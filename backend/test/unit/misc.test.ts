import { loadEnv } from '../../src/config/env.js';
import { mapPgError } from '../../src/common/errors.js';
import { hasAccess } from '../../src/http/api.js';
import { checkPasswordPolicy } from '../../src/modules/auth/password.js';
import { sniffMime } from '../../src/core/storage/storage.js';
import type { AuthUser } from '../../src/http/types.js';

const user = (perms: string[]): AuthUser => ({ id: 'u', username: 'u', fullName: 'U', roles: [], permissions: new Set(perms), mustChangePassword: false });

describe('hasAccess (deny by default)', () => {
  it('handles public, authenticated and any-of permissions', () => {
    expect(hasAccess(undefined, { public: true })).toBe(true);
    expect(hasAccess(undefined, { authenticated: true })).toBe(false);
    expect(hasAccess(user([]), { authenticated: true })).toBe(true);
    expect(hasAccess(user(['a:b']), { permission: 'a:b' })).toBe(true);
    expect(hasAccess(user(['a:c']), { permission: ['a:b', 'a:c'] })).toBe(true);
    expect(hasAccess(user(['a:c']), { permission: 'a:b' })).toBe(false);
  });
});

describe('password policy', () => {
  const policy = { minLength: 10, requireLetter: true, requireDigit: true };
  it('accepts a good password and lists problems otherwise', () => {
    expect(checkPasswordPolicy('Harvest2026x', policy)).toEqual([]);
    expect(checkPasswordPolicy('short1', policy)).toContain('at least 10 characters');
    expect(checkPasswordPolicy('onlyletterslong', policy)).toContain('at least one digit');
    expect(checkPasswordPolicy('abebe12345678', policy, { username: 'abebe' })).toContain('must not contain the username');
  });
});

describe('pg error mapping', () => {
  it('maps constraint errors to API errors', () => {
    expect(mapPgError({ code: '23505', constraint: 'users_username_key' })).toMatchObject({ statusCode: 409, code: 'DUPLICATE' });
    expect(mapPgError({ code: '23514', constraint: 'ck_srv_sod' })).toMatchObject({ statusCode: 403, code: 'SEGREGATION_OF_DUTIES' });
    expect(mapPgError({ code: '23514', constraint: 'ck_moisture' })).toMatchObject({ statusCode: 422 });
    expect(mapPgError({ code: 'P0A01' })).toMatchObject({ statusCode: 409, code: 'APPEND_ONLY' });
    expect(mapPgError(new Error('x'))).toBeUndefined();
  });
});

describe('file type sniffing', () => {
  it('identifies by magic bytes, not by name', () => {
    expect(sniffMime(Buffer.from('%PDF-1.7 ...'))?.mime).toBe('application/pdf');
    expect(sniffMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))?.mime).toBe('image/png');
    expect(sniffMime(Buffer.from('<html><script>'))).toBeUndefined();
  });
});

describe('environment validation', () => {
  const base = { DATABASE_URL: 'postgres://x/y', JWT_ACCESS_SECRET: 'x'.repeat(40) };
  it('applies defaults', () => {
    const env = loadEnv(base);
    expect(env.PORT).toBe(4000);
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:5173']);
    expect(env.RUN_WORKER_IN_PROCESS).toBe(true);
  });
  it('rejects unsafe or incomplete configuration', () => {
    expect(() => loadEnv({ ...base, JWT_ACCESS_SECRET: 'short' })).toThrow(/JWT_ACCESS_SECRET/);
    expect(() => loadEnv({ ...base, STORAGE_DRIVER: 's3' })).toThrow(/S3_BUCKET/);
    expect(() => loadEnv({ ...base, REFRESH_COOKIE_SAMESITE: 'none' })).toThrow(/REFRESH_COOKIE_SECURE/);
    expect(() => loadEnv({ ...base, NODE_ENV: 'production', JWT_ACCESS_SECRET: 'change-me-' + 'x'.repeat(40) })).toThrow(/production/);
  });
});
