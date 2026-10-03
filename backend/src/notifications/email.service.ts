import { HttpStatus, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Job } from 'bullmq';
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { AppConfig } from '../core/config/app-config.service';
import { AppException } from '../core/http/app.exception';
import { stripUrlCredentials } from '../core/logging/redact';
import { PrismaService } from '../core/prisma/prisma.service';
import { QueueService } from '../core/queue/queue.service';
import { AppSettingsService, type EmailSettings } from '../demo/app-settings.service';

/** Job name on the `notifications` queue (the queue already existed; the outbox is new). */
export const SEND_EMAIL_JOB = 'send-email';

/** BullMQ job ids can't contain ":"; one fixed id per log row makes retries idempotent. */
const emailJobId = (emailLogId: string) => `email-${emailLogId}`;

const EMAIL_ATTEMPTS = 5;

export interface TemplateVariables {
  [key: string]: string | number | null | undefined;
}

interface TemplateSeed {
  key: string;
  name: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  enabled: boolean;
}

/**
 * The default templates, seeded once (never overwritten — admins edit them in
 * Settings → Notification templates). `{{variable}}` placeholders are filled
 * when the email is queued.
 */
export const EMAIL_TEMPLATE_SEEDS: TemplateSeed[] = [
  {
    key: 'ticket.assigned',
    name: 'Ticket assigned',
    subject: '[{{companyName}}] Ticket {{ticketNumber}} assigned to you',
    bodyHtml: `<p>Hi {{assigneeName}},</p><p>Ticket <strong>{{ticketNumber}}</strong> — {{ticketTitle}} — has been assigned to you.</p><p><a href="{{ticketUrl}}">Open the ticket</a></p><p>— {{companyName}}</p>`,
    bodyText:
      'Hi {{assigneeName}},\n\nTicket {{ticketNumber}} — {{ticketTitle}} — has been assigned to you.\n\nOpen the ticket: {{ticketUrl}}\n\n— {{companyName}}',
    enabled: true,
  },
  {
    key: 'sla.breached',
    name: 'SLA breached',
    subject: '[{{companyName}}] SLA breached on ticket {{ticketNumber}}',
    bodyHtml: `<p>Ticket <strong>{{ticketNumber}}</strong> — {{ticketTitle}} — has breached its SLA.</p><p><a href="{{ticketUrl}}">Open the ticket</a></p><p>— {{companyName}}</p>`,
    bodyText:
      'Ticket {{ticketNumber}} — {{ticketTitle}} — has breached its SLA.\n\nOpen the ticket: {{ticketUrl}}\n\n— {{companyName}}',
    enabled: true,
  },
  {
    key: 'escalation.fired',
    name: 'Ticket escalated',
    subject: '[{{companyName}}] Ticket {{ticketNumber}} escalated (level {{level}})',
    bodyHtml: `<p>Ticket <strong>{{ticketNumber}}</strong> — {{ticketTitle}} — was escalated to level {{level}}: {{reason}}.</p><p><a href="{{ticketUrl}}">Open the ticket</a></p><p>— {{companyName}}</p>`,
    bodyText:
      'Ticket {{ticketNumber}} — {{ticketTitle}} — was escalated to level {{level}}: {{reason}}.\n\nOpen the ticket: {{ticketUrl}}\n\n— {{companyName}}',
    enabled: false,
  },
  {
    key: 'csat.invite',
    name: 'Feedback request',
    subject: '[{{companyName}}] How was our service on ticket {{ticketNumber}}?',
    bodyHtml: `<p>Hi {{customerName}},</p><p>Ticket <strong>{{ticketNumber}}</strong> is closed. Please tell us how the service was — it takes less than a minute:</p><p><a href="{{feedbackUrl}}">Rate our service</a></p><p>— {{companyName}}</p>`,
    bodyText:
      'Hi {{customerName}},\n\nTicket {{ticketNumber}} is closed. Please tell us how the service was — it takes less than a minute:\n\n{{feedbackUrl}}\n\n— {{companyName}}',
    enabled: true,
  },
  {
    key: 'auth.invite',
    name: 'Account invite',
    subject: '[{{companyName}}] You are invited to ERPTick',
    bodyHtml: `<p>Hi {{name}},</p><p>You have been invited to {{companyName}} on ERPTick. Set up your account here (the link expires in {{expiresIn}}):</p><p><a href="{{inviteUrl}}">Accept the invite</a></p><p>— {{companyName}}</p>`,
    bodyText:
      'Hi {{name}},\n\nYou have been invited to {{companyName}} on ERPTick. Set up your account here (the link expires in {{expiresIn}}):\n\n{{inviteUrl}}\n\n— {{companyName}}',
    enabled: true,
  },
  {
    key: 'auth.reset',
    name: 'Password reset',
    subject: '[{{companyName}}] Reset your ERPTick password',
    bodyHtml: `<p>Hi {{name}},</p><p>An administrator created a password reset link for your {{companyName}} account (it expires in {{expiresIn}}):</p><p><a href="{{resetUrl}}">Reset your password</a></p><p>If you did not ask for this, tell your administrator. — {{companyName}}</p>`,
    bodyText:
      'Hi {{name}},\n\nAn administrator created a password reset link for your {{companyName}} account (it expires in {{expiresIn}}):\n\n{{resetUrl}}\n\nIf you did not ask for this, tell your administrator. — {{companyName}}',
    enabled: true,
  },
  {
    key: 'amc.renewal',
    name: 'AMC renewal reminder',
    subject: '[{{companyName}}] AMC {{contractNumber}} expires in {{daysLeft}} days',
    bodyHtml: `<p>Contract <strong>{{contractNumber}}</strong> for {{customerName}} ends on {{endsOn}} — {{daysLeft}} days from now.</p><p>Please follow up on the renewal.</p><p>— {{companyName}}</p>`,
    bodyText:
      'Contract {{contractNumber}} for {{customerName}} ends on {{endsOn}} — {{daysLeft}} days from now.\n\nPlease follow up on the renewal.\n\n— {{companyName}}',
    enabled: true,
  },
  {
    key: 'report.scheduled',
    name: 'Scheduled report',
    subject: '[{{companyName}}] {{scheduleName}} — {{reportLabel}}',
    bodyHtml: `<p>Hi,</p><p>Your scheduled report <strong>{{scheduleName}}</strong> ({{reportLabel}}) ran with {{rowCount}} rows.</p><p>{{summary}}</p><p>{{downloadNote}}</p><p>— {{companyName}}</p>`,
    bodyText:
      'Hi,\n\nYour scheduled report {{scheduleName}} ({{reportLabel}}) ran with {{rowCount}} rows.\n\n{{summary}}\n\n{{downloadNote}}\n\n— {{companyName}}',
    enabled: true,
  },
  {
    key: 'portal.magic_link',
    name: 'Portal sign-in link',
    subject: '[{{companyName}}] Your ERPTick portal sign-in link',
    bodyHtml: `<p>Hi {{name}},</p><p>Use this link to sign in to the customer portal (expires in 15 minutes):</p><p><a href="{{magicLink}}">Sign in</a></p><p>— {{companyName}}</p>`,
    bodyText:
      'Hi {{name}},\n\nUse this link to sign in to the customer portal (expires in 15 minutes):\n\n{{magicLink}}\n\n— {{companyName}}',
    enabled: true,
  },
];

/** Renders `{{variable}}` placeholders; unknown variables render empty. Pure. */
export function renderTemplate(text: string, variables: TemplateVariables): string {
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, name: string) => {
    const value = variables[name];
    return value === null || value === undefined ? '' : String(value);
  });
}

/**
 * Escapes the five HTML-significant characters in a template value.
 * Ticket titles, customer names and other user-controlled text flow into
 * notification emails, so every value rendered into HTML must be inert.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Renders `{{variable}}` placeholders into HTML, escaping every value (SB-H3).
 * Use for bodyHtml only: subject and bodyText are plain text, where escaping
 * would corrupt the output ("A&B" would read "A&amp;B"). Pure.
 */
export function renderHtmlTemplate(text: string, variables: TemplateVariables): string {
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, name: string) => {
    const value = variables[name];
    return value === null || value === undefined ? '' : escapeHtml(String(value));
  });
}

export interface QueuedEmail {
  to: string;
  templateKey: string;
  variables: TemplateVariables;
  ticketId?: string;
  /**
   * Optional attachments, delivered with the email. Content is base64-encoded;
   * it travels with the BullMQ job data (not the database), so keep it small —
   * callers cap attachments themselves (scheduled reports: 5 MB).
   */
  attachments?: EmailAttachment[];
}

/** One file attached to a queued email. */
export interface EmailAttachment {
  filename: string;
  /** Base64-encoded file bytes. */
  content: string;
  contentType: string;
}

/**
 * Email outbox. Callers queue a templated email; the worker on the
 * `notifications` queue sends it. SMTP outages never block ticket work: the
 * row stays QUEUED and BullMQ retries with backoff. In-app notify() is untouched.
 */
@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
    private readonly settings: AppSettingsService,
    private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    this.queues.register(
      'notifications',
      SEND_EMAIL_JOB,
      async (job: Job<{ emailLogId: string; attachments?: EmailAttachment[] }>) => this.deliver(job),
    );
    void this.seedTemplates().catch((error: Error) =>
      this.logger.error(`Could not seed email templates: ${error.message}`),
    );
  }

  /** Seeds the default templates once; admin edits are never overwritten. */
  private async seedTemplates(): Promise<void> {
    await this.prisma.emailTemplate.createMany({
      data: EMAIL_TEMPLATE_SEEDS,
      skipDuplicates: true,
    });
  }

  /**
   * Queues a templated email. Returns null (and queues nothing) when email is
   * off/unconfigured, the email channel is switched off for the template, or
   * the template is disabled. Never throws: callers must not fail their own
   * work because email is unavailable.
   */
  async queueEmail(input: QueuedEmail): Promise<string | null> {
    try {
      const credentials = await this.settings.emailCredentials();
      if (!credentials) return null;
      const channels = await this.settings.notificationChannels();
      if (channels[input.templateKey]?.email === false) return null;
      const template = await this.prisma.emailTemplate.findUnique({
        where: { key: input.templateKey },
      });
      if (!template || !template.enabled) return null;
      const company = await this.settings.company();
      const variables: TemplateVariables = { companyName: company.name, ...input.variables };
      const subject = renderTemplate(template.subject, variables);
      const bodyHtml = renderHtmlTemplate(template.bodyHtml, variables);
      const bodyText = renderTemplate(template.bodyText, variables);
      const log = await this.prisma.emailLog.create({
        data: {
          to: input.to,
          templateKey: input.templateKey,
          ticketId: input.ticketId ?? null,
          subject,
          bodyHtml,
          bodyText,
        },
        select: { id: true },
      });
      await this.queues.queue('notifications').add(
        SEND_EMAIL_JOB,
        { emailLogId: log.id, attachments: input.attachments },
        {
          jobId: emailJobId(log.id),
          attempts: EMAIL_ATTEMPTS,
          backoff: { type: 'exponential', delay: 60_000 },
        },
      );
      return log.id;
    } catch (error) {
      this.logger.error(`Could not queue ${input.templateKey} email: ${(error as Error).message}`);
      return null;
    }
  }

  /** Sends one email right away (the admin "send test email" button). Throws on failure. */
  async sendTestEmail(to: string): Promise<void> {
    const credentials = await this.settings.emailCredentials();
    if (!credentials) {
      throw new AppException(
        'EMAIL_NOT_CONFIGURED',
        'Email is not configured yet. Save the SMTP settings first.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const company = await this.settings.company();
    try {
      await this.send(credentials, {
        to,
        subject: `[${company.name}] Test email from ERPTick`,
        html: `<p>This is a test email from ERPTick (${company.name}). Your SMTP settings work.</p>`,
        text: `This is a test email from ERPTick (${company.name}). Your SMTP settings work.`,
      });
    } catch (error) {
      throw new AppException(
        'EMAIL_SEND_FAILED',
        `The test email could not be sent: ${stripUrlCredentials((error as Error).message)}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  private transporter(credentials: EmailSettings & { password: string | null }): Transporter {
    return nodemailer.createTransport({
      host: credentials.host,
      port: credentials.port,
      secure: credentials.secure,
      auth:
        credentials.username && credentials.password
          ? { user: credentials.username, pass: credentials.password }
          : undefined,
    });
  }

  private async send(
    credentials: EmailSettings & { password: string | null },
    mail: {
      to: string;
      subject: string;
      html: string;
      text: string;
      attachments?: EmailAttachment[];
    },
  ): Promise<void> {
    const from = credentials.fromName
      ? `"${credentials.fromName}" <${credentials.fromAddress}>`
      : credentials.fromAddress;
    await this.transporter(credentials).sendMail({
      from,
      to: mail.to,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      attachments: mail.attachments?.map((a) => ({
        filename: a.filename,
        content: Buffer.from(a.content, 'base64'),
        contentType: a.contentType,
      })),
    });
  }

  private async deliver(job: Job<{ emailLogId: string; attachments?: EmailAttachment[] }>): Promise<string> {
    const log = await this.prisma.emailLog.findUnique({ where: { id: job.data.emailLogId } });
    if (!log) return 'Skipped: email log row no longer exists';
    if (log.status === 'SENT') return 'Skipped: already sent';
    const credentials = await this.settings.emailCredentials();
    if (!credentials) {
      await this.prisma.emailLog.update({
        where: { id: log.id },
        data: { status: 'FAILED', error: 'Email was disabled before the message was sent.' },
      });
      return 'Failed: email is not configured';
    }
    try {
      await this.send(credentials, {
        to: log.to,
        subject: log.subject,
        html: log.bodyHtml,
        text: log.bodyText,
        attachments: job.data.attachments,
      });
      await this.prisma.emailLog.update({
        where: { id: log.id },
        data: { status: 'SENT', sentAt: new Date(), attempts: log.attempts + 1, error: null },
      });
      return `Sent to ${log.to}`;
    } catch (error) {
      const attempts = log.attempts + 1;
      const message = stripUrlCredentials((error as Error).message);
      if (attempts >= EMAIL_ATTEMPTS) {
        await this.prisma.emailLog.update({
          where: { id: log.id },
          data: { status: 'FAILED', attempts, error: message },
        });
        return `Failed permanently after ${attempts} attempts: ${message}`;
      }
      await this.prisma.emailLog.update({
        where: { id: log.id },
        data: { attempts, error: message },
      });
      throw error;
    }
  }
}
