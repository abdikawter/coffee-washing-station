import { OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import type { z } from 'zod';
import { errorEnvelope } from './schemas.js';
import type { RouteRecord } from './types.js';

const ERROR_RESPONSES: Record<string, string> = {
  '400': 'Validation error',
  '401': 'Not authenticated',
  '403': 'Forbidden / segregation of duties / password change required',
  '404': 'Not found',
  '409': 'Conflict / stale version',
  '422': 'Business rule violation',
  '429': 'Rate limited',
};

function accessText(r: RouteRecord): string {
  if ('public' in r.access) return 'Public.';
  if ('authenticated' in r.access) return 'Any authenticated user.';
  const p = Array.isArray(r.access.permission) ? r.access.permission : [r.access.permission];
  return `Requires permission: ${p.map((x) => `\`${x}\``).join(' or ')}.`;
}

/** Builds the OpenAPI 3 document from the route registry (served at /api/docs). */
export function buildOpenApi(routes: RouteRecord[], version: string): object {
  const registry = new OpenAPIRegistry();
  registry.registerComponent('securitySchemes', 'bearerAuth', { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' });
  // Named schemas use zod's .meta({ id }) — no prototype patching (avoids the ESM/CJS dual-package hazard).

  for (const r of routes) {
    const s = r.spec;
    const isPublic = 'public' in r.access;
    const responses: Record<string, object> = {};
    responses[String(s.response.status)] = {
      description: s.response.description,
      ...(s.response.schema
        ? { content: { [s.response.contentType ?? 'application/json']: { schema: s.response.schema } } }
        : s.response.contentType
          ? { content: { [s.response.contentType]: { schema: { type: 'string', format: 'binary' } } } }
          : {}),
    };
    for (const [code, description] of Object.entries(ERROR_RESPONSES)) {
      if (isPublic && (code === '401' || code === '403') && !s.strictRateLimit) continue;
      responses[code] = { description, content: { 'application/json': { schema: errorEnvelope } } };
    }

    const request: Record<string, unknown> = {};
    if (s.params) request.params = s.params as z.ZodObject;
    if (s.query) request.query = s.query as z.ZodObject;
    if (s.body) {
      request.body = s.upload
        ? { content: { 'multipart/form-data': { schema: s.body } } }
        : { content: { 'application/json': { schema: s.body } } };
    }
    const headers = s.idempotent ? { 'Idempotency-Key': { description: 'Retry-safe key (8–200 chars)' } } : undefined;

    registry.registerPath({
      method: r.method,
      path: r.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
      tags: [r.tag],
      summary: s.summary,
      description: [s.description, accessText(r), s.idempotent ? 'Accepts an `Idempotency-Key` header.' : '']
        .filter(Boolean)
        .join('\n\n'),
      security: isPublic ? [] : [{ bearerAuth: [] }],
      request: request as never,
      responses: responses as never,
      ...(headers ? { 'x-idempotent': true } : {}),
      'x-access': r.access,
    } as never);
  }

  return new OpenApiGeneratorV3(registry.definitions).generateDocument({
    openapi: '3.0.3',
    info: {
      title: 'Coffee Washing Station Management System API',
      version,
      description:
        'REST API. Decimals are strings, timestamps ISO-8601 UTC, business dates YYYY-MM-DD. ' +
        'Authenticate with POST /auth/login, send the access token as `Authorization: Bearer`, ' +
        'renew it with POST /auth/refresh (httpOnly cookie).',
    },
    servers: [{ url: '/' }],
  });
}
