import { Agent, fetch, type Dispatcher } from 'undici';
import { stripUrlCredentials } from '../../core/logging/redact';
import { assertHostAllowed, createGuardedLookup } from '../../core/security/network-guard';
import { type ErpCallRecorder, type ErpCredentials, ErpError } from '../erp.types';

export interface FrappeRestOptions {
  allowPrivateHosts: boolean;
  record?: ErpCallRecorder;
  timeoutMs?: number;
  concurrency?: number;
  /** Retries for GET requests on network errors, 429 and 5xx. */
  retries?: number;
}

interface RequestOptions {
  query?: Record<string, string | number>;
  body?: unknown;
  /** Recorded in the request log for the System monitor. */
  doctype?: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Turns a Frappe error response into a message an administrator can act on. */
function describeHttpError(status: number, body: unknown): ErpError {
  const exc =
    typeof body === 'object' && body !== null
      ? (body as { exc_type?: string }).exc_type
      : undefined;
  if (status === 401 || exc === 'AuthenticationError') {
    return new ErpError(
      'auth',
      'The API key or secret was rejected. Check them in ERPNext under the user’s API access.',
      status,
    );
  }
  if (status === 403 || exc === 'PermissionError') {
    return new ErpError(
      'permission',
      'The API user signed in but is not allowed to do this.',
      status,
    );
  }
  if (status === 404 || exc === 'DoesNotExistError') {
    return new ErpError(
      'not_found',
      'The ERP did not recognise this request. Is this an ERPNext site?',
      status,
    );
  }
  if (status === 429)
    return new ErpError('rate_limited', 'The ERP is limiting requests. Try again shortly.', status);
  if (status >= 500)
    return new ErpError('server', `The ERP had an internal error (HTTP ${status}).`, status);
  return new ErpError('bad_response', `The ERP answered with HTTP ${status}.`, status);
}

function describeNetworkError(error: unknown): ErpError {
  const cause = (error as { cause?: { code?: string } })?.cause;
  const code = cause?.code ?? (error as { code?: string })?.code;
  const name = (error as { name?: string })?.name;
  if (name === 'TimeoutError' || name === 'AbortError') {
    return new ErpError('timeout', 'The ERP did not answer in time.');
  }
  if (code === 'EBLOCKEDADDRESS') {
    return new ErpError(
      'blocked',
      'This address points to a private network. If your ERP really runs on your own network, ask the person who installed ServiceBridge to allow private ERP hosts.',
    );
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return new ErpError('network', 'That address could not be found. Check the spelling.');
  }
  if (code === 'ECONNREFUSED')
    return new ErpError(
      'network',
      'The ERP refused the connection. Is the address and port right?',
    );
  if (typeof code === 'string' && /CERT|TLS|SSL/.test(code)) {
    return new ErpError('network', 'The ERP’s security certificate is not valid for this address.');
  }
  return new ErpError(
    'network',
    `Could not reach the ERP (${stripUrlCredentials(String(code ?? (error as Error)?.message ?? 'unknown error'))}).`,
  );
}

/**
 * ERPNext / Frappe REST client. Authenticates with an API key and secret,
 * connects only to public addresses (unless allowed), limits concurrency,
 * retries idempotent reads, and records every call without its query string.
 */
export class FrappeRestClient {
  private readonly dispatcher: Dispatcher;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly concurrency: number;
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(
    private readonly credentials: ErpCredentials,
    private readonly options: FrappeRestOptions,
  ) {
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.retries = options.retries ?? 2;
    this.concurrency = options.concurrency ?? 4;
    this.dispatcher = new Agent({
      connect: { lookup: createGuardedLookup(options.allowPrivateHosts) as never },
      keepAliveTimeout: 10_000,
    });
  }

  async close(): Promise<void> {
    await this.dispatcher.close();
  }

  private async slot<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= this.concurrency)
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active += 1;
    try {
      return await work();
    } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }

  async request<T>(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const url = new URL(path, this.credentials.baseUrl);
    for (const [key, value] of Object.entries(options.query ?? {}))
      url.searchParams.set(key, String(value));
    const attempts = method === 'GET' ? this.retries + 1 : 1;

    return this.slot(async () => {
      let lastError: ErpError | undefined;
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        const started = performance.now();
        let status: number | undefined;
        try {
          assertHostAllowed(url.hostname, this.options.allowPrivateHosts);
          const response = await fetch(url, {
            method,
            dispatcher: this.dispatcher,
            signal: AbortSignal.timeout(this.timeoutMs),
            headers: {
              Accept: 'application/json',
              Authorization: `token ${this.credentials.apiKey}:${this.credentials.apiSecret}`,
              ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
            },
            body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
          });
          status = response.status;
          const text = await response.text();
          let body: unknown;
          try {
            body = text ? JSON.parse(text) : undefined;
          } catch {
            body = undefined;
          }
          if (response.ok && body !== undefined) {
            this.log(method, url, options.doctype, status, true, started);
            return body as T;
          }
          lastError = response.ok
            ? new ErpError(
                'bad_response',
                'The address answered, but not like an ERPNext site.',
                status,
              )
            : describeHttpError(status, body);
          if (status === 429) {
            const retryAfter = Number(response.headers.get('retry-after'));
            if (attempt < attempts)
              await sleep(Math.min(Number.isFinite(retryAfter) ? retryAfter * 1000 : 1000, 5000));
          }
        } catch (error) {
          lastError = describeNetworkError(error);
        }
        this.log(method, url, options.doctype, status, false, started, lastError.message);
        const retryable = ['network', 'timeout', 'server', 'rate_limited'].includes(lastError.kind);
        if (!retryable || attempt === attempts || lastError.kind === 'blocked') break;
        if (lastError.kind !== 'rate_limited') await sleep(300 * 2 ** (attempt - 1));
      }
      throw lastError ?? new ErpError('network', 'Could not reach the ERP.');
    });
  }

  private log(
    method: string,
    url: URL,
    doctype: string | undefined,
    httpStatus: number | undefined,
    ok: boolean,
    started: number,
    error?: string,
  ) {
    this.options.record?.({
      connectionId: this.credentials.connectionId,
      channel: 'REST',
      method,
      target: url.pathname, // never the query string
      doctype,
      httpStatus,
      ok,
      latencyMs: Math.round(performance.now() - started),
      error,
    });
  }

  // ── Reads used by the sync ──

  /** One page of a doctype via frappe.client.get_list. `parent` is required for child tables. */
  async list<T = Record<string, unknown>>(
    doctype: string,
    options: {
      fields?: string[];
      filters?: unknown[];
      orderBy?: string;
      start?: number;
      pageLength?: number;
      parent?: string;
    } = {},
  ): Promise<T[]> {
    const body = await this.request<{ message?: T[] }>(
      'GET',
      '/api/method/frappe.client.get_list',
      {
        query: {
          doctype,
          fields: JSON.stringify(options.fields ?? ['*']),
          filters: JSON.stringify(options.filters ?? []),
          order_by: options.orderBy ?? 'modified asc, name asc',
          limit_start: options.start ?? 0,
          limit_page_length: options.pageLength ?? 500,
          ...(options.parent ? { parent: options.parent } : {}),
        },
        doctype,
      },
    );
    return body.message ?? [];
  }

  /** A single document, or undefined when it no longer exists. */
  async getDoc<T = Record<string, unknown>>(doctype: string, name: string): Promise<T | undefined> {
    try {
      const body = await this.request<{ data?: T }>(
        'GET',
        `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`,
        { doctype },
      );
      return body.data;
    } catch (error) {
      if (error instanceof ErpError && error.kind === 'not_found') return undefined;
      throw error;
    }
  }

  /** Creates a document (used only by explicit, admin-confirmed setup actions and write-backs). */
  async create<T = Record<string, unknown>>(
    doctype: string,
    doc: Record<string, unknown>,
  ): Promise<T> {
    const body = await this.request<{ data: T }>(
      'POST',
      `/api/resource/${encodeURIComponent(doctype)}`,
      {
        body: doc,
        doctype,
      },
    );
    return body.data;
  }

  // ── Calls used by the connection test ──

  /** Email of the ERP user the key belongs to. */
  async loggedUser(): Promise<string> {
    const body = await this.request<{ message?: unknown }>(
      'GET',
      '/api/method/frappe.auth.get_logged_user',
    );
    if (typeof body.message !== 'string')
      throw new ErpError('bad_response', 'The address answered, but not like an ERPNext site.');
    return body.message;
  }

  /** Installed app versions, e.g. { frappe: '15.40.0', erpnext: '15.38.0' }. */
  async versions(): Promise<Record<string, string>> {
    const body = await this.request<{ message?: Record<string, { version?: string }> }>(
      'GET',
      '/api/method/frappe.utils.change_log.get_versions',
    );
    return Object.fromEntries(
      Object.entries(body.message ?? {}).map(([app, info]) => [app, info?.version ?? 'unknown']),
    );
  }

  /** Number of records the user can read. Returns only a count, never record data. */
  async count(doctype: string): Promise<number> {
    const body = await this.request<{ message?: unknown }>(
      'GET',
      '/api/method/frappe.client.get_count',
      {
        query: { doctype },
        doctype,
      },
    );
    return Number(body.message ?? 0);
  }

  /** Which of the given custom fields exist (reads Custom Field metadata only). */
  async existingCustomFields(fieldname: string, doctypes: string[]): Promise<Set<string>> {
    const body = await this.request<{ data?: { dt: string }[] }>(
      'GET',
      '/api/resource/Custom Field',
      {
        query: {
          fields: JSON.stringify(['dt']),
          filters: JSON.stringify([
            ['fieldname', '=', fieldname],
            ['dt', 'in', doctypes],
          ]),
          limit_page_length: doctypes.length,
        },
        doctype: 'Custom Field',
      },
    );
    return new Set((body.data ?? []).map((row) => row.dt));
  }
}
