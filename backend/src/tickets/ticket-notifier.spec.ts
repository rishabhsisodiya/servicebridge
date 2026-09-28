import type { NotifyInput } from '../notifications/notifications.service';
import { TicketNotifier } from './ticket-notifier';

function build() {
  const sent: NotifyInput[] = [];
  const notifications = {
    notify: jest.fn((input: NotifyInput) => {
      sent.push(input);
      return Promise.resolve();
    }),
  };
  const prisma = {
    user: {
      findMany: jest.fn(() => Promise.resolve([{ id: 'sm1' }, { id: 'sm2' }])),
      findUnique: jest.fn(() => Promise.resolve(null)),
    },
  };
  const email = { queueEmail: jest.fn().mockResolvedValue(null) };
  const notifier = new TicketNotifier(prisma as never, notifications as never, email as never, {
    get: () => 'https://app.example.com',
  } as never);
  return { notifier, sent, email };
}

const ticket = {
  id: 't1',
  number: 'SB-26-000001',
  title: 'Jaw dies worn',
  engineerId: 'eng1',
  areaManagerId: 'am1',
};
const manager = { id: 'am1', name: 'Anita' };

describe('TicketNotifier', () => {
  it('tells the area manager about a new ticket, or the service managers when unrouted', async () => {
    const routed = build();
    await routed.notifier.created(ticket, { id: 'cc1', name: 'Ravi' }, 'South');
    expect(routed.sent[0]).toMatchObject({
      type: 'TICKET_NEW',
      userIds: ['am1'],
      title: expect.stringContaining('South'),
    });

    const unrouted = build();
    await unrouted.notifier.created(
      { ...ticket, areaManagerId: null },
      { id: 'cc1', name: 'Ravi' },
      null,
    );
    expect(unrouted.sent[0]).toMatchObject({ type: 'TICKET_UNROUTED', userIds: ['sm1', 'sm2'] });
  });

  it('tells the new and the previous engineer on reassignment, never the actor', async () => {
    const { notifier, sent } = build();
    await notifier.action('assign', ticket, { ...ticket, engineerId: 'eng2' }, manager, null);
    expect(sent.map((n) => [n.type, n.userIds, n.exceptUserId])).toEqual([
      ['TICKET_ASSIGNED', ['eng2'], 'am1'],
      ['TICKET_UNASSIGNED', ['eng1'], 'am1'],
    ]);
  });

  it('asks the area manager to verify a resolution', async () => {
    const { notifier, sent } = build();
    await notifier.action(
      'resolve',
      ticket,
      ticket,
      { id: 'eng1', name: 'Farhan' },
      'Replaced jaw dies',
    );
    expect(sent[0]).toMatchObject({
      type: 'TICKET_RESOLVED',
      userIds: ['am1'],
      body: 'Replaced jaw dies',
    });
  });

  it('escalates a breach to the engineer, area manager and service managers', async () => {
    const { notifier, sent } = build();
    await notifier.sla('breach', 'resolution', ticket);
    expect(sent[0]).toMatchObject({ type: 'SLA_BREACHED', userIds: ['eng1', 'am1', 'sm1', 'sm2'] });
  });

  it('sends nothing for steps nobody needs to hear about', async () => {
    const { notifier, sent } = build();
    await notifier.action('arrive', ticket, ticket, { id: 'eng1', name: 'Farhan' }, null);
    expect(sent).toEqual([]);
  });

  it('emails the new engineer on assignment when they have an email address', async () => {
    const { notifier, email } = build();
    const prisma = (notifier as unknown as { prisma: { user: { findMany: jest.Mock; findUnique: jest.Mock } } }).prisma;
    prisma.user.findUnique.mockResolvedValue({ id: 'eng2', name: 'Farhan' });
    prisma.user.findMany.mockResolvedValue([{ email: 'farhan@example.com' }]);
    await notifier.action('assign', ticket, { ...ticket, engineerId: 'eng2' }, manager, null);
    expect(email.queueEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'farhan@example.com',
        templateKey: 'ticket.assigned',
        variables: expect.objectContaining({ assigneeName: 'Farhan', ticketNumber: 'SB-26-000001' }),
      }),
    );
  });
});
