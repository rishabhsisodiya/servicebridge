import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';
import type { Env } from '../config/env.schema';

/**
 * Anything matching these paths is replaced with "[redacted]" before it is
 * written. Covers auth headers, cookies, and the secret fields used by ERP
 * connections, SMTP settings and users (added in later sessions).
 */
const SECRET_KEYS = [
  'password',
  'currentPassword',
  'newPassword',
  'apiSecret',
  'apiKey',
  'dbPassword',
  'smtpPassword',
  'token',
  'refreshToken',
  'secret',
];

export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["x-frappe-webhook-signature"]',
  'res.headers["set-cookie"]',
  // One and two levels deep, e.g. { body: { apiSecret } } and { body: { db: { password } } }.
  ...SECRET_KEYS.flatMap((key) => [`*.${key}`, `*.*.${key}`]),
];

const REQUEST_ID_HEADER = 'x-request-id';
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

/** Reuses a well-formed upstream request id so logs can be joined across services. */
export function resolveRequestId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const id =
    typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, id);
  return id;
}

export function buildLoggerParams(env: Pick<Env, 'NODE_ENV' | 'LOG_LEVEL'>): Params {
  const pretty = env.NODE_ENV === 'development';
  return {
    pinoHttp: {
      level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
      genReqId: resolveRequestId,
      redact: { paths: REDACT_PATHS, censor: '[redacted]' },
      customLogLevel: (_req, res, err) =>
        err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
      // Health probes run every few seconds; logging them adds noise, not signal.
      autoLogging: { ignore: (req) => req.url?.startsWith('/api/v1/health') ?? false },
      // One compact line per request instead of every header.
      serializers: {
        req: (req: { id?: string; method?: string; url?: string }) => ({
          id: req.id,
          method: req.method,
          url: maskUrl(req.url),
        }),
        res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
      },
      customSuccessMessage: (req, res, responseTime) =>
        `${req.method} ${maskUrl(req.url)} ${res.statusCode} ${Math.round(responseTime)}ms`,
      customErrorMessage: (req, res, error) =>
        `${req.method} ${maskUrl(req.url)} ${res.statusCode} failed: ${error.message}`,
      transport: pretty
        ? {
            target: 'pino-pretty',
            options: {
              singleLine: true,
              translateTime: 'SYS:HH:MM:ss',
              // The message already says method, URL, status and time.
              ignore: 'pid,hostname,req,res,responseTime',
            },
          }
        : undefined,
    },
  };
}

/** Masks single-use tokens in paths (invite/reset links) so they never reach logs. */
export function maskUrl(url: string | undefined): string {
  if (!url) return '';
  return url.replace(/(\/auth\/links\/)[^/?#]+/, '$1[token]');
}
