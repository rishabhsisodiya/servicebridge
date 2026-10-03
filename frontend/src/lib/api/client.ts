/**
 * Typed wrapper around fetch for the ERPTick API. Every failure becomes
 * an ApiError carrying the API's stable `code`, so UI code can switch on codes
 * instead of parsing messages.
 */

export const API_BASE = "/api/v1";

export interface FieldError {
  field: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: FieldError[] = [],
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** The message for one form field, if the API rejected it. */
  fieldMessage(field: string): string | undefined {
    return this.fields.find((f) => f.field === field)?.message;
  }
}

const NETWORK_MESSAGE = "Can't reach ERPTick. Check your connection and try again.";
const SERVER_MESSAGE = "Something went wrong on our side. Try again.";

interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    fields?: FieldError[];
    requestId?: string;
  };
}

function isErrorEnvelope(body: unknown): body is ErrorEnvelope {
  if (typeof body !== "object" || body === null || !("error" in body)) return false;
  const error = (body as { error: unknown }).error;
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { code?: unknown }).code === "string" &&
    typeof (error as { message?: unknown }).message === "string"
  );
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export interface ApiRequestInit extends Omit<RequestInit, "body"> {
  /** Serialised as JSON. */
  json?: unknown;
  /** Sent as multipart/form-data (file uploads); the browser sets the boundary header. */
  form?: FormData;
}

async function send<T>(path: string, init: ApiRequestInit): Promise<T> {
  const { json, form, headers, ...rest } = init;
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      credentials: "same-origin",
      ...rest,
      headers: {
        Accept: "application/json",
        ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: json !== undefined ? JSON.stringify(json) : form,
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new ApiError(0, "NETWORK_ERROR", NETWORK_MESSAGE);
  }

  const body = await readBody(response);
  if (response.ok) return body as T;

  if (isErrorEnvelope(body)) {
    const { code, message, fields, requestId } = body.error;
    throw new ApiError(response.status, code, message, fields ?? [], requestId);
  }
  // A proxy or gateway answered instead of the API (e.g. the API is down).
  throw new ApiError(
    response.status,
    response.status >= 500 ? "SERVICE_UNAVAILABLE" : "BAD_RESPONSE",
    SERVER_MESSAGE,
  );
}

/** Codes meaning "you are not signed in any more"; the app sends the user to sign in. */
export const SIGNED_OUT_CODES = new Set(["UNAUTHENTICATED", "SESSION_ENDED"]);

let refreshing: Promise<boolean> | null = null;

/**
 * One refresh at a time: requests that expire together all wait for the same
 * refresh instead of each rotating the refresh token.
 */
export function refreshSession(): Promise<boolean> {
  refreshing ??= send<unknown>("/auth/refresh", { method: "POST" })
    .then(() => true)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

type SignedOutHandler = () => void;
let onSignedOut: SignedOutHandler = () => {
  if (typeof window === "undefined") return;
  const next = `${window.location.pathname}${window.location.search}`;
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a full load clears every cached screen from the previous session
  window.location.assign(`/login?next=${encodeURIComponent(next)}`);
};

/** Tests (and the session provider) can replace what happens when the session ends. */
export function setSignedOutHandler(handler: SignedOutHandler): void {
  onSignedOut = handler;
}

export interface ApiOptions extends ApiRequestInit {
  /** Don't redirect to sign-in on 401 (used by the auth pages themselves). */
  noAuthRedirect?: boolean;
}

export async function apiFetch<T>(path: string, init: ApiOptions = {}): Promise<T> {
  const { noAuthRedirect, ...request } = init;
  try {
    return await send<T>(path, request);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401 || noAuthRedirect) throw error;

    const signedOut = error.code === "TOKEN_EXPIRED" || SIGNED_OUT_CODES.has(error.code);
    if (!signedOut) throw error;

    // The 15-minute access cookie is dropped by the browser when it expires, so a
    // missing token (UNAUTHENTICATED) also gets one refresh attempt. A failed
    // refresh clears every auth cookie server-side, so the redirect can't loop.
    if (await refreshSession()) {
      try {
        return await send<T>(path, request);
      } catch (retryError) {
        if (!(retryError instanceof ApiError) || retryError.status !== 401) throw retryError;
      }
    }
    onSignedOut();
    throw error;
  }
}
