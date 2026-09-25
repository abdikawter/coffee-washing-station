import argon2 from 'argon2';
import type { PasswordPolicy } from '../../core/settings/registry.js';

/** argon2id (ARCHITECTURE.md §14). */
export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
}

export function verifyPassword(hash: string, plain: string): Promise<boolean> {
  return argon2.verify(hash, plain).catch(() => false);
}

/** Returns a list of unmet rules (empty = acceptable). */
export function checkPasswordPolicy(plain: string, policy: PasswordPolicy, context: { username?: string } = {}): string[] {
  const problems: string[] = [];
  if (plain.length < policy.minLength) problems.push(`at least ${policy.minLength} characters`);
  if (plain.length > 128) problems.push('at most 128 characters');
  if (policy.requireLetter && !/\p{L}/u.test(plain)) problems.push('at least one letter');
  if (policy.requireDigit && !/\d/.test(plain)) problems.push('at least one digit');
  if (context.username && plain.toLowerCase().includes(context.username.toLowerCase())) problems.push('must not contain the username');
  return problems;
}

/** Used to keep login timing constant for unknown usernames. */
let dummyHash: Promise<string> | undefined;
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword('dummy-password-for-timing-1');
  return dummyHash;
}
