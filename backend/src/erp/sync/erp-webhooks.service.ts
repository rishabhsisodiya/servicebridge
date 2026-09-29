import { createHmac } from 'node:crypto';
import { HttpStatus, Injectable, type OnModuleInit } from '@nestjs/common';
import type { AuthUser, ClientInfo } from '../../auth/auth.types';
import { AutomationsService } from '../../automations/automations.service';
import { AuditService } from '../../core/audit/audit.service';
import { AppConfig } from '../../core/config/app-config.service';
import { CryptoService } from '../../core/crypto/crypto.service';
import { AppException } from '../../core/http/app.exception';
import { PrismaService } from '../../core/prisma/prisma.service';
import { QueueService } from '../../core/queue/queue.service';
import { RateLimitService } from '../../core/rate-limit/rate-limit.service';
import { generateToken, safeEqual } from '../../core/security/tokens';
import { FrappeRestClient } from '../adapters/frappe-rest.client';
import { ErpConnectionsService } from '../connections/erp-connections.service';
import { ErpRequestLogService } from '../request-log.service';
import { ErpSyncService } from './erp-sync.service';
import { WEBHOOK_DOCTYPES } from './specs';

export const WEBHOOK_SYNC_KEY = 'erp.webhook-sync';
export const CATCHUP_SYNC_KEY = 'erp.catchup-sync';
const WEBHOOK_EVENTS = ['on_update', 'on_trash'] as const;

/** Frappe signs the raw body: base64(HMAC-SHA256(secret, body)) in X-Frappe-Webhook-Signature. */
export function frappeSignature(secret: string, rawBody: Buffer): string {
  return createHmac('sha256', secret).update(rawBody).digest('base64');
}

/** The JSON ERPNext sends. We only trust doctype + name, then re-read the record ourselves. */
export function webhookTemplate(event: string): string {
  return JSON.stringify({
    doctype: '{{ doc.doctype }}',
    name: '{{ doc.name }}',
    modified: '{{ doc.modified }}',
    event,
  });
}

@Injectable()
export class ErpWebhooksService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly config: AppConfig,
    private readonly queues: QueueService,
    private readonly automations: AutomationsService,
    private readonly sync: ErpSyncService,
    private readonly connections: ErpConnectionsService,
    private readonly requestLog: ErpRequestLogService,
    private readonly rateLimit: RateLimitService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    this.automations.define(
      {
        key: WEBHOOK_SYNC_KEY,
        name: 'Apply changes from ERPNext (webhooks)',
        description:
          'When ERPNext reports that a customer, address, contact, serial number, item, price or warehouse changed, ServiceBridge re-reads that one record and updates its copy. Needs the webhooks set up (Settings → ERP connections).',
        category: 'ERP',
        queue: 'erp-sync',
        kind: 'event',
        defaultEnabled: false,
      },
      async ({ job }) => {
        const { eventId, connectionId, doctype, name, event } = job.data as Record<string, string>;
        try {
          const summary = await this.sync.syncOne(connectionId, doctype, name, event);
          await this.prisma.erpWebhookEvent.update({
            where: { id: eventId },
            data: {
              status: summary.startsWith('Ignored') ? 'IGNORED' : 'PROCESSED',
              detail: summary,
              processedAt: new Date(),
            },
          });
          return summary;
        } catch (error) {
          await this.prisma.erpWebhookEvent.update({
            where: { id: eventId },
            data: {
              status: 'FAILED',
              detail: (error as Error).message.slice(0, 500),
              processedAt: new Date(),
            },
          });
          throw error;
        }
      },
    );

    this.automations.define(
      {
        key: CATCHUP_SYNC_KEY,
        name: 'Nightly ERP catch-up sync',
        description:
          'Copies everything that changed in ERPNext since the last run: customers, addresses, contacts, serial numbers, items, prices, warehouses and stock levels. Catches anything a webhook missed. The first run copies everything.',
        category: 'ERP',
        queue: 'erp-sync',
        kind: 'periodic',
        defaultEnabled: false,
        defaultCron: '30 2 * * *',
        minIntervalMinutes: 60,
      },
      ({ log }) => this.sync.catchUp(log),
    );
  }

  webhookUrl(connectionId: string): string {
    const base = this.config.get('PUBLIC_WEBHOOK_BASE_URL') ?? this.config.get('APP_URL');
    return `${base}/api/v1/erp/webhooks/${connectionId}`;
  }

  async setupInfo(connectionId: string) {
    const connection = await this.prisma.erpConnection.findUnique({ where: { id: connectionId } });
    if (!connection)
      throw new AppException(
        'CONNECTION_NOT_FOUND',
        'That connection no longer exists.',
        HttpStatus.NOT_FOUND,
      );
    const last = await this.prisma.erpWebhookEvent.findFirst({
      where: { connectionId },
      orderBy: { receivedAt: 'desc' },
    });
    return {
      url: this.webhookUrl(connectionId),
      hasSecret: !!connection.webhookSecretEnc,
      doctypes: WEBHOOK_DOCTYPES,
      events: WEBHOOK_EVENTS,
      templates: Object.fromEntries(WEBHOOK_EVENTS.map((event) => [event, webhookTemplate(event)])),
      lastReceivedAt: last?.receivedAt ?? null,
    };
  }

  /** New signing secret. Shown once; the old one stops working immediately. */
  async rotateSecret(
    actor: AuthUser,
    connectionId: string,
    client: ClientInfo,
  ): Promise<{ secret: string }> {
    const secret = generateToken();
    const connection = await this.prisma.erpConnection.update({
      where: { id: connectionId },
      data: { webhookSecretEnc: this.crypto.encrypt(secret) },
    });
    await this.audit.record({
      actorId: actor.id,
      action: 'erp.webhook_secret_rotated',
      entityType: 'erp_connection',
      entityId: connectionId,
      summary: `${actor.name} created a new webhook secret for “${connection.name}”`,
      ip: client.ip,
      requestId: client.requestId,
    });
    return { secret };
  }

  /**
   * Creates the Webhook documents in ERPNext (a write to the ERP, only on an
   * admin's explicit, password-confirmed request). Skips ones that already exist.
   */
  async createInErp(actor: AuthUser, connectionId: string, client: ClientInfo) {
    const connection = await this.prisma.erpConnection.findUnique({ where: { id: connectionId } });
    if (!connection)
      throw new AppException(
        'CONNECTION_NOT_FOUND',
        'That connection no longer exists.',
        HttpStatus.NOT_FOUND,
      );
    let secret = connection.webhookSecretEnc
      ? this.crypto.decrypt(connection.webhookSecretEnc)
      : undefined;
    if (!secret) secret = (await this.rotateSecret(actor, connectionId, client)).secret;

    const url = this.webhookUrl(connectionId);
    const rest = new FrappeRestClient(await this.connections.credentialsFor(connection), {
      allowPrivateHosts: this.config.get('ALLOW_PRIVATE_ERP_HOSTS'),
      record: this.requestLog.record,
    });
    const created: string[] = [];
    const existing: string[] = [];
    try {
      const current = await rest.list<{ webhook_doctype: string; webhook_docevent: string }>(
        'Webhook',
        {
          fields: ['webhook_doctype', 'webhook_docevent'],
          filters: [['request_url', '=', url]],
          orderBy: 'creation asc',
          pageLength: 100,
        },
      );
      const have = new Set(current.map((w) => `${w.webhook_doctype}:${w.webhook_docevent}`));
      for (const doctype of WEBHOOK_DOCTYPES) {
        for (const event of WEBHOOK_EVENTS) {
          const label = `${doctype} (${event === 'on_update' ? 'changed' : 'deleted'})`;
          if (have.has(`${doctype}:${event}`)) {
            existing.push(label);
            continue;
          }
          await rest.create('Webhook', {
            webhook_doctype: doctype,
            webhook_docevent: event,
            request_url: url,
            request_method: 'POST',
            request_structure: 'JSON',
            webhook_json: webhookTemplate(event),
            enable_security: 1,
            webhook_secret: secret,
            enabled: 1,
          });
          created.push(label);
        }
      }
    } finally {
      await rest.close();
    }
    await this.audit.record({
      actorId: actor.id,
      action: 'erp.webhooks_created',
      entityType: 'erp_connection',
      entityId: connectionId,
      summary: `${actor.name} created ${created.length} webhooks in ERPNext for “${connection.name}” (${existing.length} already existed)`,
      ip: client.ip,
      requestId: client.requestId,
    });
    return { created, existing, url };
  }

  /** Public endpoint body. Verifies the signature, records the event, queues the update. */
  async receive(connectionId: string, rawBody: Buffer | undefined, signature: string | undefined) {
    await this.rateLimit.enforce(`webhook:${connectionId}`, 600, 60);
    const connection = await this.prisma.erpConnection.findUnique({ where: { id: connectionId } });
    if (!connection?.webhookSecretEnc) {
      throw new AppException(
        'WEBHOOK_NOT_SET_UP',
        'Webhooks are not set up for this connection.',
        HttpStatus.NOT_FOUND,
      );
    }
    const expected = frappeSignature(
      this.crypto.decrypt(connection.webhookSecretEnc),
      rawBody ?? Buffer.alloc(0),
    );
    const valid = !!signature && safeEqual(signature, expected);

    let payload: { doctype?: string; name?: string; event?: string; modified?: string } = {};
    try {
      payload = JSON.parse((rawBody ?? Buffer.alloc(0)).toString('utf8')) as typeof payload;
    } catch {
      payload = {};
    }
    const base = {
      connectionId,
      doctype: typeof payload.doctype === 'string' ? payload.doctype.slice(0, 80) : null,
      docName: typeof payload.name === 'string' ? payload.name.slice(0, 200) : null,
      event: typeof payload.event === 'string' ? payload.event.slice(0, 40) : 'on_update',
      // The ERP record's modified timestamp doubles as the idempotency key:
      // a replayed delivery carries the same value (SB-H5).
      docModified: typeof payload.modified === 'string' ? payload.modified.slice(0, 80) : null,
      signatureValid: valid,
    };

    if (!valid) {
      await this.prisma.erpWebhookEvent.create({
        data: { ...base, status: 'REJECTED', detail: 'Signature missing or wrong.' },
      });
      throw new AppException(
        'BAD_SIGNATURE',
        'Webhook signature missing or wrong.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const ignore = async (detail: string) => {
      await this.prisma.erpWebhookEvent.create({ data: { ...base, status: 'IGNORED', detail } });
      return { accepted: false, detail };
    };
    if (!base.doctype || !base.docName || !WEBHOOK_DOCTYPES.includes(base.doctype))
      return ignore('Not a record type ServiceBridge syncs.');
    const setting = await this.prisma.automationSetting.findUnique({
      where: { key: WEBHOOK_SYNC_KEY },
    });
    if (!setting?.enabled) return ignore('Webhook sync is switched off (Settings → Automations).');

    // SB-H5: drop replayed deliveries. Two deliveries of the same ERP change
    // carry the same modified timestamp; a genuinely new change never does.
    // (Re-verification in syncOne is the real control for on_trash; this just
    // avoids re-reading the ERP for replays. FAILED events are retried, not
    // dropped.)
    if (base.docModified) {
      const seen = await this.prisma.erpWebhookEvent.findFirst({
        where: {
          connectionId,
          doctype: base.doctype,
          docName: base.docName,
          event: base.event,
          docModified: base.docModified,
          status: { in: ['QUEUED', 'PROCESSED'] },
        },
        select: { id: true },
      });
      if (seen) return ignore(`Duplicate delivery of the ${base.event} event for ${base.doctype} ${base.docName}.`);
    }

    const event = await this.prisma.erpWebhookEvent.create({ data: { ...base, status: 'QUEUED' } });
    const job = await this.queues.queue('erp-sync').add(
      WEBHOOK_SYNC_KEY,
      {
        automationKey: WEBHOOK_SYNC_KEY,
        trigger: 'EVENT',
        eventId: event.id,
        connectionId,
        doctype: base.doctype,
        name: base.docName,
        event: base.event,
      },
      { attempts: 5, backoff: { type: 'exponential', delay: 5_000 } },
    );
    await this.prisma.erpWebhookEvent.update({ where: { id: event.id }, data: { jobId: job.id } });
    return { accepted: true };
  }

  /** System monitor: re-queue a failed or ignored webhook event. */
  async reprocess(actor: AuthUser, eventId: string, client: ClientInfo) {
    const event = await this.prisma.erpWebhookEvent.findUnique({ where: { id: eventId } });
    if (!event?.connectionId || !event.doctype || !event.docName || !event.signatureValid) {
      throw new AppException(
        'CANNOT_REPROCESS',
        'Only signed events for a synced record can be processed again.',
        HttpStatus.CONFLICT,
      );
    }
    const job = await this.queues.queue('erp-sync').add(
      WEBHOOK_SYNC_KEY,
      {
        automationKey: WEBHOOK_SYNC_KEY,
        trigger: 'MANUAL',
        actorId: actor.id,
        eventId,
        connectionId: event.connectionId,
        doctype: event.doctype,
        name: event.docName,
        event: event.event ?? 'on_update',
      },
      { attempts: 3, backoff: { type: 'exponential', delay: 5_000 } },
    );
    await this.prisma.erpWebhookEvent.update({
      where: { id: eventId },
      data: { status: 'QUEUED', jobId: job.id, detail: null },
    });
    await this.audit.record({
      actorId: actor.id,
      action: 'erp.webhook_reprocessed',
      entityType: 'erp_webhook_event',
      entityId: eventId,
      summary: `${actor.name} re-ran the ${event.doctype} ${event.docName} webhook`,
      ip: client.ip,
      requestId: client.requestId,
    });
  }

  async list(filters: { status?: string; page: number }, pageSize = 50) {
    const where = filters.status ? { status: filters.status as never } : {};
    const [total, data] = await this.prisma.$transaction([
      this.prisma.erpWebhookEvent.count({ where }),
      this.prisma.erpWebhookEvent.findMany({
        where,
        orderBy: { receivedAt: 'desc' },
        skip: (filters.page - 1) * pageSize,
        take: pageSize,
        include: { connection: { select: { name: true } } },
      }),
    ]);
    return { data, meta: { page: filters.page, pageSize, total } };
  }
}
