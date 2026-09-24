import { parseEncryptionKeys, validateEnv } from './env.schema';

const key = (fill: number) => Buffer.alloc(32, fill).toString('base64');

const baseEnv = {
  DATABASE_URL: 'postgresql://sb:sb@localhost:5432/servicebridge',
  REDIS_URL: 'redis://localhost:6379',
  APP_ENCRYPTION_KEYS: `v1:${key(1)}`,
};

describe('parseEncryptionKeys', () => {
  it('keeps order so the first key is the current one', () => {
    const keys = parseEncryptionKeys(`v2:${key(2)}, v1:${key(1)}`);
    expect(keys.map((k) => k.version)).toEqual(['v2', 'v1']);
    expect(keys[0].key).toHaveLength(32);
  });

  it.each([
    ['', /at least one key/],
    [key(1), /must start with a version/],
    [`v1:${Buffer.alloc(16).toString('base64')}`, /must be 32 bytes/],
    [`v1:${key(1)},v1:${key(2)}`, /more than once/],
  ])('rejects %p', (raw, message) => {
    expect(() => parseEncryptionKeys(raw)).toThrow(message);
  });
});

describe('validateEnv', () => {
  it('applies defaults', () => {
    const env = validateEnv(baseEnv);
    expect(env.PORT).toBe(4000);
    expect(env.APP_ENV).toBe('development');
    expect(env.CORS_ORIGINS).toEqual([]);
  });

  it('splits CORS_ORIGINS', () => {
    const env = validateEnv({
      ...baseEnv,
      CORS_ORIGINS: 'http://localhost:3000, https://app.example.com',
    });
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:3000', 'https://app.example.com']);
  });

  it('lists every problem at once', () => {
    expect(() => validateEnv({ APP_ENCRYPTION_KEYS: 'nope' })).toThrow(
      /DATABASE_URL[\s\S]*REDIS_URL[\s\S]*APP_ENCRYPTION_KEYS/,
    );
  });

  it('never echoes key material in errors', () => {
    const secret = Buffer.alloc(16, 7).toString('base64');
    try {
      validateEnv({ ...baseEnv, APP_ENCRYPTION_KEYS: `v1:${secret}` });
      fail('expected validation to fail');
    } catch (error) {
      expect((error as Error).message).not.toContain(secret);
    }
  });
});
