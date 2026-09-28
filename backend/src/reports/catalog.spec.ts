import {
  REPORT_KEYS,
  REPORTS,
  resolveDateRange,
  validateReportParams,
} from './catalog';

describe('resolveDateRange', () => {
  it('defaults to the last 30 days', () => {
    const { from, to } = resolveDateRange({});
    const days = (to.getTime() - from.getTime()) / 86_400_000;
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThan(31);
  });

  it('accepts explicit dates', () => {
    const { from, to } = resolveDateRange({ from: '2026-09-01', to: '2026-09-10' });
    expect(from.toISOString().slice(0, 10)).toBe('2026-09-01');
    expect(to.toISOString().slice(0, 10)).toBe('2026-09-10');
  });

  it.each([
    [{ from: '2026-9-1' }, 'Dates must be YYYY-MM-DD.'],
    [{ from: '2026-09-10', to: '2026-09-01' }, 'The from date must not be after the to date.'],
    [{ from: '2025-01-01', to: '2026-09-29' }, 'Date ranges are limited to 366 days.'],
  ])('rejects %p', (params, message) => {
    expect(() => resolveDateRange(params)).toThrow(message);
  });
});

describe('validateReportParams', () => {
  const def = REPORTS['ticket-volume-ageing'];

  it('accepts a valid parameter set', () => {
    expect(
      validateReportParams(def, { from: '2026-09-01', to: '2026-09-28', priority: 'HIGH' }),
    ).toBeUndefined();
  });

  it('rejects unknown parameters', () => {
    expect(validateReportParams(def, { bogus: '1' })).toMatch(/Unknown parameter/);
  });

  it('rejects invalid select values', () => {
    expect(validateReportParams(def, { priority: 'URGENT' })).toMatch(/invalid value/);
  });

  it('rejects bad date ranges', () => {
    expect(validateReportParams(def, { from: '2026-09-10', to: '2026-09-01' })).toMatch(
      /must not be after/,
    );
  });
});

describe('catalog', () => {
  it('ships exactly the five v1 reports', () => {
    expect(REPORT_KEYS).toEqual([
      'ticket-volume-ageing',
      'sla-compliance',
      'engineer-performance',
      'quotation-pipeline',
      'csat-summary',
    ]);
  });

  it('every report declares at least a date range', () => {
    for (const key of REPORT_KEYS) {
      const keys = REPORTS[key].params.map((p) => p.key);
      expect(keys).toContain('from');
      expect(keys).toContain('to');
    }
  });
});
