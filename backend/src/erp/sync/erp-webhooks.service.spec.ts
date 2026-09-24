import { createHmac } from 'node:crypto';
import type { AutomationsService } from '../../automations/automations.service';
import type { AuditService } from '../../core/audit/audit.service';
import type { AppConfig } from '../../core/config/app-config.service';
import { parseEncryptionKeys } from '../../core/config/env.schema';
import { CryptoService } from '../../core/crypto/crypto.service';
import type { PrismaService } from '../../core/prisma/prisma.service';
import type { QueueService } from '../../core/queue/queue.service';
import type { RateLimitService } from '../../core/rate-limit/rate-limit.service';
import type { ErpConnectionsService } from '../connections/erp-connections.service';
import type { ErpRequestLogService } from '../request-log.service';
import type { ErpSyncService } from './erp-sync.service';
import { ErpWebhooksService, frappeSignature, webhookTemplate } from './erp-webhooks.service';

const config = {
  get: (key: string) =>
    ({
      APP_ENCRYPTION_KEYS: parseEncryptionKeys(`v1:${Buffer.alloc(32, 5).toString('base64')}`),
      APP_URL: 'http://localhost:3000',
      PUBLIC_WEBHOOK_BASE_URL: 'https://tunnel.example.com',
    })[key],
} as unknown as AppConfig;
const crypto = new CryptoService(config);
const SECRET = 'whsec-test-123';

function build(enabled: boolean) {
  const events: Record<string, unknown>[] = [];
  const prisma = {
    erpConnection: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'c1',
        name: 'Test ERP',
        webhookSecretEnc: crypto.encrypt(SECRET),
      }),
    },
    automationSetting: { findUnique: jest.fn().mockResolvedValue({ enabled }) },
    erpWebhookEvent: {
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        events.push(data);
        return Promise.resolve({ id: 'e1', ...data });
      }),
      update: jest.fn(),
    },
  };
  const add = jest.fn().mockResolvedValue({ id: 'job1' });
  const service = new ErpWebhooksService(
    prisma as unknown as PrismaService,
    crypto,
    config,
    { queue: () => ({ add }) } as unknown as QueueService,
    {} as AutomationsService,
    {} as ErpSyncService,
    {} as ErpConnectionsService,
    {} as ErpRequestLogService,
    { enforce: jest.fn() } as unknown as RateLimitService,
    {} as AuditService,
  );
  return { service, events, add };
}

const body = (payload: object) => Buffer.from(JSON.stringify(payload));
const sign = (raw: Buffer) => frappeSignature(SECRET, raw);

describe('webhook signatures', () => {
  it('match what Frappe computes: base64(HMAC-SHA256(secret, body))', () => {
    const raw = body({ doctype: 'Customer', name: 'CUST-0001' });
    expect(sign(raw)).toBe(createHmac('sha256', SECRET).update(raw).digest('base64'));
  });

  it('template only carries doctype, name, modified and event', () => {
    expect(JSON.parse(webhookTemplate('on_trash'))).toEqual({
      doctype: '{{ doc.doctype }}',
      name: '{{ doc.name }}',
      modified: '{{ doc.modified }}',
      event: 'on_trash',
    });
  });

  it('uses the public webhook address when set', () => {
    expect(build(true).service.webhookUrl('c1')).toBe(
      'https://tunnel.example.com/api/v1/erp/webhooks/c1',
    );
  });
});

describe('ErpWebhooksService.receive', () => {
  it('rejects a missing or wrong signature and records it', async () => {
    const { service, events, add } = build(true);
    const raw = body({ doctype: 'Customer', name: 'CUST-0001' });
    await expect(service.receive('c1', raw, undefined)).rejects.toMatchObject({
      code: 'BAD_SIGNATURE',
    });
    await expect(service.receive('c1', raw, frappeSignature('other', raw))).rejects.toMatchObject({
      code: 'BAD_SIGNATURE',
    });
    expect(events.map((e) => e.status)).toEqual(['REJECTED', 'REJECTED']);
    expect(add).not.toHaveBeenCalled();
  });

  it('records but ignores events while webhook sync is switched off', async () => {
    const { service, events, add } = build(false);
    const raw = body({ doctype: 'Customer', name: 'CUST-0001' });
    await expect(service.receive('c1', raw, sign(raw))).resolves.toMatchObject({ accepted: false });
    expect(events[0]).toMatchObject({ status: 'IGNORED', signatureValid: true });
    expect(add).not.toHaveBeenCalled();
  });

  it('ignores record types that are not synced (e.g. stock levels)', async () => {
    const { service, add } = build(true);
    const raw = body({ doctype: 'Bin', name: 'BIN-1' });
    await expect(service.receive('c1', raw, sign(raw))).resolves.toMatchObject({ accepted: false });
    expect(add).not.toHaveBeenCalled();
  });

  it('queues a signed change when switched on, with retries', async () => {
    const { service, add } = build(true);
    const raw = body({ doctype: 'Serial No', name: 'CX400-2311-052', event: 'on_update' });
    await expect(service.receive('c1', raw, sign(raw))).resolves.toEqual({ accepted: true });
    expect(add).toHaveBeenCalledWith(
      'erp.webhook-sync',
      expect.objectContaining({ doctype: 'Serial No', name: 'CX400-2311-052', eventId: 'e1' }),
      expect.objectContaining({ attempts: 5 }),
    );
  });
});
