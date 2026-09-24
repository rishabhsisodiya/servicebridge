import { hash, verify } from '@node-rs/argon2';

// argon2id with the OWASP-recommended minimum (19 MiB, 2 passes, 1 lane).
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Runs a real verification against a throwaway hash, so a login for an
 * unknown email takes as long as one for a real account (no timing leak).
 */
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword('servicebridge-timing-equaliser');
  await verifyPassword(await dummyHash, password);
}

/**
 * Returns plain-English problems with a new password, or [] if it's fine.
 * Length matters most; one letter and one number rules out the weakest picks.
 */
export function passwordProblems(
  password: string,
  context: { email?: string; name?: string } = {},
): string[] {
  const problems: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) {
    problems.push(`Use at least ${PASSWORD_MIN_LENGTH} characters.`);
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    problems.push(`Use at most ${PASSWORD_MAX_LENGTH} characters.`);
  }
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    problems.push('Include at least one letter and one number.');
  }
  const lower = password.toLowerCase();
  const emailName = context.email?.split('@')[0]?.toLowerCase();
  if (emailName && emailName.length >= 4 && lower.includes(emailName)) {
    problems.push("Don't include your email address.");
  }
  return problems;
}
