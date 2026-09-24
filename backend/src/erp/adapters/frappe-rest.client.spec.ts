import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ErpCallRecord } from '../erp.types';
import { FrappeRestClient } from './frappe-rest.client';

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

let server: Server;
let baseUrl: string;
let handler: Handler;
const seen: { url: string; auth?: string; method?: string }[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    seen.push({ url: req.url ?? '', auth: req.headers.authorization, method: req.method });
    handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  seen.length = 0;
});

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
};

function client(overrides: { allowPrivateHosts?: boolean; timeoutMs?: number } = {}) {
  const records: ErpCallRecord[] = [];
  const instance = new FrappeRestClient(
    { connectionId: 'c1', baseUrl, apiKey: 'key123', apiSecret: 'secret456' },
    {
      allowPrivateHosts: overrides.allowPrivateHosts ?? true,
      record: (r) => records.push(r),
      timeoutMs: overrides.timeoutMs,
    },
  );
  return { instance, records };
}

describe('FrappeRestClient', () => {
  it('authenticates with the Frappe token header and reads the logged-in user', async () => {
    handler = (_req, res) => json(res, 200, { message: 'integration@example.com' });
    const { instance } = client();
    await expect(instance.loggedUser()).resolves.toBe('integration@example.com');
    expect(seen[0].auth).toBe('token key123:secret456');
    await instance.close();
  });

  it('explains rejected credentials', async () => {
    handler = (_req, res) => json(res, 401, { exc_type: 'AuthenticationError' });
    const { instance } = client();
    await expect(instance.loggedUser()).rejects.toMatchObject({ kind: 'auth', httpStatus: 401 });
    await instance.close();
  });

  it('reports a permission problem per doctype without retrying', async () => {
    handler = (_req, res) => json(res, 403, { exc_type: 'PermissionError' });
    const { instance } = client();
    await expect(instance.count('Item Price')).rejects.toMatchObject({ kind: 'permission' });
    expect(seen).toHaveLength(1);
    await instance.close();
  });

  it('retries a read after a server error', async () => {
    let calls = 0;
    handler = (_req, res) => (++calls === 1 ? json(res, 502, {}) : json(res, 200, { message: 42 }));
    const { instance, records } = client();
    await expect(instance.count('Customer')).resolves.toBe(42);
    expect(records.map((r) => r.ok)).toEqual([false, true]);
    await instance.close();
  });

  it('never retries a write', async () => {
    handler = (_req, res) => json(res, 500, {});
    const { instance } = client();
    await expect(
      instance.request('POST', '/api/resource/Stock Entry', { body: {} }),
    ).rejects.toMatchObject({
      kind: 'server',
    });
    expect(seen).toHaveLength(1);
    await instance.close();
  });

  it('logs the path and doctype but never the query string', async () => {
    handler = (_req, res) => json(res, 200, { message: 7 });
    const { instance, records } = client();
    await instance.count('Serial No');
    expect(seen[0].url).toContain('doctype=Serial+No');
    expect(records[0]).toMatchObject({
      connectionId: 'c1',
      channel: 'REST',
      target: '/api/method/frappe.client.get_count',
      doctype: 'Serial No',
      ok: true,
    });
    expect(JSON.stringify(records)).not.toMatch(/doctype=|secret456|key123/);
    await instance.close();
  });

  it('refuses private addresses unless allowed', async () => {
    handler = (_req, res) => json(res, 200, { message: 'x' });
    const { instance } = client({ allowPrivateHosts: false });
    await expect(instance.loggedUser()).rejects.toMatchObject({ kind: 'blocked' });
    expect(seen).toHaveLength(0);
    await instance.close();
  });

  it('treats a non-JSON page as "not an ERPNext site"', async () => {
    handler = (_req, res) => {
      res.setHeader('content-type', 'text/html');
      res.end('<html>Welcome</html>');
    };
    const { instance } = client();
    await expect(instance.loggedUser()).rejects.toMatchObject({ kind: 'bad_response' });
    await instance.close();
  });

  it('gives up after the timeout', async () => {
    handler = () => undefined; // never answers
    const { instance } = client({ timeoutMs: 100 });
    await expect(instance.request('POST', '/api/method/slow')).rejects.toMatchObject({
      kind: 'timeout',
    });
    await instance.close();
  });
});
