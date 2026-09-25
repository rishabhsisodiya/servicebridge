import { coverageOf } from './coverage';

const today = new Date('2026-09-25T10:00:00Z');
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe('coverageOf', () => {
  it('prefers an active AMC over warranty', () => {
    expect(
      coverageOf({ amcExpiresOn: d('2027-03-31'), warrantyExpiresOn: d('2027-01-01') }, today),
    ).toMatchObject({
      coverage: 'AMC',
      amcExpiring: false,
    });
  });

  it('flags an AMC ending within 60 days as expiring', () => {
    expect(
      coverageOf({ amcExpiresOn: d('2026-11-01'), warrantyExpiresOn: null }, today).amcExpiring,
    ).toBe(true);
  });

  it('is covered on the last day (inclusive)', () => {
    expect(
      coverageOf({ amcExpiresOn: d('2026-09-25'), warrantyExpiresOn: null }, today).coverage,
    ).toBe('AMC');
    expect(
      coverageOf({ amcExpiresOn: null, warrantyExpiresOn: d('2026-09-25') }, today).coverage,
    ).toBe('WARRANTY');
  });

  it('falls back to warranty, then chargeable', () => {
    expect(
      coverageOf({ amcExpiresOn: d('2026-01-01'), warrantyExpiresOn: d('2027-01-01') }, today)
        .coverage,
    ).toBe('WARRANTY');
    expect(
      coverageOf({ amcExpiresOn: d('2026-01-01'), warrantyExpiresOn: d('2026-02-01') }, today),
    ).toEqual({
      coverage: 'CHARGEABLE',
      until: null,
      amcExpiring: false,
    });
  });
});
