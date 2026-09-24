// Minimal stand-in for the ServiceBridge API so the e2e suite can exercise the
// web app (proxy, sign-in, users screen) without Postgres or Redis.
// Cookie `stub_role` picks the signed-in user's role (default ADMIN).
// Cookie `stub_expire_once=1` makes the next /auth/me answer TOKEN_EXPIRED once.
import { createServer } from "node:http";

const port = Number(process.env.STUB_API_PORT ?? 4599);

const ALL = [
  "tickets.view",
  "tickets.viewAll",
  "tickets.create",
  "tickets.assign",
  "tickets.work",
  "tickets.verify",
  "customers.view",
  "equipment.view",
  "items.view",
  "amc.view",
  "amc.manage",
  "quotations.manage",
  "dashboards.viewAll",
  "dashboards.viewGranted",
  "reports.view",
  "reports.schedule",
  "users.manage",
  "settings.manage",
  "erp.manage",
  "automations.manage",
  "system.monitor",
  "audit.view",
];
const ROLES = {
  ADMIN: { label: "Administrator", permissions: ALL },
  ENGINEER: {
    label: "Service engineer",
    permissions: ["tickets.view", "tickets.work", "equipment.view", "items.view"],
  },
};
const ROLE_OPTIONS = [
  { value: "ADMIN", label: "Administrator" },
  { value: "SERVICE_MANAGER", label: "Service manager" },
  { value: "ENGINEER", label: "Service engineer" },
];

const regions = [{ id: "r-central", name: "Central" }];
const users = [
  {
    id: "u-admin",
    name: "Test Admin",
    email: "admin@example.com",
    role: "ADMIN",
    roleLabel: "Administrator",
    status: "ACTIVE",
    locked: false,
    region: null,
    lastLoginAt: "2026-09-24T09:00:00.000Z",
    createdAt: "2026-09-01T09:00:00.000Z",
    version: 1,
  },
  {
    id: "u-kiran",
    name: "Kiran Shetty",
    email: "kiran@example.com",
    role: "ENGINEER",
    roleLabel: "Service engineer",
    status: "ACTIVE",
    locked: false,
    region: regions[0],
    lastLoginAt: null,
    createdAt: "2026-09-02T09:00:00.000Z",
    version: 1,
  },
];
const stepUpDone = new Set();

const PURPOSE_LABELS = {
  MASTER_SYNC: "Master data sync",
  DASHBOARDS: "Business dashboards",
  WRITEBACK: "Write-backs",
};
const erpStates = new Map();
function erpState(session) {
  if (!erpStates.has(session)) {
    erpStates.set(session, {
      connections: [],
      purposes: { MASTER_SYNC: null, DASHBOARDS: null, WRITEBACK: null },
    });
  }
  return erpStates.get(session);
}
function testResult(ok) {
  const doctypes = [
    "Customer",
    "Contact",
    "Address",
    "Serial No",
    "Item",
    "Item Price",
    "Warehouse",
    "Bin",
    "Sales Order",
    "Sales Invoice",
    "Purchase Order",
    "Work Order",
    "Delivery Note",
    "Stock Entry",
  ];
  return ok
    ? {
        ok: true,
        testedAt: new Date().toISOString(),
        rest: {
          ok: true,
          latencyMs: 120,
          user: "sb-integration@example.com",
          versions: { frappe: "15.40.1", erpnext: "15.37.0" },
        },
        access: doctypes.map((doctype) => ({ doctype, canRead: doctype !== "Item Price" })),
        readyFor: ["DASHBOARDS", "WRITEBACK"],
        setup: { missingFields: [{ doctype: "Sales Invoice", fieldname: "custom_sb_ref" }] },
      }
    : {
        ok: false,
        testedAt: new Date().toISOString(),
        rest: {
          ok: false,
          latencyMs: 80,
          error: {
            kind: "auth",
            message:
              "The API key or secret was rejected. Check them in ERPNext under the user’s API access.",
          },
        },
        access: [],
        readyFor: [],
        setup: { missingFields: null },
      };
}

const cookiesOf = (req) =>
  Object.fromEntries(
    (req.headers.cookie ?? "")
      .split(/;\s*/)
      .filter(Boolean)
      .map((c) => c.split("=")),
  );

function me(role) {
  const def = ROLES[role] ?? ROLES.ADMIN;
  const user = role === "ENGINEER" ? users[1] : users[0];
  return {
    user: { ...user, role, roleLabel: def.label, status: "ACTIVE" },
    permissions: def.permissions,
  };
}

async function body(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

function send(res, status, payload, cookies = []) {
  res.statusCode = status;
  if (cookies.length) res.setHeader("set-cookie", cookies);
  if (payload === undefined) return res.end();
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(payload));
}
const fail = (res, status, code, message, fields) =>
  send(res, status, { error: { code, message, ...(fields ? { fields } : {}) } });
const signInCookies = ["sb_access=stub; Path=/api; HttpOnly", "sb_signed_in=1; Path=/"];
const signOutCookies = [
  "sb_access=; Path=/api; Max-Age=0",
  "sb_signed_in=; Path=/; Max-Age=0",
  "stub_role=; Path=/; Max-Age=0",
];

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://stub");
  const path = url.pathname;
  const cookies = cookiesOf(req);
  const role = cookies.stub_role ?? "ADMIN";
  // Per-test identity so one test's password confirmation can't leak into another.
  const session = cookies.stub_session ?? role;

  if (path === "/api/v1/health/ready") {
    return send(res, 200, {
      status: "ok",
      checks: { database: { status: "up", latencyMs: 4 }, redis: { status: "up", latencyMs: 1 } },
    });
  }
  if (path.startsWith("/api/v1/echo"))
    return send(res, 200, { path: req.url, cookie: req.headers.cookie ?? null });

  // ── auth ──
  if (path === "/api/v1/auth/login" && req.method === "POST") {
    const { email, password } = await body(req);
    if (String(email).toLowerCase() === "admin@example.com" && password === "admin-password-1") {
      return send(res, 200, me("ADMIN"), signInCookies);
    }
    return fail(res, 401, "INVALID_CREDENTIALS", "Email or password is incorrect.");
  }
  if (path === "/api/v1/auth/refresh" && req.method === "POST") {
    // Like the real API: a failed refresh clears every auth cookie.
    if (cookies.stub_refresh_fails === "1") {
      res.statusCode = 401;
      res.setHeader("set-cookie", signOutCookies);
      res.setHeader("content-type", "application/json");
      return res.end(
        JSON.stringify({
          error: { code: "SESSION_ENDED", message: "Your session has ended. Sign in again." },
        }),
      );
    }
    return send(res, 200, me(role), signInCookies);
  }
  if (path === "/api/v1/auth/logout" && req.method === "POST")
    return send(res, 204, undefined, signOutCookies);
  if (path === "/api/v1/auth/me") {
    // Like the real API: no access cookie (expired and dropped by the browser) → UNAUTHENTICATED.
    if (!cookies.sb_access) return fail(res, 401, "UNAUTHENTICATED", "Sign in to continue.");
    if (cookies.stub_expire_once === "1") {
      res.setHeader("set-cookie", ["stub_expire_once=; Path=/; Max-Age=0"]);
      return fail(res, 401, "TOKEN_EXPIRED", "Your session needs refreshing.");
    }
    return send(res, 200, me(role));
  }
  if (path === "/api/v1/auth/confirm-password" && req.method === "POST") {
    const { password } = await body(req);
    if (password !== "admin-password-1")
      return fail(res, 401, "INVALID_CREDENTIALS", "That password is incorrect.");
    stepUpDone.add(session);
    return send(res, 204);
  }
  const link = path.match(/^\/api\/v1\/auth\/links\/([^/]+)(\/accept)?$/);
  if (link) {
    if (link[1] !== "valid-token") {
      return fail(
        res,
        410,
        "LINK_INVALID",
        "This link is invalid or has already been used. Ask an administrator for a new one.",
      );
    }
    if (!link[2]) {
      return send(res, 200, {
        type: "INVITE",
        name: "Neha Kulkarni",
        email: "neha@example.com",
        expiresAt: "2026-09-26T09:00:00.000Z",
      });
    }
    const { password } = await body(req);
    if (String(password).length < 10) {
      return fail(res, 400, "VALIDATION_FAILED", "Some fields need attention.", [
        { field: "password", message: "Use at least 10 characters." },
      ]);
    }
    return send(res, 200, me("ENGINEER"), signInCookies);
  }

  // ── everything below needs a sign-in ──
  if (!cookies.sb_signed_in) return fail(res, 401, "UNAUTHENTICATED", "Sign in to continue.");

  if (path === "/api/v1/regions") return send(res, 200, regions);
  if (path === "/api/v1/users/roles") return send(res, 200, ROLE_OPTIONS);
  if (path === "/api/v1/users" && req.method === "GET") {
    if (!ROLES[role]?.permissions.includes("users.manage"))
      return fail(res, 403, "FORBIDDEN", "You don't have access to this.");
    const search = (url.searchParams.get("search") ?? "").toLowerCase();
    const data = users.filter(
      (u) => !search || `${u.name} ${u.email}`.toLowerCase().includes(search),
    );
    return send(res, 200, { data, meta: { page: 1, pageSize: 25, total: data.length } });
  }
  if (path === "/api/v1/users/invite" && req.method === "POST") {
    const input = await body(req);
    const email = String(input.email).toLowerCase();
    if (users.some((u) => u.email === email)) {
      return fail(res, 409, "EMAIL_TAKEN", "Someone with that email already has an account.", [
        { field: "email", message: "Someone with that email already has an account." },
      ]);
    }
    const user = {
      id: `u-${users.length + 1}`,
      name: input.name,
      email,
      role: input.role,
      roleLabel: ROLE_OPTIONS.find((r) => r.value === input.role)?.label ?? input.role,
      status: "INVITED",
      locked: false,
      region: regions.find((r) => r.id === input.regionId) ?? null,
      lastLoginAt: null,
      createdAt: new Date().toISOString(),
      version: 1,
    };
    users.push(user);
    return send(res, 201, {
      user,
      invite: {
        url: "http://127.0.0.1:3100/welcome/valid-token",
        expiresAt: "2026-09-26T09:00:00.000Z",
      },
    });
  }
  const reset = path.match(/^\/api\/v1\/users\/([^/]+)\/reset-link$/);
  if (reset && req.method === "POST") {
    if (!stepUpDone.has(session))
      return fail(res, 403, "STEP_UP_REQUIRED", "Confirm your password to continue.");
    return send(res, 201, {
      url: "http://127.0.0.1:3100/reset-password/valid-token",
      expiresAt: "2026-09-24T11:00:00.000Z",
    });
  }

  // ── ERP connections (in memory, per test session) ──
  const erp = erpState(session);
  if (path === "/api/v1/erp/connections" && req.method === "GET")
    return send(res, 200, erp.connections);
  if (path === "/api/v1/erp/connections/test" && req.method === "POST") {
    const input = await body(req);
    return send(res, 200, testResult(input.apiKey === "goodkey123"));
  }
  if (path === "/api/v1/erp/connections" && req.method === "POST") {
    if (!stepUpDone.has(session))
      return fail(res, 403, "STEP_UP_REQUIRED", "Confirm your password to continue.");
    const input = await body(req);
    if (!String(input.baseUrl).startsWith("https://")) {
      return fail(res, 400, "VALIDATION_FAILED", "Some fields need attention.", [
        { field: "baseUrl", message: "Use an https:// address." },
      ]);
    }
    const connection = {
      id: `c-${erp.connections.length + 1}`,
      name: input.name,
      kind: "FRAPPE",
      baseUrl: input.baseUrl.replace(/\/+$/, ""),
      apiKeyHint: String(input.apiKey).slice(-4),
      goodKey: input.apiKey === "goodkey123",
      status: "UNTESTED",
      erpVersion: null,
      lastTestedAt: null,
      lastTestResult: null,
      canEnable: false,
      db: null,
      purposes: [],
      version: 1,
    };
    erp.connections.push(connection);
    return send(res, 201, connection);
  }
  const connAction = path.match(
    /^\/api\/v1\/erp\/connections\/([^/]+)(?:\/(test|enable|disable))?$/,
  );
  if (connAction) {
    const connection = erp.connections.find((c) => c.id === connAction[1]);
    if (!connection)
      return fail(res, 404, "CONNECTION_NOT_FOUND", "That connection no longer exists.");
    if (connAction[2] === "test") {
      connection.lastTestResult = testResult(connection.goodKey);
      connection.lastTestedAt = connection.lastTestResult.testedAt;
      connection.erpVersion = connection.goodKey ? "15.37.0" : null;
      connection.canEnable = connection.goodKey && connection.status !== "ACTIVE";
      return send(res, 200, connection);
    }
    if (connAction[2] === "enable") {
      if (!connection.canEnable)
        return fail(res, 422, "NOT_TESTED", "Run a successful test first.");
      Object.assign(connection, { status: "ACTIVE", canEnable: false });
      return send(res, 200, connection);
    }
    if (connAction[2] === "disable") {
      Object.assign(connection, { status: "DISABLED", canEnable: connection.goodKey });
      return send(res, 200, connection);
    }
    if (req.method === "DELETE") {
      if (connection.purposes.length)
        return fail(
          res,
          409,
          "CONNECTION_IN_USE",
          "This connection is used for Business dashboards. Choose another connection for it first.",
        );
      erp.connections.splice(erp.connections.indexOf(connection), 1);
      return send(res, 204);
    }
  }
  if (path === "/api/v1/erp/purposes") {
    if (req.method === "PUT") {
      const input = await body(req);
      for (const [purpose, id] of Object.entries(input)) {
        const target = erp.connections.find((c) => c.id === id);
        if (id && target?.status !== "ACTIVE")
          return fail(res, 422, "CONNECTION_NOT_ACTIVE", "That connection isn't enabled.");
        erp.purposes[purpose] = id;
      }
      for (const c of erp.connections)
        c.purposes = Object.keys(erp.purposes).filter((p) => erp.purposes[p] === c.id);
    }
    return send(res, 200, { assignments: erp.purposes, labels: PURPOSE_LABELS });
  }

  fail(res, 404, "NOT_FOUND", "Not found");
});

// Same keep-alive settings as the real API (backend/src/main.ts).
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
server.listen(port, "127.0.0.1");
