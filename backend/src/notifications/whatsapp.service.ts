import { createHmac } from 'node:crypto';
import { HttpStatus, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Job } from 'bullmq';
import { AppConfig } from '../core/config/app-config.service';
import { AppException } from '../core/http/app.exception';
import { stripUrlCredentials } from '../core/logging/redact';
import { PrismaService } from '../core/prisma/prisma.service';
import { QueueService } from '../core/queue/queue.service';
import { safeEqual } from '../core/security/tokens';
import {
  AppSettingsService,
  type WhatsAppCredentials,
} from '../demo/app-settings.service';
import { normalizePhone } from './phone.util';
import {
  MetaCloudApiProvider,
  type WhatsAppProvider,
} from './whatsapp-providers';

/** Job name on the `notifications` queue (the queue already existed; the outbox is new). */
export const SEND_WHATSAPP_JOB = 'send-whatsapp';

/** BullMQ job ids can't contain ":"; one fixed id per log row makes retries idempotent. */
const whatsappJobId = (whatsappLogId: string) => `whatsapp-${whatsappLogId}`;

const WHATSAPP_ATTEMPTS = 5;

export interface WhatsAppVariables {
  [key: string]: string | number;
}

interface WhatsAppTemplateSeed {
  key: string;
  name: string;
  providerTemplateName: string;
  bodyText: string;
  enabled: boolean;
}

/**
 * The default templates, seeded once (never overwritten). WhatsApp
 * business-initiated messages must use Meta-approved templates, so the body is
 * NOT admin-editable — admins only toggle `enabled`. `{{name}}` placeholders
 * fill positionally, in order of first appearance (see extractParamNames).
 * All seeds start disabled: the channel is off everywhere until an admin
 * enables it.
 */
export const WHATSAPP_TEMPLATE_SEEDS: WhatsAppTemplateSeed[] = [
  {
    key: 'ticket.assigned',
    name: 'Ticket assigned',
    providerTemplateName: 'ticket_assigned',
    bodyText:
      'Hi {{assigneeName}}, ticket {{ticketNumber}} ({{ticketTitle}}) has been assigned to you.',
    enabled: false,
  },
  {
    key: 'sla.breached',
    name: 'SLA breached',
    providerTemplateName: 'sla_breached',
    bodyText: 'SLA breached on ticket {{ticketNumber}} ({{ticketTitle}}). Please act now.',
    enabled: false,
  },
  {
    key: 'csat.invite',
    name: 'Feedback request',
    providerTemplateName: 'csat_invite',
    bodyText:
      'Hi {{customerName}}, ticket {{ticketNumber}} is closed. Please rate our service: {{feedbackUrl}}',
    enabled: false,
  },
  {
    key: 'amc.renewal',
    name: 'AMC renewal reminder',
    providerTemplateName: 'amc_renewal',
    bodyText:
      'Contract {{contractNumber}} for {{customerName}} ends on {{endsOn}} ({{daysLeft}} days left). Please follow up on the renewal.',
    enabled: false,
  },
];

/**
 * Placeholder names in order of first appearance: `{{assigneeName}} … {{ticketNumber}}`
 * → ['assigneeName', 'ticketNumber']. Duplicates collapse to their first
 * position. Pure.
 */
export function extractParamNames(bodyText: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const match of bodyText.matchAll(/\{\{\s*([a-zA-Z][\w.]*)\s*\}\}/g)) {
    if (!seen.has(match[1])) {
      seen.add(match[1]);
      names.push(match[1]);
    }
  }
  return names;
}

export interface QueuedWhatsApp {
  /** Raw number; normalized to E.164 at queue time (null = skip). */
  to: string | null | undefined;
  templateKey: string;
  variables: WhatsAppVariables;
  ticketId?: string;
  /** True when the recipient (Customer/CustomerContact) opted out. */
  optOut?: boolean;
}

/** What travels with the BullMQ job: the rendered template payload. */
interface WhatsAppJobData {
  whatsappLogId: string;
  providerTemplateName: string;
  languageCode: string;
  parameters: string[];
}

/** Meta's delivery-receipt payload (only the parts we read). */
interface MetaStatusEntry {
  id?: string;
  status?: string;
  errors?: { title?: string }[];
}

/** Delivery ranks: receipts only ever move a message forward, never back. */
const STATUS_RANK: Record<string, number> = {
  QUEUED: 0,
  SENT: 1,
  DELIVERED: 2,
  READ: 3,
  FAILED: 4,
};

const META_STATUS_TO_LOG: Record<string, 'SENT' | 'DELIVERED' | 'READ' | 'FAILED'> = {
  sent: 'SENT',
  delivered: 'DELIVERED',
  read: 'READ',
  failed: 'FAILED',
};

/**
 * WhatsApp outbox. Callers queue a templated message; the worker on the
 * `notifications` queue sends it through the Meta Cloud API. Provider outages
 * never block ticket work: the row stays QUEUED and BullMQ retries with
 * backoff. Delivery receipts arrive on the public webhook.
 */
@Injectable()
export class WhatsAppService implements OnModuleInit {
  private readonly logger = new Logger(WhatsAppService.name);

  /**
   * Swapped in tests so the worker never hits the real Meta API. Production
   * builds a MetaCloudApiProvider from the stored credentials.
   */
  providerFactory: (credentials: WhatsAppCredentials) => WhatsAppProvider = (credentials) =>
    new MetaCloudApiProvider({
      phoneNumberId: credentials.phoneNumberId,
      accessToken: credentials.accessToken,
    });

  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
    private readonly settings: AppSettingsService,
    private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    this.queues.register(
      'notifications',
      SEND_WHATSAPP_JOB,
      async (job: Job<WhatsAppJobData>) => this.deliver(job),
    );
    void this.seedTemplates().catch((error: Error) =>
      this.logger.error(`Could not seed WhatsApp templates: ${error.message}`),
    );
  }

  /** Seeds the default templates once; admin toggles are never overwritten. */
  private async seedTemplates(): Promise<void> {
    await this.prisma.whatsAppTemplate.createMany({
      data: WHATSAPP_TEMPLATE_SEEDS,
      skipDuplicates: true,
    });
  }

  /**
   * Queues a templated WhatsApp message. Returns null (and queues nothing)
   * when WhatsApp is off/unconfigured, the channel toggle is off for the
   * template key, the template is missing/disabled, the number is unusable,
   * or the recipient opted out. Never throws: callers must not fail their
   * own work because WhatsApp is unavailable.
   */
  async queueWhatsApp(input: QueuedWhatsApp): Promise<string | null> {
    try {
      return await this.enqueue(input, { checkChannel: true });
    } catch (error) {
      this.logger.error(
        `Could not queue ${input.templateKey} WhatsApp message: ${(error as Error).message}`,
      );
      return null;
    }
  }

  /** Sends one template message right away (the admin "send test message" button). Throws on failure. */
  async sendTestMessage(to: string, templateKey = 'ticket.assigned'): Promise<string> {
    const template = await this.prisma.whatsAppTemplate.findUnique({
      where: { key: templateKey },
    });
    const variables: WhatsAppVariables = Object.fromEntries(
      extractParamNames(template?.bodyText ?? '').map((name) => [name, `Test ${name}`]),
    );
    try {
      return await this.enqueue({ to, templateKey, variables }, { checkChannel: false });
    } catch (error) {
      if (error instanceof AppException) throw error;
      throw new AppException(
        'WHATSAPP_SEND_FAILED',
        `The test message could not be sent: ${stripUrlCredentials((error as Error).message)}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  /**
   * Renders the positional template parameters, writes the outbox row and
   * enqueues the send job. Throws AppException for every "don't send" case;
   * queueWhatsApp() converts those to null.
   */
  private async enqueue(
    input: QueuedWhatsApp,
    opts: { checkChannel: boolean },
  ): Promise<string> {
    const credentials = await this.settings.whatsappCredentials();
    if (!credentials) {
      throw new AppException(
        'WHATSAPP_NOT_CONFIGURED',
        'WhatsApp is not configured yet. Save the settings first.',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (input.optOut) {
      throw new AppException(
        'WHATSAPP_OPTED_OUT',
        'The recipient opted out of WhatsApp messages.',
        HttpStatus.CONFLICT,
      );
    }
    if (opts.checkChannel) {
      const channels = await this.settings.notificationChannels();
      if (channels[input.templateKey]?.whatsapp !== true) {
        throw new AppException(
          'WHATSAPP_CHANNEL_OFF',
          'The WhatsApp channel is switched off for this notification.',
          HttpStatus.CONFLICT,
        );
      }
    }
    const template = await this.prisma.whatsAppTemplate.findUnique({
      where: { key: input.templateKey },
    });
    if (!template || !template.enabled) {
      throw new AppException(
        'WHATSAPP_TEMPLATE_UNAVAILABLE',
        'That WhatsApp template is not available.',
        HttpStatus.NOT_FOUND,
      );
    }
    const to = normalizePhone(input.to);
    if (!to) {
      throw new AppException(
        'INVALID_PHONE_NUMBER',
        'There is no usable phone number for this recipient.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const parameters = extractParamNames(template.bodyText).map((name) =>
      String(input.variables[name] ?? ''),
    );
    const log = await this.prisma.whatsAppLog.create({
      data: { to, templateKey: input.templateKey, ticketId: input.ticketId ?? null },
      select: { id: true },
    });
    await this.queues.queue('notifications').add(
      SEND_WHATSAPP_JOB,
      {
        whatsappLogId: log.id,
        providerTemplateName: template.providerTemplateName,
        languageCode: template.languageCode,
        parameters,
      },
      {
        jobId: whatsappJobId(log.id),
        attempts: WHATSAPP_ATTEMPTS,
        backoff: { type: 'exponential', delay: 60_000 },
      },
    );
    return log.id;
  }

  private async deliver(job: Job<WhatsAppJobData>): Promise<string> {
    const log = await this.prisma.whatsAppLog.findUnique({ where: { id: job.data.whatsappLogId } });
    if (!log) return 'Skipped: WhatsApp log row no longer exists';
    if (STATUS_RANK[log.status] >= STATUS_RANK.SENT)
      return 'Skipped: already sent';
    const credentials = await this.settings.whatsappCredentials();
    if (!credentials) {
      await this.prisma.whatsAppLog.update({
        where: { id: log.id },
        data: { status: 'FAILED', error: 'WhatsApp was disabled before the message was sent.' },
      });
      return 'Failed: WhatsApp is not configured';
    }
    try {
      const { providerMessageId } = await this.providerFactory(credentials).sendTemplate(
        log.to,
        job.data.providerTemplateName,
        job.data.languageCode,
        job.data.parameters,
      );
      await this.prisma.whatsAppLog.update({
        where: { id: log.id },
        data: {
          status: 'SENT',
          providerMessageId,
          sentAt: new Date(),
          attempts: log.attempts + 1,
          error: null,
        },
      });
      return `Sent to ${log.to}`;
    } catch (error) {
      const attempts = log.attempts + 1;
      const message = stripUrlCredentials((error as Error).message);
      if (attempts >= WHATSAPP_ATTEMPTS) {
        await this.prisma.whatsAppLog.update({
          where: { id: log.id },
          data: { status: 'FAILED', attempts, error: message },
        });
        return `Failed permanently after ${attempts} attempts: ${message}`;
      }
      await this.prisma.whatsAppLog.update({
        where: { id: log.id },
        data: { attempts, error: message },
      });
      throw error;
    }
  }

  /** The URL the admin registers in the Meta app dashboard. */
  webhookUrl(): string {
    const base = this.config.get('PUBLIC_WEBHOOK_BASE_URL') ?? this.config.get('APP_URL');
    return `${base}/api/v1/settings/whatsapp/webhook`;
  }

  /**
   * Meta's webhook verification handshake. Returns the challenge when the
   * verify token matches the stored one; anything else is a 403.
   */
  async verifyHandshake(
    mode: string | undefined,
    token: string | undefined,
    challenge: string | undefined,
  ): Promise<string> {
    const secrets = await this.settings.whatsappWebhookSecrets();
    if (!secrets) {
      throw new AppException(
        'WHATSAPP_WEBHOOK_NOT_SET_UP',
        'WhatsApp webhooks are not set up.',
        HttpStatus.NOT_FOUND,
      );
    }
    if (mode !== 'subscribe' || !token || !challenge || !safeEqual(token, secrets.verifyToken)) {
      throw new AppException(
        'WEBHOOK_VERIFY_FAILED',
        'Webhook verification failed.',
        HttpStatus.FORBIDDEN,
      );
    }
    return challenge;
  }

  /**
   * Meta's delivery receipts. Verifies X-Hub-Signature-256 (HMAC-SHA256 of
   * the raw body with the app secret) then moves matching log rows forward:
   * sent → delivered → read, or failed. Receipts for unknown message ids are
   * ignored. Secrets are never logged.
   */
  async receiveWebhook(
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ): Promise<{ received: boolean }> {
    const secrets = await this.settings.whatsappWebhookSecrets();
    if (!secrets) {
      throw new AppException(
        'WHATSAPP_WEBHOOK_NOT_SET_UP',
        'WhatsApp webhooks are not set up.',
        HttpStatus.NOT_FOUND,
      );
    }
    const expected = `sha256=${createHmac('sha256', secrets.appSecret).update(rawBody ?? Buffer.alloc(0)).digest('hex')}`;
    if (!signature || !safeEqual(signature, expected)) {
      throw new AppException(
        'BAD_SIGNATURE',
        'Webhook signature missing or wrong.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    let payload: unknown = null;
    try {
      payload = JSON.parse((rawBody ?? Buffer.alloc(0)).toString('utf8'));
    } catch {
      payload = null;
    }
    for (const entry of this.collectStatuses(payload)) {
      const mapped = META_STATUS_TO_LOG[entry.status ?? ''];
      if (!mapped || !entry.id) continue;
      const log = await this.prisma.whatsAppLog.findFirst({
        where: { providerMessageId: entry.id },
        select: { id: true, status: true },
      });
      if (!log) continue;
      if (STATUS_RANK[mapped] <= STATUS_RANK[log.status]) continue;
      await this.prisma.whatsAppLog.update({
        where: { id: log.id },
        data: {
          status: mapped,
          error:
            mapped === 'FAILED'
              ? (entry.errors?.[0]?.title ?? 'The provider reported a failure.').slice(0, 500)
              : null,
        },
      });
    }
    return { received: true };
  }

  private collectStatuses(payload: unknown): MetaStatusEntry[] {
    const entries: MetaStatusEntry[] = [];
    const root = payload as {
      entry?: { changes?: { value?: { statuses?: MetaStatusEntry[] } }[] }[];
    } | null;
    for (const entry of root?.entry ?? []) {
      for (const change of entry?.changes ?? []) {
        for (const status of change?.value?.statuses ?? []) entries.push(status);
      }
    }
    return entries;
  }
}
