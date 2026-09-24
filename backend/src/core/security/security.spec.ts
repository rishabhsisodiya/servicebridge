import { burnPasswordCheck, hashPassword, passwordProblems, verifyPassword } from './password';
import { generateToken, hashToken, safeEqual } from './tokens';

describe('tokens', () => {
  it('are long, URL-safe and unique', () => {
    const a = generateToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateToken()).not.toBe(a);
  });

  it('hash deterministically without storing the token', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
    expect(hashToken('abc')).not.toContain('abc');
    expect(hashToken('abc')).toHaveLength(64);
  });

  it('compares in constant time and handles length mismatch', () => {
    expect(safeEqual('same', 'same')).toBe(true);
    expect(safeEqual('same', 'different')).toBe(false);
  });
});

describe('password hashing', () => {
  it('verifies the right password only', async () => {
    const hash = await hashPassword('correct horse 42');
    expect(hash).toMatch(/^\$argon2id\$/);
    await expect(verifyPassword(hash, 'correct horse 42')).resolves.toBe(true);
    await expect(verifyPassword(hash, 'wrong horse 42')).resolves.toBe(false);
  });

  it('treats a malformed hash as a failed check, not a crash', async () => {
    await expect(verifyPassword('not-a-hash', 'anything')).resolves.toBe(false);
  });

  it('burns comparable time for unknown accounts', async () => {
    await expect(burnPasswordCheck('whatever1')).resolves.toBeUndefined();
  });
});

describe('passwordProblems', () => {
  it('accepts a reasonable password', () => {
    expect(passwordProblems('field-visit-2026')).toEqual([]);
  });

  it.each([
    ['short1', /at least 10/],
    ['onlyletters-here', /letter and one number/],
    ['1234567890123', /letter and one number/],
  ])('rejects %p', (password, message) => {
    expect(passwordProblems(password).join(' ')).toMatch(message);
  });

  it('rejects passwords containing the email name', () => {
    expect(passwordProblems('priya.nair2026x', { email: 'priya.nair@example.com' })).toContain(
      "Don't include your email address.",
    );
  });
});
