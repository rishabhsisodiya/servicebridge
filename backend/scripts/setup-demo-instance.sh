#!/bin/sh
# One-off: builds a demo-only database (no ERP-synced data) for recording product videos,
# and fixes the product name in the three stored email templates of the main database.
# Run from anywhere:  sh backend/scripts/setup-demo-instance.sh
set -e
cd "$(dirname "$0")/.."

set -a
. ./.env
set +a

MAIN_URL="$DATABASE_URL"
DEMO_DB="erptick_demo"
DEMO_URL="${MAIN_URL%/*}/$DEMO_DB"

echo "1/5  Updating the product name in stored email templates (main database)…"
psql "$MAIN_URL" -v ON_ERROR_STOP=1 -c "
  update \"EmailTemplate\"
     set subject    = replace(subject,    'ServiceBridge', 'ERPTick'),
         \"bodyHtml\" = replace(\"bodyHtml\", 'ServiceBridge', 'ERPTick'),
         \"bodyText\" = replace(\"bodyText\", 'ServiceBridge', 'ERPTick'),
         version    = version + 1,
         \"updatedAt\" = now()
   where subject like '%ServiceBridge%'
      or \"bodyHtml\" like '%ServiceBridge%'
      or \"bodyText\" like '%ServiceBridge%';"

echo "2/5  Creating the $DEMO_DB database…"
psql "$MAIN_URL" -v ON_ERROR_STOP=1 -c "create database $DEMO_DB"

export DATABASE_URL="$DEMO_URL"
# Separate Redis database so demo timers never mix with the main app's queues.
export REDIS_URL="${REDIS_URL%/}/1"

echo "3/5  Creating tables…"
npx prisma migrate deploy

echo "4/5  Creating the demo administrator…"
ADMIN_PASSWORD="crusher-gravel-4471" npm run admin:create -- --email admin@apex-demo.example --name "Priya Nair"

echo "5/5  Loading the fictional demo company…"
echo "     When the demo logins and password are printed, copy them; if the command"
echo "     does not return after that, press Ctrl+C (the data is already saved)."
npm run demo:seed
