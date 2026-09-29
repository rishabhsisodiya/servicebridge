import { AmcSchedulerService } from './amc-scheduler.service';

const makeService = () => {
  const add = jest.fn();
  const remove = jest.fn().mockResolvedValue(0);
  const queue = { add, remove };
  const queues = { queue: jest.fn().mockReturnValue(queue) };
  const automations = { isEnabled: jest.fn().mockResolvedValue(false) };
  const settings = { amc: jest.fn().mockResolvedValue({ pmLeadTimeDays: 3 }) };
  const service = new AmcSchedulerService(
    {} as never,
    queues as never,
    automations as never,
    {} as never,
    {} as never,
    {} as never,
    { queueWhatsApp: jest.fn().mockResolvedValue(null) } as never,
    settings as never,
    {} as never,
  );
  return { service, queue, automations, settings, queues };
};

describe('AmcSchedulerService.sync', () => {
  it('removes stale timers and schedules nothing for a non-active contract', async () => {
    const remove = jest.fn().mockResolvedValue(0);
    const queue = { add: jest.fn(), remove };
    const service = new AmcSchedulerService(
      { amcContract: { findUnique: jest.fn().mockResolvedValue({ id: 'c1', status: 'DRAFT', endsOn: new Date(), plannedVisits: [] }) } } as never,
      { queue: jest.fn().mockReturnValue(queue) } as never,
      { isEnabled: jest.fn().mockResolvedValue(false) } as never,
      {} as never, {} as never, {} as never, { queueWhatsApp: jest.fn().mockResolvedValue(null) } as never, {} as never, {} as never,
    );
    await service.sync('c1');
    expect(remove).toHaveBeenCalledWith('amc-expire-c1');
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('always schedules expiry; PM and renewal jobs only when their automations are on', async () => {
    const endsOn = new Date(Date.now() + 90 * 24 * 3600 * 1000);
    const { service, queue, automations } = makeService();
    (service as unknown as { prisma: unknown }).prisma = {
      amcContract: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'c1',
          status: 'ACTIVE',
          endsOn,
          plannedVisits: [{ id: 'v1', plannedOn: new Date(Date.now() + 60 * 24 * 3600 * 1000), status: 'PLANNED' }],
        }),
      },
    };

    // Everything off: only the expiry job.
    await service.sync('c1');
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith(
      'amc-expiry',
      expect.objectContaining({ contractId: 'c1' }),
      expect.objectContaining({ jobId: 'amc-expire-c1' }),
    );

    // PM automation on: PM job with lead-time-shifted delay and fixed id.
    queue.add.mockClear();
    (automations.isEnabled).mockImplementation((key: string) => key === 'amc-pm-tickets');
    await service.sync('c1');
    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(queue.add).toHaveBeenCalledWith(
      'amc-pm-tickets',
      expect.objectContaining({ plannedVisitId: 'v1' }),
      expect.objectContaining({ jobId: 'amc-pm-v1' }),
    );

    // Renewal automation on: three reminder jobs at 60/30/7 days with fixed ids.
    queue.add.mockClear();
    (automations.isEnabled).mockImplementation((key: string) => key === 'amc-renewals');
    await service.sync('c1');
    const renewalCalls = queue.add.mock.calls.filter((c: unknown[]) => c[0] === 'amc-renewals');
    expect(renewalCalls).toHaveLength(3);
    expect(renewalCalls.map((c: unknown[]) => (c[2] as { jobId: string }).jobId)).toEqual([
      'amc-renewal-c1-60',
      'amc-renewal-c1-30',
      'amc-renewal-c1-7',
    ]);
  });
});
