# ServiceBridge

Service desk and ERP operations in one app: tickets, field visits, AMC contracts and quotations
for your service team, plus sales, finance and production dashboards read from ERPNext. ERP
connections are added by an administrator in the app, not in config files.

> Status: early build. Sign-in, users, roles and ERP connections are real; ticket screens still use sample data.

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
#    set DATABASE_URL / REDIS_URL, then generate the two secrets:
#    APP_ENCRYPTION_KEYS=v1:$(openssl rand -base64 32)
#    JWT_SECRET=$(openssl rand -base64 48)
npm install
npm run prisma:migrate        # creates the database tables
npm run admin:create -- --email you@company.com --name "Your Name"   # first administrator
npm run dev                   # http://localhost:4000/api/v1/health/ready

# 3. Web app (new terminal)
cd frontend
cp .env.example .env.local
npm install
npm run dev                   # http://localhost:3000
```

Sign in at http://localhost:3000 with the administrator you created, then invite your team
under **Settings → Users & roles**. Until email is set up, each invite gives you a one-time link
to send yourself.

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
| `JWT_SECRET` | API | Signs sign-in tokens. Changing it signs everyone out. |
| `APP_URL` | API | Web address used in invite links; `https://` makes cookies Secure |
| `ALLOW_PRIVATE_ERP_HOSTS` | API | `true` only when your ERPNext runs on your own network (default `false`) |
| `CORS_ORIGINS` | API | Browser origins allowed to call the API directly |
| `API_INTERNAL_URL` | Web | Where the web server forwards `/api/*` requests |

ERP connections, email settings and automations are configured in the app under **Settings**.
