import { randomBytes } from 'node:crypto';
import { createReadStream, type ReadStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Injectable } from '@nestjs/common';
import { AppConfig } from '../config/app-config.service';

/** File types we accept, recognised by their first bytes (the browser's MIME type is not trusted). */
const SIGNATURES: { mime: string; ext: string; test: (b: Buffer) => boolean }[] = [
  { mime: 'image/jpeg', ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: 'image/png',
    ext: 'png',
    test: (b) =>
      b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    mime: 'image/webp',
    ext: 'webp',
    test: (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
  },
  { mime: 'application/pdf', ext: 'pdf', test: (b) => b.toString('ascii', 0, 5) === '%PDF-' },
];

export function detectFileType(buffer: Buffer): { mime: string; ext: string } | null {
  const match = SIGNATURES.find((s) => buffer.length >= 12 && s.test(buffer));
  return match ? { mime: match.mime, ext: match.ext } : null;
}

/**
 * Local-disk file storage under STORAGE_DIR. Keys are random, so a file name
 * from the user never becomes a path.
 */
@Injectable()
export class StorageService {
  private readonly root: string;

  constructor(config: AppConfig) {
    this.root = path.resolve(config.get('STORAGE_DIR'));
  }

  private resolve(key: string): string {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error('Invalid storage key');
    return full;
  }

  /** Saves the bytes and returns the key to store. `folder` must be a safe, fixed name (e.g. tickets/<id>). */
  async save(folder: string, ext: string, data: Buffer): Promise<string> {
    const key = `${folder}/${randomBytes(16).toString('hex')}.${ext}`;
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, data, { flag: 'wx' });
    return key;
  }

  read(key: string): ReadStream {
    return createReadStream(this.resolve(key));
  }

  async remove(key: string): Promise<void> {
    await fs.rm(this.resolve(key), { force: true });
  }
}
