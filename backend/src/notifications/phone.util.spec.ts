import { normalizePhone } from './phone.util';

describe('normalizePhone', () => {
  it('returns null for missing or blank input', () => {
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone('   ')).toBeNull();
  });

  it('prefixes a bare 10-digit Indian mobile with +91', () => {
    expect(normalizePhone('9876543210')).toBe('+919876543210');
  });

  it('strips spaces, dashes and brackets from a 10-digit number', () => {
    expect(normalizePhone('98765 43210')).toBe('+919876543210');
    expect(normalizePhone('(987) 654-3210')).toBe('+919876543210');
  });

  it('accepts 12 digits starting with 91 without a plus', () => {
    expect(normalizePhone('919876543210')).toBe('+919876543210');
  });

  it('keeps a leading + when the digit count is within the E.164 range', () => {
    expect(normalizePhone('+91 98765 43210')).toBe('+919876543210');
    expect(normalizePhone('+14155552671')).toBe('+14155552671');
    expect(normalizePhone('+442071234567')).toBe('+442071234567');
  });

  it('rejects a plus number that is too short or too long', () => {
    expect(normalizePhone('+123')).toBeNull();
    expect(normalizePhone('+1234567')).toBeNull();
    expect(normalizePhone('+1234567890123456')).toBeNull();
  });

  it('strips a trunk zero from 11-digit Indian numbers', () => {
    expect(normalizePhone('09876543210')).toBe('+919876543210');
    expect(normalizePhone('0 98765 43210')).toBe('+919876543210');
  });

  it('rejects 10-digit numbers that do not start with 6-9', () => {
    expect(normalizePhone('0987654321')).toBeNull(); // trunk 0 without the 11th digit
    expect(normalizePhone('5876543210')).toBeNull(); // starts with 5
    expect(normalizePhone('9876543210')).toBe('+919876543210'); // starts with 9
  });

  it('rejects digit counts that cannot be interpreted', () => {
    expect(normalizePhone('987654321')).toBeNull(); // 9 digits
    expect(normalizePhone('91987654321')).toBeNull(); // 11 digits
    expect(normalizePhone('9119876543210')).toBeNull(); // 13 digits
  });

  it('rejects 12 digits that do not start with 91', () => {
    expect(normalizePhone('441234567890')).toBeNull();
  });

  it('rejects input with no digits at all', () => {
    expect(normalizePhone('not-a-number')).toBeNull();
  });

  it('handles the 8-digit E.164 minimum with a plus', () => {
    expect(normalizePhone('+12345678')).toBe('+12345678');
  });
});
