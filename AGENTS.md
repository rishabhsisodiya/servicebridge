# ServiceBridge

Field service and ERP operations platform for equipment manufacturers: a service desk (tickets,
field visits, customers, equipment, AMC contracts, quotations, SLAs), business dashboards read
from ERPNext, and an admin area where ERP connections are configured in the UI. One company per
install. Runs on seeded demo data until an ERP is connected.

## Stack

| Layer | What | Version |
|---|---|---|
| Runtime | Node.js (`.nvmrc`) | 24 (engines: >= 20.11) |
| Backend | NestJS | ^10.4 |
| Backend language | TypeScript, `strict`, `esModuleInterop: true` | ~5.6 |
| Database | PostgreSQL via Prisma | Prisma ^5.22 |
| Queues / timers | BullMQ on Redis (ioredis) | added in session 5 |
| Frontend | Next.js App Router + React | 16.3 / 19.2 |
| Styling | Tailwind CSS | v4 |
| Data fetching (web) | SWR | ^2 |
| Tests | Jest + supertest (API), Vitest + Testing Library (web), Playwright (web e2e) | |

## Commands

Run from the repo root unless noted. Each app keeps its own `package-lock.json`.

| Role | Command |
|---|---|
| Install | `npm install` in `backend/` and in `frontend/` |
| Local infra (Docker) | `npm run infra:up` (Postgres :5433, Redis :6380) |
| Run API | `npm run dev:api` (http://localhost:4000/api/v1) |
| Run web | `npm run dev:web` (http://localhost:3000) |
| Everything green? | `npm run check` (typecheck, lint, unit + API e2e for both apps) |
| Web e2e | `npm run test:e2e:web` (builds the app; uses a stub API, no infra needed) |
| One API test file | `cd backend && npx jest src/core/health` |
| One web test file | `cd frontend && npx vitest run src/lib/api` |
| Migrations | `cd backend && npm run prisma:migrate` (dev) / `npm run prisma:deploy` (prod). **Agents do not run or generate migrations; the developer does.** |
| First administrator | `cd backend && npm run admin:create -- --email you@co.com --name "Your Name"` (asks for the password; `ADMIN_PASSWORD` for automation) |
| Load / reset demo data | `cd backend && npm run demo:seed` (prints demo logins + one shared password), or Settings → Company & demo data |
| Rotate the encryption key | put the new key first in `APP_ENCRYPTION_KEYS`, then `cd backend && npm run secrets:reencrypt` |
| API integration tests | `cd backend && TEST_DATABASE_URL=… npm run test:int` (real, migrated test DB that gets EMPTIED; skipped when unset) |

## Structure

- `backend/src/core/` — cross-cutting infrastructure: `config/` (zod-validated env, `AppConfig`),
  `http/` (error envelope, validation pipe), `logging/` (pino + redaction), `prisma/`, `redis/`,
  `health/`
- `backend/src/bootstrap.ts` — global HTTP setup shared by `main.ts` and e2e tests
- `backend/src/auth/` — sign-in, sessions (rotating refresh tokens), invite/reset links, the
  global `OriginGuard` + `AuthGuard`, and `permissions.ts` (role → permission map)
- `backend/src/users/` — user management and regions
- `backend/src/core/audit/`, `core/rate-limit/`, `core/security/` — audit log, Redis rate limits,
  password hashing and token helpers
- `backend/src/erp/` — ERP connections: `adapters/` (Frappe REST client, read-only MariaDB client,
  SQL guard), `connection-tester.ts` (read-only checks), `connections/` (API + service),
  `request-log.service.ts` (every ERP call, for the System monitor)
- `backend/src/erp/sync/` — master data sync: `specs.ts` (doctype → table mapping, pure),
  `erp-sync.service.ts` (incremental by `modified`, 500 per page), `erp-webhooks.service.ts`
  (signed webhooks, setup in ERPNext, the two sync automations — both off by default)
- `backend/src/demo/` — demo company (`demo-data.ts`, fictional and deterministic), load/clear, and
  company settings (`app-settings.service.ts`). Demo rows: `source = DEMO` / `isDemo = true`; new
  demo-seeded tables must use the same marker so "Clear demo data" removes them.
- `backend/src/catalog/` — read APIs for customers, equipment and items. `coverage.ts` holds the
  coverage rule (active AMC → warranty → chargeable, dates inclusive, AMC "ending soon" = 60 days)
  both as a pure function and as a Prisma `where`. Use it; never re-derive coverage elsewhere.
- `backend/src/service-rules/` — SLA policies (coverage × priority, always 12 rows) and business
  calendars, service types, priority/stage labels, billing rates + spares price lists
  (`AppSetting "billing"`), regions (pincode-prefix routing, longest prefix wins) and skill tags.
  `business-calendar.ts` (`addBusinessMinutes`, company time zone) is the SLA clock — use it for due
  times. `defaults.ts` rows are created on API start only where a table is empty; never overwrite.
  Priorities and stages are fixed enums (`TicketPriority`, `TicketStage`); only their labels change.
- `backend/src/core/crypto/` — AES-256-GCM secret encryption with key versions
- `backend/src/core/security/network-guard.ts` — SSRF protection for admin-entered addresses
- `backend/src/core/queue/` — BullMQ queues (one per area) and workers; `QueueService.register()`
- `backend/src/automations/` — Automations: definitions + switch/schedule in `AutomationSetting`,
  run history in `JobRun`, weekly clean-up (`housekeeping.ts`)
- `backend/src/system/` — System monitor API (queues, jobs, ERP requests, connection health)
- `backend/src/cli/` — command-line tools (`create-admin.ts`, `reencrypt-secrets.ts`)
- `backend/prisma/schema.prisma` — ServiceBridge's own schema (never an ERP schema)
- `frontend/src/proxy.ts` — forwards `/api/*` to `API_INTERNAL_URL` at runtime, and redirects
  signed-out visitors to `/login` (cookie presence only; the API is the real check)
- `frontend/src/lib/auth/` — `useSession()` (`me`, `can(permission)`, `signOut`), `safeNext`
- `frontend/src/lib/api/` — typed API client (`apiFetch`, `ApiError`)
- `frontend/src/app/globals.css` — design tokens (light + dark) mapped to Tailwind colours
  (`bg-surface`, `text-muted`, `text-bad`…). Use tokens, never raw hex, in components.
- `frontend/src/components/ui/` — Button, Field/Input/Select/Textarea, StatusPill, Card, KpiCard,
  Table, Tabs, Segmented, Dialog/Drawer (native `<dialog>`), Popover, Toast, Empty/Error/Skeleton
- `frontend/src/components/shell/nav-config.ts` — single source for the sidebar, breadcrumbs,
  ⌘K search and placeholder pages. A new screen: add/adjust its entry, remove `plannedSession`.
- `frontend/src/app/(app)/[...slug]` — placeholder for menu entries not built yet; a real route
  takes precedence automatically
- `frontend/src/features/<area>/` — feature code (e.g. `tickets/display.tsx` stages, priority, SLA)
- `frontend/src/components/ui/list-controls.tsx` — `SearchInput` (debounced) + `Pager` for
  paginated lists; `features/catalog/shared.tsx` — `CoveragePill`, `SourceTag`, `money`, `formatDate`
- `frontend/src/features/service-rules/` — `/settings/service-rules?tab=…` (one tab per rule type),
  `/settings/regions`, `/settings/skills`
- `frontend/src/mocks/` — TEMPORARY sample data; delete each file when its API arrives
- `frontend/src/app/(app)/settings/design-system` — live reference of tokens, components, states
- `frontend/e2e/` — Playwright tests (incl. axe WCAG scans in both themes) and the stub API

## Conventions

- **Errors**: always `{ error: { code, message, fields?, requestId } }`. Throw `AppException(code,
  message, status, fields?)` for anything the user should act on; `code` is UPPER_SNAKE and stable.
  Unexpected errors are logged (credentials stripped) and returned as a generic 500.
- **Config**: inject `AppConfig`; never read `process.env` outside `core/config`. New env vars go
  in `env.schema.ts` and `backend/.env.example`.
- **Validation**: DTO classes with `class-validator`; the global pipe rejects unknown fields.
- **Auth (API)**: every route requires sign-in unless marked `@Public()`. Gate actions with
  `@RequirePermissions('x.y')` (add new names to `auth/permissions.ts` AND the web copy in
  `lib/auth/session.tsx`; a test fails if they drift). Sensitive actions add `@RequireRecentAuth()`
  and the web app wraps the call in `useStepUp().run(...)`. Get the caller with `@CurrentUser()`
  and request info with `@Client()`.
- **Audit**: every change calls `AuditService.record(...)`, inside the same transaction (`tx`)
  as the change. Summaries are plain English; secrets never go in.
- **ERP access**: never call an ERP directly; use `FrappeRestClient` / `FrappeDbClient` so the
  network guard, timeouts, retries (reads only) and request logging always apply. Database reads
  go through `select()`, which refuses anything but one SELECT/WITH statement.
- **Secrets**: store with `CryptoService.encrypt`; never return them from the API, log them or put
  them in audit entries. Show only a hint (e.g. last 4 characters).
- **Background work**: add it as an automation — `AutomationsService.define(definition, handler)`
  in the feature's `onModuleInit`; the handler returns a plain-English summary. Periodic ones get
  a cron schedule (synced to BullMQ from the setting); event ones are enqueued with a fixed
  `jobId` (so repeats don't duplicate) and a `delay`. Handlers must re-read the database, since
  a queued job may be stale. Never add a polling cron for per-record work.
- **Concurrency**: editable records carry a `version`; updates check it and return
  `VERSION_CONFLICT` when stale.
- **Logging**: secrets are redacted by key name (`REDACT_PATHS`); pass driver/HTTP error text
  through `stripUrlCredentials` before logging or storing it.
- **Web data**: SWR hooks, not `useEffect` + `setState`. Call the API only through `apiFetch`
  (same-origin `/api/v1`).
- **Tests**: API unit tests sit next to code as `*.spec.ts`; web unit tests as `*.test.ts(x)`.
- **Imports (API)**: normal default imports are fine (`esModuleInterop` is on).
- **UI**: every screen starts with `PageHeader` (the only `h1`; it takes focus after navigation);
  card titles are `h2` via `CardHeader`. Icons are `lucide-react` with `aria-hidden`; icon-only
  buttons use `IconButton` (label required). Status always has shape + text, never colour alone.
- **Theme**: `data-theme` on `<html>` is set before paint by `themeInitScript`; style with the
  `dark:` variant or tokens, never `prefers-color-scheme` directly.
- **New screen checklist**: add it to `BUILT_PAGES` in `frontend/e2e/shell.spec.ts` so it gets the
  axe scans (light + dark) and the 375 px no-sideways-scroll check.

## Gotchas

- **Responsive grids need a base column**: `grid md:grid-cols-2` alone sizes its single mobile
  column to the widest child (a table), breaking the page width. Always `grid grid-cols-1 md:…`.
- **Scroll containers must be `relative`**: absolutely positioned children (e.g. `sr-only` text)
  escape a non-positioned `overflow-x-auto` box and widen the page. `Table` already does this.
- **Overriding a UI control's width**: `Input`/`Select` set `w-full`; a plain `w-auto` passed in
  may lose (Tailwind 4 resolves by stylesheet order). Use the important form, e.g. `sm:w-auto!`.
- **Auth cookies are path-scoped**: `sb_access` is sent only to `/api`, `sb_refresh` only to
  `/api/v1/auth`. Playwright's `request` fixture doesn't share browser cookies.
- **IP-literal hosts skip DNS lookup**, so the guarded lookup alone doesn't cover them. Call
  `assertHostAllowed()` before connecting (the ERP clients do).
- **Two dev processes share `.next`**: running `npm run typecheck` (which runs `next typegen`)
  while `next dev` is running can leave a half-written `.next/dev/types/routes.d.ts`; restart
  `next dev` or re-save a file if type errors appear only in that file.
- **Playwright label matching**: required fields render a visual `*` inside the label, so
  `getByLabel(..., { exact: true })` fails for them; match without `exact`.
- **Keep-alive**: the API sets `keepAliveTimeout` to 65 s (`main.ts`) so the web proxy never
  reuses a socket the API just closed (ECONNRESET under load). Keep any stub API the same.

## Product rules (do not break)

1. ERP credentials are entered by an admin in the UI and stored encrypted (AES-256-GCM, keys in
   `APP_ENCRYPTION_KEYS`). They are never returned by the API or logged.
2. **ERP writes go through the Frappe REST API only.** The optional MariaDB connection is
   read-only: SELECT/WITH only, read-only session, SELECT-only DB user recommended.
3. Sales invoices created in the ERP are always drafts (`docstatus 0`), never auto-submitted.
4. Every ERP write-back and every automation has its own on/off switch; write-backs default off.
5. **No polling crons for per-record work.** SLA, escalations, AMC and quotation expiry use
   per-record BullMQ delayed jobs with fixed job IDs; workers re-check the DB before acting.
   Periodic jobs are limited to the optional nightly ERP catch-up and weekly housekeeping.
6. Do not copy code, schema, business rules, names or data from any previous client project.
   Demo data is fictional.

## Next.js

`frontend/` uses Next.js 16, which differs from older versions (e.g. `middleware.ts` is now
`proxy.ts`). Read `frontend/AGENTS.md` and the guides in `frontend/node_modules/next/dist/docs/`
before writing frontend code.
