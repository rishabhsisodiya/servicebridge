import { type Candidate, pickAutoAssignee, rankEngineers } from './assignment';

const engineer = (patch: Partial<Candidate> & { id: string }): Candidate => ({
  name: patch.id,
  regionId: 'south',
  regionName: 'South',
  dutyStatus: 'ON_DUTY',
  skills: [],
  openTickets: 0,
  onVisit: false,
  ...patch,
});
const crusher = { name: 'Crushers', equipmentModels: ['JX-1100'] };
const ticket = { regionId: 'south', itemCode: 'JX-1100', engineerId: null };

describe('rankEngineers', () => {
  it('puts on-duty engineers first, then skill, then region, then load', () => {
    const ranked = rankEngineers(
      [
        engineer({ id: 'off', skills: [crusher], dutyStatus: 'OFF_DUTY' }),
        engineer({ id: 'busy-skilled', skills: [crusher], openTickets: 4 }),
        engineer({ id: 'free-skilled', skills: [crusher], openTickets: 1, regionId: 'north' }),
        engineer({ id: 'local', openTickets: 0 }),
      ],
      ticket,
    );
    expect(ranked.map((e) => e.id)).toEqual(['busy-skilled', 'free-skilled', 'local', 'off']);
    expect(ranked[0]).toMatchObject({ skills: ['Crushers'], sameRegion: true });
  });
});

describe('pickAutoAssignee', () => {
  it('picks the best on-duty engineer with a skill or region match', () => {
    const ranked = rankEngineers(
      [engineer({ id: 'local', openTickets: 2 }), engineer({ id: 'far', regionId: 'north' })],
      ticket,
    );
    expect(pickAutoAssignee(ranked)?.id).toBe('local');
  });

  it('leaves the ticket for a manager when nobody suitable is on duty', () => {
    const ranked = rankEngineers(
      [
        engineer({ id: 'far', regionId: 'north' }),
        engineer({ id: 'leave', skills: [crusher], dutyStatus: 'ON_LEAVE' }),
      ],
      ticket,
    );
    expect(pickAutoAssignee(ranked)).toBeNull();
  });
});
