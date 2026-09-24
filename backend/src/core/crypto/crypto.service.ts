import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppConfig } from '../config/app-config.service';
import type { EncryptionKey } from '../config/env.schema';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

export class DecryptionError extends Error {
  constructor(readonly reason: 'unknown_key' | 'malformed' | 'tampered') {
    super(`Secret could not be decrypted (${reason})`);
  }
}

/**
 * Encrypts secrets stored in the database (ERP and SMTP credentials).
 * Format: `v{n}:{iv}:{authTag}:{ciphertext}` (base64url parts). The version
 * names the key, so keys can rotate: new values use the first key in
 * APP_ENCRYPTION_KEYS, and older values still decrypt while their key is listed.
 * GCM authenticates the data, so a tampered value fails instead of decrypting to garbage.
 */
@Injectable()
export class CryptoService {
  private readonly keys: EncryptionKey[];

  constructor(config: AppConfig) {
    this.keys = config.get('APP_ENCRYPTION_KEYS');
  }

  get currentVersion(): string {
    return this.keys[0].version;
  }

  encrypt(plaintext: string): string {
    const { version, key } = this.keys[0];
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [version, iv, tag, ciphertext]
      .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
      .join(':');
  }

  decrypt(stored: string): string {
    const parts = stored.split(':');
    if (parts.length !== 4) throw new DecryptionError('malformed');
    const [version, iv, tag, ciphertext] = parts;
    const entry = this.keys.find((k) => k.version === version);
    if (!entry) throw new DecryptionError('unknown_key');
    try {
      const decipher = createDecipheriv(ALGORITHM, entry.key, Buffer.from(iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertext, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new DecryptionError('tampered');
    }
  }

  /** Key version a stored value was encrypted with, without decrypting it. */
  versionOf(stored: string): string | undefined {
    return stored.split(':')[0];
  }

  /** True when the value should be re-encrypted with the current key. */
  needsRotation(stored: string): boolean {
    return this.versionOf(stored) !== this.currentVersion;
  }
}
