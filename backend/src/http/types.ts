import type { Request, Response } from 'express';
import type { z } from 'zod';

/** The authenticated principal. Permissions are loaded from the DB on every request. */
export interface AuthUser {
  id: string;
  username: string;
  fullName: string;
  roles: string[];
  permissions: Set<string>;
  mustChangePassword: boolean;
}

/** Request metadata recorded in the audit log. */
export interface RequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
}

/**
 * Who may call a route. Deny by default: every route must declare one of these
 * (enforced by the type and by test/integration/route-guard.test.ts).
 *  - public: no token
 *  - authenticated: any logged-in user (own notifications, own profile)
 *  - permission: any-of list of permission codes
 */
export type Access = { public: true } | { authenticated: true } | { permission: string | string[] };

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

export interface HandlerCtx<P, Q, B> {
  params: P;
  query: Q;
  body: B;
  /** Present on every non-public route. */
  user: AuthUser;
  meta: RequestMeta;
  file?: Express.Multer.File;
  req: Request;
  res: Response;
}

type Infer<T> = T extends z.ZodType ? z.infer<T> : undefined;

export interface RouteSpec<
  P extends z.ZodType | undefined = undefined,
  Q extends z.ZodType | undefined = undefined,
  B extends z.ZodType | undefined = undefined,
> {
  method: HttpMethod;
  /** Express-style path relative to /api/v1, e.g. "/users/:id". */
  path: string;
  summary: string;
  description?: string;
  access: Access;
  params?: P;
  query?: Q;
  body?: B;
  /** multipart/form-data with a single file field; other fields validated by `body`. */
  upload?: { field: string; maxBytes: number };
  /** Success response. `schema` documents the JSON body; omit for 204 / streams. */
  response: { status: number; description: string; schema?: z.ZodType; contentType?: string };
  /** Honour the Idempotency-Key header (money- and stock-moving commands). */
  idempotent?: boolean;
  /** Allowed while the user must still change their password. */
  allowWhilePasswordChangeRequired?: boolean;
  /** Stricter rate limit (auth endpoints). */
  strictRateLimit?: boolean;
  handler: (ctx: HandlerCtx<Infer<P>, Infer<Q>, Infer<B>>) => Promise<unknown>;
}

/** What the registry remembers about each route (used by OpenAPI and the route-guard tests). */
export interface RouteRecord {
  method: HttpMethod;
  path: string; // full express path incl. /api/v1
  tag: string;
  access: Access;
  spec: RouteSpec<z.ZodType | undefined, z.ZodType | undefined, z.ZodType | undefined>;
}
