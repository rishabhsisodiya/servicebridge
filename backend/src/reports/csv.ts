/**
 * Minimal RFC-4180 CSV writer for report exports. Pure functions, no I/O.
 *
 * Cells that start with `=`, `+`, `-` or `@` are prefixed with a single quote
 * so spreadsheet apps never interpret them as formulas (CSV injection).
 */

export interface CsvColumn {
  key: string;
  label: string;
}

/** UTF-8 byte-order mark, so Excel opens the file with the right encoding. */
export const CSV_BOM = '﻿';

/** Characters that make a spreadsheet treat a cell as a formula. */
const FORMULA_PREFIXES = new Set(['=', '+', '-', '@']);

export function sanitizeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text: string;
  if (value instanceof Date) {
    text = value.toISOString();
  } else if (typeof value === 'object') {
    text = JSON.stringify(value);
  } else {
    text = String(value);
  }
  const first = text.charAt(0);
  if (FORMULA_PREFIXES.has(first)) return `'${text}`;
  return text;
}

function escapeCell(text: string): string {
  if (text.includes('"') || text.includes(',') || text.includes('\n') || text.includes('\r')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * Renders rows as CSV text (without BOM — callers decide whether to add it,
 * e.g. file downloads want it, in-memory strings usually don't).
 */
export function toCsv(columns: CsvColumn[], rows: Record<string, unknown>[]): string {
  const lines: string[] = [columns.map((c) => escapeCell(c.label)).join(',')];
  for (const row of rows) {
    lines.push(columns.map((c) => escapeCell(sanitizeCell(row[c.key]))).join(','));
  }
  return lines.join('\r\n');
}
