import axios, { AxiosError, type AxiosRequestConfig } from 'axios';
import type { ApiErrorBody, Session } from './types';

/**
 * Axios instance for the REST API.
 * - The access token lives only in memory (never localStorage).
 * - The refresh token is an httpOnly cookie the browser sends to /api/v1/auth/*.
 * - On 401 TOKEN_EXPIRED/INVALID_TOKEN the request is retried once after a
 *   single-flight refresh (concurrent 401s share one refresh call, which keeps
 *   refresh-token rotation from tripping reuse detection).
 */
export const API_BASE = `${import.meta.env.VITE_API_BASE_URL ?? ''}/api/v1`;

export const http = axios.create({ baseURL: API_BASE, withCredentials: true, timeout: 30_000 });

let accessToken: string | null = null;
let onSessionChange: (s: Session | null) => void = () => undefined;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}
export function getAccessToken(): string | null {
  return accessToken;
}
export function onSession(cb: (s: Session | null) => void): void {
  onSessionChange = cb;
}

http.interceptors.request.use((config) => {
  if (accessToken) config.headers.set('Authorization', `Bearer ${accessToken}`);
  return config;
});

let refreshing: Promise<Session | null> | null = null;

/** Single-flight refresh. Resolves to null when the session cannot be renewed. */
export function refreshSession(): Promise<Session | null> {
  refreshing ??= axios
    .post<{ data: Session }>(`${API_BASE}/auth/refresh`, null, { withCredentials: true })
    .then((r) => {
      setAccessToken(r.data.data.accessToken);
      onSessionChange(r.data.data);
      return r.data.data;
    })
    .catch(() => {
      setAccessToken(null);
      onSessionChange(null);
      return null;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

const RETRYABLE = new Set(['TOKEN_EXPIRED', 'INVALID_TOKEN', 'UNAUTHORIZED']);

http.interceptors.response.use(undefined, async (error: AxiosError<ApiErrorBody>) => {
  const original = error.config as (AxiosRequestConfig & { _retried?: boolean }) | undefined;
  const code = error.response?.data?.code;
  const isAuthCall = original?.url?.startsWith('/auth/');
  if (error.response?.status === 401 && original && !original._retried && !isAuthCall && code && RETRYABLE.has(code)) {
    original._retried = true;
    const session = await refreshSession();
    if (session) return http(original);
  }
  throw error;
});

/** Human-readable message from any API error. */
export function errorMessage(err: unknown): string {
  if (axios.isAxiosError<ApiErrorBody>(err)) {
    const body = err.response?.data;
    if (body?.message) {
      const details = Array.isArray(body.details)
        ? (body.details as { path?: string; message?: string }[])
            .map((d) => (d.path ? `${d.path}: ${d.message}` : d.message))
            .filter(Boolean)
            .join('; ')
        : '';
      return details ? `${body.message} — ${details}` : body.message;
    }
    if (!err.response) return 'Cannot reach the server. Check the connection and try again.';
  }
  return err instanceof Error ? err.message : 'Unexpected error';
}

export function errorCode(err: unknown): string | undefined {
  return axios.isAxiosError<ApiErrorBody>(err) ? err.response?.data?.code : undefined;
}
