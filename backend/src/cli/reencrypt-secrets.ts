/* eslint-disable no-console -- command-line tool: console output is the interface */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { CryptoService } from '../core/crypto/crypto.service';
import { PrismaService } from '../core/prisma/prisma.service';

/**
 * Key rotation, step 2. Step 1: put the new key first in APP_ENCRYPTION_KEYS
 * and keep the old one after it (v2:<new>,v1:<old>). This command re-encrypts
 * every stored secret with the new key. Step 3: remove the old key.
 */
const FIELDS = ['apiKeyEnc', 'apiSecretEnc', 'dbPasswordEnc'] as const;

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const crypto = app.get(CryptoService);
  const prisma = app.get(PrismaService);
  let rotated = 0;
  const failed: string[] = [];

  try {
    const connections = await prisma.erpConnection.findMany();
    for (const connection of connections) {
      const updates: Partial<Record<(typeof FIELDS)[number], string>> = {};
      try {
        for (const field of FIELDS) {
          const stored = connection[field];
          if (stored && crypto.needsRotation(stored))
            updates[field] = crypto.encrypt(crypto.decrypt(stored));
        }
      } catch {
        failed.push(connection.name);
        await prisma.erpConnection.update({
          where: { id: connection.id },
          data: { status: 'KEY_ERROR' },
        });
        continue;
      }
      if (Object.keys(updates).length) {
        await prisma.erpConnection.update({ where: { id: connection.id }, data: updates });
        rotated += 1;
      }
    }
    console.log(
      `Re-encrypted secrets for ${rotated} ERP connection(s) with key ${crypto.currentVersion}.`,
    );
    if (failed.length) {
      console.log(
        `Could not decrypt: ${failed.join(', ')}. Their old key isn't in APP_ENCRYPTION_KEYS; re-enter their credentials in Settings → ERP connections.`,
      );
      process.exitCode = 1;
    } else {
      console.log(
        'All secrets now use the current key. You can remove older keys from APP_ENCRYPTION_KEYS.',
      );
    }
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(`Re-encryption failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
