/* eslint-disable no-console -- command-line tool: console output is the interface */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { CryptoService } from '../core/crypto/crypto.service';
import { PrismaService } from '../core/prisma/prisma.service';
import { EMAIL_KEY } from '../demo/app-settings.service';

/**
 * Key rotation, step 2. Step 1: put the new key first in APP_ENCRYPTION_KEYS
 * and keep the old one after it (v2:<new>,v1:<old>). This command re-encrypts
 * every stored secret with the new key. Step 3: remove the old key.
 *
 * Covers every secret the app stores: the four ERP connection fields
 * (apiKeyEnc, apiSecretEnc, dbPasswordEnc, webhookSecretEnc) and the SMTP
 * password tucked inside the email AppSetting's JSON blob.
 */
const CONNECTION_FIELDS = [
  'apiKeyEnc',
  'apiSecretEnc',
  'dbPasswordEnc',
  'webhookSecretEnc',
] as const;

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const crypto = app.get(CryptoService);
  const prisma = app.get(PrismaService);
  let rotatedConnections = 0;
  let rotatedSecrets = 0;
  /** Per-secret failures, e.g. "Acme ERP: webhookSecretEnc". */
  const failedSecrets: string[] = [];

  try {
    const connections = await prisma.erpConnection.findMany();
    for (const connection of connections) {
      const updates: Partial<Record<(typeof CONNECTION_FIELDS)[number], string>> = {};
      let connectionFailed = false;
      for (const field of CONNECTION_FIELDS) {
        const stored = connection[field];
        if (!stored || !crypto.needsRotation(stored)) continue;
        try {
          updates[field] = crypto.encrypt(crypto.decrypt(stored));
          rotatedSecrets += 1;
        } catch {
          failedSecrets.push(`${connection.name}: ${field}`);
          connectionFailed = true;
        }
      }
      if (connectionFailed) {
        await prisma.erpConnection.update({
          where: { id: connection.id },
          data: { status: 'KEY_ERROR' },
        });
        continue;
      }
      if (Object.keys(updates).length) {
        await prisma.erpConnection.update({ where: { id: connection.id }, data: updates });
        rotatedConnections += 1;
      }
    }

    // The SMTP password lives inside the email settings blob, not a column.
    try {
      const emailRow = await prisma.appSetting.findUnique({ where: { key: EMAIL_KEY } });
      const stored = (emailRow?.value ?? {}) as { passwordEncrypted?: unknown };
      const password = stored.passwordEncrypted;
      if (typeof password === 'string' && password && crypto.needsRotation(password)) {
        const reEncrypted = crypto.encrypt(crypto.decrypt(password));
        await prisma.appSetting.update({
          where: { key: EMAIL_KEY },
          data: {
            value: { ...(emailRow?.value as Record<string, unknown>), passwordEncrypted: reEncrypted },
          },
        });
        rotatedSecrets += 1;
        console.log('Re-encrypted the SMTP password with the current key.');
      }
    } catch {
      failedSecrets.push('email settings: passwordEncrypted');
    }

    console.log(
      `Re-encrypted ${rotatedSecrets} secret(s) across ${rotatedConnections} ERP connection(s) with key ${crypto.currentVersion}.`,
    );
    if (failedSecrets.length) {
      console.log(
        `Could not decrypt: ${failedSecrets.join('; ')}. Their old key isn't in APP_ENCRYPTION_KEYS; re-enter them in Settings → ERP connections / Email settings.`,
      );
      process.exitCode = 1;
    } else {
      // Every tracked secret either already used the current key or was just
      // re-encrypted: only now is it safe to drop the older keys.
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
