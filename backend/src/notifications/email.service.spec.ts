import { EMAIL_TEMPLATE_SEEDS, EmailService, renderTemplate } from './email.service';

describe('renderTemplate', () => {
  it('fills {{variables}} and blanks unknown ones', () => {
    expect(renderTemplate('Hi {{name}}, ticket {{ticketNumber}}.', { name: 'Mira' })).toBe(
      'Hi Mira, ticket .',
    );
  });

  it('tolerates whitespace inside the braces', () => {
    expect(renderTemplate('{{  companyName  }}', { companyName: 'Acme' })).toBe('Acme');
  });
});

describe('EmailService seeds', () => {
  it('covers every template the code queues', () => {
    const keys = new Set(EMAIL_TEMPLATE_SEEDS.map((t) => t.key));
    for (const key of [
      'ticket.assigned',
      'sla.breached',
      'escalation.fired',
      'csat.invite',
      'auth.invite',
      'auth.reset',
      'amc.renewal',
    ]) {
      expect(keys.has(key)).toBe(true);
    }
  });

  it('each seed renders without leftover placeholders for its documented variables', () => {
    const variables: Record<string, Record<string, string | number>> = {
      'ticket.assigned': { assigneeName: 'A', ticketNumber: 'N', ticketTitle: 'T', ticketUrl: 'U', companyName: 'C' },
      'sla.breached': { ticketNumber: 'N', ticketTitle: 'T', ticketUrl: 'U', companyName: 'C' },
      'escalation.fired': { ticketNumber: 'N', ticketTitle: 'T', level: 2, reason: 'R', ticketUrl: 'U', companyName: 'C' },
      'csat.invite': { customerName: 'C', ticketNumber: 'N', feedbackUrl: 'U', companyName: 'Co' },
      'auth.invite': { name: 'N', inviteUrl: 'U', expiresIn: '48 hours', companyName: 'Co' },
      'auth.reset': { name: 'N', resetUrl: 'U', expiresIn: '2 hours', companyName: 'Co' },
      'amc.renewal': { contractNumber: 'N', customerName: 'C', endsOn: 'D', daysLeft: 30, companyName: 'Co' },
    };
    for (const seed of EMAIL_TEMPLATE_SEEDS) {
      for (const text of [seed.subject, seed.bodyHtml, seed.bodyText]) {
        expect(renderTemplate(text, variables[seed.key] ?? {})).not.toMatch(/\{\{/);
      }
    }
  });
});

describe('EmailService.queueEmail', () => {
  const makeService = (overrides: Record<string, unknown> = {}) => {
    const prisma = {
      emailTemplate: {
        findUnique: jest.fn().mockResolvedValue({
          key: 'ticket.assigned',
          subject: 'Hi {{assigneeName}}',
          bodyHtml: '<p>{{ticketNumber}}</p>',
          bodyText: '{{ticketNumber}}',
          enabled: true,
        }),
      },
      emailLog: { create: jest.fn().mockResolvedValue({ id: 'log1' }) },
      ...overrides,
    };
    const queues = { queue: jest.fn(() => ({ add: jest.fn().mockResolvedValue({}) })) };
    const settings = {
      emailCredentials: jest.fn(),
      company: jest.fn().mockResolvedValue({ name: 'Acme' }),
    };
    const service = new EmailService(prisma as never, queues as never, settings as never, {} as never);
    return { service, settings, queues, prisma };
  };

  it('returns null without queueing when email is not configured', async () => {
    const { service, settings, queues } = makeService();
    (settings.emailCredentials).mockResolvedValue(null);
    await expect(
      service.queueEmail({ to: 'a@b.co', templateKey: 'ticket.assigned', variables: {} }),
    ).resolves.toBeNull();
    expect(queues.queue).not.toHaveBeenCalled();
  });

  it('returns null when the template is disabled', async () => {
    const { service, settings } = makeService({
      emailTemplate: { findUnique: jest.fn().mockResolvedValue({ enabled: false }) },
    });
    (settings.emailCredentials).mockResolvedValue({ host: 'smtp' });
    await expect(
      service.queueEmail({ to: 'a@b.co', templateKey: 'ticket.assigned', variables: {} }),
    ).resolves.toBeNull();
  });

  it('queues a rendered email with a fixed job id', async () => {
    const { service, settings, queues, prisma } = makeService();
    (settings.emailCredentials).mockResolvedValue({ host: 'smtp' });
    const add = jest.fn().mockResolvedValue({});
    (queues.queue as jest.Mock).mockReturnValue({ add });
    const id = await service.queueEmail({
      to: 'a@b.co',
      templateKey: 'ticket.assigned',
      variables: { assigneeName: 'Mira', ticketNumber: 'SB-1' },
      ticketId: 't1',
    });
    expect(id).toBe('log1');
    expect(prisma.emailLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ subject: 'Hi Mira', bodyText: 'SB-1', ticketId: 't1' }),
      }),
    );
    expect(add).toHaveBeenCalledWith(
      'send-email',
      { emailLogId: 'log1' },
      expect.objectContaining({ jobId: 'email-log1' }),
    );
  });
});
