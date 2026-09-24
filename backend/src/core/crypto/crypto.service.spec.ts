import type { AppConfig } from '../config/app-config.service';
import { parseEncryptionKeys } from '../config/env.schema';
import { CryptoService, DecryptionError } from './crypto.service';

const key = (fill: number) => Buffer.alloc(32, fill).toString('base64');
const serviceWith = (raw: string) =>
  new CryptoService({ get: () => parseEncryptionKeys(raw) } as unknown as AppConfig);

describe('CryptoService', () => {
  const crypto = serviceWith(`v1:${key(1)}`);

  it('round-trips a secret and never stores it in the clear', () => {
    const stored = crypto.encrypt('api-secret-123');
    expect(stored).not.toContain('api-secret-123');
    expect(stored.startsWith('v1:')).toBe(true);
    expect(crypto.decrypt(stored)).toBe('api-secret-123');
  });

  it('uses a fresh IV each time', () => {
    expect(crypto.encrypt('same')).not.toBe(crypto.encrypt('same'));
  });

  it('detects tampering', () => {
    const [v, iv, tag, data] = crypto.encrypt('secret').split(':');
    const flipped = Buffer.from(data, 'base64url');
    flipped[0] ^= 0xff;
    expect(() => crypto.decrypt([v, iv, tag, flipped.toString('base64url')].join(':'))).toThrow(
      new DecryptionError('tampered'),
    );
  });

  it('rejects malformed values and unknown key versions', () => {
    expect(() => crypto.decrypt('nonsense')).toThrow(new DecryptionError('malformed'));
    expect(() => crypto.decrypt('v9:a:b:c')).toThrow(new DecryptionError('unknown_key'));
  });

  it('decrypts old values after rotation and flags them for re-encryption', () => {
    const old = crypto.encrypt('legacy');
    const rotated = serviceWith(`v2:${key(2)},v1:${key(1)}`);
    expect(rotated.decrypt(old)).toBe('legacy');
    expect(rotated.needsRotation(old)).toBe(true);
    const fresh = rotated.encrypt('legacy');
    expect(fresh.startsWith('v2:')).toBe(true);
    expect(rotated.needsRotation(fresh)).toBe(false);
  });

  it('cannot decrypt with the wrong key', () => {
    const stored = crypto.encrypt('secret');
    const other = serviceWith(`v1:${key(7)}`);
    expect(() => other.decrypt(stored)).toThrow(new DecryptionError('tampered'));
  });
});
