import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuthUser, ClientInfo } from '../auth/auth.types';
import { AuditService } from '../core/audit/audit.service';
import { CryptoService } from '../core/crypto/crypto.service';
import { validationFailed } from '../core/http/app.exception';
import { PrismaService } from '../core/prisma/prisma.service';
import { generateToken } from '../core/security/tokens';
import { normalizePhone } from '../notifications/phone.util';

export interface CompanySettings {
  name: string;
  timezone: string;
  currency: string;
  gstRatePercent: number;
}

/** Quotation rules stored in AppSetting. */
export interface QuotationSettings {
  /** When on, a ticket can't move to IN_PROGRESS while a SENT quotation has no PO. */
  requirePoBeforeWork: boolean;
}

export const COMPANY_KEY = 'company';
export const QUOTATIONS_KEY = 'quotations';
export const WRITEBACKS_KEY = 'writebacks';
export const EMAIL_KEY = 'email';
export const WHATSAPP_KEY = 'whatsapp';
export const NOTIFICATION_CHANNELS_KEY = 'notifications';
export const AMC_KEY = 'amc';
export const DEFAULT_QUOTATIONS: QuotationSettings = {
  requirePoBeforeWork: false,
};

/** Which ticket actions create the sales invoice in the ERP. */
export type InvoiceTrigger = 'close' | 'verify';
export const INVOICE_TRIGGERS: InvoiceTrigger[] = ['close', 'verify'];

/** ERP write-back rules stored in AppSetting. */
export interface WritebackSettings {
  /** Ticket actions that create the sales invoice; empty disables invoices. */
  invoiceTriggers: InvoiceTrigger[];
  /** Local warehouse id used for stock entries; null = not configured. */
  defaultWarehouseId: string | null;
  /** Stock entries are posted as drafts (docstatus 0). */
  stockEntryAsDraft: boolean;
  /** ERP taxes-and-charges template on invoices; null lets the ERP decide. */
  invoiceTaxTemplate: string | null;
}
export const DEFAULT_WRITEBACKS: WritebackSettings = {
  invoiceTriggers: ['close'],
  defaultWarehouseId: null,
  stockEntryAsDraft: true,
  invoiceTaxTemplate: null,
};
export const DEFAULT_COMPANY: CompanySettings = {
  name: 'ERPTick',
  timezone: 'Asia/Kolkata',
  currency: 'INR',
  gstRatePercent: 18,
};

/** Email (SMTP) settings stored in AppSetting. The password is encrypted at rest. */
export interface EmailSettings {
  /** Master switch: nothing is sent while off. */
  enabled: boolean;
  host: string;
  port: number;
  /** Implicit TLS (usually port 465); otherwise STARTTLS is tried. */
  secure: boolean;
  username: string;
  fromName: string;
  fromAddress: string;
}

/** What the API returns: the settings plus whether a password is stored. Never the password. */
export interface EmailSettingsView extends EmailSettings {
  hasPassword: boolean;
}

export const DEFAULT_EMAIL: EmailSettings = {
  enabled: false,
  host: '',
  port: 587,
  secure: false,
  username: '',
  fromName: '',
  fromAddress: '',
};

/** WhatsApp (Meta Cloud API) settings stored in AppSetting. Secrets are encrypted at rest. */
export interface WhatsAppSettings {
  /** Master switch: nothing is queued while off. */
  enabled: boolean;
  provider: 'meta';
  /** The phone number ID from the Meta WhatsApp Business account. */
  phoneNumberId: string;
  businessAccountId: string;
  /** The business's own WhatsApp number, e.g. +919876543210. */
  displayPhoneNumber: string;
  /**
   * Plain setup value, not a secret: Meta sends it back on the webhook
   * handshake, so the admin copies it into the Meta app dashboard.
   */
  verifyToken: string;
}

/** What the API returns: the settings plus whether secrets are stored. Never the secrets. */
export interface WhatsAppSettingsView extends WhatsAppSettings {
  hasAccessToken: boolean;
  hasAppSecret: boolean;
}

/** Decrypted credentials for the WhatsApp outbox, or null when not configured. */
export interface WhatsAppCredentials {
  phoneNumberId: string;
  accessToken: string;
  appSecret: string | null;
  verifyToken: string | null;
}

export const DEFAULT_WHATSAPP: WhatsAppSettings = {
  enabled: false,
  provider: 'meta',
  phoneNumberId: '',
  businessAccountId: '',
  displayPhoneNumber: '',
  verifyToken: '',
};

/**
 * Per-template channel toggles stored in AppSetting. Email defaults to on
 * (today's behaviour); WhatsApp defaults to off — an admin enables it per
 * template after the master switch is on.
 */
export interface NotificationChannels {
  [templateKey: string]: { email: boolean; whatsapp: boolean };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** AMC scheduling rules stored in AppSetting. */
export interface AmcSettings {
  /** Days before a planned visit its PM ticket is created. */
  pmLeadTimeDays: number;
}

export const DEFAULT_AMC: AmcSettings = { pmLeadTimeDays: 3 };
export const MIN_PM_LEAD_DAYS = 1;
export const MAX_PM_LEAD_DAYS = 30;

function timezoneValid(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** Company-wide settings stored in AppSetting. */
@Injectable()
export class AppSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
  ) {}

  async company(): Promise<CompanySettings> {
    const row = await this.prisma.appSetting.findUnique({ where: { key: COMPANY_KEY } });
    return { ...DEFAULT_COMPANY, ...((row?.value as Partial<CompanySettings>) ?? {}) };
  }

  async hasCompany(): Promise<boolean> {
    return !!(await this.prisma.appSetting.findUnique({ where: { key: COMPANY_KEY } }));
  }

  async quotations(): Promise<QuotationSettings> {
    const row = await this.prisma.appSetting.findUnique({ where: { key: QUOTATIONS_KEY } });
    return { ...DEFAULT_QUOTATIONS, ...((row?.value as Partial<QuotationSettings>) ?? {}) };
  }

  async writebacks(): Promise<WritebackSettings> {
    const row = await this.prisma.appSetting.findUnique({ where: { key: WRITEBACKS_KEY } });
    const stored = (row?.value as Partial<WritebackSettings>) ?? {};
    return {
      ...DEFAULT_WRITEBACKS,
      ...stored,
      // Guard against hand-edited rows: only known triggers survive.
      invoiceTriggers: (stored.invoiceTriggers ?? DEFAULT_WRITEBACKS.invoiceTriggers).filter(
        (t): t is InvoiceTrigger => INVOICE_TRIGGERS.includes(t),
      ),
    };
  }

  async updateWritebackSettings(
    actor: AuthUser,
    input: Partial<WritebackSettings>,
    client: ClientInfo,
  ): Promise<WritebackSettings> {
    const current = await this.writebacks();
    const triggers =
      input.invoiceTriggers === undefined
        ? current.invoiceTriggers
        : input.invoiceTriggers.filter((t): t is InvoiceTrigger =>
            INVOICE_TRIGGERS.includes(t),
          );
    let defaultWarehouseId = current.defaultWarehouseId;
    if (input.defaultWarehouseId !== undefined) {
      defaultWarehouseId = input.defaultWarehouseId;
      if (defaultWarehouseId) {
        const warehouse = await this.prisma.warehouse.findUnique({
          where: { id: defaultWarehouseId },
        });
        if (!warehouse || !warehouse.active) {
          throw validationFailed([
            { field: 'defaultWarehouseId', message: 'Choose an active warehouse.' },
          ]);
        }
      }
    }
    const next: WritebackSettings = {
      invoiceTriggers: triggers,
      defaultWarehouseId,
      stockEntryAsDraft: input.stockEntryAsDraft ?? current.stockEntryAsDraft,
      invoiceTaxTemplate: (input.invoiceTaxTemplate ?? current.invoiceTaxTemplate)?.trim() || null,
    };
    await this.prisma.appSetting.upsert({
      where: { key: WRITEBACKS_KEY },
      create: { key: WRITEBACKS_KEY, value: next as unknown as Prisma.InputJsonValue },
      update: { value: next as unknown as Prisma.InputJsonValue },
    });
    const changed = (Object.keys(next) as (keyof WritebackSettings)[]).filter(
      (k) => JSON.stringify(next[k]) !== JSON.stringify(current[k]),
    );
    if (changed.length) {
      await this.audit.record({
        actorId: actor.id,
        action: 'settings.writebacks_updated',
        entityType: 'app_setting',
        entityId: WRITEBACKS_KEY,
        summary: `${actor.name} updated the ERP write-back settings (${changed.join(', ')})`,
        changes: Object.fromEntries(
          changed.map((k) => [k, { from: current[k], to: next[k] }]),
        ),
        ip: client.ip,
        requestId: client.requestId,
      });
    }
    return next;
  }

  async updateQuotationSettings(
    actor: AuthUser,
    input: Partial<QuotationSettings>,
    client: ClientInfo,
  ): Promise<QuotationSettings> {
    const current = await this.quotations();
    const next = { ...current, requirePoBeforeWork: !!input.requirePoBeforeWork };
    await this.prisma.appSetting.upsert({
      where: { key: QUOTATIONS_KEY },
      create: { key: QUOTATIONS_KEY, value: next },
      update: { value: next },
    });
    if (next.requirePoBeforeWork !== current.requirePoBeforeWork) {
      await this.audit.record({
        actorId: actor.id,
        action: 'settings.quotations_updated',
        entityType: 'app_setting',
        entityId: QUOTATIONS_KEY,
        summary: `${actor.name} ${next.requirePoBeforeWork ? 'required' : 'no longer required'} a purchase order before work starts`,
        changes: {
          requirePoBeforeWork: {
            from: current.requirePoBeforeWork,
            to: next.requirePoBeforeWork,
          },
        },
        ip: client.ip,
        requestId: client.requestId,
      });
    }
    return next;
  }

  async setCompany(
    value: CompanySettings,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    await tx.appSetting.upsert({
      where: { key: COMPANY_KEY },
      create: { key: COMPANY_KEY, value: value as unknown as Prisma.InputJsonValue },
      update: { value: value as unknown as Prisma.InputJsonValue },
    });
  }

  /** Email settings for display. The password is never returned; see hasPassword. */
  async email(): Promise<EmailSettingsView> {
    const row = await this.prisma.appSetting.findUnique({ where: { key: EMAIL_KEY } });
    const stored = (row?.value as Partial<EmailSettings> & { passwordEncrypted?: string }) ?? {};
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passwordEncrypted, ...rest } = stored;
    return {
      ...DEFAULT_EMAIL,
      ...rest,
      hasPassword: !!passwordEncrypted,
    };
  }

  /**
   * Decrypted SMTP credentials for the mailer, or null when email isn't
   * configured. Only the mailer calls this; the API never exposes it.
   */
  async emailCredentials(): Promise<(EmailSettings & { password: string | null }) | null> {
    const row = await this.prisma.appSetting.findUnique({ where: { key: EMAIL_KEY } });
    if (!row) return null;
    const stored = row.value as Partial<EmailSettings> & { passwordEncrypted?: string };
    if (!stored.enabled || !stored.host) return null;
    return {
      ...DEFAULT_EMAIL,
      ...(stored as Partial<EmailSettings>),
      password: stored.passwordEncrypted ? this.crypto.decrypt(stored.passwordEncrypted) : null,
    };
  }

  async updateEmailSettings(
    actor: AuthUser,
    input: Partial<EmailSettings> & { password?: string },
    client: ClientInfo,
  ): Promise<EmailSettingsView> {
    const row = await this.prisma.appSetting.findUnique({ where: { key: EMAIL_KEY } });
    const stored = (row?.value as Partial<EmailSettings> & { passwordEncrypted?: string }) ?? {};
    const next: EmailSettings = {
      enabled: input.enabled ?? stored.enabled ?? DEFAULT_EMAIL.enabled,
      host: (input.host ?? stored.host ?? '').trim(),
      port: input.port ?? stored.port ?? DEFAULT_EMAIL.port,
      secure: input.secure ?? stored.secure ?? DEFAULT_EMAIL.secure,
      username: (input.username ?? stored.username ?? '').trim(),
      fromName: (input.fromName ?? stored.fromName ?? '').trim(),
      fromAddress: (input.fromAddress ?? stored.fromAddress ?? '').trim().toLowerCase(),
    };
    // undefined keeps the stored password; an empty string clears it.
    const passwordEncrypted =
      input.password === undefined
        ? stored.passwordEncrypted
        : input.password
          ? this.crypto.encrypt(input.password)
          : undefined;
    const problems = [
      next.enabled && !next.host && { field: 'host', message: 'Enter the SMTP host.' },
      next.enabled && !(next.port >= 1 && next.port <= 65535) && {
        field: 'port',
        message: 'Use a port from 1 to 65535.',
      },
      next.enabled && !EMAIL_RE.test(next.fromAddress) && {
        field: 'fromAddress',
        message: 'Enter a valid sender address, e.g. service@company.com.',
      },
      next.enabled && !passwordEncrypted && {
        field: 'password',
        message: 'Enter the SMTP password.',
      },
    ].filter((p): p is { field: string; message: string } => !!p);
    if (problems.length) throw validationFailed(problems);

    await this.prisma.appSetting.upsert({
      where: { key: EMAIL_KEY },
      create: {
        key: EMAIL_KEY,
        value: { ...next, passwordEncrypted } as unknown as Prisma.InputJsonValue,
      },
      update: {
        value: { ...next, passwordEncrypted } as unknown as Prisma.InputJsonValue,
      },
    });
    await this.audit.record({
      actorId: actor.id,
      action: 'settings.email_updated',
      entityType: 'app_setting',
      entityId: EMAIL_KEY,
      summary: `${actor.name} updated the email (SMTP) settings`,
      ip: client.ip,
      requestId: client.requestId,
    });
    return { ...next, hasPassword: !!passwordEncrypted };
  }

  /** WhatsApp settings for display. Secrets are never returned; see hasAccessToken/hasAppSecret. */
  async whatsapp(): Promise<WhatsAppSettingsView> {
    const row = await this.prisma.appSetting.findUnique({ where: { key: WHATSAPP_KEY } });
    const stored =
      (row?.value as Partial<WhatsAppSettings> & {
        accessTokenEncrypted?: string;
        appSecretEncrypted?: string;
      }) ?? {};
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { accessTokenEncrypted, appSecretEncrypted, ...rest } = stored;
    return {
      ...DEFAULT_WHATSAPP,
      ...rest,
      hasAccessToken: !!accessTokenEncrypted,
      hasAppSecret: !!appSecretEncrypted,
    };
  }

  /**
   * Decrypted WhatsApp credentials for the outbox, or null when WhatsApp isn't
   * configured. Only the WhatsApp worker calls this; the API never exposes it.
   */
  async whatsappCredentials(): Promise<WhatsAppCredentials | null> {
    const row = await this.prisma.appSetting.findUnique({ where: { key: WHATSAPP_KEY } });
    if (!row) return null;
    const stored = row.value as Partial<WhatsAppSettings> & {
      accessTokenEncrypted?: string;
      appSecretEncrypted?: string;
    };
    if (!stored.enabled || !stored.phoneNumberId || !stored.accessTokenEncrypted) return null;
    return {
      phoneNumberId: stored.phoneNumberId,
      accessToken: this.crypto.decrypt(stored.accessTokenEncrypted),
      appSecret: stored.appSecretEncrypted ? this.crypto.decrypt(stored.appSecretEncrypted) : null,
      verifyToken: stored.verifyToken || null,
    };
  }

  /**
   * The webhook secrets (verify token + app secret), or null when webhooks
   * aren't set up. The master switch doesn't gate this: Meta verifies the
   * webhook before the channel ever goes live.
   */
  async whatsappWebhookSecrets(): Promise<{ verifyToken: string; appSecret: string } | null> {
    const row = await this.prisma.appSetting.findUnique({ where: { key: WHATSAPP_KEY } });
    const stored = row?.value as
      | (Partial<WhatsAppSettings> & { appSecretEncrypted?: string })
      | undefined;
    if (!stored?.verifyToken || !stored?.appSecretEncrypted) return null;
    return {
      verifyToken: stored.verifyToken,
      appSecret: this.crypto.decrypt(stored.appSecretEncrypted),
    };
  }

  async updateWhatsAppSettings(
    actor: AuthUser,
    input: Partial<WhatsAppSettings> & { accessToken?: string; appSecret?: string },
    client: ClientInfo,
  ): Promise<WhatsAppSettingsView> {
    const row = await this.prisma.appSetting.findUnique({ where: { key: WHATSAPP_KEY } });
    const stored =
      (row?.value as Partial<WhatsAppSettings> & {
        accessTokenEncrypted?: string;
        appSecretEncrypted?: string;
      }) ?? {};
    const next: WhatsAppSettings = {
      enabled: input.enabled ?? stored.enabled ?? DEFAULT_WHATSAPP.enabled,
      provider: 'meta',
      phoneNumberId: (input.phoneNumberId ?? stored.phoneNumberId ?? '').trim(),
      businessAccountId: (input.businessAccountId ?? stored.businessAccountId ?? '').trim(),
      displayPhoneNumber: (input.displayPhoneNumber ?? stored.displayPhoneNumber ?? '').trim(),
      verifyToken: (input.verifyToken ?? stored.verifyToken ?? '').trim(),
    };
    // The admin copies the verify token into the Meta dashboard; generate one
    // when the channel is switched on without it.
    if (next.enabled && !next.verifyToken) next.verifyToken = generateToken();
    // undefined keeps the stored secret; an empty string clears it.
    const accessTokenEncrypted =
      input.accessToken === undefined
        ? stored.accessTokenEncrypted
        : input.accessToken
          ? this.crypto.encrypt(input.accessToken)
          : undefined;
    const appSecretEncrypted =
      input.appSecret === undefined
        ? stored.appSecretEncrypted
        : input.appSecret
          ? this.crypto.encrypt(input.appSecret)
          : undefined;
    const problems = [
      next.enabled && !next.phoneNumberId && {
        field: 'phoneNumberId',
        message: 'Enter the phone number ID from your Meta WhatsApp Business account.',
      },
      next.enabled && !accessTokenEncrypted && {
        field: 'accessToken',
        message: 'Enter the WhatsApp access token.',
      },
      next.displayPhoneNumber && !normalizePhone(next.displayPhoneNumber) && {
        field: 'displayPhoneNumber',
        message: 'Enter a valid phone number, e.g. +919876543210.',
      },
    ].filter((p): p is { field: string; message: string } => !!p);
    if (problems.length) throw validationFailed(problems);

    await this.prisma.appSetting.upsert({
      where: { key: WHATSAPP_KEY },
      create: {
        key: WHATSAPP_KEY,
        value: { ...next, accessTokenEncrypted, appSecretEncrypted } as unknown as Prisma.InputJsonValue,
      },
      update: {
        value: { ...next, accessTokenEncrypted, appSecretEncrypted } as unknown as Prisma.InputJsonValue,
      },
    });
    await this.audit.record({
      actorId: actor.id,
      action: 'settings.whatsapp_updated',
      entityType: 'app_setting',
      entityId: WHATSAPP_KEY,
      summary: `${actor.name} updated the WhatsApp settings`,
      ip: client.ip,
      requestId: client.requestId,
    });
    return { ...next, hasAccessToken: !!accessTokenEncrypted, hasAppSecret: !!appSecretEncrypted };
  }

  /** Per-template channel toggles. Unknown keys are dropped. */
  async notificationChannels(): Promise<NotificationChannels> {
    const row = await this.prisma.appSetting.findUnique({ where: { key: NOTIFICATION_CHANNELS_KEY } });
    const stored = (row?.value as { channels?: NotificationChannels } | undefined)?.channels;
    if (!stored || typeof stored !== 'object') return {};
    const channels: NotificationChannels = {};
    for (const [key, value] of Object.entries(stored)) {
      if (!value || typeof value !== 'object') continue;
      channels[key] = {
        email: (value as { email?: unknown }).email !== false,
        whatsapp: (value as { whatsapp?: unknown }).whatsapp === true,
      };
    }
    return channels;
  }

  async updateNotificationChannels(
    actor: AuthUser,
    input: { channels: Record<string, { email?: boolean; whatsapp?: boolean }> },
    client: ClientInfo,
  ): Promise<NotificationChannels> {
    const current = await this.notificationChannels();
    const [emailTemplates, whatsappTemplates] = await Promise.all([
      this.prisma.emailTemplate.findMany({ select: { key: true } }),
      this.prisma.whatsAppTemplate.findMany({ select: { key: true } }),
    ]);
    const known = new Set([
      ...emailTemplates.map((t) => t.key),
      ...whatsappTemplates.map((t) => t.key),
    ]);
    const next: NotificationChannels = { ...current };
    for (const [key, value] of Object.entries(input.channels ?? {})) {
      if (!known.has(key) || !value || typeof value !== 'object') continue;
      next[key] = {
        email: value.email ?? current[key]?.email ?? true,
        whatsapp: value.whatsapp ?? current[key]?.whatsapp ?? false,
      };
    }
    await this.prisma.appSetting.upsert({
      where: { key: NOTIFICATION_CHANNELS_KEY },
      create: {
        key: NOTIFICATION_CHANNELS_KEY,
        value: { channels: next } as unknown as Prisma.InputJsonValue,
      },
      update: { value: { channels: next } as unknown as Prisma.InputJsonValue },
    });
    await this.audit.record({
      actorId: actor.id,
      action: 'settings.notification_channels_updated',
      entityType: 'app_setting',
      entityId: NOTIFICATION_CHANNELS_KEY,
      summary: `${actor.name} updated the notification channel toggles`,
      ip: client.ip,
      requestId: client.requestId,
    });
    return next;
  }

  /** AMC scheduling rules. */
  async amc(): Promise<AmcSettings> {
    const row = await this.prisma.appSetting.findUnique({ where: { key: AMC_KEY } });
    return { ...DEFAULT_AMC, ...((row?.value as Partial<AmcSettings>) ?? {}) };
  }

  async updateAmcSettings(
    actor: AuthUser,
    input: Partial<AmcSettings>,
    client: ClientInfo,
  ): Promise<AmcSettings> {
    const current = await this.amc();
    const next: AmcSettings = {
      pmLeadTimeDays: input.pmLeadTimeDays ?? current.pmLeadTimeDays,
    };
    if (
      !Number.isInteger(next.pmLeadTimeDays) ||
      next.pmLeadTimeDays < MIN_PM_LEAD_DAYS ||
      next.pmLeadTimeDays > MAX_PM_LEAD_DAYS
    ) {
      throw validationFailed([
        {
          field: 'pmLeadTimeDays',
          message: `Use ${MIN_PM_LEAD_DAYS} to ${MAX_PM_LEAD_DAYS} days.`,
        },
      ]);
    }
    await this.prisma.appSetting.upsert({
      where: { key: AMC_KEY },
      create: { key: AMC_KEY, value: next as unknown as Prisma.InputJsonValue },
      update: { value: next as unknown as Prisma.InputJsonValue },
    });
    if (next.pmLeadTimeDays !== current.pmLeadTimeDays) {
      await this.audit.record({
        actorId: actor.id,
        action: 'settings.amc_updated',
        entityType: 'app_setting',
        entityId: AMC_KEY,
        summary: `${actor.name} set the AMC PM lead time to ${next.pmLeadTimeDays} days`,
        changes: { pmLeadTimeDays: { from: current.pmLeadTimeDays, to: next.pmLeadTimeDays } },
        ip: client.ip,
        requestId: client.requestId,
      });
    }
    return next;
  }

  async updateCompany(
    actor: AuthUser,
    input: Partial<CompanySettings>,
    client: ClientInfo,
  ): Promise<CompanySettings> {
    const current = await this.company();
    const next = { ...current, ...input, name: (input.name ?? current.name).trim() };
    const problems = [
      next.name.length < 2 && { field: 'name', message: 'Enter the company name.' },
      !timezoneValid(next.timezone) && { field: 'timezone', message: 'Choose a valid time zone.' },
      !/^[A-Z]{3}$/.test(next.currency) && {
        field: 'currency',
        message: 'Use a 3-letter currency code, e.g. INR.',
      },
      !(next.gstRatePercent >= 0 && next.gstRatePercent <= 100) && {
        field: 'gstRatePercent',
        message: 'Use a rate from 0 to 100.',
      },
    ].filter((p): p is { field: string; message: string } => !!p);
    if (problems.length) throw validationFailed(problems);

    await this.setCompany(next);
    const changed = (Object.keys(next) as (keyof CompanySettings)[]).filter(
      (k) => next[k] !== current[k],
    );
    if (changed.length) {
      await this.audit.record({
        actorId: actor.id,
        action: 'settings.company_updated',
        entityType: 'app_setting',
        entityId: COMPANY_KEY,
        summary: `${actor.name} changed company settings: ${changed.join(', ')}`,
        changes: Object.fromEntries(changed.map((k) => [k, { from: current[k], to: next[k] }])),
        ip: client.ip,
        requestId: client.requestId,
      });
    }
    return next;
  }
}
