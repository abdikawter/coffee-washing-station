import express, { type NextFunction, type Request, type RequestHandler, type Response, Router } from 'express';
import multer from 'multer';
import type { z } from 'zod';
import { ForbiddenError, UnauthorizedError, ValidationError } from '../common/errors.js';
import type { Access, AuthUser, RequestMeta, RouteRecord, RouteSpec } from './types.js';

export const API_PREFIX = '/api/v1';

export interface ApiDeps {
  authenticate: (req: Request) => Promise<AuthUser>;
  idempotency: (spec: RouteSpec<z.ZodType | undefined, z.ZodType | undefined, z.ZodType | undefined>) => RequestHandler | undefined;
  strictRateLimit: RequestHandler;
}

export function hasAccess(user: AuthUser | undefined, access: Access): boolean {
  if ('public' in access) return true;
  if (!user) return false;
  if ('authenticated' in access) return true;
  const needed = Array.isArray(access.permission) ? access.permission : [access.permission];
  return needed.some((p) => user.permissions.has(p));
}

export function requestMeta(req: Request): RequestMeta {
  return {
    ipAddress: req.ip ?? null,
    userAgent: req.get('user-agent')?.slice(0, 500) ?? null,
    requestId: (req.id as string | undefined) ?? null,
  };
}

function zodDetails(error: z.ZodError, location: string) {
  return error.issues.map((i) => ({ location, path: i.path.join('.'), message: i.message, code: i.code }));
}

/**
 * The only way to register an endpoint. Each route declares its access rule,
 * schemas and success response, which gives us:
 *   deny-by-default authorization, request validation, Swagger docs and the
 *   generated authorization-matrix tests — all from one definition.
 *
 * Middleware order: [strict rate limit] → authenticate → password-change gate →
 * permission check → [multipart] → validation → [idempotency] → handler.
 * Authorization runs before validation so a caller without permission always
 * gets 403, never a hint about the payload shape.
 */
export class Api {
  readonly router: Router = Router();
  readonly routes: RouteRecord[] = [];

  constructor(private readonly deps: ApiDeps) {}

  route<P extends z.ZodType | undefined, Q extends z.ZodType | undefined, B extends z.ZodType | undefined>(
    tag: string,
    spec: RouteSpec<P, Q, B>,
  ): void {
    const record: RouteRecord = { method: spec.method, path: API_PREFIX + spec.path, tag, access: spec.access, spec: spec as never };
    if (this.routes.some((r) => r.method === record.method && r.path === record.path)) {
      throw new Error(`Duplicate route ${record.method.toUpperCase()} ${record.path}`);
    }
    this.routes.push(record);

    const chain: RequestHandler[] = [];
    if (spec.strictRateLimit) chain.push(this.deps.strictRateLimit);

    if (!('public' in spec.access)) {
      chain.push(async (req: Request, res: Response, next: NextFunction) => {
        const user = await this.deps.authenticate(req);
        res.locals.user = user;
        if (user.mustChangePassword && !spec.allowWhilePasswordChangeRequired) {
          throw new ForbiddenError('You must change your password before continuing', 'PASSWORD_CHANGE_REQUIRED');
        }
        if (!hasAccess(user, spec.access)) {
          throw new ForbiddenError(undefined, 'FORBIDDEN', { required: (spec.access as { permission: unknown }).permission });
        }
        next();
      });
    }

    if (spec.upload) {
      const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: spec.upload.maxBytes, files: 1 } });
      const field = spec.upload.field;
      chain.push((req, res, next) =>
        upload.single(field)(req, res, (err: unknown) => {
          if (!err) return next();
          if (err instanceof multer.MulterError) {
            return next(new ValidationError([{ location: 'body', path: field, message: err.message, code: err.code }], 'Upload rejected'));
          }
          next(err);
        }),
      );
    }

    chain.push((req: Request, res: Response, next: NextFunction) => {
      const parsed: Record<string, unknown> = {};
      const errors: unknown[] = [];
      for (const [loc, schema, value] of [
        ['params', spec.params, req.params],
        ['query', spec.query, req.query],
        ['body', spec.body, req.body ?? {}],
      ] as const) {
        if (!schema) {
          parsed[loc] = undefined;
          continue;
        }
        const r = (schema as z.ZodType).safeParse(value);
        if (r.success) parsed[loc] = r.data;
        else errors.push(...zodDetails(r.error, loc));
      }
      if (errors.length) throw new ValidationError(errors);
      res.locals.parsed = parsed;
      next();
    });

    const idem = spec.idempotent ? this.deps.idempotency(spec) : undefined;
    if (idem) chain.push(idem);

    chain.push(async (req: Request, res: Response) => {
      const parsed = res.locals.parsed as { params: never; query: never; body: never };
      const result = await spec.handler({
        params: parsed.params,
        query: parsed.query,
        body: parsed.body,
        user: res.locals.user as AuthUser,
        meta: requestMeta(req),
        file: req.file,
        req,
        res,
      });
      if (res.headersSent) return;
      if (spec.response.status === 204 || result === undefined) {
        res.status(spec.response.status === 200 && result === undefined ? 204 : spec.response.status).end();
        return;
      }
      // A handler may set a different status explicitly (e.g. readiness 503).
      res.status(res.statusCode !== 200 ? res.statusCode : spec.response.status).json(result);
    });

    this.router[spec.method](spec.path, ...chain);
  }
}

/** JSON body parser used for the API (1 MB is plenty for forms; files go through multipart). */
export const jsonBody = express.json({ limit: '1mb' });

/** Throws when a route handler forgot that `user` is only set on non-public routes. */
export function requireUser(user: AuthUser | undefined): AuthUser {
  if (!user) throw new UnauthorizedError();
  return user;
}
