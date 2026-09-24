import { connect as netConnect } from 'node:net';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { createConnection } from 'mysql2/promise';
import { stripUrlCredentials } from '../../core/logging/redact';
import { assertHostAllowed, resolveSafeAddress } from '../../core/security/network-guard';
import { type ErpCallRecorder, type ErpDbCredentials, ErpError } from '../erp.types';
import { assertReadOnlySql, assessGrants, type GrantsVerdict } from './read-only-sql';

export interface FrappeDbOptions {
  allowPrivateHosts: boolean;
  connectionId?: string;
  record?: ErpCallRecorder;
  connectTimeoutMs?: number;
  statementTimeoutSeconds?: number;
}

function describeDbError(error: unknown): ErpError {
  const code = (error as { code?: string })?.code;
  if (code === 'EBLOCKEDADDRESS') {
    return new ErpError(
      'blocked',
      'The database address points to a private network, which is not allowed.',
    );
  }
  if (code === 'ER_ACCESS_DENIED_ERROR' || code === 'ER_DBACCESS_DENIED_ERROR') {
    return new ErpError(
      'auth',
      'The database user or password was rejected, or the user can’t use this database.',
    );
  }
  if (code === 'ER_TABLEACCESS_DENIED_ERROR') {
    return new ErpError('permission', 'The database user can’t read this table.');
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN')
    return new ErpError('network', 'The database address could not be found.');
  if (code === 'ECONNREFUSED')
    return new ErpError(
      'network',
      'The database refused the connection. Check the host, port and firewall.',
    );
  if (code === 'ETIMEDOUT')
    return new ErpError(
      'timeout',
      'The database did not answer in time. It may only accept connections from certain addresses.',
    );
  if (code === 'HANDSHAKE_NO_SSL_SUPPORT') {
    return new ErpError(
      'network',
      'This database server doesn’t offer encrypted connections. Untick “Encrypt the connection (SSL)” to connect without encryption, ideally only over a private network or VPN.',
    );
  }
  const message = String((error as Error)?.message ?? '');
  if (
    code === 'HANDSHAKE_SSL_ERROR' ||
    /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ALTNAME/.test(String(code)) ||
    /certificate|self[- ]signed|altname/i.test(message)
  ) {
    return new ErpError(
      'network',
      `The database offers encryption, but its certificate couldn’t be trusted (${stripUrlCredentials(message || String(code))}). Common causes: a self-signed certificate, or a certificate issued for a different host name than the one entered.`,
    );
  }
  return new ErpError(
    'network',
    `Database error: ${stripUrlCredentials((error as Error)?.message ?? String(code))}`,
  );
}

/**
 * Read-only MariaDB connection to an ERPNext database. Three layers keep it
 * read-only: a SELECT-only user (checked by `grants()`), a read-only session,
 * and assertReadOnlySql() on every query.
 */
export class FrappeDbClient {
  private constructor(
    private readonly connection: Connection,
    private readonly options: FrappeDbOptions,
  ) {}

  static async connect(
    credentials: ErpDbCredentials,
    options: FrappeDbOptions,
  ): Promise<FrappeDbClient> {
    const started = performance.now();
    let connection: Connection | undefined;
    try {
      assertHostAllowed(credentials.host, options.allowPrivateHosts);
      // Open the socket to the checked IP ourselves, while mysql2 treats the real
      // hostname as the host, so TLS verifies the certificate against that name.
      const address = await resolveSafeAddress(credentials.host, options.allowPrivateHosts);
      connection = await createConnection({
        host: credentials.host,
        port: credentials.port,
        stream: () => netConnect({ host: address, port: credentials.port }),
        user: credentials.user,
        password: credentials.password,
        database: credentials.database,
        connectTimeout: options.connectTimeoutMs ?? 10_000,
        ssl: credentials.ssl ? { rejectUnauthorized: true, verifyIdentity: true } : undefined,
        multipleStatements: false,
        dateStrings: true,
      });
      await connection.query('SET SESSION TRANSACTION READ ONLY');
      await connection
        .query(`SET SESSION max_statement_time = ${options.statementTimeoutSeconds ?? 30}`)
        .catch(() => undefined); // MariaDB only; MySQL servers ignore this safeguard
      record(options, 'CONNECT', 'connect', true, started);
      return new FrappeDbClient(connection, options);
    } catch (error) {
      await connection?.end().catch(() => undefined);
      const erpError = error instanceof ErpError ? error : describeDbError(error);
      record(options, 'CONNECT', 'connect', false, started, erpError.message);
      throw erpError;
    }
  }

  async close(): Promise<void> {
    await this.connection.end().catch(() => undefined);
  }

  /** Runs a parameterised read. Anything that isn't a single SELECT/WITH is refused before it's sent. */
  async select<T extends RowDataPacket>(
    sql: string,
    params: unknown[] = [],
    label = 'SELECT',
  ): Promise<T[]> {
    assertReadOnlySql(sql);
    const started = performance.now();
    try {
      const [rows] = await this.connection.query<T[]>(sql, params);
      record(this.options, 'SQL', label, true, started);
      return rows;
    } catch (error) {
      const erpError = describeDbError(error);
      record(this.options, 'SQL', label, false, started, erpError.message);
      throw erpError;
    }
  }

  async serverVersion(): Promise<string> {
    const rows = await this.select<RowDataPacket>(
      'SELECT VERSION() AS version',
      [],
      'SELECT VERSION()',
    );
    return String(rows[0]?.version ?? 'unknown');
  }

  /** Whether the DB user can do more than read (SHOW GRANTS is itself read-only). */
  async grants(): Promise<{ verdict: GrantsVerdict; extra: string[] }> {
    const started = performance.now();
    try {
      const [rows] = await this.connection.query<RowDataPacket[]>('SHOW GRANTS FOR CURRENT_USER()');
      record(this.options, 'SQL', 'SHOW GRANTS', true, started);
      return assessGrants(rows.map((row) => String(Object.values(row)[0])));
    } catch (error) {
      record(this.options, 'SQL', 'SHOW GRANTS', false, started, describeDbError(error).message);
      return { verdict: 'UNVERIFIED', extra: [] };
    }
  }

  /** Checks the user may read a table, without reading any rows. */
  async canRead(table: string): Promise<boolean> {
    if (!/^tab[A-Za-z0-9 _-]+$/.test(table)) throw new Error(`Unexpected table name: ${table}`);
    try {
      await this.select(`SELECT 1 FROM \`${table}\` LIMIT 0`, [], `SELECT ${table}`);
      return true;
    } catch {
      return false;
    }
  }
}

function record(
  options: FrappeDbOptions,
  method: string,
  target: string,
  ok: boolean,
  started: number,
  error?: string,
) {
  options.record?.({
    connectionId: options.connectionId,
    channel: 'DB',
    method,
    target,
    ok,
    latencyMs: Math.round(performance.now() - started),
    error,
  });
}
