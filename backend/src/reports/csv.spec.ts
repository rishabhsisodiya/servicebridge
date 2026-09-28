import { CSV_BOM, sanitizeCell, toCsv } from './csv';

describe('sanitizeCell', () => {
  it('returns empty string for null/undefined', () => {
    expect(sanitizeCell(null)).toBe('');
    expect(sanitizeCell(undefined)).toBe('');
  });

  it('stringifies numbers and booleans', () => {
    expect(sanitizeCell(42)).toBe('42');
    expect(sanitizeCell(true)).toBe('true');
  });

  it('formats dates as ISO strings', () => {
    expect(sanitizeCell(new Date('2026-09-01T10:00:00.000Z'))).toBe('2026-09-01T10:00:00.000Z');
  });

  it.each(['=cmd|calc', '+123', '-5', '@SUM(A1)'])('neutralises formula prefix in %p', (cell) => {
    expect(sanitizeCell(cell)).toBe(`'${cell}`);
  });

  it('leaves ordinary text alone, including leading whitespace before a prefix', () => {
    expect(sanitizeCell('total = 5')).toBe('total = 5');
    expect(sanitizeCell(' =not-formula')).toBe(' =not-formula');
  });
});

describe('toCsv', () => {
  const columns = [
    { key: 'name', label: 'Name' },
    { key: 'note', label: 'Note' },
  ];

  it('renders a header plus one line per row', () => {
    expect(toCsv(columns, [{ name: 'Asha', note: 'ok' }])).toBe('Name,Note\r\nAsha,ok');
  });

  it('quotes cells containing commas, quotes or newlines', () => {
    expect(toCsv(columns, [{ name: 'a,b', note: 'say "hi"\nx' }])).toBe(
      'Name,Note\r\n"a,b","say ""hi""\nx"',
    );
  });

  it('renders header only when there are no rows', () => {
    expect(toCsv(columns, [])).toBe('Name,Note');
  });

  it('exposes a UTF-8 BOM for Excel downloads', () => {
    expect(CSV_BOM.charCodeAt(0)).toBe(0xfeff);
  });
});
