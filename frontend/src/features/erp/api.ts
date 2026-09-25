import { apiFetch } from "@/lib/api/client";

export type ErpPurpose = "MASTER_SYNC" | "WRITEBACK";
export type ConnectionStatus = "UNTESTED" | "ACTIVE" | "FAILING" | "DISABLED" | "KEY_ERROR";

export interface CheckError {
  kind: string;
  message: string;
}

/** Mirrors backend/src/erp/connection-tester.ts ConnectionTestResult. */
export interface TestResult {
  ok: boolean;
  testedAt: string;
  rest: {
    ok: boolean;
    latencyMs: number;
    user?: string;
    versions?: Record<string, string>;
    error?: CheckError;
  };
  access: { doctype: string; canRead: boolean | null }[];
  readyFor: ErpPurpose[];
  db?: {
    ok: boolean;
    latencyMs: number;
    serverVersion?: string;
    grants?: "SELECT_ONLY" | "HAS_WRITE_GRANTS" | "UNVERIFIED";
    extraPrivileges?: string[];
    tables?: { table: string; canRead: boolean }[];
    error?: CheckError;
  };
  setup: { missingFields: { doctype: string; fieldname: string }[] | null };
}

export interface Connection {
  id: string;
  name: string;
  kind: "FRAPPE";
  baseUrl: string;
  apiKeyHint: string;
  status: ConnectionStatus;
  erpVersion: string | null;
  lastTestedAt: string | null;
  lastTestResult: TestResult | null;
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
}

export interface DbInput {
  host: string;
  port: number;
  database: string;
  user: string;
  password?: string;
  ssl: boolean;
  connectionLimit: number;
}

export interface ConnectionInput {
  name: string;
  baseUrl: string;
  apiKey: string;
  apiSecret: string;
  db?: DbInput;
}

export interface SavedSecrets {
  apiKey: string;
  apiSecret: string;
  dbPassword: string | null;
}

export interface PurposesResponse {
  assignments: Record<ErpPurpose, string | null>;
  labels: Record<ErpPurpose, string>;
}

/** Which ERP doctypes each purpose reads (mirrors PURPOSE_DOCTYPES on the API). */
export const PURPOSE_DOCTYPES: Record<ErpPurpose, string[]> = {
  MASTER_SYNC: [
    "Customer",
    "Contact",
    "Address",
    "Serial No",
    "Item",
    "Item Price",
    "Warehouse",
    "Bin",
  ],
  WRITEBACK: ["Stock Entry", "Sales Invoice"],
};

export const PURPOSE_HELP: Record<ErpPurpose, string> = {
  MASTER_SYNC: "Customers, machines (serial numbers), items, prices and stock.",
  WRITEBACK:
    "Stock issues from field visits and draft invoices on closure (switched on separately).",
};

export const erpApi = {
  create: (body: ConnectionInput) =>
    apiFetch<Connection>("/erp/connections", { method: "POST", json: body }),
  update: (
    id: string,
    body: Omit<Partial<ConnectionInput>, "db"> & { db?: DbInput | null; version: number },
  ) => apiFetch<Connection>(`/erp/connections/${id}`, { method: "PATCH", json: body }),
  testDraft: (body: Partial<ConnectionInput> & { connectionId?: string }) =>
    apiFetch<TestResult>("/erp/connections/test", { method: "POST", json: body }),
  reveal: (id: string) =>
    apiFetch<SavedSecrets>(`/erp/connections/${id}/reveal`, { method: "POST" }),
  test: (id: string) => apiFetch<Connection>(`/erp/connections/${id}/test`, { method: "POST" }),
  enable: (id: string) => apiFetch<Connection>(`/erp/connections/${id}/enable`, { method: "POST" }),
  disable: (id: string) =>
    apiFetch<Connection>(`/erp/connections/${id}/disable`, { method: "POST" }),
  remove: (id: string) => apiFetch<void>(`/erp/connections/${id}`, { method: "DELETE" }),
  setPurposes: (body: Partial<Record<ErpPurpose, string | null>>) =>
    apiFetch<PurposesResponse>("/erp/purposes", { method: "PUT", json: body }),
};
