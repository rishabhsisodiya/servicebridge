import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { testConnection } from './connection-tester';

/** Fake ERPNext: API user can read everything except Item Price; one custom field exists. */
let server: Server;
let baseUrl: string;
const hits: string[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const pathname = decodeURIComponent(url.pathname);
    hits.push(`${req.method} ${pathname}`);
    res.setHeader('content-type', 'application/json');
    if (req.headers.authorization !== 'token good:secret') {
      res.statusCode = 401;
      return res.end(JSON.stringify({ exc_type: 'AuthenticationError' }));
    }
    if (url.pathname === '/api/method/frappe.auth.get_logged_user') {
      return res.end(JSON.stringify({ message: 'sb-integration@example.com' }));
    }
    if (url.pathname === '/api/method/frappe.utils.change_log.get_versions') {
      return res.end(
        JSON.stringify({
          message: { frappe: { version: '15.40.1' }, erpnext: { version: '15.37.0' } },
        }),
      );
    }
    if (url.pathname === '/api/method/frappe.client.get_count') {
      if (url.searchParams.get('doctype') === 'Item Price') {
        res.statusCode = 403;
        return res.end(JSON.stringify({ exc_type: 'PermissionError' }));
      }
      return res.end(JSON.stringify({ message: 12 }));
    }
    if (pathname === '/api/resource/Custom Field') {
      return res.end(JSON.stringify({ data: [{ dt: 'Stock Entry' }] }));
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

describe('testConnection', () => {
  it('reports identity, versions, per-doctype access, readiness and missing fields', async () => {
    hits.length = 0;
    const result = await testConnection(
      { baseUrl, apiKey: 'good', apiSecret: 'secret' },
      { allowPrivateHosts: true },
    );
    expect(result.ok).toBe(true);
    expect(result.rest).toMatchObject({
      ok: true,
      user: 'sb-integration@example.com',
      versions: { frappe: '15.40.1', erpnext: '15.37.0' },
    });
    expect(result.access.find((a) => a.doctype === 'Item Price')?.canRead).toBe(false);
    expect(result.access.find((a) => a.doctype === 'Customer')?.canRead).toBe(true);
    // Item Price blocks master sync; the other purposes are ready.
    expect(result.readyFor).toEqual(['DASHBOARDS', 'WRITEBACK']);
    expect(result.setup.missingFields).toEqual([
      { doctype: 'Sales Invoice', fieldname: 'custom_sb_ref' },
    ]);
  });

  it('only ever reads: every call is a GET, and records are counted, not fetched', async () => {
    hits.length = 0;
    await testConnection(
      { baseUrl, apiKey: 'good', apiSecret: 'secret' },
      { allowPrivateHosts: true },
    );
    expect(hits.every((hit) => hit.startsWith('GET '))).toBe(true);
    expect(hits.some((hit) => /\/api\/resource\/(?!Custom Field)/.test(hit))).toBe(false);
  });

  it('stops after a rejected key with a clear reason', async () => {
    const result = await testConnection(
      { baseUrl, apiKey: 'bad', apiSecret: 'nope' },
      { allowPrivateHosts: true },
    );
    expect(result.ok).toBe(false);
    expect(result.rest.error?.kind).toBe('auth');
    expect(result.access).toEqual([]);
  });

  it('reports a blocked private address without contacting it', async () => {
    hits.length = 0;
    const result = await testConnection(
      { baseUrl, apiKey: 'good', apiSecret: 'secret' },
      { allowPrivateHosts: false },
    );
    expect(result.rest.error?.kind).toBe('blocked');
    expect(hits).toEqual([]);
  });

  it('reports a database problem without failing the REST checks', async () => {
    const result = await testConnection(
      {
        baseUrl,
        apiKey: 'good',
        apiSecret: 'secret',
        db: { host: '127.0.0.1', port: 1, database: 'x', user: 'u', password: 'p', ssl: false },
      },
      { allowPrivateHosts: true },
    );
    expect(result.rest.ok).toBe(true);
    expect(result.db).toMatchObject({ ok: false, error: { kind: 'network' } });
    expect(result.ok).toBe(false);
  });
});
