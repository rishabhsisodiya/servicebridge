/** Indian pincodes are 6 digits; a rule is 1–6 leading digits. */
export const PREFIX = /^\d{1,6}$/;

export interface PrefixRule<T> {
  pincodePrefix: string;
  target: T;
}

/** The rule with the longest prefix that the pincode starts with, or null. */
export function matchPincode<T>(pincode: string, rules: PrefixRule<T>[]): PrefixRule<T> | null {
  const digits = pincode.replace(/\s+/g, '');
  let best: PrefixRule<T> | null = null;
  for (const rule of rules) {
    if (!digits.startsWith(rule.pincodePrefix)) continue;
    if (!best || rule.pincodePrefix.length > best.pincodePrefix.length) best = rule;
  }
  return best;
}

/** Trimmed, de-duplicated and sorted; returns the invalid entries separately. */
export function normalisePrefixes(input: string[]): { prefixes: string[]; invalid: string[] } {
  const cleaned = input.map((p) => p.replace(/\s+/g, '')).filter(Boolean);
  return {
    prefixes: [...new Set(cleaned.filter((p) => PREFIX.test(p)))].sort(),
    invalid: cleaned.filter((p) => !PREFIX.test(p)),
  };
}
