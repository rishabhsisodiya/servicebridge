import { EscalationTimersService } from './escalation-timers.service';

const makeService = (prisma: Record<string, unknown> = {}) => {
  const add = jest.fn();
  const remove = jest.fn().mockResolvedValue(0);
  const queue = { add, remove };
  const queues = { queue: jest.fn().mockReturnValue(queue) };
  const definitions: Record<string, { validateParams?: (p: Record<string, unknown>) => Promise<string[]> }> = {};
  const automations = {
    isEnabled: jest.fn().mockResolvedValue(false),
    define: jest.fn((def: { key: string }) => {
      definitions[def.key] = def as never;
    }),
  };
  const service = new EscalationTimersService(
    prisma as never,
    queues as never,
    automations as never,
    {} as never,
    {} as never,
    { get: () => 'https://app.example.com' } as never,
  );
  return { service, queue, automations, queues, definitions };
};

describe('EscalationTimersService.validateParams (save-time)', () => {
  const level = (key: string) => {
    const { service, definitions } = makeService({
      role: { findUnique: jest.fn().mockResolvedValue({ id: 'r1' }) },
    });
    service.onModuleInit();
    return definitions[key].validateParams!;
  };

  it('accepts defaults and requires nothing for level 1', async () => {
    const validate = level('escalation-l1');
    await expect(validate({})).resolves.toEqual([]);
    await expect(validate({ afterMinutes: 45 })).resolves.toEqual([]);
    await expect(validate({ afterMinutes: 3 })).resolves.toHaveLength(1);
    await expect(validate({ afterMinutes: 10081 })).resolves.toHaveLength(1);
    await expect(validate({ afterMinutes: 4.5 })).resolves.toHaveLength(1);
  });

  it('requires a role for levels 2 and 3, and the role must exist', async () => {
    const findUnique = jest.fn().mockResolvedValue(null);
    const { service, definitions } = makeService({ role: { findUnique } });
    service.onModuleInit();
    const validate = definitions['escalation-l2'].validateParams!;
    await expect(validate({ afterMinutes: 240 })).resolves.toHaveLength(1);
    await expect(validate({ afterMinutes: 240, notifyRoleId: 'gone' })).resolves.toHaveLength(1);
    findUnique.mockResolvedValue({ id: 'r1' });
    await expect(validate({ afterMinutes: 240, notifyRoleId: 'r1' })).resolves.toEqual([]);
  });
});

describe('EscalationTimersService.sync', () => {
  const ticket = (over: Record<string, unknown> = {}) => ({
    id: 't1',
    stage: 'ASSIGNED' as const,
    engineerId: 'eng1',
    ...over,
  });

  it('removes stale jobs and schedules nothing when automations are off', async () => {
    const { service, queue, queues } = makeService();
    await service.sync(ticket());
    expect(queues.queue).toHaveBeenCalledWith('escalations');
    expect(queue.remove).toHaveBeenCalledTimes(3);
    expect(queue.remove).toHaveBeenCalledWith('escalation-t1-l1');
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('does not schedule for tickets that are not awaiting acceptance', async () => {
    const { service, queue, automations } = makeService();
    (automations.isEnabled).mockResolvedValue(true);
    await service.sync(ticket({ stage: 'OPEN' }));
    expect(queue.add).not.toHaveBeenCalled();
    await service.sync(ticket({ engineerId: null }));
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('schedules the enabled level with the configured delay and a fixed job id', async () => {
    const { service, queue, automations } = makeService();
    (automations.isEnabled).mockImplementation((key: string) => key === 'escalation-l1');
    // paramsFor reads via settings; stub the private settings accessor shape is heavier,
    // so stub the module-level default path by patching the instance:
    jest
      .spyOn(service as unknown as { paramsFor: () => Promise<unknown> }, 'paramsFor')
      .mockResolvedValue({ afterMinutes: 45, notifyRoleId: 'area-managers' });
    await service.sync(ticket());
    expect(queue.add).toHaveBeenCalledWith(
      'escalation-l1',
      expect.objectContaining({ ticketId: 't1', level: 1, engineerId: 'eng1' }),
      expect.objectContaining({ jobId: 'escalation-t1-l1', delay: 45 * 60_000 }),
    );
    // l2/l3 are off, so only one job
    expect(queue.add).toHaveBeenCalledTimes(1);
  });
});
