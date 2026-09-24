import { z } from 'zod';

const KEY_BYTES = 32; // AES-256

export interface EncryptionKey {
  version: string;
  key: Buffer;
}

/**
 * Parses `APP_ENCRYPTION_KEYS` in the form "v2:<base64>,v1:<base64>".
 * The first entry is the current key used for new encryptions; later entries
 * are kept only so older secrets can still be decrypted during key rotation.
 */
export function parseEncryptionKeys(raw: string): EncryptionKey[] {
  const entries = raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (entries.length === 0) {
    throw new Error('APP_ENCRYPTION_KEYS must contain at least one key');
  }

  const seen = new Set<string>();
  return entries.map((entry, index) => {
    const separator = entry.indexOf(':');
    const version = separator > 0 ? entry.slice(0, separator) : '';
    const encoded = separator > 0 ? entry.slice(separator + 1) : '';

    if (!/^v\d+$/.test(version)) {
      throw new Error(
        `APP_ENCRYPTION_KEYS entry ${index + 1} must start with a version like "v1:"`,
      );
    }
    if (seen.has(version)) {
      throw new Error(`APP_ENCRYPTION_KEYS has version ${version} more than once`);
    }
    seen.add(version);

    const key = Buffer.from(encoded, 'base64');
    if (key.length !== KEY_BYTES) {
      throw new Error(
        `APP_ENCRYPTION_KEYS ${version} must be ${KEY_BYTES} bytes of base64 (generate one with: openssl rand -base64 32)`,
      );
    }
    return { version, key };
  });
}

const commaList = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  CORS_ORIGINS: commaList,
  DATABASE_URL: z.string().url().startsWith('postgres', 'DATABASE_URL must be a PostgreSQL URL'),
  REDIS_URL: z.string().url().startsWith('redis', 'REDIS_URL must be a redis:// or rediss:// URL'),
  APP_ENCRYPTION_KEYS: z.string().transform((raw, ctx) => {
    try {
      return parseEncryptionKeys(raw);
    } catch (error) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: (error as Error).message });
      return z.NEVER;
    }
  }),
  /** Public address of the web app. Used in invite links; https here makes cookies Secure. */
  APP_URL: z
    .string()
    .url()
    .default('http://localhost:3000')
    .transform((url) => url.replace(/\/+$/, '')),
  /** Signs access tokens (HS256). Generate with: openssl rand -base64 48 */
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  /** Idle sign-out: a session unused for this long ends. */
  SESSION_IDLE_DAYS: z.coerce.number().int().min(1).max(90).default(14),
  /** Hard limit: every session ends this long after sign-in. */
  SESSION_MAX_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  /**
   * ERP connections to private/loopback addresses are refused (SSRF protection).
   * Set to true only when the ERP runs on your own network, e.g. a local Docker ERPNext.
   */
  /**
   * Address ERPNext uses to reach ServiceBridge's webhook endpoint. Defaults to APP_URL.
   * Must be reachable from the ERP (a cloud ERP can't reach localhost; use a tunnel for local testing).
   */
  PUBLIC_WEBHOOK_BASE_URL: z
    .string()
    .url()
    .optional()
    .transform((url) => url?.replace(/\/+$/, '')),
  ALLOW_PRIVATE_ERP_HOSTS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

export type Env = z.infer<typeof envSchema>;

/** Used by ConfigModule: fails fast at boot with every problem listed at once. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return result.data;
}
