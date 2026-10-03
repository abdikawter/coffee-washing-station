import { randomUUID } from 'node:crypto';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import type { Container } from './container.js';
import { TooManyRequestsError } from './common/errors.js';
import { API_PREFIX, Api, jsonBody } from './http/api.js';
import { errorHandler, notFoundHandler } from './http/error-handler.js';
import { idempotencyMiddleware } from './http/idempotency.js';
import { buildOpenApi } from './http/openapi.js';
import { registerAuditLogRoutes } from './modules/audit-log/audit-log.routes.js';
import { registerAuthRoutes } from './modules/auth/auth.routes.js';
import { registerEquipmentRoutes } from './modules/equipment/equipment.routes.js';
import { registerFileRoutes } from './modules/files/files.routes.js';
import { registerFinanceRoutes } from './modules/finance/finance.routes.js';
import { registerHealthRoutes } from './modules/health/health.routes.js';
import { registerLotRoutes } from './modules/lots/lots.routes.js';
import { registerPaymentRoutes } from './modules/payments/payments.routes.js';
import { registerProcessingRoutes } from './modules/processing/processing.routes.js';
import { registerPurchasingRoutes } from './modules/purchasing/purchasing.routes.js';
import { registerQualityRoutes } from './modules/quality/quality.routes.js';
import { registerSettingsRoutes } from './modules/settings/settings.routes.js';
import { registerSupplierRoutes } from './modules/suppliers/suppliers.routes.js';
import { registerUserRoutes } from './modules/users/users.routes.js';

export const APP_VERSION = process.env.npm_package_version ?? '0.1.0';

export interface AppOptions {
  /** Extra route registrations (tests use this to mount probe routes). */
  extraRoutes?: (api: Api) => void;
}

/** Builds the Express app. No listening, no background work: safe for Supertest. */
export function createApp(c: Container, opts: AppOptions = {}): { app: Express; api: Api; openApi: object } {
  const { env, pool, logger } = c;
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const incoming = req.headers['x-request-id'];
        const id = typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
      redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
      autoLogging: env.NODE_ENV !== 'test',
    }),
  );
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || env.CORS_ORIGINS.includes(origin)),
      credentials: true,
      exposedHeaders: ['X-Request-Id', 'Idempotent-Replayed'],
    }),
  );
  app.use(cookieParser());
  app.use(API_PREFIX, jsonBody);

  const limiter = (limit: number) =>
    rateLimit({
      windowMs: 60_000,
      limit,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      skip: () => env.NODE_ENV === 'test',
      handler: (_req, _res, next) => next(new TooManyRequestsError()),
    });
  app.use(API_PREFIX, limiter(600));

  const api = new Api({
    authenticate: c.auth.authenticate,
    idempotency: () => idempotencyMiddleware(pool, logger),
    strictRateLimit: limiter(20),
  });

  registerHealthRoutes(api, pool, APP_VERSION);
  registerAuthRoutes(api, c.auth, { sameSite: env.REFRESH_COOKIE_SAMESITE, secure: env.REFRESH_COOKIE_SECURE });
  registerUserRoutes(api, c.users, c.roles, c.employees);
  registerSettingsRoutes(api, pool, c.settings);
  registerAuditLogRoutes(api, pool, c.audit);
  registerFileRoutes(api, pool, c.storage, c.audit, Math.round(env.MAX_UPLOAD_MB * 1024 * 1024));
  // Phase 2 — Procurement
  registerSupplierRoutes(api, c.suppliers);
  registerQualityRoutes(api, c.quality, c.holds);
  registerEquipmentRoutes(api, c.equipment, c.scales);
  registerPurchasingRoutes(api, c.purchasing, c.settings);
  registerPaymentRoutes(api, c.payments);
  registerFinanceRoutes(api, pool, c.cash, c.audit);
  // Phase 3 — Wet processing
  registerLotRoutes(api, c.lotsQuery);
  registerProcessingRoutes(api, c.processing);
  opts.extraRoutes?.(api);

  app.use(API_PREFIX, api.router);

  const openApi = buildOpenApi(api.routes, APP_VERSION);
  app.get('/api/docs/openapi.json', (_req, res) => res.json(openApi));
  if (env.SWAGGER_ENABLED) {
    app.use('/api/docs', helmet({ contentSecurityPolicy: false }), swaggerUi.serve, swaggerUi.setup(openApi, { customSiteTitle: 'CWS API' }));
  }

  app.use(API_PREFIX, notFoundHandler);
  app.use(errorHandler(logger, env.NODE_ENV === 'production'));
  return { app, api, openApi };
}
