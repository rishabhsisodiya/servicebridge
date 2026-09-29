// Minimal stand-in for the ServiceBridge API so the e2e suite can exercise the
// web app (proxy, sign-in, users screen) without Postgres or Redis.
// Cookie `stub_role` picks the signed-in user's role (default ADMIN).
// Cookie `stub_expire_once=1` makes the next /auth/me answer TOKEN_EXPIRED once.
import { createServer } from "node:http";

const port = Number(process.env.STUB_API_PORT ?? 4599);

/** The Administrator role: everything except engineer and escalation membership. */
const ALL = [
  "tickets.read",
  "tickets.create",
  "tickets.edit",
  "visits.read",
  "visits.create",
  "visits.edit",
  "visits.delete",
  "customers.read",
  "equipment.read",
  "items.read",
  "rules.read",
  "rules.edit",
  "users.read",
  "users.create",
  "users.edit",
  "users.delete",
  "roles.read",
  "roles.create",
  "roles.edit",
  "roles.delete",
  "company.read",
  "company.edit",
  "erp.read",
  "erp.edit",
  "automations.read",
  "automations.edit",
  "system.read",
  "system.edit",
  "audit.read",
  "partner.read",
  "partner.edit",
  "imports.read",
  "imports.edit",
  "audit.edit",
  "tickets.assign",
  "tickets.verify",
  "demo.manage",
  "amc.read",
  "amc.edit",
  "quotations.read",
  "quotations.create",
  "quotations.edit",
  "quotations.delete",
  "writebacks.read",
  "writebacks.edit",
  "reports.read",
  "reports.schedule",
];
const ROLES = {
  ADMIN: { id: "role_admin", label: "Administrator", ticketScope: "ALL", permissions: ALL },
  ENGINEER: {
    id: "role_engineer",
    label: "Service engineer",
    ticketScope: "OWN",
    permissions: [
      "tickets.read",
      "tickets.work",
      "equipment.read",
      "items.read",
      "visits.read",
      "visits.create",
      "visits.edit",
      "visits.delete",
    ],
  },
  // A custom role that may look at users and roles but not change them.
  VIEWER: {
    id: "role_auditor",
    label: "Auditor",
    ticketScope: "ALL",
    permissions: ["tickets.read", "users.read", "roles.read"],
  },
};
const ROLE_OPTIONS = [
  { value: "role_admin", label: "Administrator" },
  { value: "role_service_manager", label: "Service manager" },
  { value: "role_engineer", label: "Service engineer" },
];

const regions = [{ id: "r-central", name: "Central" }];
const users = [
  {
    id: "u-admin",
    name: "Test Admin",
    email: "admin@example.com",
    role: { id: "role_admin", name: "Administrator" },
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
    role: { id: "role_engineer", name: "Service engineer" },
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
  WRITEBACK: "Write-backs",
};
const erpStates = new Map();
function erpState(session) {
  if (!erpStates.has(session)) {
    erpStates.set(session, {
      connections: [],
      purposes: { MASTER_SYNC: null, WRITEBACK: null },
    });
  }
  return erpStates.get(session);
}
// ── ERP write-backs (in memory, per test session) ──
const writebackStates = new Map();
function writebackState(session) {
  if (!writebackStates.has(session)) {
    writebackStates.set(session, {
      settings: {
        invoiceTriggers: ["close"],
        defaultWarehouseId: "wh-local-1",
        stockEntryAsDraft: true,
        invoiceTaxTemplate: "GST 18%",
      },
      automations: [
        {
          key: "writeback-invoice",
          name: "ERP sales invoices",
          description:
            "Raises a draft sales invoice in the ERP when a ticket is closed or verified, depending on the settings below.",
          enabled: true,
        },
        {
          key: "writeback-stock-entry",
          name: "ERP stock entries",
          description:
            "Issues consumed spares from the default warehouse in the ERP when a visit is submitted.",
          enabled: false,
        },
      ],
      warehouses: [
        {
          id: "wh-local-1",
          name: "Jaipur service store",
          erpName: "Jaipur Service Store",
          active: true,
          source: "LOCAL",
        },
        {
          id: "wh-erp-1",
          name: "Mumbai central warehouse",
          erpName: "Mumbai Central Warehouse",
          active: true,
          source: "ERP",
        },
      ],
      rows: [
        {
          id: "wb-1",
          type: "INVOICE",
          status: "FAILED",
          ticketId: "t-d1",
          ticketNumber: "SB-26-000415",
          visitId: null,
          erpDocType: "Sales Invoice",
          erpDocName: null,
          attempts: 3,
          error: "Item GST-18 not found in the ERP item master.",
          createdAt: "2026-09-28T10:15:00.000Z",
        },
        {
          id: "wb-2",
          type: "STOCK_ENTRY",
          status: "SUCCEEDED",
          ticketId: "t-d1",
          ticketNumber: "SB-26-000415",
          visitId: "v-d1",
          erpDocType: "Stock Entry",
          erpDocName: "MAT-STE-2026-00042",
          attempts: 1,
          error: null,
          createdAt: "2026-09-28T09:40:00.000Z",
        },
        {
          id: "wb-3",
          type: "INVOICE",
          status: "PROCESSING",
          ticketId: "t-d2",
          ticketNumber: "SB-26-000416",
          visitId: null,
          erpDocType: "Sales Invoice",
          erpDocName: null,
          attempts: 1,
          error: null,
          createdAt: "2026-09-28T11:02:00.000Z",
        },
      ],
    });
  }
  return writebackStates.get(session);
}
// ── roles (in memory, per test session) ──
const ROLE_CATALOG = {
  records: [
    {
      key: "tickets",
      label: "Tickets",
      ops: ["read", "create", "edit"],
      hint: "Tickets are cancelled, never deleted.",
    },
    { key: "customers", label: "Customers", ops: ["read"] },
    { key: "equipment", label: "Equipment", ops: ["read"] },
    { key: "items", label: "Spares & items", ops: ["read"] },
    { key: "rules", label: "Service rules", ops: ["read", "edit"] },
    { key: "users", label: "Users", ops: ["read", "create", "edit", "delete"] },
    { key: "roles", label: "Roles", ops: ["read", "create", "edit", "delete"] },
    { key: "company", label: "Company settings", ops: ["read", "edit"] },
    { key: "erp", label: "ERP connections", ops: ["read", "edit"] },
    { key: "automations", label: "Automations", ops: ["read", "edit"] },
    { key: "system", label: "System monitor", ops: ["read", "edit"] },
    { key: "audit", label: "Audit log", ops: ["read"] },
  ],
  actions: [
    {
      key: "tickets.assign",
      label: "Assign tickets",
      hint: "Assign engineers and change priority.",
    },
    {
      key: "tickets.work",
      label: "Work on tickets",
      hint: "Makes people with this role engineers.",
    },
    {
      key: "tickets.verify",
      label: "Verify & close",
      hint: "Check resolved tickets and close them.",
    },
    {
      key: "tickets.escalations",
      label: "Receive escalations",
      hint: "Alerts for unrouted tickets and SLA breaches.",
    },
    { key: "demo.manage", label: "Manage demo data", hint: "Load and clear demo data." },
  ],
  scopes: [
    { value: "ALL", label: "All tickets", hint: "Every ticket in every region." },
    { value: "REGION", label: "Their region", hint: "Tickets in their region, plus their own." },
    { value: "OWN", label: "Their own", hint: "Tickets assigned to them or raised by them." },
  ],
};
const roleStates = new Map();
function rolesState(session) {
  if (!roleStates.has(session)) {
    const row = (id, name, patch) => ({
      id,
      name,
      description: null,
      isLocked: false,
      isBuiltIn: true,
      ticketScope: "ALL",
      permissions: [],
      userCount: 0,
      version: 1,
      updatedAt: "2026-09-28T09:00:00.000Z",
      ...patch,
    });
    roleStates.set(session, [
      row("role_admin", "Administrator", { isLocked: true, permissions: ALL, userCount: 1 }),
      row("role_engineer", "Service engineer", {
        ticketScope: "OWN",
        permissions: ROLES.ENGINEER.permissions,
        userCount: 1,
      }),
      row("role_night_desk", "Night desk", {
        isBuiltIn: false,
        description: "Logs breakdowns after hours",
        permissions: ["tickets.read", "tickets.create", "customers.read"],
        userCount: 2,
      }),
    ]);
  }
  return roleStates.get(session);
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
        readyFor: ["WRITEBACK"],
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
    user: {
      ...user,
      role: { id: def.id, name: def.label, ticketScope: def.ticketScope },
      status: "ACTIVE",
    },
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

// ── tickets (fictional fixture, per test session) ──
const TICKET_NUMBER = "SB-26-000415";
const ticketStates = new Map();
const minutesFromNow = (m) => new Date(Date.now() + m * 60_000).toISOString();
const STAGE_ACTIONS = {
  IN_PROGRESS: ["assign", "hold", "resolve"],
  ON_HOLD: ["resume"],
  RESOLVED: ["verify", "reject"],
};
const ACTION_STAGE = {
  hold: "ON_HOLD",
  resume: "IN_PROGRESS",
  resolve: "RESOLVED",
  verify: "VERIFIED",
  reject: "IN_PROGRESS",
};
const LOOKUPS = {
  serviceTypes: [
    {
      id: "st-1",
      name: "Breakdown",
      description: "The machine has stopped or is faulty.",
      defaultPriority: "HIGH",
      requiresEquipment: true,
    },
  ],
  priorities: ["CRITICAL", "HIGH", "MEDIUM", "LOW"].map((p) => ({
    priority: p,
    label: p[0] + p.slice(1).toLowerCase(),
    description: null,
  })),
  stages: [],
  actions: {
    assign: { label: "Assign engineer", note: "optional" },
    hold: { label: "Put on hold", note: "required" },
    resume: { label: "Resume", note: "optional" },
    resolve: { label: "Mark resolved", note: "required" },
    verify: { label: "Verify fix", note: "optional" },
    reject: { label: "Send back", note: "required" },
  },
};

function ticketFor(session) {
  if (!ticketStates.has(session)) {
    ticketStates.set(session, { stage: "IN_PROGRESS", version: 3, events: [] });
  }
  const state = ticketStates.get(session);
  const created = minutesFromNow(-240);
  const running = state.stage === "IN_PROGRESS";
  const row = {
    id: "t-415",
    number: TICKET_NUMBER,
    title: "Heavy vibration, output size drifting",
    stage: state.stage,
    priority: "HIGH",
    coverage: "AMC",
    channel: "PHONE",
    isDemo: true,
    createdAt: created,
    customer: { id: "c-1", name: "Northfield Infra" },
    site: { id: "s-1", title: "Nelamangala plant", city: "Nelamangala", pincode: "562123" },
    equipment: {
      id: "m-1",
      serialNo: "CX400-2311-052",
      itemCode: "CX-400",
      itemName: "Cone Crusher CX-400",
    },
    engineer: { id: users[0].id, name: users[0].name },
    region: { id: "r-central", name: "Central" },
    sla: running
      ? { clock: "resolution", state: "risk", dueAt: minutesFromNow(125), metAt: null }
      : state.stage === "ON_HOLD"
        ? { clock: "resolution", state: "paused", dueAt: null, metAt: null }
        : {
            clock: "resolution",
            state: "met",
            dueAt: minutesFromNow(125),
            metAt: minutesFromNow(0),
          },
    version: state.version,
  };
  return {
    row,
    detail: {
      ...row,
      customer: { ...row.customer, mobile: "+91 90000 20097", email: null, territory: "Central" },
      site: { ...row.site, line1: "Plot 12, Industrial Area", state: "Karnataka" },
      equipment: { ...row.equipment, warrantyExpiresOn: null, amcExpiresOn: "2027-03-31" },
      description:
        "Heavy vibration since the morning shift; product size drifting from 20 mm to 28 mm.",
      contact: {
        id: "p-1",
        fullName: "Sanjay Gowda",
        mobile: "+91 90000 20108",
        phone: null,
        email: null,
      },
      serviceType: { id: "st-1", name: "Breakdown" },
      areaManager: { id: "u-am", name: "Anita Verghese" },
      createdBy: { id: "u-cc", name: "Ravi Prakash" },
      duplicateOf: null,
      coverageUntil: "2027-03-31",
      holdReason: state.stage === "ON_HOLD" ? (state.events.at(-1)?.note ?? null) : null,
      stageBeforeHold: state.stage === "ON_HOLD" ? "IN_PROGRESS" : null,
      reopenCount: 0,
      targets: { responseMinutes: 240, resolutionMinutes: 1440 },
      dates: {
        responseDueAt: minutesFromNow(0),
        resolutionDueAt: minutesFromNow(125),
        respondedAt: minutesFromNow(-220),
        resolvedAt: state.stage === "RESOLVED" ? minutesFromNow(0) : null,
        verifiedAt: null,
        closedAt: null,
        cancelledAt: null,
        pausedAt: state.stage === "ON_HOLD" ? minutesFromNow(0) : null,
      },
      breached: { response: false, resolution: false },
      openForCustomer: 1,
      openForMachine: 0,
      events: [
        {
          id: "e1",
          type: "CREATED",
          actor: { id: "u-cc", name: "Ravi Prakash" },
          fromStage: null,
          toStage: "NEW",
          note: null,
          data: { channel: "PHONE" },
          createdAt: created,
        },
        {
          id: "e2",
          type: "ROUTED",
          actor: null,
          fromStage: null,
          toStage: null,
          note: null,
          data: { regionName: "Central" },
          createdAt: created,
        },
        ...state.events,
      ],
      attachments: [],
      actions: STAGE_ACTIONS[state.stage] ?? [],
    },
  };
}

// ── home, engineers, notifications (per test session) ──
const SUMMARY = {
  counts: {
    open: 1,
    atRisk: 1,
    breached: 0,
    unassigned: 0,
    awaitingVerification: 0,
    onHold: 0,
    mine: 1,
    loggedToday: 1,
    closedToday: 0,
  },
  byStage: [{ stage: "IN_PROGRESS", count: 1 }],
  channels: [{ channel: "PHONE", count: 1 }],
  flow: Array.from({ length: 7 }, (_, i) => ({
    day: new Date(Date.now() - (6 - i) * 86_400_000).toISOString().slice(0, 10),
    logged: i === 6 ? 1 : 0,
    closed: 0,
  })),
  last30: { resolved: 4, avgResolutionMinutes: 410, slaMetPercent: 75 },
};
const engineerStates = new Map();
function engineersFor(session) {
  if (!engineerStates.has(session)) {
    engineerStates.set(session, [
      {
        id: "u-eng",
        name: "Neha Kulkarni",
        region: "Central",
        dutyStatus: "ON_DUTY",
        onVisit: true,
        openTickets: 2,
        skills: ["Crushers"],
        canChange: true,
      },
      {
        id: "u-eng2",
        name: "Vikas Rao",
        region: "East",
        dutyStatus: "OFF_DUTY",
        onVisit: false,
        openTickets: 0,
        skills: [],
        canChange: true,
      },
    ]);
  }
  return engineerStates.get(session);
}
const notificationStates = new Map();
function notificationsFor(session) {
  if (!notificationStates.has(session)) {
    notificationStates.set(session, [
      {
        id: "n1",
        type: "SLA_AT_RISK",
        title: "SB-26-000415: resolution time at risk",
        body: "Heavy vibration, output size drifting",
        readAt: null,
        createdAt: new Date().toISOString(),
        ticket: { id: "t-415", number: "SB-26-000415" },
      },
      {
        id: "n2",
        type: "TICKET_ASSIGNED",
        title: "Assigned to you: SB-26-000415",
        body: null,
        readAt: new Date().toISOString(),
        createdAt: new Date(Date.now() - 3_600_000).toISOString(),
        ticket: { id: "t-415", number: "SB-26-000415" },
      },
    ]);
  }
  return notificationStates.get(session);
}
const myDuty = new Map();

// ── visits (fictional fixture, per test session) ──
const visitStates = new Map();
function visitsFor(session) {
  if (!visitStates.has(session)) {
    const now = Date.now();
    const iso = (ms) => new Date(ms).toISOString();
    visitStates.set(session, [
      {
        id: "v-sub1",
        ticketId: "t-415",
        visitNumber: 1,
        status: "SUBMITTED",
        workDone:
          "Replaced the worn V-belt set and re-tensioned the drive. Vibration back within limits.",
        signatoryName: "Plant in-charge",
        hasSignature: true,
        signatureRefused: false,
        refusalReason: null,
        submittedAt: iso(now - 2 * 3_600_000),
        submittedBy: { name: "Kiran Shetty" },
        createdBy: { name: "Kiran Shetty" },
        version: 4,
        createdAt: iso(now - 5 * 3_600_000),
        updatedAt: iso(now - 2 * 3_600_000),
        spares: [
          {
            id: "vs-1",
            quantity: 2,
            item: { id: "i-belt", itemCode: "BELT-V-SET", name: "V-belt set", uom: "SET" },
          },
        ],
        photos: [
          {
            id: "vp-1",
            fileName: "nameplate.jpg",
            mimeType: "image/jpeg",
            sizeBytes: 184320,
            createdAt: iso(now - 4 * 3_600_000),
          },
        ],
      },
      {
        id: "v-d1",
        ticketId: "t-415",
        visitNumber: 2,
        status: "DRAFT",
        workDone: "",
        signatoryName: null,
        hasSignature: false,
        signatureRefused: false,
        refusalReason: null,
        submittedAt: null,
        submittedBy: null,
        createdBy: { name: "Kiran Shetty" },
        version: 1,
        createdAt: iso(now - 30 * 60_000),
        updatedAt: iso(now - 30 * 60_000),
        spares: [],
        photos: [],
      },
    ]);
  }
  return visitStates.get(session);
}
/** The list shape: lines collapse to quantities/rates, like the real API. */
const visitSummary = (v) => {
  const { spares, photos, ...rest } = v;
  return { ...rest, _count: { spares: spares.length, photos: photos.length } };
};

// ── quotations (fictional fixture, per test session) ──
const quotationStates = new Map();
const QUOTATION_GST_RATE = 18;
function quotationTotals(lines, discountPercent) {
  const subtotal = lines.reduce((sum, l) => sum + l.quantity * l.rate, 0);
  const discount = subtotal * ((discountPercent ?? 0) / 100);
  const taxable = subtotal - discount;
  const gst = taxable * (QUOTATION_GST_RATE / 100);
  const total = taxable + gst;
  const fixed = (n) => n.toFixed(2);
  return {
    currency: "INR",
    gstRatePercent: QUOTATION_GST_RATE,
    lineCount: lines.length,
    subtotal: fixed(subtotal),
    discount: fixed(discount),
    taxable: fixed(taxable),
    gst: fixed(gst),
    total: fixed(total),
  };
}
const withQuotationTotals = (q) => ({ ...q, totals: quotationTotals(q.lines, q.discountPercent) });
const quotationSummary = (q) => {
  const full = withQuotationTotals(q);
  return { ...full, lines: q.lines.map((l) => ({ quantity: l.quantity, rate: l.rate })) };
};
function quotationsFor(session) {
  if (!quotationStates.has(session)) {
    const now = Date.now();
    const iso = (ms) => new Date(ms).toISOString();
    const future = (days) => iso(now + days * 86_400_000);
    quotationStates.set(session, [
      {
        id: "q-d1",
        ticketId: "t-415",
        number: "QT-26-000101",
        status: "DRAFT",
        discountPercent: 5,
        validUntil: future(30),
        notes: "Labour included. Spares extra if the nameplate is damaged.",
        sentAt: null,
        poNumber: null,
        poDate: null,
        poReceivedAt: null,
        revisesId: null,
        version: 3,
        createdAt: iso(now - 86_400_000),
        updatedAt: iso(now - 3_600_000),
        sentBy: null,
        createdBy: { name: "Ravi Prakash" },
        revises: null,
        ticket: { id: "t-415", number: "SB-26-000415", title: "Heavy vibration, output size drifting" },
        lines: [
          {
            id: "ql-1",
            itemId: "i-belt",
            quantity: 2,
            rate: 1450,
            item: { id: "i-belt", itemCode: "BELT-V-SET", name: "V-belt set", uom: "SET" },
          },
          {
            id: "ql-2",
            itemId: "i-bearing",
            quantity: 4,
            rate: 620,
            item: { id: "i-bearing", itemCode: "BRG-6205", name: "Bearing 6205", uom: "NOS" },
          },
        ],
      },
      {
        id: "q-s1",
        ticketId: "t-415",
        number: "QT-26-000098",
        status: "SENT",
        discountPercent: null,
        validUntil: future(12),
        notes: null,
        sentAt: iso(now - 2 * 86_400_000),
        poNumber: null,
        poDate: null,
        poReceivedAt: null,
        revisesId: null,
        version: 5,
        createdAt: iso(now - 3 * 86_400_000),
        updatedAt: iso(now - 2 * 86_400_000),
        sentBy: { name: "Kiran Shetty" },
        createdBy: { name: "Ravi Prakash" },
        revises: null,
        ticket: { id: "t-415", number: "SB-26-000415", title: "Heavy vibration, output size drifting" },
        lines: [
          {
            id: "ql-3",
            itemId: "i-bearing",
            quantity: 2,
            rate: 620,
            item: { id: "i-bearing", itemCode: "BRG-6205", name: "Bearing 6205", uom: "NOS" },
          },
        ],
      },
    ]);
  }
  return quotationStates.get(session);
}

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
    // An access token that is present but expired (checked first, so the test covers that path).
    if (cookies.stub_expire_once === "1") {
      res.setHeader("set-cookie", ["stub_expire_once=; Path=/; Max-Age=0"]);
      return fail(res, 401, "TOKEN_EXPIRED", "Your session needs refreshing.");
    }
    if (!cookies.sb_access) return fail(res, 401, "UNAUTHENTICATED", "Sign in to continue.");
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

  // ── home, engineers, notifications ──
  if (path === "/api/v1/tickets/summary") return send(res, 200, SUMMARY);
  if (path === "/api/v1/engineers" && req.method === "GET")
    return send(res, 200, engineersFor(session));
  if (path === "/api/v1/engineers/me" && req.method === "GET")
    return send(res, 200, {
      dutyStatus: myDuty.get(session) ?? "ON_DUTY",
      dutyChangedAt: null,
      openTickets: 1,
      onVisit: false,
    });
  const dutyMatch = path.match(/^\/api\/v1\/engineers\/([^/]+)\/duty$/);
  if (dutyMatch && req.method === "PATCH") {
    const { dutyStatus } = await body(req);
    if (dutyMatch[1] === "me") myDuty.set(session, dutyStatus);
    else {
      const engineer = engineersFor(session).find((e) => e.id === dutyMatch[1]);
      if (engineer) engineer.dutyStatus = dutyStatus;
    }
    return send(res, 200, { id: dutyMatch[1], dutyStatus });
  }
  if (path === "/api/v1/notifications") {
    const items = notificationsFor(session);
    return send(res, 200, { items, unread: items.filter((n) => !n.readAt).length });
  }
  if (path === "/api/v1/notifications/unread-count")
    return send(res, 200, { unread: notificationsFor(session).filter((n) => !n.readAt).length });
  if (path === "/api/v1/notifications/read" && req.method === "POST") {
    const { ids } = await body(req);
    const items = notificationsFor(session);
    for (const n of items) if (!ids || ids.includes(n.id)) n.readAt ??= new Date().toISOString();
    return send(res, 200, { marked: 1, unread: items.filter((n) => !n.readAt).length });
  }

  // ── tickets ──
  if (path === "/api/v1/tickets/lookups") return send(res, 200, LOOKUPS);
  if (path === "/api/v1/tickets" && req.method === "GET") {
    const { row } = ticketFor(session);
    const open = !["CLOSED", "CANCELLED"].includes(row.stage);
    const quick = url.searchParams.get("quick") ?? "open";
    const show =
      quick === "closed" ? !open : quick === "open" || quick === "sla-risk" ? open : false;
    return send(res, 200, {
      data: show ? [row] : [],
      meta: { page: 1, pageSize: 25, total: show ? 1 : 0 },
      counts: {
        open: open ? 1 : 0,
        mine: 1,
        "sla-risk": 1,
        unassigned: 0,
        "awaiting-verification": 0,
        chargeable: 0,
        closed: 0,
      },
    });
  }
  const ticketMatch = path.match(/^\/api\/v1\/tickets\/([^/]+)(\/[a-z]+)?$/);
  if (ticketMatch && [TICKET_NUMBER, "t-415"].includes(decodeURIComponent(ticketMatch[1]))) {
    const sub = ticketMatch[2];
    if (!sub && req.method === "GET") return send(res, 200, ticketFor(session).detail);
    if (sub === "/scheduled")
      return send(res, 200, {
        available: true,
        timers: [
          { kind: "breach", clock: "resolution", runAt: minutesFromNow(125), state: "delayed" },
        ],
      });
    if (sub === "/engineers") return send(res, 200, []);
    if ((sub === "/actions" || sub === "/notes") && req.method === "POST") {
      const input = await body(req);
      const state = ticketStates.get(session) ?? (ticketFor(session), ticketStates.get(session));
      const at = new Date().toISOString();
      if (sub === "/notes") {
        state.events.push({
          id: `n${state.events.length}`,
          type: "NOTE",
          actor: { id: users[0].id, name: users[0].name },
          fromStage: null,
          toStage: null,
          note: input.note,
          data: null,
          createdAt: at,
        });
      } else {
        if (input.version !== state.version)
          return fail(
            res,
            409,
            "VERSION_CONFLICT",
            "Someone else changed this ticket. Reload to see their changes.",
          );
        const to = ACTION_STAGE[input.action];
        if (!to || !(STAGE_ACTIONS[state.stage] ?? []).includes(input.action))
          return fail(res, 409, "ACTION_NOT_ALLOWED", "That step is not possible at this stage.");
        state.events.push({
          id: `a${state.events.length}`,
          type: "STAGE_CHANGED",
          actor: { id: users[0].id, name: users[0].name },
          fromStage: state.stage,
          toStage: to,
          note: input.note ?? null,
          data: { action: input.action },
          createdAt: at,
        });
        state.stage = to;
        state.version += 1;
      }
      return send(res, 201, ticketFor(session).detail);
    }
    // Latest CSAT token for the ticket (newest first); empty when none issued.
    // The raw token-bearing link never appears here (SB-M7); staff fetch it
    // on demand from /survey-link.
    if (sub === "/feedback" && req.method === "GET")
      return send(res, 200, [
        {
          id: "fb-1",
          createdAt: "2026-09-26T09:00:00.000Z",
          usedAt: null,
          emailed: true,
          rating: null,
          comment: null,
          answeredAt: null,
        },
      ]);
    // Staff-only raw survey link (SB-M7): needs tickets.edit in the real API.
    if (sub === "/survey-link" && req.method === "GET")
      return send(res, 200, { feedbackUrl: "http://127.0.0.1:3100/feedback/csat-d1" });
  }
  if (ticketMatch && req.method === "GET")
    return fail(res, 404, "TICKET_NOT_FOUND", "That ticket doesn't exist, or you can't see it.");

  // ── visits ──
  const visitListMatch = path.match(/^\/api\/v1\/visits\/ticket\/([^/]+)$/);
  if (visitListMatch && req.method === "GET")
    return send(
      res,
      200,
      visitsFor(session)
        .filter((v) => v.ticketId === decodeURIComponent(visitListMatch[1]))
        .map(visitSummary),
    );
  if (path === "/api/v1/visits" && req.method === "POST") {
    const { ticketId } = await body(req);
    const visits = visitsFor(session);
    if (visits.some((v) => v.ticketId === ticketId && v.status === "DRAFT"))
      return fail(
        res,
        409,
        "VISIT_DRAFT_EXISTS",
        "Finish or delete the open visit before starting another.",
      );
    const now = new Date().toISOString();
    const visit = {
      id: `v-${Date.now()}`,
      ticketId,
      visitNumber: visits.length + 1,
      status: "DRAFT",
      workDone: null,
      signatoryName: null,
      hasSignature: false,
      signatureRefused: false,
      refusalReason: null,
      submittedAt: null,
      submittedBy: null,
      createdBy: { name: "Kiran Shetty" },
      version: 1,
      createdAt: now,
      updatedAt: now,
      spares: [],
      photos: [],
    };
    visits.push(visit);
    return send(res, 201, visit);
  }
  const visitMatch = path.match(/^\/api\/v1\/visits\/([^/]+)(\/submit)?$/);
  if (visitMatch) {
    const visit = visitsFor(session).find((v) => v.id === visitMatch[1]);
    if (!visit) return fail(res, 404, "VISIT_NOT_FOUND", "That visit no longer exists.");
    if (!visitMatch[2] && req.method === "GET") return send(res, 200, visit);
    if (!visitMatch[2] && req.method === "DELETE") {
      const visits = visitsFor(session);
      visits.splice(visits.indexOf(visit), 1);
      return send(res, 204);
    }
    if (visitMatch[2] && req.method === "POST") {
      if (visit.status === "SUBMITTED")
        return fail(res, 409, "VISIT_ALREADY_SUBMITTED", "This visit is already submitted.");
      if (!visit.workDone?.trim())
        return fail(
          res,
          422,
          "VISIT_NOTES_REQUIRED",
          "Write up what was done before submitting the visit.",
        );
      if (!visit.hasSignature && !visit.signatureRefused)
        return fail(
          res,
          422,
          "VISIT_SIGNATURE_REQUIRED",
          "Capture the customer signature (or record a refusal) before submitting.",
        );
      visit.status = "SUBMITTED";
      visit.submittedAt = new Date().toISOString();
      visit.submittedBy = { name: "Kiran Shetty" };
      visit.version += 1;
      return send(res, 200, visit);
    }
  }

  // ── quotations ──
  if (path === "/api/v1/quotations" && req.method === "GET") {
    const search = (url.searchParams.get("search") ?? "").toLowerCase();
    const status = url.searchParams.get("status") ?? "";
    const page = Number(url.searchParams.get("page") ?? "1");
    const pageSize = Number(url.searchParams.get("pageSize") ?? "25");
    const all = quotationsFor(session).filter(
      (q) =>
        (!status || q.status === status) && (!search || q.number.toLowerCase().includes(search)),
    );
    return send(res, 200, {
      data: all.slice((page - 1) * pageSize, page * pageSize).map(quotationSummary),
      page,
      pageSize,
      total: all.length,
    });
  }
  const quotationTicketMatch = path.match(/^\/api\/v1\/quotations\/ticket\/([^/]+)$/);
  if (quotationTicketMatch && req.method === "GET")
    return send(
      res,
      200,
      quotationsFor(session)
        .filter((q) => q.ticketId === decodeURIComponent(quotationTicketMatch[1]))
        .map(quotationSummary),
    );
  if (path === "/api/v1/quotations" && req.method === "POST") {
    const { ticketId, validUntil, discountPercent, notes } = await body(req);
    const quotations = quotationsFor(session);
    const now = new Date().toISOString();
    const quotation = {
      id: `q-${Date.now()}`,
      ticketId,
      number: `QT-26-${String(102 + quotations.length).padStart(6, "0")}`,
      status: "DRAFT",
      discountPercent: discountPercent ?? null,
      validUntil: new Date(`${validUntil}T00:00:00Z`).toISOString(),
      notes: notes?.trim() || null,
      sentAt: null,
      poNumber: null,
      poDate: null,
      poReceivedAt: null,
      revisesId: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
      sentBy: null,
      createdBy: { name: "Kiran Shetty" },
      revises: null,
      ticket: { id: ticketId, number: "SB-26-000415", title: "Heavy vibration, output size drifting" },
      lines: [],
    };
    quotations.unshift(quotation);
    return send(res, 201, withQuotationTotals(quotation));
  }
  const quotationPrintMatch = path.match(/^\/api\/v1\/quotations\/([^/]+)\/print$/);
  if (quotationPrintMatch && req.method === "GET") {
    const quotation = quotationsFor(session).find((q) => q.id === quotationPrintMatch[1]);
    if (!quotation)
      return fail(res, 404, "QUOTATION_NOT_FOUND", "That quotation no longer exists.");
    return send(res, 200, {
      company: { name: "Apex Crushing Systems (Demo)", timezone: "Asia/Kolkata", currency: "INR" },
      ticket: {
        number: "SB-26-000415",
        title: "Heavy vibration, output size drifting",
        stage: "IN_PROGRESS",
        customer: { name: "Northfield Infra", taxId: null, mobile: "+91 90000 20097", email: null },
        site: { title: "Nelamangala plant", line1: "Plot 12, Industrial Area", line2: null },
      },
      quotation: withQuotationTotals(quotation),
      generatedAt: new Date().toISOString(),
    });
  }
  const quotationActionMatch = path.match(/^\/api\/v1\/quotations\/([^/]+)\/(send|po|revise|cancel)$/);
  if (quotationActionMatch && req.method === "POST") {
    const quotations = quotationsFor(session);
    const quotation = quotations.find((q) => q.id === quotationActionMatch[1]);
    if (!quotation)
      return fail(res, 404, "QUOTATION_NOT_FOUND", "That quotation no longer exists.");
    const action = quotationActionMatch[2];
    const stamp = () => {
      quotation.version += 1;
      quotation.updatedAt = new Date().toISOString();
    };
    if (action === "send") {
      if (quotation.status !== "DRAFT")
        return fail(res, 409, "QUOTATION_NOT_DRAFT", "This quotation is already sent.");
      if (quotation.lines.length === 0)
        return fail(
          res,
          422,
          "QUOTATION_EMPTY",
          "Add at least one line before sending the quotation.",
        );
      quotation.status = "SENT";
      quotation.sentAt = new Date().toISOString();
      quotation.sentBy = { name: "Kiran Shetty" };
      stamp();
      return send(res, 200, withQuotationTotals(quotation));
    }
    const payload = await body(req);
    if (payload.version !== quotation.version)
      return fail(
        res,
        409,
        "VERSION_CONFLICT",
        "That quotation changed under you. Reload and try again.",
      );
    if (action === "po") {
      if (quotation.status !== "SENT")
        return fail(
          res,
          409,
          "QUOTATION_PO_NOT_ALLOWED",
          "A purchase order can only be recorded on a sent quotation.",
        );
      quotation.status = "PO_RECEIVED";
      quotation.poNumber = String(payload.poNumber).trim();
      quotation.poDate = payload.poDate
        ? new Date(`${payload.poDate}T00:00:00Z`).toISOString()
        : null;
      quotation.poReceivedAt = new Date().toISOString();
      stamp();
      return send(res, 200, withQuotationTotals(quotation));
    }
    if (action === "revise") {
      if (quotation.status !== "SENT" && quotation.status !== "EXPIRED")
        return fail(
          res,
          409,
          "QUOTATION_REVISE_NOT_ALLOWED",
          "Only sent or expired quotations can be revised.",
        );
      quotation.status = "REVISED";
      stamp();
      const now = new Date().toISOString();
      const next = {
        ...quotation,
        id: `q-${Date.now()}`,
        number: `QT-26-${String(102 + quotations.length).padStart(6, "0")}`,
        status: "DRAFT",
        sentAt: null,
        sentBy: null,
        poNumber: null,
        poDate: null,
        poReceivedAt: null,
        revisesId: quotation.id,
        revises: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
        lines: quotation.lines.map((l) => ({ ...l, id: `ql-${Date.now()}-${l.id}` })),
      };
      quotations.unshift(next);
      return send(res, 201, withQuotationTotals(next));
    }
    if (quotation.status !== "DRAFT" && quotation.status !== "SENT")
      return fail(res, 409, "QUOTATION_CANCEL_NOT_ALLOWED", "This quotation is already closed.");
    quotation.status = "CANCELLED";
    stamp();
    return send(res, 200, withQuotationTotals(quotation));
  }
  const quotationLineMatch = path.match(/^\/api\/v1\/quotations\/([^/]+)\/lines(?:\/([^/]+))?$/);
  if (quotationLineMatch) {
    const quotations = quotationsFor(session);
    const quotation = quotations.find((q) => q.id === quotationLineMatch[1]);
    if (!quotation)
      return fail(res, 404, "QUOTATION_NOT_FOUND", "That quotation no longer exists.");
    const stamp = () => {
      quotation.version += 1;
      quotation.updatedAt = new Date().toISOString();
    };
    if (req.method === "POST" && !quotationLineMatch[2]) {
      const payload = await body(req);
      const known = { "i-belt": ["BELT-V-SET", "V-belt set", "SET"], "i-bearing": ["BRG-6205", "Bearing 6205", "NOS"] };
      const [itemCode, name, uom] = known[payload.itemId] ?? ["ITEM", "Item", null];
      const line = {
        id: `ql-${Date.now()}`,
        itemId: payload.itemId,
        quantity: payload.quantity,
        rate: payload.rate,
        item: { id: payload.itemId, itemCode, name, uom },
      };
      quotation.lines.push(line);
      stamp();
      return send(res, 201, line);
    }
    const line = quotation.lines.find((l) => l.id === quotationLineMatch[2]);
    if (!line) return fail(res, 404, "QUOTATION_LINE_NOT_FOUND", "That line no longer exists.");
    if (req.method === "PATCH") {
      const payload = await body(req);
      if (payload.version !== quotation.version)
        return fail(
          res,
          409,
          "VERSION_CONFLICT",
          "That quotation changed under you. Reload and try again.",
        );
      line.quantity = payload.quantity;
      line.rate = payload.rate;
      stamp();
      return send(res, 200, line);
    }
    if (req.method === "DELETE") {
      quotation.lines.splice(quotation.lines.indexOf(line), 1);
      stamp();
      return send(res, 204);
    }
  }
  const quotationMatch = path.match(/^\/api\/v1\/quotations\/([^/]+)$/);
  if (quotationMatch) {
    const quotations = quotationsFor(session);
    const quotation = quotations.find((q) => q.id === quotationMatch[1]);
    if (!quotation)
      return fail(res, 404, "QUOTATION_NOT_FOUND", "That quotation no longer exists.");
    if (req.method === "GET") return send(res, 200, withQuotationTotals(quotation));
    if (req.method === "DELETE") {
      quotations.splice(quotations.indexOf(quotation), 1);
      return send(res, 204);
    }
    if (req.method === "PATCH") {
      const payload = await body(req);
      if (payload.version !== quotation.version)
        return fail(
          res,
          409,
          "VERSION_CONFLICT",
          "That quotation changed under you. Reload and try again.",
        );
      if (payload.validUntil)
        quotation.validUntil = new Date(`${payload.validUntil}T00:00:00Z`).toISOString();
      if (payload.discountPercent !== undefined) quotation.discountPercent = payload.discountPercent;
      if (payload.notes !== undefined) quotation.notes = payload.notes?.trim() || null;
      quotation.version += 1;
      quotation.updatedAt = new Date().toISOString();
      return send(res, 200, withQuotationTotals(quotation));
    }
  }

  // ── items (spares picker) ──
  if (path === "/api/v1/items" && req.method === "GET") {
    const search = (url.searchParams.get("search") ?? "").toLowerCase();
    const items = [
      {
        id: "i-belt",
        itemCode: "BELT-V-SET",
        name: "V-belt set",
        itemGroup: "Belts",
        uom: "SET",
        source: "DEMO",
        stock: [],
        totalQty: 4,
        prices: [],
      },
      {
        id: "i-bearing",
        itemCode: "BRG-6205",
        name: "Bearing 6205",
        itemGroup: "Bearings",
        uom: "NOS",
        source: "DEMO",
        stock: [],
        totalQty: 12,
        prices: [],
      },
    ].filter((i) => !search || `${i.itemCode} ${i.name}`.toLowerCase().includes(search));
    return send(res, 200, {
      data: items,
      meta: { page: 1, pageSize: 10, total: items.length },
      groups: [],
      priceLists: [],
    });
  }

  if (path === "/api/v1/regions") return send(res, 200, regions);
  if (path === "/api/v1/users/roles") return send(res, 200, ROLE_OPTIONS);
  if (path === "/api/v1/users" && req.method === "GET") {
    if (!ROLES[role]?.permissions.includes("users.read"))
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
      role: {
        id: input.roleId,
        name: ROLE_OPTIONS.find((r) => r.value === input.roleId)?.label ?? input.roleId,
      },
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
        emailed: false,
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
      emailed: false,
    });
  }

  // ── AMC (maintenance contracts) + settings/app + public CSAT ──
  const STUB_EQUIPMENT = [
    { id: "m-1", customerId: "c-1", serialNo: "CX400-2311-052", itemName: "Cone Crusher CX-400" },
    { id: "m-2", customerId: "c-1", serialNo: "JS150-2403-011", itemName: "Jaw Crusher JS-150" },
    { id: "m-3", customerId: "c-2", serialNo: "GR220-2501-004", itemName: "Grinding Mill GR-220" },
  ];
  const amcContract = {
    id: "amc-d1",
    number: "AMC-26-0001",
    customer: { id: "c-1", name: "Northfield Infra", email: null, mobile: "+91 90000 20097" },
    status: "DRAFT",
    startsOn: "2026-01-01",
    endsOn: "2026-12-31",
    billingUnit: "YEAR",
    value: "120000",
    serviceTypeId: null,
    serviceType: null,
    preferredEngineerId: null,
    preferredEngineer: null,
    notes: null,
    equipment: [
      {
        equipmentId: "m-1",
        equipment: { id: "m-1", itemName: "Cone Crusher CX-400", serialNo: "CX400-2311-052" },
      },
    ],
    plannedVisits: [
      {
        id: "pv-1",
        equipmentId: null,
        plannedOn: "2026-10-15",
        ticketId: null,
        status: "PLANNED",
      },
    ],
    version: 1,
    createdAt: "2026-09-20T10:00:00.000Z",
    updatedAt: "2026-09-20T10:00:00.000Z",
  };
  const amcRow = () => ({
    id: amcContract.id,
    number: amcContract.number,
    customer: { id: amcContract.customer.id, name: amcContract.customer.name },
    status: amcContract.status,
    startsOn: amcContract.startsOn,
    endsOn: amcContract.endsOn,
    billingUnit: amcContract.billingUnit,
    value: amcContract.value,
    equipmentCount: amcContract.equipment.length,
    plannedVisitCount: amcContract.plannedVisits.length,
    version: amcContract.version,
  });
  if (path === "/api/v1/customers" && req.method === "GET") {
    const search = (url.searchParams.get("search") ?? "").toLowerCase();
    const full = [
      {
        id: "c-1",
        name: "Northfield Infra",
        source: "LOCAL",
        erpName: null,
        customerGroup: "Industrial",
        territory: "Central",
        taxId: null,
        mobile: "+91 90000 20097",
        siteCount: 1,
        machineCount: 2,
        primaryContact: { name: "Sanjay Gowda", mobile: "+91 90000 20108" },
      },
      {
        id: "c-2",
        name: "Deccan Power Tools",
        source: "LOCAL",
        erpName: null,
        customerGroup: "Industrial",
        territory: "South",
        taxId: null,
        mobile: "+91 90000 20111",
        siteCount: 1,
        machineCount: 1,
        primaryContact: null,
      },
    ];
    const data = full.filter((c) => !search || c.name.toLowerCase().includes(search));
    return send(res, 200, {
      data,
      meta: { page: 1, pageSize: 25, total: data.length },
      territories: ["Central", "South"],
    });
  }
  if (path === "/api/v1/equipment" && req.method === "GET") {
    const customerId = url.searchParams.get("customerId");
    return send(res, 200, {
      data: STUB_EQUIPMENT.filter((m) => !customerId || m.customerId === customerId),
    });
  }
  if (path === "/api/v1/amc" && req.method === "GET") {
    if (!ROLES[role]?.permissions.includes("amc.read"))
      return fail(res, 403, "FORBIDDEN", "You don't have access to this.");
    return send(res, 200, { data: [amcRow()], page: 1, pageSize: 25, total: 1 });
  }
  if (path === "/api/v1/amc" && req.method === "POST") {
    if (!ROLES[role]?.permissions.includes("amc.edit"))
      return fail(res, 403, "FORBIDDEN", "You don't have access to this.");
    return send(res, 201, amcContract);
  }
  const amcId = path.match(/^\/api\/v1\/amc\/(amc-d1)((?:\/.*)?)$/);
  if (amcId) {
    const rest = amcId[2];
    if (rest === "" && req.method === "GET") return send(res, 200, amcContract);
    if (rest === "" && req.method === "PATCH") {
      const input = await body(req);
      if (Number(input.version) !== amcContract.version)
        return fail(res, 409, "VERSION_CONFLICT", "Someone else changed this contract.");
      Object.assign(amcContract, {
        startsOn: input.startsOn ?? amcContract.startsOn,
        endsOn: input.endsOn ?? amcContract.endsOn,
        billingUnit: input.billingUnit ?? amcContract.billingUnit,
        value: input.value === null ? null : input.value !== undefined ? String(input.value) : amcContract.value,
        notes: input.notes === null ? null : (input.notes ?? amcContract.notes),
        version: amcContract.version + 1,
      });
      return send(res, 200, amcContract);
    }
    const needsStepUp = !stepUpDone.has(session);
    if (rest === "/activate" && req.method === "POST") {
      if (needsStepUp)
        return fail(res, 403, "STEP_UP_REQUIRED", "Confirm your password to continue.");
      amcContract.status = "ACTIVE";
      amcContract.version += 1;
      return send(res, 200, amcContract);
    }
    if (rest === "/cancel" && req.method === "POST") {
      if (needsStepUp)
        return fail(res, 403, "STEP_UP_REQUIRED", "Confirm your password to continue.");
      amcContract.status = "CANCELLED";
      amcContract.version += 1;
      return send(res, 200, amcContract);
    }
    if (rest === "/equipment" && req.method === "POST") {
      const input = await body(req);
      const machine = STUB_EQUIPMENT.find((m) => m.id === input.equipmentId);
      if (!machine) return fail(res, 404, "EQUIPMENT_NOT_FOUND", "That machine no longer exists.");
      if (!amcContract.equipment.some((e) => e.equipmentId === machine.id)) {
        amcContract.equipment.push({
          equipmentId: machine.id,
          equipment: { id: machine.id, itemName: machine.itemName, serialNo: machine.serialNo },
        });
        amcContract.version += 1;
      }
      return send(res, 200, amcContract);
    }
    const removeEq = rest.match(/^\/equipment\/([^/]+)$/);
    if (removeEq && req.method === "DELETE") {
      amcContract.equipment = amcContract.equipment.filter(
        (e) => e.equipmentId !== removeEq[1],
      );
      amcContract.version += 1;
      return send(res, 200, amcContract);
    }
    if (rest === "/visits" && req.method === "POST") {
      const input = await body(req);
      amcContract.plannedVisits.push({
        id: `pv-${amcContract.plannedVisits.length + 1}`,
        equipmentId: input.equipmentId ?? null,
        plannedOn: input.plannedOn,
        ticketId: null,
        status: "PLANNED",
      });
      amcContract.version += 1;
      return send(res, 200, amcContract);
    }
    const removeVisit = rest.match(/^\/visits\/([^/]+)$/);
    if (removeVisit && req.method === "DELETE") {
      const visit = amcContract.plannedVisits.find((v) => v.id === removeVisit[1]);
      if (!visit) return fail(res, 404, "AMC_VISIT_NOT_FOUND", "That planned visit no longer exists.");
      if (visit.status !== "PLANNED")
        return fail(res, 409, "AMC_VISIT_LOCKED", "That visit already produced a ticket and can no longer be removed.");
      amcContract.plannedVisits = amcContract.plannedVisits.filter((v) => v.id !== removeVisit[1]);
      amcContract.version += 1;
      return send(res, 200, { removed: true });
    }
  }
  const appAmc = path === "/api/v1/settings/app/amc";
  if (appAmc && req.method === "GET") return send(res, 200, { pmLeadTimeDays: 3 });
  if (appAmc && req.method === "PATCH") {
    if (!stepUpDone.has(session))
      return fail(res, 403, "STEP_UP_REQUIRED", "Confirm your password to continue.");
    return send(res, 200, { pmLeadTimeDays: (await body(req)).pmLeadTimeDays ?? 3 });
  }
  const emailSettings = {
    enabled: false,
    fromName: "ServiceBridge",
    fromAddress: "service@example.com",
    host: "",
    port: 587,
    secure: false,
    username: "",
    hasPassword: false,
  };
  if (path === "/api/v1/settings/app/email" && req.method === "GET")
    return send(res, 200, emailSettings);
  if (path === "/api/v1/settings/app/email" && req.method === "PATCH") {
    if (!stepUpDone.has(session))
      return fail(res, 403, "STEP_UP_REQUIRED", "Confirm your password to continue.");
    const input = await body(req);
    Object.assign(emailSettings, input, input.password ? { hasPassword: true } : {});
    return send(res, 200, emailSettings);
  }
  if (path === "/api/v1/settings/app/email/test" && req.method === "POST") {
    if (!stepUpDone.has(session))
      return fail(res, 403, "STEP_UP_REQUIRED", "Confirm your password to continue.");
    return send(res, 200, { sent: true });
  }
  const emailTemplates = [
    {
      key: "ticket.assigned",
      name: "Ticket assigned",
      description: "Sent to the engineer when a ticket is assigned.",
      subject: "Ticket {{ticketNumber}} assigned to you",
      bodyHtml: "<p>Ticket <strong>{{ticketNumber}}</strong> is assigned to {{assigneeName}}.</p>",
      bodyText: "Ticket {{ticketNumber}} is assigned to {{assigneeName}}.",
      enabled: true,
      version: 1,
    },
    {
      key: "sla.breached",
      name: "SLA breached",
      description: "Sent when a ticket breaches its SLA.",
      subject: "SLA breached on {{ticketNumber}}",
      bodyHtml: "<p>Ticket {{ticketNumber}} breached its SLA.</p>",
      bodyText: "Ticket {{ticketNumber}} breached its SLA.",
      enabled: true,
      version: 1,
    },
    {
      key: "escalation.fired",
      name: "Escalation fired",
      description: "Sent when an escalation level fires.",
      subject: "Escalation level {{level}} for {{ticketNumber}}",
      bodyHtml: "<p>Escalation level {{level}} fired for {{ticketNumber}}: {{reason}}.</p>",
      bodyText: "Escalation level {{level}} fired for {{ticketNumber}}: {{reason}}.",
      enabled: true,
      version: 1,
    },
    {
      key: "csat.invite",
      name: "Feedback request",
      description: "Asks the customer to rate a closed ticket.",
      subject: "How was our service on {{ticketNumber}}?",
      bodyHtml: "<p>Please rate us: <a href=\"{{feedbackUrl}}\">feedback</a>.</p>",
      bodyText: "Please rate us: {{feedbackUrl}}",
      enabled: true,
      version: 1,
    },
    {
      key: "auth.invite",
      name: "User invite",
      description: "Sent to a new user with their invite link.",
      subject: "You've been invited to {{companyName}}",
      bodyHtml: "<p>Accept your invite: <a href=\"{{inviteUrl}}\">join</a>.</p>",
      bodyText: "Accept your invite: {{inviteUrl}}",
      enabled: true,
      version: 1,
    },
    {
      key: "auth.reset",
      name: "Password reset",
      description: "Sent when a user asks to reset their password.",
      subject: "Reset your password",
      bodyHtml: "<p>Reset your password: <a href=\"{{resetUrl}}\">reset</a>.</p>",
      bodyText: "Reset your password: {{resetUrl}}",
      enabled: true,
      version: 1,
    },
    {
      key: "amc.renewal",
      name: "AMC renewal reminder",
      description: "Sent before a maintenance contract expires.",
      subject: "{{contractNumber}} expires in {{daysLeft}} days",
      bodyHtml: "<p>Contract {{contractNumber}} for {{customerName}} ends on {{endsOn}}.</p>",
      bodyText: "Contract {{contractNumber}} for {{customerName}} ends on {{endsOn}}.",
      enabled: true,
      version: 1,
    },
  ];
  if (path === "/api/v1/settings/app/email/templates" && req.method === "GET")
    return send(res, 200, emailTemplates);
  const tplId = path.match(/^\/api\/v1\/settings\/app\/email\/templates\/([^/]+)$/);
  if (tplId && req.method === "PATCH") {
    const template = emailTemplates.find((t) => t.key === tplId[1]);
    if (!template) return fail(res, 404, "TEMPLATE_NOT_FOUND", "That template no longer exists.");
    const input = await body(req);
    if (Number(input.version) !== template.version)
      return fail(res, 409, "VERSION_CONFLICT", "Someone else changed this template.");
    Object.assign(template, {
      subject: input.subject ?? template.subject,
      bodyHtml: input.bodyHtml ?? template.bodyHtml,
      bodyText: input.bodyText ?? template.bodyText,
      enabled: input.enabled ?? template.enabled,
      version: template.version + 1,
    });
    return send(res, 200, template);
  }
  if (path === "/api/v1/settings/app/email/log" && req.method === "GET")
    return send(res, 200, []);
  const csatToken = path.match(/^\/api\/v1\/public\/csat\/([^/]+)$/);
  if (csatToken) {
    if (csatToken[1] === "csat-d1" && req.method === "GET")
      return send(res, 200, {
        ticketNumber: "SB-26-000415",
        ticketTitle: "Heavy vibration, output size drifting",
        customerName: "Sanjay Gowda",
        answered: false,
      });
    if (csatToken[1] === "csat-d1" && req.method === "POST") return send(res, 200, { ok: true });
    if (csatToken[1] === "csat-used" && req.method === "POST")
      return fail(res, 409, "CSAT_ALREADY_ANSWERED", "This feedback link has already been used.");
    return fail(res, 410, "CSAT_TOKEN_NOT_FOUND", "This feedback link is no longer valid.");
  }
  const automations = [
    {
      key: "escalation-l1",
      name: "Escalation level 1",
      description: "Nudges the area manager when a ticket sits too long.",
      category: "Service",
      kind: "event",
      enabled: false,
      cron: null,
      timezone: "Asia/Calcutta",
      nextRunAt: null,
      lastRun: null,
      params: {},
    },
    {
      key: "escalation-l2",
      name: "Escalation level 2",
      description: "Escalates to the chosen role when level 1 is ignored.",
      category: "Service",
      kind: "event",
      enabled: false,
      cron: null,
      timezone: "Asia/Calcutta",
      nextRunAt: null,
      lastRun: null,
      params: {},
    },
    {
      key: "escalation-l3",
      name: "Escalation level 3",
      description: "The final escalation, straight to the chosen role.",
      category: "Service",
      kind: "event",
      enabled: false,
      cron: null,
      timezone: "Asia/Calcutta",
      nextRunAt: null,
      lastRun: null,
      params: {},
    },
  ];
  if (path === "/api/v1/automations" && req.method === "GET") return send(res, 200, automations);
  const automationId = path.match(/^\/api\/v1\/automations\/([^/]+)(\/runs)?$/);
  if (automationId) {
    const automation = automations.find((a) => a.key === automationId[1]);
    if (!automation) return fail(res, 404, "AUTOMATION_NOT_FOUND", "That automation no longer exists.");
    if (automationId[2]) return send(res, 200, { data: [] });
    if (req.method === "PATCH") {
      const input = await body(req);
      if (typeof input.enabled === "boolean") automation.enabled = input.enabled;
      if (typeof input.cron === "string") automation.cron = input.cron;
      if (typeof input.timezone === "string") automation.timezone = input.timezone;
      if (input.params && typeof input.params === "object")
        automation.params = { ...automation.params, ...input.params };
      return send(res, 200, automation);
    }
  }

  // ── roles ──
  if (path.startsWith("/api/v1/roles")) {
    const roles = rolesState(session);
    const id = path.split("/")[4];
    const needsStepUp = req.method !== "GET" && !stepUpDone.has(session);
    if (needsStepUp)
      return fail(res, 403, "STEP_UP_REQUIRED", "Confirm your password to continue.");
    if (path === "/api/v1/roles/catalog") return send(res, 200, ROLE_CATALOG);
    if (!id && req.method === "GET") return send(res, 200, roles);
    if (!id && req.method === "POST") {
      const input = await body(req);
      if (roles.some((r) => r.name.toLowerCase() === String(input.name).toLowerCase())) {
        return fail(res, 409, "ROLE_NAME_TAKEN", "Another role already has that name.", [
          { field: "name", message: "Another role already has that name." },
        ]);
      }
      const role = {
        id: `role_${roles.length + 1}`,
        name: input.name,
        description: input.description,
        isLocked: false,
        isBuiltIn: false,
        ticketScope: input.ticketScope,
        permissions: input.permissions,
        userCount: 0,
        version: 1,
        updatedAt: new Date().toISOString(),
      };
      roles.push(role);
      return send(res, 201, role);
    }
    const role = roles.find((r) => r.id === id);
    if (!role) return fail(res, 404, "ROLE_NOT_FOUND", "That role no longer exists.");
    if (req.method === "GET") return send(res, 200, { ...role, users: [] });
    if (req.method === "PATCH") {
      const input = await body(req);
      Object.assign(role, {
        name: input.name,
        description: input.description,
        ticketScope: input.ticketScope,
        permissions: input.permissions,
        version: role.version + 1,
      });
      return send(res, 200, { ...role, openTicketsLeftAssigned: 0 });
    }
    if (req.method === "DELETE") {
      roles.splice(roles.indexOf(role), 1);
      return send(res, 204);
    }
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
          "This connection is used for Write-backs. Choose another connection for it first.",
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

  // ── ERP write-backs ──
  if (path === "/api/v1/erp/writebacks/overview" && req.method === "GET") {
    const erp = erpState(session);
    const wb = writebackState(session);
    const conn =
      erp.connections.find((c) => c.purposes?.includes("WRITEBACK")) ??
      erp.connections.find((c) => c.status === "ACTIVE") ??
      null;
    return send(res, 200, {
      settings: wb.settings,
      automations: wb.automations,
      connection: conn ? { id: conn.id, name: conn.name, status: conn.status } : null,
      setup: {
        ok: !!conn,
        readyForWriteback: !!conn,
        missingFields: [],
        fieldInstructions: [
          "Add the custom field ServiceBridge uses to link ERP documents back to tickets:",
          "",
          "1. In ERPNext, open “Customize Form”.",
          "2. Set DocType to “Stock Entry” and press Go.",
          "3. In the Fields table add a row: Label “SB reference”, Fieldname “custom_sb_ref”, Type “Data”.",
          "4. Save, then repeat steps 2–3 for DocType “Sales Invoice”.",
        ].join("\n"),
      },
      warehouses: wb.warehouses,
      recent: wb.rows,
    });
  }
  if (path === "/api/v1/erp/writebacks/settings" && req.method === "PATCH") {
    const wb = writebackState(session);
    Object.assign(wb.settings, await body(req));
    return send(res, 200, wb.settings);
  }
  if (path === "/api/v1/erp/writebacks/warehouses" && req.method === "POST") {
    const wb = writebackState(session);
    const input = await body(req);
    const warehouse = {
      id: `wh-local-${wb.warehouses.length + 1}`,
      name: String(input.name ?? "").trim(),
      erpName: String(input.name ?? "").trim(),
      active: true,
      source: "LOCAL",
    };
    wb.warehouses.push(warehouse);
    return send(res, 201, warehouse);
  }
  const wbWarehouse = path.match(/^\/api\/v1\/erp\/writebacks\/warehouses\/([^/]+)$/);
  if (wbWarehouse && req.method === "PATCH") {
    const wb = writebackState(session);
    const warehouse = wb.warehouses.find((w) => w.id === wbWarehouse[1]);
    if (!warehouse)
      return fail(res, 404, "WAREHOUSE_NOT_FOUND", "That warehouse no longer exists.");
    if (warehouse.source === "ERP")
      return fail(
        res,
        409,
        "WAREHOUSE_SYNCED",
        "Warehouses synced from the ERP can't be changed here.",
      );
    const input = await body(req);
    if (typeof input.name === "string" && input.name.trim())
      warehouse.name = input.name.trim();
    if (typeof input.active === "boolean") warehouse.active = input.active;
    return send(res, 200, warehouse);
  }
  const wbRetry = path.match(/^\/api\/v1\/erp\/writebacks\/([^/]+)\/retry$/);
  if (wbRetry && req.method === "POST") {
    const wb = writebackState(session);
    const row = wb.rows.find((r) => r.id === wbRetry[1]);
    if (!row)
      return fail(res, 404, "WRITEBACK_NOT_FOUND", "That write-back no longer exists.");
    row.status = "PROCESSING";
    row.attempts += 1;
    row.error = null;
    return send(res, 200, { id: row.id, status: row.status });
  }

  // Session 14: reports fixtures for the Playwright/axe sweep.
  if (path === "/api/v1/reports" && req.method === "GET") {
    return send(res, 200, [
      {
        key: "ticket-volume-ageing",
        label: "Ticket volume & ageing",
        description: "Tickets logged in the period, with age and age bucket for open ones.",
        params: [
          { key: "from", label: "From", type: "date" },
          { key: "to", label: "To", type: "date" },
          { key: "regionId", label: "Region", type: "select" },
          {
            key: "priority",
            label: "Priority",
            type: "select",
            options: [
              { value: "P1", label: "P1" },
              { value: "P2", label: "P2" },
            ],
          },
        ],
      },
      {
        key: "sla-compliance",
        label: "SLA compliance",
        description: "Response and resolution SLA outcomes for tickets closed in the period.",
        params: [
          { key: "from", label: "From", type: "date" },
          { key: "to", label: "To", type: "date" },
          { key: "regionId", label: "Region", type: "select" },
        ],
      },
      {
        key: "engineer-performance",
        label: "Engineer performance",
        description: "Workload, resolution speed and SLA outcomes per engineer for the period.",
        params: [
          { key: "from", label: "From", type: "date" },
          { key: "to", label: "To", type: "date" },
          { key: "regionId", label: "Region", type: "select" },
        ],
      },
      {
        key: "quotation-pipeline",
        label: "Quotation pipeline",
        description: "Quotations created in the period, with values and pipeline status.",
        params: [
          { key: "from", label: "From", type: "date" },
          { key: "to", label: "To", type: "date" },
        ],
      },
      {
        key: "csat-summary",
        label: "CSAT summary",
        description: "Customer satisfaction ratings received in the period.",
        params: [
          { key: "from", label: "From", type: "date" },
          { key: "to", label: "To", type: "date" },
        ],
      },
    ]);
  }
  const reportRun = path.match(/^\/api\/v1\/reports\/([^/]+)\/run$/);
  if (reportRun && req.method === "POST") {
    return send(res, 200, {
      reportKey: reportRun[1],
      label: "Ticket volume & ageing",
      columns: [
        { key: "ticket", label: "Ticket" },
        { key: "title", label: "Title" },
        { key: "customer", label: "Customer" },
      ],
      rows: [
        {
          ticket: "SB-26-000415",
          title: "Conveyor belt snapped",
          customer: "Apex Crushing Systems (Demo)",
        },
      ],
      total: 1,
      truncated: false,
      summary: {},
    });
  }
  if (path === "/api/v1/reports/kpi" && req.method === "GET") {
    return send(res, 200, {
      from: "2026-08-30",
      to: "2026-09-28",
      rows: [
        {
          regionId: "r1",
          regionName: "Jaipur",
          kpis: [
            { key: "sla-compliance", label: "SLA compliance", value: 96, target: 95, unit: "%", better: "higher", met: true },
            { key: "avg-resolution-hours", label: "Avg resolution time", value: 41, target: 48, unit: "h", better: "lower", met: true },
            { key: "reopen-rate", label: "Reopen rate", value: 3, target: 5, unit: "%", better: "lower", met: true },
            { key: "csat-average", label: "CSAT average", value: 4.6, target: 4.5, unit: "/5", better: "higher", met: true },
            { key: "backlog-change", label: "Backlog change", value: -2, target: 0, unit: "", better: "lower", met: true },
            { key: "visit-completion", label: "Visit completion", value: 100, target: 100, unit: "%", better: "higher", met: true },
          ],
        },
      ],
    });
  }
  if (path === "/api/v1/reports/kpi/targets" && req.method === "GET") {
    return send(res, 200, {
      "sla-compliance": { target: 95, regions: {} },
      "avg-resolution-hours": { target: 48, regions: {} },
      "reopen-rate": { target: 5, regions: {} },
      "csat-average": { target: 4.5, regions: {} },
      "backlog-change": { target: 0, regions: {} },
      "visit-completion": { target: 100, regions: {} },
    });
  }
  if (path === "/api/v1/report-schedules" && req.method === "GET") {
    return send(res, 200, [
      {
        id: "rs-1",
        name: "Weekly SLA digest",
        reportKey: "sla-compliance",
        params: { from: "2026-09-21", to: "2026-09-28" },
        cron: "0 9 * * 1",
        timezone: "Asia/Calcutta",
        recipients: ["u-admin"],
        active: true,
        lastRunAt: "2026-09-28T03:30:00.000Z",
        createdBy: { id: "u-admin", name: "Test Admin" },
        version: 1,
        createdAt: "2026-09-20T09:00:00.000Z",
      },
    ]);
  }
  const scheduleRuns = path.match(/^\/api\/v1\/report-schedules\/([^/]+)\/runs$/);
  if (scheduleRuns && req.method === "GET") {
    return send(res, 200, [
      {
        id: "rr-1",
        reportKey: "sla-compliance",
        trigger: "SCHEDULE",
        status: "SUCCESS",
        rowCount: 42,
        error: null,
        startedAt: "2026-09-28T03:30:00.000Z",
        finishedAt: "2026-09-28T03:30:05.000Z",
        hasFile: false,
        requestedBy: { id: "u-admin", name: "Test Admin" },
      },
    ]);
  }

  fail(res, 404, "NOT_FOUND", "Not found");
});

// Same keep-alive settings as the real API (backend/src/main.ts).
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
server.listen(port, "127.0.0.1");
