import pino, { type Logger } from 'pino';
import type { Env } from './config/env.js';

/** Structured JSON logs to stdout (Render collects them). Pretty output only in development. */
export function createLogger(env: Pick<Env, 'LOG_LEVEL' | 'NODE_ENV'>): Logger {
  return pino({
    level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
    redact: { paths: ['password', '*.password', '*.newPassword', '*.currentPassword', '*.temporaryPassword', 'refreshToken'], censor: '[REDACTED]' },
    ...(env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty', options: { singleLine: true } } } : {}),
  });
}
