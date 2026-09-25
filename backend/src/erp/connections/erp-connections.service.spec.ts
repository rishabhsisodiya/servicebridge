import { Logger } from '@nestjs/common';
import type { AuthUser } from '../../auth/auth.types';
import type { AuditService } from '../../core/audit/audit.service';
import type { AppConfig } from '../../core/config/app-config.service';
import { parseEncryptionKeys } from '../../core/config/env.schema';
import { CryptoService } from '../../core/crypto/crypto.service';
import type { PrismaService } from '../../core/prisma/prisma.service';
import type { RateLimitService } from '../../core/rate-limit/rate-limit.service';
import type { ErpRequestLogService } from '../request-log.service';
import { ErpConnectionsService } from './erp-connections.service';

const env: Record<string, unknown> = {
  APP_ENCRYPTION_KEYS: parseEncryptionKeys(`v1:${Buffer.alloc(32, 3).toString('base64')}`),
  APP_ENV: 'production',
  ALLOW_PRIVATE_ERP_HOSTS: false,
};
const config = { get: (key: string) => env[key] } as unknown as AppConfig;
const crypto = new CryptoService(config);
const client = { ip: null, userAgent: null, requestId: null };
const admin = { id: 'a1', name: 'Admin' } as AuthUser;

const passingResult = {
  ok: true,
  readyFor: ['WRITEBACK'],
  access: [{ doctype: 'Item Price', canRead: false }],
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    name: 'Main ERP',
    kind: 'FRAPPE',
    baseUrl: 'https://erp.example.com',
    apiKeyEnc: crypto.encrypt('abcdefgh1234'),
    apiKeyHint: '1234',
    apiSecretEnc: crypto.encrypt('secretsecret99'),
    dbHost: null,
    dbPort: null,
    dbName: null,
    dbUser: null,
    dbPasswordEnc: null,
    dbSsl: true,
    status: 'UNTESTED',
    detailsChangedAt: new Date('2026-09-24T10:00:00Z'),
    lastTestedAt: null,
    lastTestResult: null,
    erpVersion: null,
    version: 2,
    purposes: [],
    ...overrides,
  };
}

function build(current: ReturnType<typeof row> | null) {
  const connection = {
    findUnique: jest.fn().mockResolvedValue(current),
    findMany: jest.fn().mockResolvedValue(current ? [current] : []),
    create: jest
      .fn()
      .mockImplementation(({ data }: { data: object }) => Promise.resolve({ ...row(), ...data })),
    update: jest
      .fn()
      .mockImplementation(({ data }: { data: object }) => Promise.resolve({ ...current, ...data })),
    delete: jest.fn(),
  };
  const binding = {
    upsert: jest.fn(),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    findMany: jest.fn().mockResolvedValue([]),
  };
  const prisma = {
    erpConnection: connection,
    erpPurposeBinding: binding,
    $transaction: (fn: (tx: unknown) => unknown) => fn(prisma),
  };
  const audit = { record: jest.fn() };
  const service = new ErpConnectionsService(
    prisma as unknown as PrismaService,
    crypto,
    config,
    audit as unknown as AuditService,
    { enforce: jest.fn() } as unknown as RateLimitService,
    { record: jest.fn() } as unknown as ErpRequestLogService,
  );
  return { service, connection, binding, audit };
}

beforeAll(() => jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined));

describe('ErpConnectionsService', () => {
  it('stores secrets encrypted and never returns them', async () => {
    const { service, connection, audit } = build(null);
    const view = await service.create(
      admin,
      {
        name: 'Main ERP',
        baseUrl: 'https://erp.example.com/',
        apiKey: 'abcdefgh1234',
        apiSecret: 'secretsecret99',
      },
      client,
    );
    const data = connection.create.mock.calls[0][0].data;
    expect(data.baseUrl).toBe('https://erp.example.com');
    expect(data.apiSecretEnc).not.toContain('secretsecret99');
    expect(crypto.decrypt(data.apiSecretEnc as string)).toBe('secretsecret99');
    expect(JSON.stringify(view)).not.toMatch(/secretsecret99|abcdefgh1234|Enc/);
    expect(view.apiKeyHint).toBe('1234');
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain('secretsecret99');
  });

  it('rejects a non-https address as a field error', async () => {
    const { service } = build(null);
    await expect(
      service.create(
        admin,
        { name: 'X', baseUrl: 'http://erp.example.com', apiKey: 'abcdefgh', apiSecret: 'abcdefgh' },
        client,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', fields: [{ field: 'baseUrl' }] });
  });

  it('needs a fresh test after the credentials change, but not after a rename', async () => {
    const rename = build(row({ status: 'ACTIVE' }));
    await rename.service.update(admin, 'c1', { name: 'Head office ERP', version: 2 }, client);
    expect(rename.connection.update.mock.calls[0][0].data.status).toBeUndefined();

    const rekey = build(row({ status: 'ACTIVE' }));
    await rekey.service.update(admin, 'c1', { apiSecret: 'newsecret123', version: 2 }, client);
    const data = rekey.connection.update.mock.calls[0][0].data;
    expect(data.status).toBe('UNTESTED');
    expect(data.detailsChangedAt).toBeInstanceOf(Date);
    expect(rekey.audit.record.mock.calls[0][0].summary).toContain('API secret');
  });

  it('keeps the saved database password when an edit leaves it blank', async () => {
    const saved = crypto.encrypt('db-pass');
    const { service, connection } = build(
      row({
        dbHost: 'db.example.com',
        dbPort: 3306,
        dbName: 'erp',
        dbUser: 'ro',
        dbPasswordEnc: saved,
      }),
    );
    await service.update(
      admin,
      'c1',
      {
        db: { host: 'db.example.com', port: 3307, database: 'erp', user: 'ro', ssl: true },
        version: 2,
      },
      client,
    );
    expect(connection.update.mock.calls[0][0].data.dbPasswordEnc).toBe(saved);
  });

  it('only enables after a test that passed since the last change', async () => {
    const stale = build(
      row({ lastTestedAt: new Date('2026-09-24T09:00:00Z'), lastTestResult: passingResult }),
    );
    await expect(stale.service.setEnabled(admin, 'c1', true, client)).rejects.toMatchObject({
      code: 'NOT_TESTED',
    });

    const fresh = build(
      row({ lastTestedAt: new Date('2026-09-24T11:00:00Z'), lastTestResult: passingResult }),
    );
    const view = await fresh.service.setEnabled(admin, 'c1', true, client);
    expect(view.status).toBe('ACTIVE');
  });

  it('refuses to delete a connection that is in use', async () => {
    const { service, connection } = build(row({ purposes: [{ purpose: 'WRITEBACK' }] }));
    await expect(service.remove(admin, 'c1', client)).rejects.toMatchObject({
      code: 'CONNECTION_IN_USE',
      message: expect.stringContaining('Write-backs'),
    });
    expect(connection.delete).not.toHaveBeenCalled();
  });

  it('assigns a purpose only to an active connection that can read what it needs', async () => {
    const inactive = build(row({ lastTestResult: passingResult }));
    await expect(
      inactive.service.setPurposes(admin, { WRITEBACK: 'c1' }, client),
    ).rejects.toMatchObject({
      code: 'CONNECTION_NOT_ACTIVE',
    });

    const noPrices = build(row({ status: 'ACTIVE', lastTestResult: passingResult }));
    await expect(
      noPrices.service.setPurposes(admin, { MASTER_SYNC: 'c1' }, client),
    ).rejects.toMatchObject({
      code: 'MISSING_PERMISSION',
      message: expect.stringContaining('Item Price'),
    });

    const ok = build(row({ status: 'ACTIVE', lastTestResult: passingResult }));
    await ok.service.setPurposes(admin, { WRITEBACK: 'c1' }, client);
    expect(ok.binding.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { purpose: 'WRITEBACK' } }),
    );
  });

  it('flags a connection whose secrets no longer decrypt', async () => {
    const other = new CryptoService({
      get: () => parseEncryptionKeys(`v1:${Buffer.alloc(32, 9).toString('base64')}`),
    } as unknown as AppConfig);
    const { service, connection } = build(
      row({ apiKeyEnc: other.encrypt('x'), apiSecretEnc: other.encrypt('y') }),
    );
    await expect(service.testSaved(admin, 'c1', client)).rejects.toMatchObject({
      code: 'KEY_ERROR',
    });
    expect(connection.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'KEY_ERROR' } }),
    );
  });
});
