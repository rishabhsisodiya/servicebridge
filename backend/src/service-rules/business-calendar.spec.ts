import { addBusinessMinutes, type CalendarRules, calendarProblems } from './business-calendar';
import { matchPincode, normalisePrefixes } from './region-match';

const TZ = 'Asia/Kolkata';
const weekdays = (open: string, close: string, days = [1, 2, 3, 4, 5, 6]) =>
  days.map((day) => ({ day, open, close }));
const business: CalendarRules = {
  alwaysOpen: false,
  hours: weekdays('09:00', '18:00'),
  holidays: [],
};
/** Local India time → Date */
const ist = (local: string) => new Date(`${local}+05:30`);

describe('addBusinessMinutes', () => {
  it('adds plain minutes on a 24×7 calendar', () => {
    expect(
      addBusinessMinutes(ist('2026-09-26T23:00:00'), 120, { ...business, alwaysOpen: true }, TZ),
    ).toEqual(ist('2026-09-27T01:00:00'));
  });

  it('stays inside the same day when there is time', () => {
    expect(addBusinessMinutes(ist('2026-09-25T10:00:00'), 120, business, TZ)).toEqual(
      ist('2026-09-25T12:00:00'),
    );
  });

  it('carries over to the next open day, skipping Sunday', () => {
    // Saturday 17:00 + 2h → 1h on Saturday, Sunday closed, 1h on Monday
    expect(addBusinessMinutes(ist('2026-09-26T17:00:00'), 120, business, TZ)).toEqual(
      ist('2026-09-28T10:00:00'),
    );
  });

  it('starts counting at opening time when logged before hours', () => {
    expect(addBusinessMinutes(ist('2026-09-25T06:30:00'), 30, business, TZ)).toEqual(
      ist('2026-09-25T09:30:00'),
    );
  });

  it('skips holidays', () => {
    const rules = { ...business, holidays: [{ date: '2026-10-02', name: 'Gandhi Jayanti' }] };
    // Thursday 17:00 + 2h → 1h Thursday, Friday holiday, 1h Saturday
    expect(addBusinessMinutes(ist('2026-10-01T17:00:00'), 120, rules, TZ)).toEqual(
      ist('2026-10-03T10:00:00'),
    );
  });

  it('respects a lunch break', () => {
    const rules: CalendarRules = {
      alwaysOpen: false,
      hours: [...weekdays('09:00', '13:00'), ...weekdays('14:00', '18:00')],
      holidays: [],
    };
    expect(addBusinessMinutes(ist('2026-09-25T12:00:00'), 120, rules, TZ)).toEqual(
      ist('2026-09-25T15:00:00'),
    );
  });

  it('handles a zone with daylight saving', () => {
    const rules: CalendarRules = {
      alwaysOpen: false,
      hours: weekdays('09:00', '17:00', [1, 2, 3, 4, 5]),
      holidays: [],
    };
    // Friday 16:00 in London before the clocks go back on Sunday 25 Oct 2026 → Monday 10:00 GMT
    expect(
      addBusinessMinutes(new Date('2026-10-23T15:00:00Z'), 120, rules, 'Europe/London'),
    ).toEqual(new Date('2026-10-26T10:00:00Z'));
  });
});

describe('calendarProblems', () => {
  it('accepts a valid calendar', () => {
    expect(calendarProblems(business)).toEqual([]);
  });

  it('rejects empty hours, reversed times, overlaps and duplicate holidays', () => {
    expect(calendarProblems({ alwaysOpen: false, hours: [], holidays: [] })[0].field).toBe('hours');
    expect(
      calendarProblems({
        alwaysOpen: false,
        hours: [{ day: 1, open: '18:00', close: '09:00' }],
        holidays: [],
      }),
    ).toHaveLength(1);
    expect(
      calendarProblems({
        alwaysOpen: false,
        hours: [
          { day: 1, open: '09:00', close: '13:00' },
          { day: 1, open: '12:00', close: '18:00' },
        ],
        holidays: [],
      })[0].message,
    ).toMatch(/overlap/);
    expect(
      calendarProblems({
        ...business,
        holidays: [
          { date: '2026-10-02', name: 'A' },
          { date: '2026-10-02', name: 'B' },
        ],
      })[0].field,
    ).toBe('holidays.1.date');
  });
});

describe('matchPincode', () => {
  const rules = [
    { pincodePrefix: '56', target: 'Karnataka' },
    { pincodePrefix: '5601', target: 'Bengaluru central' },
    { pincodePrefix: '63', target: 'Tamil Nadu' },
  ];

  it('picks the longest matching prefix', () => {
    expect(matchPincode('560102', rules)?.target).toBe('Bengaluru central');
    expect(matchPincode('562123', rules)?.target).toBe('Karnataka');
    expect(matchPincode('110001', rules)).toBeNull();
  });

  it('normalises prefixes and reports invalid ones', () => {
    expect(normalisePrefixes([' 560 ', '560', '5a', '1234567', '400'])).toEqual({
      prefixes: ['400', '560'],
      invalid: ['5a', '1234567'],
    });
  });
});
