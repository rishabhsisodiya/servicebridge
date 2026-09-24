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

## Structure

- `backend/src/core/` — cross-cutting infrastructure: `config/` (zod-validated env, `AppConfig`),
  `http/` (error envelope, validation pipe), `logging/` (pino + redaction), `prisma/`, `redis/`,
  `health/`
- `backend/src/bootstrap.ts` — global HTTP setup shared by `main.ts` and e2e tests
- `backend/prisma/schema.prisma` — ServiceBridge's own schema (never an ERP schema)
- `frontend/src/proxy.ts` — forwards `/api/*` to `API_INTERNAL_URL` at runtime
- `frontend/src/lib/api/` — typed API client (`apiFetch`, `ApiError`)
- `frontend/e2e/` — Playwright tests and the stub API they run against

## Conventions

- **Errors**: always `{ error: { code, message, fields?, requestId } }`. Throw `AppException(code,
  message, status, fields?)` for anything the user should act on; `code` is UPPER_SNAKE and stable.
  Unexpected errors are logged (credentials stripped) and returned as a generic 500.
- **Config**: inject `AppConfig`; never read `process.env` outside `core/config`. New env vars go
  in `env.schema.ts` and `backend/.env.example`.
- **Validation**: DTO classes with `class-validator`; the global pipe rejects unknown fields.
- **Logging**: secrets are redacted by key name (`REDACT_PATHS`); pass driver/HTTP error text
  through `stripUrlCredentials` before logging or storing it.
- **Web data**: SWR hooks, not `useEffect` + `setState`. Call the API only through `apiFetch`
  (same-origin `/api/v1`).
- **Tests**: API unit tests sit next to code as `*.spec.ts`; web unit tests as `*.test.ts(x)`.
- **Imports (API)**: normal default imports are fine (`esModuleInterop` is on).

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
