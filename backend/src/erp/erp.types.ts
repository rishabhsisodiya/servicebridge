/** Decrypted connection details, only ever held in memory. */
export interface ErpCredentials {
  /** Set for saved connections; absent for "test before saving". */
  connectionId?: string;
  baseUrl: string;
  apiKey: string;
  apiSecret: string;
  db?: ErpDbCredentials;
}

export interface ErpDbCredentials {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
  /** Pool size for dashboard queries (default 3). */
  connectionLimit?: number;
}

export type ErpErrorKind =
  | 'auth' // key/secret or DB password rejected
  | 'permission' // signed in, but not allowed to read this
  | 'not_found'
  | 'blocked' // address refused by the network guard
  | 'network' // DNS failure, connection refused, TLS problem
  | 'timeout'
  | 'rate_limited'
  | 'server' // the ERP answered with a 5xx
  | 'bad_response'; // not ERPNext, or unexpected shape

/** A failure talking to the ERP, with a message an administrator can act on. */
export class ErpError extends Error {
  constructor(
    readonly kind: ErpErrorKind,
    message: string,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'ErpError';
  }
}

export interface ErpCallRecord {
  connectionId?: string;
  channel: 'REST' | 'DB';
  method: string;
  target: string;
  doctype?: string;
  httpStatus?: number;
  ok: boolean;
  latencyMs: number;
  error?: string;
}

/** Receives one record per ERP call (see ErpRequestLogService). */
export type ErpCallRecorder = (record: ErpCallRecord) => void;
