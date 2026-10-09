#!/usr/bin/env bash
# Boots DDS on Koyeb: writes server/.env from platform env vars, applies
# migrations (idempotent), seeds only on an empty DB, then starts services.
set -euo pipefail
cd /app

: "${MYSQL_HOST:?set MYSQL_HOST}" "${MYSQL_USER:?set MYSQL_USER}" "${MYSQL_PASSWORD:?set MYSQL_PASSWORD}" "${JWT_SECRET:?set JWT_SECRET}"

cat > server/.env <<EOF
PORT=${PORT:-8000}
CLIENT_ORIGIN=${CLIENT_ORIGIN:-*}
MYSQL_HOST=${MYSQL_HOST}
MYSQL_PORT=${MYSQL_PORT:-3306}
MYSQL_USER=${MYSQL_USER}
MYSQL_PASSWORD=${MYSQL_PASSWORD}
MYSQL_DATABASE=${MYSQL_DATABASE:-defaultdb}
MYSQL_SSL=${MYSQL_SSL:-1}
MYSQL_TIMEZONE=${MYSQL_TIMEZONE:-+02:00}
JWT_SECRET=${JWT_SECRET}
JWT_EXPIRES_HOURS=8
ANALYTICS_URL=http://127.0.0.1:8000
WHISPER_URL=http://127.0.0.1:8001/transcribe
PATHOLOGY_INFERENCE_URL=http://127.0.0.1:8002/analyze
OUTBREAK_THRESHOLD=8
OUTBREAK_WINDOW_HOURS=48
TRANSLATE_PROVIDER=gemini
TRANSLATE_MODEL=gemini-3.1-flash-lite
GEMINI_API_KEY=${GEMINI_API_KEY:-}
DISCOVERY_BEACON=0
EOF
chmod 600 server/.env
mkdir -p server/uploads

echo "[entrypoint] migrations"
pnpm --filter server migrate

# Seed only when the database has no users yet — keeps restarts idempotent.
USER_COUNT="$(cd server && node -e "
const m = require('mysql2/promise');
(async () => {
  try {
    const c = await m.createConnection({
      host: process.env.MYSQL_HOST, port: +(process.env.MYSQL_PORT || 3306),
      user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE || 'defaultdb',
      ssl: process.env.MYSQL_SSL === '1' ? { rejectUnauthorized: false } : undefined,
    });
    const [r] = await c.query('SELECT COUNT(*) AS c FROM users');
    console.log(r[0].c); await c.end();
  } catch { console.log(0) }
})()")"
if [ "$USER_COUNT" = "0" ]; then
  echo "[entrypoint] empty db — seeding demo data"
  pnpm --filter server seed || echo "[entrypoint] seed failed — continuing"
fi

if [ "${DISABLE_PYTHON:-0}" != "1" ]; then
  echo "[entrypoint] python services"
  /opt/dds-venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8000 --app-dir analytics >/var/log/analytics.log 2>&1 &
  /opt/dds-venv/bin/python -m uvicorn pathology:app --host 127.0.0.1 --port 8002 --app-dir analytics >/var/log/pathology.log 2>&1 &
fi

echo "[entrypoint] api + web on :${PORT:-8000}"
cd /app/server
exec node dist/index.js
