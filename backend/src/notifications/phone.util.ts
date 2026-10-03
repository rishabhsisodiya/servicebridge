/**
 * E.164 phone-number normalization for the WhatsApp outbox. Pure.
 *
 * Rules (India-first, since ERPTick installs are Indian):
 * - strip every non-digit; a leading "+" is remembered, never part of the digits
 * - 10 digits with no "+" → Indian mobile, prefix +91 (must start 6-9;
 *   Indian mobiles never start with 0)
 * - 11 digits with no "+" starting with 0 → trunk-zero form, strip it first
 * - 12 digits with no "+" starting with 91 → +<digits>
 * - a leading "+" is kept when the total digit count is 8–15 (the E.164 range)
 * - anything else → null (the caller treats it as "no usable number")
 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const text = input.trim();
  if (!text) return null;
  const hasPlus = text.startsWith('+');
  const digits = text.replace(/\D/g, '');
  if (hasPlus) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  // Trunk-zero form: 09876543210 → 9876543210.
  const local = digits.length === 11 && digits.startsWith('0') ? digits.slice(1) : digits;
  // Indian mobiles start 6-9; anything else is not a usable number.
  if (local.length === 10 && /^[6-9]/.test(local)) return `+91${local}`;
  if (local.length === 12 && local.startsWith('91')) return `+${local}`;
  return null;
}
