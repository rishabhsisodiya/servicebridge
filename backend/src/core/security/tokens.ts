import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 256 bits of randomness, URL-safe. Used for refresh tokens and invite/reset links. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Tokens are high-entropy random values, so a fast hash is enough: we store
 * only the hash, and a database leak can't be replayed as a login.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
