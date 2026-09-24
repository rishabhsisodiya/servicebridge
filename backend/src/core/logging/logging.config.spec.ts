import { Writable } from 'node:stream';
import pino from 'pino';
import { maskUrl, REDACT_PATHS, resolveRequestId } from './logging.config';
import type { IncomingMessage, ServerResponse } from 'node:http';

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  const logger = pino({ redact: { paths: REDACT_PATHS, censor: '[redacted]' } }, stream);
  return { logger, lines };
}

describe('log redaction', () => {
  it('hides secrets nested one level down', () => {
    const { logger, lines } = capture();
    logger.info({
      body: { apiSecret: 's3cr3t', password: 'hunter2', name: 'Main ERP' },
      req: { headers: { authorization: 'Bearer abc', cookie: 'sb_refresh=xyz' } },
    });
    const out = lines.join('');
    expect(out).not.toMatch(/s3cr3t|hunter2|Bearer abc|sb_refresh=xyz/);
    expect(out).toContain('Main ERP');
  });

  it('hides secrets nested two levels down', () => {
    const { logger, lines } = capture();
    logger.info({ body: { db: { password: 'db-pass-123', host: 'erp.local' } } });
    const out = lines.join('');
    expect(out).not.toContain('db-pass-123');
    expect(out).toContain('erp.local');
  });
});

describe('resolveRequestId', () => {
  const fakeRes = () => {
    const headers: Record<string, string> = {};
    return {
      res: { setHeader: (k: string, v: string) => (headers[k] = v) } as unknown as ServerResponse,
      headers,
    };
  };

  it('reuses a well-formed incoming id', () => {
    const { res, headers } = fakeRes();
    const req = { headers: { 'x-request-id': 'abc12345-edge' } } as unknown as IncomingMessage;
    expect(resolveRequestId(req, res)).toBe('abc12345-edge');
    expect(headers['x-request-id']).toBe('abc12345-edge');
  });

  it('replaces a malformed id instead of trusting it', () => {
    const { res } = fakeRes();
    const req = { headers: { 'x-request-id': '<script>' } } as unknown as IncomingMessage;
    expect(resolveRequestId(req, res)).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('maskUrl', () => {
  it('hides one-time link tokens', () => {
    expect(maskUrl('/api/v1/auth/links/abcDEF123_-xyz/accept')).toBe(
      '/api/v1/auth/links/[token]/accept',
    );
    expect(maskUrl('/api/v1/erp/connections')).toBe('/api/v1/erp/connections');
  });
});
