import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type pg from 'pg';
import type { Logger } from 'pino';
import { BusinessRuleError, ConflictError, ValidationError } from '../common/errors.js';
import { canonicalJson, sha256Hex } from '../common/util.js';
import type { AuthUser } from './types.js';

const TTL_HOURS = 24;

/**
 * Idempotency-Key support for money- and stock-moving commands (ARCHITECTURE.md §8).
 * Keyed by (user, route, key) in PostgreSQL for 24 h:
 *  - first request: row IN_PROGRESS → handler runs → 2xx response stored before it is sent;
 *    non-2xx deletes the row so the client may retry
 *  - same key + same body after completion: stored response replayed (header Idempotent-Replayed: true)
 *  - same key + different body: 422 IDEMPOTENCY_KEY_REUSED
 *  - same key while the first is still running: 409 IDEMPOTENCY_IN_PROGRESS
 */
export function idempotencyMiddleware(pool: pg.Pool, logger: Logger): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const key = req.get('Idempotency-Key');
    if (!key) return next();
    if (key.length < 8 || key.length > 200) {
      throw new ValidationError([{ location: 'header', path: 'Idempotency-Key', message: 'must be 8–200 characters' }]);
    }
    const user = res.locals.user as AuthUser;
    const route = `${req.method} ${req.originalUrl.split('?')[0]}`;
    const requestHash = sha256Hex(canonicalJson(req.body ?? null));

    await pool.query('DELETE FROM idempotency_keys WHERE user_id = $1 AND route = $2 AND key = $3 AND expires_at < now()', [user.id, route, key]);
    const ins = await pool.query(
      `INSERT INTO idempotency_keys (user_id, route, key, request_hash, expires_at)
       VALUES ($1, $2, $3, $4, now() + ($5 || ' hours')::interval)
       ON CONFLICT DO NOTHING RETURNING key`,
      [user.id, route, key, requestHash, String(TTL_HOURS)],
    );

    if (ins.rowCount === 0) {
      const { rows } = await pool.query(
        'SELECT request_hash, status, response_status, response_body FROM idempotency_keys WHERE user_id = $1 AND route = $2 AND key = $3',
        [user.id, route, key],
      );
      const prev = rows[0];
      if (!prev) throw new ConflictError('Idempotency key is being processed, retry shortly', 'IDEMPOTENCY_IN_PROGRESS');
      if (prev.request_hash !== requestHash) {
        throw new BusinessRuleError('IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used with a different request body');
      }
      if (prev.status !== 'COMPLETED') throw new ConflictError('The original request is still being processed', 'IDEMPOTENCY_IN_PROGRESS');
      res.set('Idempotent-Replayed', 'true');
      res.status(prev.response_status).json(prev.response_body);
      return;
    }

    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      const ok = res.statusCode >= 200 && res.statusCode < 300;
      const persist = ok
        ? pool.query(
            `UPDATE idempotency_keys SET status = 'COMPLETED', response_status = $4, response_body = $5
              WHERE user_id = $1 AND route = $2 AND key = $3`,
            [user.id, route, key, res.statusCode, JSON.stringify(body ?? null)],
          )
        : pool.query('DELETE FROM idempotency_keys WHERE user_id = $1 AND route = $2 AND key = $3', [user.id, route, key]);
      persist
        .catch((err) => logger.error({ err }, 'failed to persist idempotency result'))
        .finally(() => originalJson(body));
      return res;
    }) as Response['json'];

    // Responses without a JSON body (204) still complete the key.
    res.on('finish', () => {
      if (res.statusCode === 204) {
        pool
          .query(`UPDATE idempotency_keys SET status = 'COMPLETED', response_status = 204 WHERE user_id = $1 AND route = $2 AND key = $3`, [user.id, route, key])
          .catch((err) => logger.error({ err }, 'failed to persist idempotency result'));
      }
    });
    next();
  };
}
