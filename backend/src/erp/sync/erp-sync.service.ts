import { Injectable, Logger } from '@nestjs/common';
import type { ErpConnection } from '@prisma/client';
import { AppConfig } from '../../core/config/app-config.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { FrappeRestClient } from '../adapters/frappe-rest.client';
import { ErpConnectionsService } from '../connections/erp-connections.service';
import { ErpError } from '../erp.types';
import { ErpRequestLogService } from '../request-log.service';
import { type ErpDoc, erpTimestamp, SYNC_SPECS, type SyncSpec, specFor } from './specs';

const PAGE_SIZE = 500;
/** Stops a runaway loop (e.g. an ERP ignoring limit_start): 500 × 400 = 200,000 rows per doctype per run. */
const MAX_PAGES = 400;
/** Errors that mean the connection itself is broken, not just one record. */
const CONNECTION_LEVEL = new Set(['auth', 'network', 'timeout', 'blocked']);

interface UpsertDelegate {
  upsert(args: { where: unknown; create: unknown; update: unknown }): Promise<unknown>;
  updateMany(args: { where: unknown; data: unknown }): Promise<{ count: number }>;
  deleteMany(args: { where: unknown }): Promise<{ count: number }>;
}

/**
 * Copies master data from the connection assigned to "Master data sync".
 * Incremental by `modified`; idempotent upserts keyed by (connection, ERP name).
 */
@Injectable()
export class ErpSyncService {
  private readonly logger = new Logger(ErpSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly connections: ErpConnectionsService,
    private readonly requestLog: ErpRequestLogService,
    private readonly config: AppConfig,
  ) {}

  /** The active connection assigned to master data sync, if any. */
  async masterConnection(): Promise<ErpConnection | null> {
    const binding = await this.prisma.erpPurposeBinding.findUnique({
      where: { purpose: 'MASTER_SYNC' },
      include: { connection: true },
    });
    return binding?.connection.status === 'ACTIVE' ? binding.connection : null;
  }

  private async client(connection: ErpConnection): Promise<FrappeRestClient> {
    const credentials = await this.connections.credentialsFor(connection);
    // Two at a time: a sync must never compete with people using ERPNext.
    return new FrappeRestClient(credentials, {
      allowPrivateHosts: this.config.get('ALLOW_PRIVATE_ERP_HOSTS'),
      record: this.requestLog.record,
      concurrency: 2,
    });
  }

  private delegate(spec: SyncSpec): UpsertDelegate {
    return this.prisma[spec.table] as unknown as UpsertDelegate;
  }

  private async onError(connection: ErpConnection, error: unknown): Promise<never> {
    if (error instanceof ErpError && CONNECTION_LEVEL.has(error.kind))
      await this.connections.markFailing(connection.id);
    throw error;
  }

  /** Nightly catch-up: everything changed since the last run, for every doctype. */
  async catchUp(log: (line: string) => Promise<void>): Promise<string> {
    const connection = await this.masterConnection();
    if (!connection) {
      return 'Nothing to sync: no active connection is set for “Master data sync” (Settings → ERP connections).';
    }
    const client = await this.client(connection);
    const counts: string[] = [];
    try {
      for (const spec of SYNC_SPECS) {
        const count = await this.syncDoctype(client, connection.id, spec, log);
        counts.push(`${count.toLocaleString('en-IN')} ${spec.label}`);
      }
      await this.relinkCustomers(connection.id);
    } catch (error) {
      await this.onError(connection, error);
    } finally {
      await client.close();
    }
    return `Synced from “${connection.name}”: ${counts.join(', ')}.`;
  }

  private cursorKey(connectionId: string, doctype: string) {
    return `${connectionId}:${doctype}`;
  }

  async syncDoctype(
    client: FrappeRestClient,
    connectionId: string,
    spec: SyncSpec,
    log: (line: string) => Promise<void>,
  ): Promise<number> {
    const key = this.cursorKey(connectionId, spec.doctype);
    const cursor = await this.prisma.syncCursor.findUnique({ where: { key } });
    // ">=" plus idempotent upserts: records sharing the cursor's timestamp are never skipped.
    const filters = cursor?.lastModified ? [['modified', '>=', cursor.lastModified]] : [];
    let lastModified = cursor?.lastModified ?? null;
    let total = 0;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const docs = await client.list<ErpDoc>(spec.doctype, {
        filters,
        start: page * PAGE_SIZE,
        pageLength: PAGE_SIZE,
      });
      if (docs.length === 0) break;
      const links = spec.customerLinked
        ? await this.customerLinks(
            client,
            spec.doctype,
            docs.map((d) => d.name),
          )
        : new Map<string, string>();
      await this.upsert(connectionId, spec, docs, links);
      total += docs.length;
      for (const doc of docs)
        if (doc.modified && (!lastModified || doc.modified > lastModified))
          lastModified = doc.modified;
      await log(`${spec.doctype}: ${total} so far`);
      if (docs.length < PAGE_SIZE) break;
    }

    await this.prisma.syncCursor.upsert({
      where: { key },
      create: { key, lastModified },
      update: { lastModified },
    });
    return total;
  }

  /** Address/Contact → customer, through the Dynamic Link child table. */
  private async customerLinks(
    client: FrappeRestClient,
    parentDoctype: string,
    names: string[],
  ): Promise<Map<string, string>> {
    if (!names.length) return new Map();
    const rows = await client.list<{ parent: string; link_name: string }>('Dynamic Link', {
      fields: ['parent', 'link_name'],
      filters: [
        ['link_doctype', '=', 'Customer'],
        ['parenttype', '=', parentDoctype],
        ['parent', 'in', names],
      ],
      orderBy: 'parent asc',
      pageLength: names.length * 4,
      parent: parentDoctype,
    });
    return new Map(rows.map((row) => [row.parent, row.link_name]));
  }

  private async upsert(
    connectionId: string,
    spec: SyncSpec,
    docs: ErpDoc[],
    links: Map<string, string>,
  ) {
    const now = new Date();
    const delegate = this.delegate(spec);
    // An active local contract owns a machine's AMC dates: the ERP must not
    // overwrite them (decision: active local contract wins over ERP sync).
    const erpCovered =
      spec.table === 'equipment'
        ? new Set(
            (
              await this.prisma.equipment.findMany({
                where: {
                  erpConnectionId: connectionId,
                  erpName: { in: docs.map((doc) => doc.name) },
                  amcContractLinks: { some: { contract: { status: 'ACTIVE' } } },
                },
                select: { erpName: true },
              })
            ).map((row) => row.erpName),
          )
        : null;
    await this.prisma.$transaction(
      docs.map((doc) => {
        const data = {
          ...spec.map(doc, links),
          erpModified: erpTimestamp(doc.modified),
          syncedAt: now,
        };
        const update = { ...data };
        // The mapped row type is generic per spec; the strip only applies to equipment.
        if (erpCovered?.has(doc.name)) delete (update as Record<string, unknown>).amcExpiresOn;
        return delegate.upsert({
          where: { erpConnectionId_erpName: { erpConnectionId: connectionId, erpName: doc.name } },
          create: { ...data, source: 'ERP', erpConnectionId: connectionId, erpName: doc.name },
          update,
        }) as never;
      }),
    );
  }

  /** Links contacts, sites and machines to customers that arrived after them. */
  async relinkCustomers(connectionId: string): Promise<void> {
    for (const table of ['CustomerContact', 'Site', 'Equipment']) {
      await this.prisma.$executeRawUnsafe(
        `UPDATE "${table}" t SET "customerId" = c.id
           FROM "Customer" c
          WHERE t."erpConnectionId" = $1 AND c."erpConnectionId" = $1
            AND t."customerErpName" = c."erpName"
            AND t."customerId" IS DISTINCT FROM c.id`,
        connectionId,
      );
    }
  }

  /** Applies one changed record (from a webhook). Deleted records become inactive, never removed. */
  async syncOne(
    connectionId: string,
    doctype: string,
    name: string,
    event: string,
  ): Promise<string> {
    const spec = specFor(doctype);
    if (!spec) return `Ignored: ${doctype} is not synced.`;
    const connection = await this.masterConnection();
    if (!connection || connection.id !== connectionId) {
      return 'Ignored: this connection is not the one set for “Master data sync”.';
    }

    const deactivate = async () => {
      const where = { erpConnectionId: connectionId, erpName: name };
      if (spec.table === 'stockLevel') await this.delegate(spec).deleteMany({ where });
      else
        await this.delegate(spec).updateMany({
          where,
          data: { active: false, syncedAt: new Date() },
        });
      return `${doctype} ${name} was deleted in ERPNext; marked inactive.`;
    };
    if (event === 'on_trash') return deactivate();

    const client = await this.client(connection);
    try {
      const doc = await client.getDoc<ErpDoc>(doctype, name);
      if (!doc) return await deactivate();
      const links = spec.customerLinked
        ? await this.customerLinks(client, doctype, [name])
        : new Map<string, string>();
      await this.upsert(connectionId, spec, [doc], links);
      if (spec.customerLinked || spec.table === 'equipment' || spec.table === 'customer')
        await this.relinkCustomers(connectionId);
      return `Updated ${doctype} ${name}.`;
    } catch (error) {
      return this.onError(connection, error);
    } finally {
      await client.close();
    }
  }
}
