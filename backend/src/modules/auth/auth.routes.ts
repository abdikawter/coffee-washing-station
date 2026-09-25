import type { CookieOptions, Response } from 'express';
import { z } from 'zod';
import type { Api } from '../../http/api.js';
import { API_PREFIX } from '../../http/api.js';
import { single } from '../../http/schemas.js';
import { AuthService, type SessionTokens } from './auth.service.js';

export const REFRESH_COOKIE = 'cws_rt';

export interface CookieConfig {
  sameSite: 'strict' | 'lax' | 'none';
  secure: boolean;
}

export const principalSchema = z
  .object({
    id: z.uuid(),
    username: z.string(),
    fullName: z.string(),
    email: z.string().nullable(),
    mustChangePassword: z.boolean(),
    roles: z.array(z.string()),
    permissions: z.array(z.string()),
  })
  .meta({ id: 'Principal' });

const sessionSchema = z
  .object({
    accessToken: z.string(),
    tokenType: z.literal('Bearer'),
    expiresIn: z.number().int().meta({ description: 'Access token lifetime in seconds' }),
    user: principalSchema,
  })
  .meta({ id: 'Session' });

export function registerAuthRoutes(api: Api, auth: AuthService, cookie: CookieConfig): void {
  const cookieOpts = (expires?: Date): CookieOptions => ({
    httpOnly: true,
    secure: cookie.secure,
    sameSite: cookie.sameSite,
    path: `${API_PREFIX}/auth`,
    ...(expires ? { expires } : {}),
  });
  const sendSession = (res: Response, s: { tokens: SessionTokens; user: ReturnType<typeof AuthService.view> }) => {
    res.cookie(REFRESH_COOKIE, s.tokens.refreshToken, cookieOpts(s.tokens.refreshTokenExpiresAt));
    return { data: { accessToken: s.tokens.accessToken, tokenType: 'Bearer' as const, expiresIn: s.tokens.accessTokenExpiresIn, user: s.user } };
  };

  api.route('Auth', {
    method: 'post',
    path: '/auth/login',
    summary: 'Sign in',
    description: 'Returns an access token and sets the httpOnly refresh cookie. Locks the account after `auth.maxFailedLogins` failures.',
    access: { public: true },
    strictRateLimit: true,
    body: z.object({ username: z.string().min(1).max(100), password: z.string().min(1).max(200) }).strict(),
    response: { status: 200, description: 'Signed in', schema: single(sessionSchema) },
    handler: async ({ body, meta, res }) => sendSession(res, await auth.login(body.username, body.password, meta)),
  });

  api.route('Auth', {
    method: 'post',
    path: '/auth/refresh',
    summary: 'Rotate the refresh cookie and get a new access token',
    description: 'Reusing a rotated refresh token revokes the whole session family.',
    access: { public: true },
    strictRateLimit: true,
    response: { status: 200, description: 'New session', schema: single(sessionSchema) },
    handler: async ({ req, res, meta }) => {
      try {
        return sendSession(res, await auth.refresh(req.cookies?.[REFRESH_COOKIE], meta));
      } catch (err) {
        res.clearCookie(REFRESH_COOKIE, cookieOpts());
        throw err;
      }
    },
  });

  api.route('Auth', {
    method: 'post',
    path: '/auth/logout',
    summary: 'Sign out (revokes the refresh-token family)',
    access: { public: true },
    response: { status: 204, description: 'Signed out' },
    handler: async ({ req, res, meta }) => {
      await auth.logout(req.cookies?.[REFRESH_COOKIE], meta);
      res.clearCookie(REFRESH_COOKIE, cookieOpts());
      return undefined;
    },
  });

  api.route('Auth', {
    method: 'post',
    path: '/auth/change-password',
    summary: 'Change own password',
    description: 'Required after first login or an admin reset. Revokes all sessions and starts a new one.',
    access: { authenticated: true },
    allowWhilePasswordChangeRequired: true,
    strictRateLimit: true,
    body: z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(1).max(200) }).strict(),
    response: { status: 200, description: 'Password changed; new session', schema: single(sessionSchema) },
    handler: async ({ body, user, meta, res }) => sendSession(res, await auth.changePassword(user, body.currentPassword, body.newPassword, meta)),
  });

  api.route('Auth', {
    method: 'get',
    path: '/auth/me',
    summary: 'Current user, roles and effective permissions',
    access: { authenticated: true },
    allowWhilePasswordChangeRequired: true,
    response: { status: 200, description: 'Current principal', schema: single(principalSchema) },
    handler: async ({ user }) => ({ data: AuthService.view(user) }),
  });
}
