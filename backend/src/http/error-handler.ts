import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { Logger } from 'pino';
import { AppError, mapPgError } from '../common/errors.js';

/** 404 for unknown API routes. */
export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    statusCode: 404,
    error: 'NOT_FOUND',
    code: 'ROUTE_NOT_FOUND',
    message: `No route ${req.method} ${req.path}`,
    timestamp: new Date().toISOString(),
    path: req.originalUrl,
    requestId: (req.id as string | undefined) ?? null,
  });
};

/**
 * Uniform error envelope (ARCHITECTURE.md §8). Unknown errors become 500 and
 * their message is hidden in production.
 */
export function errorHandler(logger: Logger, isProduction: boolean): ErrorRequestHandler {
  return (err, req, res, _next) => {
    let appErr: AppError | undefined = err instanceof AppError ? err : mapPgError(err);

    // body-parser errors (malformed JSON / too large)
    if (!appErr && err && typeof err === 'object' && 'type' in err) {
      const type = (err as { type: string }).type;
      if (type === 'entity.parse.failed') appErr = new AppError(400, 'VALIDATION_ERROR', 'MALFORMED_JSON', 'Malformed JSON body');
      if (type === 'entity.too.large') appErr = new AppError(413, 'PAYLOAD_TOO_LARGE', 'PAYLOAD_TOO_LARGE', 'Request body too large');
    }

    const status = appErr?.statusCode ?? 500;
    if (status >= 500) logger.error({ err, requestId: req.id }, 'unhandled error');
    else if (!appErr?.statusCode || status === 409) logger.warn({ err: { message: (err as Error).message, code: appErr?.code }, requestId: req.id }, 'request failed');

    if (res.headersSent) return;
    res.status(status).json({
      statusCode: status,
      error: appErr?.error ?? 'INTERNAL_SERVER_ERROR',
      code: appErr?.code ?? 'INTERNAL_ERROR',
      message: appErr ? appErr.message : isProduction ? 'Internal server error' : String((err as Error)?.message ?? err),
      ...(appErr?.details !== undefined ? { details: appErr.details } : {}),
      timestamp: new Date().toISOString(),
      path: req.originalUrl,
      requestId: (req.id as string | undefined) ?? null,
    });
  };
}
