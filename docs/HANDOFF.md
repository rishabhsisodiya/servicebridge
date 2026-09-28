# ServiceBridge — handoff for the next agent

Last updated 2026-09-28, after commit `142eb08` (custom roles, session B). Read this first, then
[`AGENTS.md`](../AGENTS.md) for stack, commands, code structure, conventions and gotchas. This file
covers what AGENTS.md doesn't: how to work with the developer, why things are the way they are,
what is built, and the plan for everything that is left.

---

## 1. How to work on this project (non-negotiable)

The developer (Rishabh) set these rules. Breaking them costs trust.

1. **Four phases per feature, one at a time, with explicit approval between each:**
   1. *Analyze* (no code): explain the feature, user flow and admin flow in plain English, list
      missing requirements, ask clarifying questions.
   2. *Review existing code* (no code): what can be reused or extended, where logic would be
      duplicated, which checks/tables/screens are affected.
   3. *Design* (no code): business rules, database design, API design (endpoint, method, request,
      response, validation, errors), service layer, edge cases, validation, security, performance.
   4. *Build*: split into sessions of about one working session each (objective, scope, files,
      expected result). Build **one** session, report, and wait for "yes" before the next.
2. **Never assume a business rule.** Ask, offer a recommendation, and mark it as a recommendation.
3. **The developer runs the database, migrations and git.** Agents do not run `psql`, any
   `prisma migrate …` command, or `git add`/`git commit` (permission hooks block them anyway). You
   may run `prisma format`, `prisma validate` and `prisma generate`.
   - After a schema change, tell them: *"run `npm run migrate`, then restart the API"*. It never
     prompts for a name (it uses `--name schema_update`).
   - If a migration needs data clean-up (removing an enum value, moving data), hand-write the SQL
     in the migration folder *before* they run it. Never edit a migration that has already been
     applied or has failed. If Prisma offers to reset the database, the answer is always **N**.
   - End each session with a suggested commit command.
4. **UI work:** load the `design-orchestrator` skill first (it routes to `ui-ux-pro-max` as primary
   and `apple-design` as auditor). Follow the existing design system in `frontend/src/components/ui`.
5. **Finish every session green:** backend `npx tsc --noEmit`, `npx eslint src`, `npx jest`;
   frontend `npx tsc --noEmit`, `npx eslint src e2e`, `npx vitest run`, `npm run test:e2e`
   (stub API, no infra needed). Report the counts. Current baseline: **backend 249 tests, frontend
   67 unit, e2e 74**. Add new pages to `BUILT_PAGES` in `frontend/e2e/shell.spec.ts` (runs axe
   in light and dark).
6. **Communication:** concise, plain English, trade-offs stated, assumptions separated from
   confirmed decisions. Update this file and AGENTS.md when something significant changes.
7. **No client code.** ServiceBridge was inspired by an earlier client project (Proman Edge,
   handed over to the client). Never copy its code, schema, business rules, names or data, and no
   client names or `*.frappe.cloud` URLs. Demo data is fictional ("Apex Crushing Systems (Demo)").

---

## 2. What ServiceBridge is

A **field service and ERP operations platform** for equipment manufacturers. The service desk
covers tickets, field visits, customers, equipment, AMC (annual maintenance) contracts, quotations
and SLAs. Master data comes from **ERPNext**, and admins configure ERP connections in the UI.

- **One company per install** (not multi-tenant).
- **Demo mode:** runs fully on seeded fictional data until an ERP is connected.
- **Goal:** every module in the plan below, then a final design pass, then it is demo-ready and
  deployable.

### Confirmed product decisions (keep them)

| Area | Decision |
|---|---|
| ERP connections | Admin adds them in the UI: ERPNext REST (API key/secret) plus an optional read-only MariaDB connection. Secrets are AES-256-GCM encrypted; only the master key lives in env. The DB connection is SELECT-only, enforced three ways. |
| ERP purposes | `MASTER_SYNC` and `WRITEBACK`, one connection each. |
| ERP writes | **REST only**, never through the DB connection. Sales invoices are always **drafts** (`docstatus 0`), never submitted automatically. |
| Master data | Read-only in ServiceBridge while an ERP is connected ("for now"). |
| Switches | Every write-back and every automation has its own on/off switch. Write-backs are **off by default**; ERP sync stays off until a connection exists. |
| Jobs | **No polling crons for per-record work.** Use per-record BullMQ delayed jobs with fixed job IDs; workers reload from the DB and do nothing if the record changed. Timers are rebuilt once on startup. Only two periodic jobs: the optional nightly ERP catch-up and weekly housekeeping. |
| Master sync | Signed ERPNext webhooks (HMAC-SHA256), with the nightly catch-up as a safety net. Built, **off by default**; the developer switches it on. |
| Visibility | A native **System monitor** (queues, ERP requests, webhooks, connections), not Bull Board, plus a **Scheduled actions** panel on each ticket. |
| Sensitive actions | A password re-check (`@RequireRecentAuth` + `useStepUp`) before changing credentials, switching on write-backs, managing roles, demo load/clear and reset links. |
| Email | SMTP settings in the admin UI, encrypted like ERP secrets (session 12). |
| Files | Local disk now (`core/storage`), S3-compatible later. |
| Business dashboards | **Removed from scope** (2026-09-25). The old session 13 is dropped, as are the Department head role and the `DASHBOARDS` ERP purpose. |
| Roles | **Custom roles** (ERPNext-style), built 2026-09-28. **Never check role names in code; gate by permission.** See AGENTS.md "Custom roles". |
| Design | Data-dense; slate `#334155` and emerald `#059669`; Fira Sans and Fira Code; light and dark. |

---

## 3. What is built (all committed)

| Session | Delivered | Commit |
|---|---|---|
| 1 | Foundations: config validation, error envelope, log redaction, health checks, web proxy, test tooling | `6ea6cba` |
| 2 | Design system and app shell: tokens, UI components, sidebar, ⌘K search, theming, placeholder screens | `7b9da8f` |
| 3 | Auth: httpOnly cookie sessions with rotating refresh tokens, argon2id, lockout, invite and reset links (copyable until email exists), audit log, CLI to create the first admin | (in history) |
| 4 | Encryption with key versions and a re-encrypt CLI, SSRF guard, ERP connections screen with read-only tests | `d33f3c8` |
| 5a | BullMQ queues, Automations screen (switches, run now, history), System monitor | `8006ab9` |
| 5b | ERP master-data sync (customers, contacts, sites, serial numbers as equipment, items, prices, warehouses, stock), signed webhooks, catch-up automation (all off by default) | `83fdb35` |
| 6 | Demo company load/clear (typed confirmation), company settings, demo banner | `8249b93` |
| 7 | Customers, equipment and items screens with coverage; service rules: SLA policies, business calendars, service types, priorities, stage labels, billing rates and price lists, regions (pincode prefixes, area manager), skill tags | `4603174`, `0283e1f` |
| 8 | Tickets: workflow, coverage, SLA clocks with pause and per-ticket BullMQ timers, routing, duplicate check, attachments, yearly numbers (`SB-26-000123`), demo tickets; list, log-a-ticket and detail screens | `ad043e1`, `6f79729` |
| 9 | Engineer availability (duty status plus derived "On visit"), in-app notifications (bell), auto-assign automation (off by default), home page per permission, My tickets | `054f34e`, `caf1cc3` |
| Roles A | `Role` table replacing the enum, permission catalog, roles API, permission-based checks, anti-escalation, hand-written migration `20260928090000_custom_roles` | `880998f` |
| Roles B | Roles screen with permission grid; write buttons hidden without the matching `.edit`/`.create`/`.delete` permission | `142eb08` |

### Ticket workflow (as built)

Stages: `NEW → TRIAGED → ASSIGNED → ACCEPTED → ON_SITE → IN_PROGRESS → RESOLVED → VERIFIED → CLOSED`,
plus `ON_HOLD` and `CANCELLED`. Actions are in `backend/src/tickets/workflow.ts`: triage, assign,
accept, decline, arrive, start, hold, resume, resolve, verify, reject (send back), close, cancel,
reopen.

- Coverage comes from the machine: an active AMC gives AMC, a warranty in the future gives
  WARRANTY, otherwise CHARGEABLE. AMC contracts don't exist yet (session 12).
- SLA targets are coverage × priority on a business calendar. Risk is flagged in the last 25% of
  the target; timers use job IDs `sla-{ticketId}-risk` and `sla-{ticketId}-breach`.

### Permissions (as built)

- Record permissions are `<record>.<read|create|edit|delete>`, plus actions `tickets.assign`,
  `tickets.work` (makes someone an engineer), `tickets.verify`, `tickets.escalations` and
  `demo.manage`.
- Each role has a ticket scope: ALL, REGION or OWN.
- Placeholder keys already exist for later sessions: `amc.read`, `amc.edit`, `quotations.edit`,
  `reports.read`, `reports.schedule`. Each later session turns its keys into real grid rows or
  actions and grants them to the built-in roles through a migration (see AGENTS.md).

---

## 4. What's next

Every item below still goes through all four phases. The notes are the **original approved design
(2026-09-24)**, adjusted for what changed since. Treat them as the starting point for Phase 1, not
as final specs, and confirm open questions with the developer.

### Session 10 — Field visits and quotations ← next

- **Visits:** a ticket can have several visits.
  - A visit records work done, spares used (`VisitSpare`: item, quantity > 0), photos and a
    **customer signature** (pad). A visit can't be submitted without the signature.
  - **Submitting locks the visit.** Idempotent: submitting twice returns `409`.
  - Submitting later triggers the stock-issue write-back (session 11), so emit a `VisitSubmitted`
    event.
  - Decide with the developer how visits relate to the stages `ON_SITE`/`IN_PROGRESS` and to the
    derived "On visit" availability, and whether stock is fetched on demand (the design says yes,
    cached for 5 minutes).
- **Quotations:** for chargeable work.
  - `Quotation` and `QuotationLine`: quantity > 0, rate ≥ 0, valid-until date in the future.
  - GST totals use the company GST rate; the price list comes from the billing settings.
  - Actions: **send**, then **record the customer PO**.
  - A setting "require a PO before work starts" exists and is **off by default**.
  - Quotation expiry is a per-record timer (it may be built here or in session 12): mark the
    quotation expired and tell customer support; cancelled when a PO is recorded or the quote is
    revised.
- **Planned endpoints:**
  - `/visits`, `POST /visits/:id/submit`
  - `/quotations`, `POST /quotations/:id/send`, `POST /quotations/:id/po`
- **Permissions:** add `visits.*` rows and make `quotations.*` real; the engineer role needs the
  visit permissions.
- **Screens:** a visit form for engineers (phone-first), a quotations list and editor for customer
  support, and both on the ticket page.
- **Result:** an engineer can complete a visit, and customer support can quote chargeable work.

### Session 11 — ERP write-backs (both off by default)

| Write-back | Trigger | Settings |
|---|---|---|
| Stock issue | A visit with spares is submitted | Company, source warehouse, whether to submit the Stock Entry |
| Draft sales invoice | A chargeable ticket is closed | Company, price list, tax template; **always draft** |

- **Tables:** `WritebackSetting`, and `WritebackRecord` (status PENDING / RUNNING / SUCCESS /
  FAILED / DISCARDED, attempts, **unique `idempotencyKey`** such as `stock-issue:visit:<id>`).
- **Duplicate protection:** before creating, the worker searches the ERP for a document with
  `custom_sb_ref = key`. BullMQ retries 5 times with backoff, then marks the record FAILED and
  notifies the admin. When a connection recovers, its pending write-backs are queued once.
- **Switching on** needs an ACTIVE `WRITEBACK` connection, a passing **setup check** (custom
  fields `Stock Entry.custom_sb_ref` and `Sales Invoice.custom_sb_ref` exist; they can be created
  over REST if permitted) and a password re-check.
- **Endpoints:**
  - `GET /erp/writebacks/settings`, `PATCH /erp/writebacks/settings/:type`
  - `GET /erp/writebacks`, `POST /erp/writebacks/:id/retry`, `POST /erp/writebacks/:id/discard`
- **Needs a real ERPNext site to test.** The developer's test ERP is fine for this.

### Session 12 — AMC contracts, customer feedback, email

- **AMC:**
  - `AmcContract` and `AmcContractEquipment` feed coverage.
  - Per-record timers create preventive-maintenance tickets ahead of each planned visit, and send
    renewal alerts 60, 30 and 7 days before the contract ends.
  - Make the `amc.*` permissions real (the AMC screen is currently a placeholder).
- **Feedback:**
  - On closure the customer gets a single-use link that expires after 7 days. The token is stored
    as a hash, and expiry is checked when the link is opened (no job).
  - Public page `GET/POST /public/csat/:token`; tables `CsatToken`, `CsatResponse`.
- **Email:**
  - SMTP settings in the admin UI, encrypted, with a password re-check.
  - Notification templates, a delivery log, and push-token registration.
  - Email reuses the existing notification events (`tickets/ticket-notifier.ts`).
  - Invite and reset links start being emailed instead of copied.
- **Escalation timers** from the design, not built yet:
  - Unassigned after X minutes.
  - Not accepted after X minutes.
  - On hold longer than N hours.
  - Each is a switchable automation with its own settings.

### Session 13 — dropped (business dashboards removed from scope)

### Session 14 — Reports, KPI matrix, scheduled reports

- A report catalog and runner with CSV export, and a KPI matrix (service KPIs against targets, by
  region).
- Scheduled report delivery: one BullMQ repeatable job per schedule, existing only while that
  schedule is active. Tables `ReportSchedule` and `ReportRun`.
- Make `reports.read` and `reports.schedule` real. The optional read-only ERP DB connection may be
  used for heavy reports.
- Placeholder routes already exist: `/reports`, `/reports/kpi`, `/reports/schedules`.

### Session 15 — Partner API, bulk import, audit screen, hardening

- **Partner API:** `PartnerApiKey` (stored as hash plus prefix, shown once) and
  `POST /partner/v1/tickets`. Settings has a "Partner API keys" placeholder.
- **Bulk import:** CSV import of customers and machines with a validation preview.
- **Audit log screen:** `audit.read` already exists; `/settings/audit-log` is a placeholder.
- **Hardening:** helmet, CORS allowlist and security headers; a security review; e2e tests for the
  main flows; a production docker-compose and deployment docs.
- **Result:** demo-ready and deployable.

### Final — UI review

The developer postponed design fixes until everything is built. Then rerun the review
(`design-orchestrator`, then `ui-ux-pro-max` as primary and `apple-design` as audit) starting from
these parked findings:

- **High:**
  - Control borders (`--line-strong`) are only 1.5:1 contrast. Add `--control-border` (light
    `#7c8ba0`, dark `#5b6d93`) for inputs, secondary buttons and filter chips.
  - Drawers lose unsaved edits on Escape or a backdrop click. Add a `dirty` prop and a "Discard
    changes?" confirmation.
- **Medium:**
  - Ticket detail overloads amber and blue; make the chargeable coverage callout neutral.
  - The ticket action bar wraps to 3 rows on phones; show the primary action plus one, with the
    rest in "More".
  - The stage stepper (min-width 720px) scrolls on phones; use a compact summary below `sm`.
  - The Scheduled panel uses jargon ("job queue") and is shown to engineers; limit it to managers
    and `system.read`, and reword it.
- **Low:**
  - The customer picker's visible label isn't linked to the field.
  - The SLA grid's pencil only shows on hover.
  - A "System name" column appears on the label tabs.
  - There are two entry points for Reassign.
  - Removing a file has no undo.
- **Also:** the Roles screen (session B) was built without the design skills, which weren't
  available then.

### Known loose ends

- `/settings/service-rules` and a few other pages have no stub endpoints in `frontend/e2e/stub-api.mjs`,
  so the accessibility tests run against their error states. Add stubs when those screens change.
- Customers, equipment and items grid rows only have **Read**. Create, edit and delete arrive when
  there are screens to edit master data locally (no-ERP mode); ask before adding them.
- Audit entries for user role changes store role **ids**, not names.
- The e2e web server sometimes logs `NoFallbackError`. No test fails; not investigated yet.

---

## 5. Where else context lives

- [`AGENTS.md`](../AGENTS.md): stack, commands, structure, conventions, gotchas, product rules,
  custom roles.
- `README.md`: setup and configuration.
- Git history: one commit per session, with descriptive messages.
- The original full design (2026-09-24) is summarised in section 4 above; nothing else needs to
  be read from past chats.
