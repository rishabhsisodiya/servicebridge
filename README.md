# ServiceBridge

Service desk and ERP operations in one app: tickets, field visits, AMC contracts and quotations
for your service team, plus sales, finance and production dashboards read from ERPNext. ERP
connections are added by an administrator in the app, not in config files.

> Status: early build. Foundations only (API health, web shell placeholder).

## Requirements

- Node.js 24 (see `.nvmrc`)
- PostgreSQL 15+ and Redis 7+ — either your own, or Docker via `docker-compose.yml`

## Getting started

```bash
# 1. Infrastructure (skip if you run Postgres and Redis yourself)
npm run infra:up

# 2. API
cd backend
cp .env.example .env
#    set DATABASE_URL / REDIS_URL, then generate an encryption key:
#    APP_ENCRYPTION_KEYS=v1:$(openssl rand -base64 32)
npm install
npm run prisma:migrate        # creates the database tables
npm run dev                   # http://localhost:4000/api/v1/health/ready

# 3. Web app (new terminal)
cd frontend
cp .env.example .env.local
npm install
npm run dev                   # http://localhost:3000
```

The web app shows whether the API, database and Redis are reachable.

## Checks

```bash
npm run check          # type check, lint and tests for both apps
npm run test:e2e:web   # browser tests (first run: npx playwright install chromium)
```

## Configuration

| Variable | App | Purpose |
|---|---|---|
| `DATABASE_URL` | API | ServiceBridge's own Postgres database |
| `REDIS_URL` | API | Queues and timers |
| `APP_ENCRYPTION_KEYS` | API | Encrypts ERP and email credentials saved in the app. Keep a backup. |
| `CORS_ORIGINS` | API | Browser origins allowed to call the API directly |
| `API_INTERNAL_URL` | Web | Where the web server forwards `/api/*` requests |

ERP connections, email settings and automations are configured in the app under **Settings**.
