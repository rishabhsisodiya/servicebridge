import { HttpStatus } from '@nestjs/common';
import { AppException } from '../core/http/app.exception';
import { extractParamNames, WHATSAPP_TEMPLATE_SEEDS, WhatsAppService } from './whatsapp.service';

describe('extractParamNames', () => {
  it('returns placeholder names in order of first appearance', () => {
    expect(extractParamNames('Hi {{assigneeName}}, ticket {{ticketNumber}} ({{ticketTitle}}).')).toEqual([
      'assigneeName',
      'ticketNumber',
      'ticketTitle',
    ]);
  });

  it('dedupes repeated placeholders and tolerates whitespace', () => {
    expect(extractParamNames('{{a}} then {{ b }} then {{a}}')).toEqual(['a', 'b']);
  });

  it('returns an empty list when there are no placeholders', () => {
    expect(extractParamNames('No placeholders here.')).toEqual([]);
  });
});

describe('WhatsAppService seeds', () => {
  it('seeds the four v1 templates, all disabled', () => {
    const keys = new Map(WHATSAPP_TEMPLATE_SEEDS.map((t) => [t.key, t]));
    expect(keys.get('ticket.assigned')).toMatchObject({
      providerTemplateName: 'ticket_assigned',
      enabled: false,
    });
    expect(keys.get('sla.breached')).toMatchObject({
      providerTemplateName: 'sla_breached',
      enabled: false,
    });
    expect(keys.get('csat.invite')).toMatchObject({
      providerTemplateName: 'csat_invite',
      enabled: false,
    });
    expect(keys.get('amc.renewal')).toMatchObject({
      providerTemplateName: 'amc_renewal',
      enabled: false,
    });
  });

  it('every seed renders its positional parameters in the documented order', () => {
    const expected: Record<string, string[]> = {
      'ticket.assigned': ['assigneeName', 'ticketNumber', 'ticketTitle'],
      'sla.breached': ['ticketNumber', 'ticketTitle'],
      'csat.invite': ['customerName', 'ticketNumber', 'feedbackUrl'],
      'amc.renewal': ['contractNumber', 'customerName', 'endsOn', 'daysLeft'],
    };
    for (const seed of WHATSAPP_TEMPLATE_SEEDS) {
      expect(extractParamNames(seed.bodyText)).toEqual(expected[seed.key]);
    }
  });
});

describe('WhatsAppService.queueWhatsApp', () => {
  const makeService = (overrides: Record<string, unknown> = {}) => {
    const prisma = {
      whatsAppTemplate: {
        findUnique: jest.fn().mockResolvedValue({
          key: 'ticket.assigned',
          providerTemplateName: 'ticket_assigned',
          languageCode: 'en',
          bodyText: 'Hi {{assigneeName}}, ticket {{ticketNumber}}.',
          enabled: true,
        }),
      },
      whatsAppLog: {
        create: jest.fn().mockResolvedValue({ id: 'wlog1' }),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      ...overrides,
    };
    const add = jest.fn().mockResolvedValue({});
    const queues = { queue: jest.fn(() => ({ add })), register: jest.fn() };
    const settings = {
      whatsappCredentials: jest.fn().mockResolvedValue({
        phoneNumberId: '12345',
        accessToken: 'token',
      }),
      notificationChannels: jest.fn().mockResolvedValue({}),
    };
    const service = new WhatsAppService(
      prisma as never,
      queues as never,
      settings as never,
      { get: jest.fn() } as never,
    );
    return { service, settings, queues, prisma, add };
  };

  const input = {
    to: '9876543210',
    templateKey: 'ticket.assigned',
    variables: { assigneeName: 'Mira', ticketNumber: 'SB-1' },
  };

  it('returns null when WhatsApp is not configured', async () => {
    const { service, settings, queues } = makeService();
    (settings.whatsappCredentials as jest.Mock).mockResolvedValue(null);
    await expect(service.queueWhatsApp(input)).resolves.toBeNull();
    expect(queues.queue).not.toHaveBeenCalled();
  });

  it('returns null when the WhatsApp channel toggle is off (the default)', async () => {
    const { service, settings, queues } = makeService();
    (settings.notificationChannels as jest.Mock).mockResolvedValue({});
    await expect(service.queueWhatsApp(input)).resolves.toBeNull();
    expect(queues.queue).not.toHaveBeenCalled();
  });

  it('queues when the channel toggle is on, with a fixed job id and E.164 number', async () => {
    const { service, settings, queues, prisma, add } = makeService();
    (settings.notificationChannels as jest.Mock).mockResolvedValue({
      'ticket.assigned': { email: true, whatsapp: true },
    });
    const id = await service.queueWhatsApp(input);
    expect(id).toBe('wlog1');
    expect(prisma.whatsAppLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ to: '+919876543210', templateKey: 'ticket.assigned' }),
      }),
    );
    expect(add).toHaveBeenCalledWith(
      'send-whatsapp',
      expect.objectContaining({
        whatsappLogId: 'wlog1',
        providerTemplateName: 'ticket_assigned',
        languageCode: 'en',
        parameters: ['Mira', 'SB-1'],
      }),
      expect.objectContaining({ jobId: 'whatsapp-wlog1', attempts: 5 }),
    );
  });

  it('returns null when the template is disabled', async () => {
    const { service, settings } = makeService({
      whatsAppTemplate: { findUnique: jest.fn().mockResolvedValue({ enabled: false }) },
    });
    (settings.notificationChannels as jest.Mock).mockResolvedValue({
      'ticket.assigned': { email: true, whatsapp: true },
    });
    await expect(service.queueWhatsApp(input)).resolves.toBeNull();
  });

  it('returns null for an unusable phone number', async () => {
    const { service, settings, queues } = makeService();
    (settings.notificationChannels as jest.Mock).mockResolvedValue({
      'ticket.assigned': { email: true, whatsapp: true },
    });
    await expect(service.queueWhatsApp({ ...input, to: 'abc' })).resolves.toBeNull();
    expect(queues.queue).not.toHaveBeenCalled();
  });

  it('returns null when the recipient opted out', async () => {
    const { service, settings, queues } = makeService();
    (settings.notificationChannels as jest.Mock).mockResolvedValue({
      'ticket.assigned': { email: true, whatsapp: true },
    });
    await expect(service.queueWhatsApp({ ...input, optOut: true })).resolves.toBeNull();
    expect(queues.queue).not.toHaveBeenCalled();
  });

  it('renders missing variables as empty strings', async () => {
    const { service, settings, add } = makeService();
    (settings.notificationChannels as jest.Mock).mockResolvedValue({
      'ticket.assigned': { email: true, whatsapp: true },
    });
    await service.queueWhatsApp({ ...input, variables: { assigneeName: 'Mira' } });
    expect(add).toHaveBeenCalledWith(
      'send-whatsapp',
      expect.objectContaining({ parameters: ['Mira', ''] }),
      expect.anything(),
    );
  });
});

describe('WhatsAppService.sendTestMessage', () => {
  it('throws WHATSAPP_NOT_CONFIGURED when WhatsApp is off', async () => {
    const prisma = {
      whatsAppTemplate: { findUnique: jest.fn().mockResolvedValue(null) },
      whatsAppLog: { create: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    };
    const service = new WhatsAppService(
      prisma as never,
      { queue: jest.fn(), register: jest.fn() } as never,
      {
        whatsappCredentials: jest.fn().mockResolvedValue(null),
        notificationChannels: jest.fn(),
      } as never,
      { get: jest.fn() } as never,
    );
    const error = await service.sendTestMessage('+919876543210').catch((e) => e);
    expect(error).toBeInstanceOf(AppException);
    expect((error as AppException).code).toBe('WHATSAPP_NOT_CONFIGURED');
    expect((error as AppException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
  });
});
