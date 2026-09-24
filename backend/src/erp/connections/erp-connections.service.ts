import { HttpStatus, Injectable } from '@nestjs/common';
import { type ErpConnection, type ErpConnectionStatus, ErpPurpose, Prisma } from '@prisma/client';
import type { AuthUser, ClientInfo } from '../../auth/auth.types';
import { AuditService } from '../../core/audit/audit.service';
import { AppConfig } from '../../core/config/app-config.service';
import { CryptoService, DecryptionError } from '../../core/crypto/crypto.service';
import { AppException, validationFailed } from '../../core/http/app.exception';
import { PrismaService } from '../../core/prisma/prisma.service';
import { RateLimitService } from '../../core/rate-limit/rate-limit.service';
import { normaliseBaseUrl } from '../../core/security/network-guard';
import { type ConnectionTestResult, PURPOSE_DOCTYPES, testConnection } from '../connection-tester';
import type { ErpCredentials } from '../erp.types';
import { ErpRequestLogService } from '../request-log.service';
import type {
  ConnectionDbDto,
  ConnectionInputDto,
  SetPurposesDto,
  TestDraftDto,
  UpdateConnectionDto,
} from './dto';

export const PURPOSE_LABELS: Record<ErpPurpose, string> = {
  MASTER_SYNC: 'Master data sync',
  DASHBOARDS: 'Business dashboards',
  WRITEBACK: 'Write-backs',
};

export interface ConnectionView {
  id: string;
  name: string;
  kind: 'FRAPPE';
  baseUrl: string;
  apiKeyHint: string;
  status: ErpConnectionStatus;
  erpVersion: string | null;
  lastTestedAt: Date | null;
  lastTestResult: ConnectionTestResult | null;
  /** A successful test newer than the last change to the connection details. */
  canEnable: boolean;
  db: {
    host: string;
    port: number;
    database: string;
    user: string;
    ssl: boolean;
    connectionLimit: number;
    hasPassword: boolean;
  } | null;
  purposes: ErpPurpose[];
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

type ConnectionRow = ErpConnection & { purposes: { purpose: ErpPurpose }[] };

const notFound = () =>
  new AppException(
    'CONNECTION_NOT_FOUND',
    'That connection no longer exists.',
    HttpStatus.NOT_FOUND,
  );

const keyError = () =>
  new AppException(
    'KEY_ERROR',
    "This connection's saved credentials can't be read with the current encryption key. Enter the API key and secret (and database password) again.",
    HttpStatus.CONFLICT,
  );

function passedSinceChange(row: ErpConnection): boolean {
  const result = row.lastTestResult as ConnectionTestResult | null;
  return !!result?.ok && !!row.lastTestedAt && row.lastTestedAt >= row.detailsChangedAt;
}

export function toView(row: ConnectionRow): ConnectionView {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    baseUrl: row.baseUrl,
    apiKeyHint: row.apiKeyHint,
    status: row.status,
    erpVersion: row.erpVersion,
    lastTestedAt: row.lastTestedAt,
    lastTestResult: row.lastTestResult as ConnectionTestResult | null,
    canEnable: passedSinceChange(row) && row.status !== 'ACTIVE',
    db:
      row.dbHost && row.dbPort && row.dbName && row.dbUser
        ? {
            host: row.dbHost,
            port: row.dbPort,
            database: row.dbName,
            user: row.dbUser,
            ssl: row.dbSsl,
            connectionLimit: row.dbConnectionLimit,
            hasPassword: !!row.dbPasswordEnc,
          }
        : null,
    purposes: row.purposes.map((p) => p.purpose),
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class ErpConnectionsService {
  /** Set by ConnectionRecovery: called when a connection starts failing. */
  onFailing?: (connectionId: string) => Promise<void>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly config: AppConfig,
    private readonly audit: AuditService,
    private readonly rateLimit: RateLimitService,
    private readonly requestLog: ErpRequestLogService,
  ) {}

  private get allowPrivateHosts(): boolean {
    return this.config.get('ALLOW_PRIVATE_ERP_HOSTS');
  }

  private baseUrlOrFail(input: string): string {
    const { url, problem } = normaliseBaseUrl(input, {
      allowHttp: this.config.get('APP_ENV') === 'development',
    });
    if (!url)
      throw validationFailed([{ field: 'baseUrl', message: problem ?? 'Enter a valid address.' }]);
    return url;
  }

  private include = { purposes: { select: { purpose: true } } } as const;

  async list(): Promise<ConnectionView[]> {
    const rows = await this.prisma.erpConnection.findMany({
      include: this.include,
      orderBy: { name: 'asc' },
    });
    return rows.map(toView);
  }

  private async get(id: string): Promise<ConnectionRow> {
    const row = await this.prisma.erpConnection.findUnique({
      where: { id },
      include: this.include,
    });
    if (!row) throw notFound();
    return row;
  }

  private dbColumns(db: ConnectionDbDto, existingPasswordEnc: string | null) {
    const passwordEnc = db.password ? this.crypto.encrypt(db.password) : existingPasswordEnc;
    if (!passwordEnc)
      throw validationFailed([{ field: 'db.password', message: 'Enter the database password.' }]);
    return {
      dbHost: db.host.trim().toLowerCase(),
      dbPort: db.port,
      dbName: db.database,
      dbUser: db.user,
      dbPasswordEnc: passwordEnc,
      dbSsl: db.ssl,
      dbConnectionLimit: db.connectionLimit ?? 3,
    };
  }

  private nameTaken(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }

  private nameTakenError() {
    return new AppException(
      'NAME_TAKEN',
      'Another connection already has that name.',
      HttpStatus.CONFLICT,
      [{ field: 'name', message: 'Another connection already has that name.' }],
    );
  }

  async create(
    actor: AuthUser,
    dto: ConnectionInputDto,
    client: ClientInfo,
  ): Promise<ConnectionView> {
    const baseUrl = this.baseUrlOrFail(dto.baseUrl);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.erpConnection.create({
          data: {
            name: dto.name.trim(),
            baseUrl,
            apiKeyEnc: this.crypto.encrypt(dto.apiKey),
            apiKeyHint: dto.apiKey.slice(-4),
            apiSecretEnc: this.crypto.encrypt(dto.apiSecret),
            ...(dto.db ? this.dbColumns(dto.db, null) : {}),
            createdById: actor.id,
          },
          include: this.include,
        });
        await this.audit.record(
          {
            actorId: actor.id,
            action: 'erp.connection_created',
            entityType: 'erp_connection',
            entityId: row.id,
            summary: `${actor.name} added the ERP connection “${row.name}” (${baseUrl}${dto.db ? ', with database access' : ''})`,
            ip: client.ip,
            requestId: client.requestId,
          },
          tx,
        );
        return toView(row);
      });
    } catch (error) {
      if (this.nameTaken(error)) throw this.nameTakenError();
      throw error;
    }
  }

  async update(
    actor: AuthUser,
    id: string,
    dto: UpdateConnectionDto,
    client: ClientInfo,
  ): Promise<ConnectionView> {
    const baseUrl = dto.baseUrl !== undefined ? this.baseUrlOrFail(dto.baseUrl) : undefined;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.erpConnection.findUnique({ where: { id }, include: this.include });
        if (!row) throw notFound();
        if (row.version !== dto.version) {
          throw new AppException(
            'VERSION_CONFLICT',
            'Someone else changed this connection while you were editing. Reload to see their changes.',
            HttpStatus.CONFLICT,
          );
        }

        const data: Prisma.ErpConnectionUpdateInput = {};
        const changed: string[] = [];
        if (dto.name !== undefined && dto.name.trim() !== row.name) {
          data.name = dto.name.trim();
          changed.push('name');
        }
        if (baseUrl && baseUrl !== row.baseUrl) {
          data.baseUrl = baseUrl;
          changed.push('address');
        }
        if (dto.apiKey) {
          data.apiKeyEnc = this.crypto.encrypt(dto.apiKey);
          data.apiKeyHint = dto.apiKey.slice(-4);
          changed.push('API key');
        }
        if (dto.apiSecret) {
          data.apiSecretEnc = this.crypto.encrypt(dto.apiSecret);
          changed.push('API secret');
        }
        if (dto.db === null && row.dbHost) {
          Object.assign(data, {
            dbHost: null,
            dbPort: null,
            dbName: null,
            dbUser: null,
            dbPasswordEnc: null,
          });
          changed.push('database access removed');
        } else if (dto.db) {
          Object.assign(data, this.dbColumns(dto.db, row.dbPasswordEnc));
          changed.push('database settings');
        }

        // Anything other than the name needs a fresh successful test before use.
        const detailsChanged = changed.some((c) => c !== 'name');
        if (detailsChanged) {
          data.detailsChangedAt = new Date();
          if (row.status !== 'DISABLED') data.status = 'UNTESTED';
        }
        if (!changed.length) return toView(row);

        const updated = await tx.erpConnection.update({
          where: { id },
          data: { ...data, version: { increment: 1 } },
          include: this.include,
        });
        await this.audit.record(
          {
            actorId: actor.id,
            action: 'erp.connection_updated',
            entityType: 'erp_connection',
            entityId: id,
            summary: `${actor.name} changed the ERP connection “${updated.name}”: ${changed.join(', ')}`,
            ip: client.ip,
            requestId: client.requestId,
          },
          tx,
        );
        return toView(updated);
      });
    } catch (error) {
      if (this.nameTaken(error)) throw this.nameTakenError();
      throw error;
    }
  }

  /** Decrypted credentials for a saved connection. Marks the connection KEY_ERROR if they can't be read. */
  async credentialsFor(row: ErpConnection): Promise<ErpCredentials> {
    try {
      return {
        connectionId: row.id,
        baseUrl: row.baseUrl,
        apiKey: this.crypto.decrypt(row.apiKeyEnc),
        apiSecret: this.crypto.decrypt(row.apiSecretEnc),
        db:
          row.dbHost && row.dbPort && row.dbName && row.dbUser && row.dbPasswordEnc
            ? {
                host: row.dbHost,
                port: row.dbPort,
                database: row.dbName,
                user: row.dbUser,
                password: this.crypto.decrypt(row.dbPasswordEnc),
                ssl: row.dbSsl,
                connectionLimit: row.dbConnectionLimit,
              }
            : undefined,
      };
    } catch (error) {
      if (error instanceof DecryptionError) {
        await this.prisma.erpConnection.update({
          where: { id: row.id },
          data: { status: 'KEY_ERROR' },
        });
        throw keyError();
      }
      throw error;
    }
  }

  private async limitTests(actor: AuthUser) {
    await this.rateLimit.enforce(`erp-test:${actor.id}`, 10, 60);
  }

  /** "Test before saving": nothing is stored except the request log. */
  async testDraft(actor: AuthUser, dto: TestDraftDto): Promise<ConnectionTestResult> {
    await this.limitTests(actor);
    const baseUrl = this.baseUrlOrFail(dto.baseUrl);
    // Editing: anything left blank means "keep the saved value".
    const saved = dto.connectionId
      ? await this.credentialsFor(await this.get(dto.connectionId))
      : undefined;
    const apiKey = dto.apiKey || saved?.apiKey;
    const apiSecret = dto.apiSecret || saved?.apiSecret;
    const dbPassword = dto.db?.password || saved?.db?.password;
    const missing = [
      !apiKey && { field: 'apiKey', message: 'Enter the API key.' },
      !apiSecret && { field: 'apiSecret', message: 'Enter the API secret.' },
      dto.db && !dbPassword && { field: 'db.password', message: 'Enter the database password.' },
    ].filter((problem): problem is { field: string; message: string } => !!problem);
    if (missing.length) throw validationFailed(missing);
    return testConnection(
      {
        baseUrl,
        apiKey: apiKey!,
        apiSecret: apiSecret!,
        db: dto.db
          ? { ...dto.db, host: dto.db.host.trim().toLowerCase(), password: dbPassword! }
          : undefined,
      },
      { allowPrivateHosts: this.allowPrivateHosts, record: this.requestLog.record },
    );
  }

  /** Called when real traffic (sync, write-back) fails at the connection level. */
  async markFailing(id: string): Promise<void> {
    const { count } = await this.prisma.erpConnection.updateMany({
      where: { id, status: 'ACTIVE' },
      data: { status: 'FAILING', consecutiveFailures: { increment: 1 } },
    });
    if (count) await this.onFailing?.(id);
  }

  /** Saved secrets for the edit form. Needs a fresh password check; every reveal is audited. */
  async revealCredentials(actor: AuthUser, id: string, client: ClientInfo) {
    const row = await this.get(id);
    const credentials = await this.credentialsFor(row);
    await this.audit.record({
      actorId: actor.id,
      action: 'erp.credentials_revealed',
      entityType: 'erp_connection',
      entityId: id,
      summary: `${actor.name} viewed the saved credentials of “${row.name}”`,
      ip: client.ip,
      requestId: client.requestId,
    });
    return {
      apiKey: credentials.apiKey,
      apiSecret: credentials.apiSecret,
      dbPassword: credentials.db?.password ?? null,
    };
  }

  async testSaved(actor: AuthUser, id: string, client: ClientInfo): Promise<ConnectionView> {
    await this.limitTests(actor);
    const row = await this.get(id);
    const credentials = await this.credentialsFor(row);
    const result = await testConnection(credentials, {
      allowPrivateHosts: this.allowPrivateHosts,
      record: this.requestLog.record,
    });

    let status = row.status;
    if (result.ok && (row.status === 'FAILING' || row.status === 'KEY_ERROR')) status = 'ACTIVE';
    if (!result.ok && row.status === 'ACTIVE') status = 'FAILING';
    const startedFailing = status === 'FAILING' && row.status !== 'FAILING';

    const updated = await this.prisma.erpConnection.update({
      where: { id },
      data: {
        status,
        lastTestedAt: new Date(result.testedAt),
        lastTestResult: result as unknown as Prisma.InputJsonValue,
        erpVersion: result.rest.versions?.erpnext ?? row.erpVersion,
        consecutiveFailures: result.ok ? 0 : { increment: 1 },
      },
      include: this.include,
    });
    await this.audit.record({
      actorId: actor.id,
      action: 'erp.connection_tested',
      entityType: 'erp_connection',
      entityId: id,
      summary: `${actor.name} tested “${row.name}”: ${result.ok ? 'passed' : 'failed'}`,
      ip: client.ip,
      requestId: client.requestId,
    });
    if (startedFailing) await this.onFailing?.(id);
    return toView(updated);
  }

  async setEnabled(
    actor: AuthUser,
    id: string,
    enabled: boolean,
    client: ClientInfo,
  ): Promise<ConnectionView> {
    const row = await this.get(id);
    if (enabled && !passedSinceChange(row)) {
      throw new AppException(
        'NOT_TESTED',
        'Run a successful test first. The connection details changed since the last test that passed.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const status: ErpConnectionStatus = enabled ? 'ACTIVE' : 'DISABLED';
    if (row.status === status) return toView(row);
    const updated = await this.prisma.erpConnection.update({
      where: { id },
      data: { status, version: { increment: 1 } },
      include: this.include,
    });
    await this.audit.record({
      actorId: actor.id,
      action: enabled ? 'erp.connection_enabled' : 'erp.connection_disabled',
      entityType: 'erp_connection',
      entityId: id,
      summary: `${actor.name} ${enabled ? 'enabled' : 'disabled'} the ERP connection “${row.name}”`,
      ip: client.ip,
      requestId: client.requestId,
    });
    return toView(updated);
  }

  async remove(actor: AuthUser, id: string, client: ClientInfo): Promise<void> {
    const row = await this.get(id);
    if (row.purposes.length) {
      const uses = row.purposes.map((p) => PURPOSE_LABELS[p.purpose]).join(', ');
      throw new AppException(
        'CONNECTION_IN_USE',
        `This connection is used for ${uses}. Choose another connection for ${row.purposes.length === 1 ? 'it' : 'them'} first.`,
        HttpStatus.CONFLICT,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.erpConnection.delete({ where: { id } });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'erp.connection_deleted',
          entityType: 'erp_connection',
          entityId: id,
          summary: `${actor.name} deleted the ERP connection “${row.name}”`,
          ip: client.ip,
          requestId: client.requestId,
        },
        tx,
      );
    });
  }

  async purposes(): Promise<Record<ErpPurpose, string | null>> {
    const bindings = await this.prisma.erpPurposeBinding.findMany();
    const result = { MASTER_SYNC: null, DASHBOARDS: null, WRITEBACK: null } as Record<
      ErpPurpose,
      string | null
    >;
    for (const binding of bindings) result[binding.purpose] = binding.connectionId;
    return result;
  }

  /** Assigns connections to purposes. Only active connections that can read what the purpose needs. */
  async setPurposes(actor: AuthUser, dto: SetPurposesDto, client: ClientInfo) {
    const requested = Object.entries(dto).filter(([, value]) => value !== undefined) as [
      ErpPurpose,
      string | null,
    ][];
    await this.prisma.$transaction(async (tx) => {
      const changes: string[] = [];
      for (const [purpose, connectionId] of requested) {
        if (!(purpose in PURPOSE_LABELS)) continue;
        if (connectionId === null) {
          const { count } = await tx.erpPurposeBinding.deleteMany({ where: { purpose } });
          if (count) changes.push(`${PURPOSE_LABELS[purpose]}: none`);
          continue;
        }
        const row = await tx.erpConnection.findUnique({ where: { id: connectionId } });
        if (!row) throw notFound();
        if (row.status !== 'ACTIVE') {
          throw new AppException(
            'CONNECTION_NOT_ACTIVE',
            `“${row.name}” isn't enabled. Test and enable it before using it for ${PURPOSE_LABELS[purpose]}.`,
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }
        const result = row.lastTestResult as ConnectionTestResult | null;
        if (!result?.readyFor.includes(purpose)) {
          const blocked = PURPOSE_DOCTYPES[purpose].filter(
            (doctype) => !result?.access.find((a) => a.doctype === doctype)?.canRead,
          );
          throw new AppException(
            'MISSING_PERMISSION',
            `The ERP user for “${row.name}” can't read ${blocked.join(', ')}, which ${PURPOSE_LABELS[purpose]} needs. Give it read access in ERPNext, then test again.`,
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }
        await tx.erpPurposeBinding.upsert({
          where: { purpose },
          create: { purpose, connectionId },
          update: { connectionId },
        });
        changes.push(`${PURPOSE_LABELS[purpose]}: ${row.name}`);
      }
      if (changes.length) {
        await this.audit.record(
          {
            actorId: actor.id,
            action: 'erp.purposes_updated',
            entityType: 'erp_purposes',
            summary: `${actor.name} set ERP connections: ${changes.join('; ')}`,
            ip: client.ip,
            requestId: client.requestId,
          },
          tx,
        );
      }
    });
    return this.purposes();
  }
}
