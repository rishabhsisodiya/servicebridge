/**
 * Guards for the optional ERP database connection, which must never write.
 * These run in addition to a read-only session and (recommended) a
 * SELECT-only database user: three independent layers.
 */

export class UnsafeSqlError extends Error {
  constructor(reason: string) {
    super(`Refused non-read-only SQL: ${reason}`);
  }
}

/** Removes comments, string literals and quoted names so keywords inside them can't hide or mislead. */
function stripCommentsAndStrings(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(--|#)[^\n]*/g, ' ')
    .replace(/'(?:[^'\\]|\\.|'')*'/g, "''")
    .replace(/"(?:[^"\\]|\\.|"")*"/g, '""')
    .replace(/`[^`]*`/g, '``'); // quoted names like `tabUpdate Log` aren't keywords
}

const FORBIDDEN = [
  /\binto\s+(outfile|dumpfile|@)/i,
  /\bfor\s+update\b/i,
  /\block\s+in\s+share\s+mode\b/i,
  /\bfor\s+share\b/i,
  /\b(insert|update|delete|replace|merge|upsert|truncate|drop|alter|create|rename|grant|revoke|call|do|handler|load|set|lock|unlock|kill|shutdown|flush|install|uninstall|analyze|optimize|repair)\b/i,
  /\b(sleep|benchmark|get_lock|load_file)\s*\(/i,
];

/** Throws unless `sql` is a single SELECT/WITH statement with no write or lock clauses. */
export function assertReadOnlySql(sql: string): void {
  const cleaned = stripCommentsAndStrings(sql).trim().replace(/;\s*$/, '');
  if (!/^(select|with)\b/i.test(cleaned))
    throw new UnsafeSqlError('must start with SELECT or WITH');
  if (cleaned.includes(';')) throw new UnsafeSqlError('only one statement is allowed');
  for (const pattern of FORBIDDEN) {
    const match = cleaned.match(pattern);
    if (match) throw new UnsafeSqlError(`"${match[0].trim()}" is not allowed`);
  }
}

export type GrantsVerdict = 'SELECT_ONLY' | 'HAS_WRITE_GRANTS' | 'UNVERIFIED';

const HARMLESS = new Set(['SELECT', 'USAGE', 'SHOW VIEW', 'SHOW DATABASES']);

/**
 * Reads `SHOW GRANTS` output. SELECT_ONLY when nothing beyond reading is
 * granted; UNVERIFIED when roles or unusual grants make it unclear.
 */
export function assessGrants(lines: string[]): { verdict: GrantsVerdict; extra: string[] } {
  const extra = new Set<string>();
  let unclear = false;
  for (const line of lines) {
    const match = line.match(/^GRANT\s+(.+?)\s+ON\s+/i);
    if (!match) {
      // e.g. "GRANT `role` TO `user`": privileges come from a role we can't see here.
      if (/^GRANT\s+/i.test(line)) unclear = true;
      continue;
    }
    for (const raw of match[1].split(',')) {
      const privilege = raw
        .trim()
        .toUpperCase()
        .replace(/\s*\(.*\)$/, '');
      if (!HARMLESS.has(privilege)) extra.add(privilege === 'ALL' ? 'ALL PRIVILEGES' : privilege);
    }
    if (/WITH\s+GRANT\s+OPTION/i.test(line)) extra.add('GRANT OPTION');
  }
  if (extra.size) return { verdict: 'HAS_WRITE_GRANTS', extra: [...extra].sort() };
  return { verdict: unclear ? 'UNVERIFIED' : 'SELECT_ONLY', extra: [] };
}
