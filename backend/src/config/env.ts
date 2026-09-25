import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

/**
 * Environment schema. Validated once at boot; the process refuses to start on
 * invalid configuration (ARCHITECTURE.md §14 "Secrets").
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    TRUST_PROXY: z.coerce.number().int().min(0).default(1),

    DATABASE_URL: z.string().min(1),
    DATABASE_SSL: bool.default(false),
    DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_ISSUER: z.string().default('cws-api'),
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:5173')
      .transform((s) => s.split(',').map((o) => o.trim()).filter(Boolean)),
    REFRESH_COOKIE_SAMESITE: z.enum(['strict', 'lax', 'none']).default('lax'),
    REFRESH_COOKIE_SECURE: bool.default(false),

    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    LOCAL_STORAGE_DIR: z.string().default('./storage'),
    MAX_UPLOAD_MB: z.coerce.number().positive().max(100).default(10),
    S3_BUCKET: z.string().optional(),
    S3_REGION: z.string().default('auto'),
    S3_ENDPOINT: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: bool.default(false),

    RUN_WORKER_IN_PROCESS: bool.default(true),
    SWAGGER_ENABLED: bool.default(true),

    SEED_ADMIN_USERNAME: z.string().default('admin'),
    SEED_ADMIN_FULL_NAME: z.string().default('System Administrator'),
    SEED_ADMIN_PASSWORD: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.STORAGE_DRIVER === 's3') {
      for (const k of ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const) {
        if (!env[k]) ctx.addIssue({ code: 'custom', path: [k], message: `${k} is required when STORAGE_DRIVER=s3` });
      }
    }
    if (env.REFRESH_COOKIE_SAMESITE === 'none' && !env.REFRESH_COOKIE_SECURE) {
      ctx.addIssue({ code: 'custom', path: ['REFRESH_COOKIE_SECURE'], message: 'SameSite=none requires REFRESH_COOKIE_SECURE=true' });
    }
    if (env.NODE_ENV === 'production' && env.JWT_ACCESS_SECRET.startsWith('change-me')) {
      ctx.addIssue({ code: 'custom', path: ['JWT_ACCESS_SECRET'], message: 'set a real secret in production' });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  return parsed.data;
}
