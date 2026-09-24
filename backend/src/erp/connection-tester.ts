import type { ErpPurpose } from '@prisma/client';
import { FrappeDbClient } from './adapters/frappe-db.client';
import { FrappeRestClient } from './adapters/frappe-rest.client';
import type { GrantsVerdict } from './adapters/read-only-sql';
import {
  type ErpCallRecorder,
  type ErpCredentials,
  ErpError,
  type ErpErrorKind,
} from './erp.types';

/** What each purpose needs to read. Checked with counts only: no record data is fetched. */
export const PURPOSE_DOCTYPES: Record<ErpPurpose, string[]> = {
  MASTER_SYNC: [
    'Customer',
    'Contact',
    'Address',
    'Serial No',
    'Item',
    'Item Price',
    'Warehouse',
    'Bin',
  ],
  DASHBOARDS: [
    'Sales Order',
    'Sales Invoice',
    'Purchase Order',
    'Work Order',
    'Delivery Note',
    'Bin',
  ],
  WRITEBACK: ['Stock Entry', 'Sales Invoice'],
};

/** Custom field ServiceBridge stamps on documents it creates (session 11). */
export const SB_REF_FIELD = 'custom_sb_ref';
export const SB_REF_DOCTYPES = ['Stock Entry', 'Sales Invoice'];

const ALL_DOCTYPES = [...new Set(Object.values(PURPOSE_DOCTYPES).flat())];

export interface CheckError {
  kind: ErpErrorKind;
  message: string;
}

export interface ConnectionTestResult {
  ok: boolean;
  testedAt: string;
  rest: {
    ok: boolean;
    latencyMs: number;
    user?: string;
    versions?: Record<string, string>;
    error?: CheckError;
  };
  /** Read access per doctype: true, false (no permission) or null (couldn't check). */
  access: { doctype: string; canRead: boolean | null }[];
  /** Purposes whose doctypes are all readable. */
  readyFor: ErpPurpose[];
  db?: {
    ok: boolean;
    latencyMs: number;
    serverVersion?: string;
    grants?: GrantsVerdict;
    extraPrivileges?: string[];
    tables?: { table: string; canRead: boolean }[];
    error?: CheckError;
  };
  setup: {
    /** Missing ServiceBridge custom fields; null when they couldn't be checked. */
    missingFields: { doctype: string; fieldname: string }[] | null;
  };
}

const toCheckError = (error: unknown): CheckError =>
  error instanceof ErpError
    ? { kind: error.kind, message: error.message }
    : { kind: 'network', message: 'Unexpected error while testing the connection.' };

/**
 * Tests a connection without writing anything and without reading business
 * data: identity, versions, per-doctype read access (as counts), DB grants and
 * table access (LIMIT 0), and whether ServiceBridge's custom fields exist.
 */
export async function testConnection(
  credentials: ErpCredentials,
  options: { allowPrivateHosts: boolean; record?: ErpCallRecorder },
): Promise<ConnectionTestResult> {
  const rest = new FrappeRestClient(credentials, { ...options, retries: 1 });
  const result: ConnectionTestResult = {
    ok: false,
    testedAt: new Date().toISOString(),
    rest: { ok: false, latencyMs: 0 },
    access: [],
    readyFor: [],
    setup: { missingFields: null },
  };

  try {
    const started = performance.now();
    try {
      result.rest.user = await rest.loggedUser();
      result.rest.versions = await rest.versions().catch(() => undefined);
      result.rest.ok = true;
    } catch (error) {
      result.rest.error = toCheckError(error);
    }
    result.rest.latencyMs = Math.round(performance.now() - started);

    if (result.rest.ok) {
      result.access = await Promise.all(
        ALL_DOCTYPES.map(async (doctype) => {
          try {
            await rest.count(doctype);
            return { doctype, canRead: true };
          } catch (error) {
            return {
              doctype,
              canRead: error instanceof ErpError && error.kind === 'permission' ? false : null,
            };
          }
        }),
      );
      const readable = new Set(result.access.filter((a) => a.canRead).map((a) => a.doctype));
      result.readyFor = (Object.keys(PURPOSE_DOCTYPES) as ErpPurpose[]).filter((purpose) =>
        PURPOSE_DOCTYPES[purpose].every((doctype) => readable.has(doctype)),
      );
      try {
        const present = await rest.existingCustomFields(SB_REF_FIELD, SB_REF_DOCTYPES);
        result.setup.missingFields = SB_REF_DOCTYPES.filter((dt) => !present.has(dt)).map(
          (doctype) => ({
            doctype,
            fieldname: SB_REF_FIELD,
          }),
        );
      } catch {
        result.setup.missingFields = null;
      }
    }
  } finally {
    await rest.close();
  }

  if (credentials.db) {
    const started = performance.now();
    let db: FrappeDbClient | undefined;
    try {
      db = await FrappeDbClient.connect(credentials.db, {
        ...options,
        connectionId: credentials.connectionId,
      });
      const grants = await db.grants();
      const tables = await Promise.all(
        ['tabCustomer', 'tabItem', 'tabSales Invoice', 'tabBin'].map(async (table) => ({
          table,
          canRead: await db!.canRead(table),
        })),
      );
      result.db = {
        ok: tables.every((t) => t.canRead),
        latencyMs: Math.round(performance.now() - started),
        serverVersion: await db.serverVersion(),
        grants: grants.verdict,
        extraPrivileges: grants.extra,
        tables,
        error: tables.every((t) => t.canRead)
          ? undefined
          : { kind: 'permission', message: 'The database user can’t read some ERPNext tables.' },
      };
    } catch (error) {
      result.db = {
        ok: false,
        latencyMs: Math.round(performance.now() - started),
        error: toCheckError(error),
      };
    } finally {
      await db?.close();
    }
  }

  result.ok = result.rest.ok && (result.db ? result.db.ok : true);
  return result;
}
