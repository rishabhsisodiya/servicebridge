import { visibleTo } from './tickets.service';

describe('visibleTo (ticket scope of the role)', () => {
  it('shows everything for All', () => {
    expect(visibleTo({ id: 'u1', ticketScope: 'ALL', regionId: 'r1' })).toEqual({});
  });

  it('shows assigned or raised tickets for Own', () => {
    expect(visibleTo({ id: 'u1', ticketScope: 'OWN', regionId: 'r1' })).toEqual({
      OR: [{ engineerId: 'u1' }, { createdById: 'u1' }],
    });
  });

  it('shows the region plus own tickets for Region', () => {
    expect(visibleTo({ id: 'u1', ticketScope: 'REGION', regionId: 'r1' })).toEqual({
      OR: [
        { regionId: 'r1' },
        { areaManagerId: 'u1' },
        { createdById: 'u1' },
        { engineerId: 'u1' },
      ],
    });
  });

  it('falls back to own tickets when a Region user has no region', () => {
    expect(visibleTo({ id: 'u1', ticketScope: 'REGION', regionId: null })).toEqual({
      OR: [{ areaManagerId: 'u1' }, { createdById: 'u1' }, { engineerId: 'u1' }],
    });
  });
});
