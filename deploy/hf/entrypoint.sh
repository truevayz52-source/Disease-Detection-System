#!/usr/bin/env bash
# Boots the full DDS stack inside a single HF Space container.
# Storage is ephemeral: MariaDB is recreated and re-seeded on every boot.
set -euo pipefail
cd /opt/dds

DB_PASS="$(openssl rand -hex 24)"
JWT_SECRET="$(openssl rand -hex 48)"

cat > server/.env <<EOF
PORT=7860
CLIENT_ORIGIN=${PUBLIC_ORIGIN:-http://localhost:5173}
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=dds
MYSQL_PASSWORD=${DB_PASS}
MYSQL_DATABASE=dds_db
MYSQL_TIMEZONE=+02:00
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

echo "[dds] starting mariadb"
mkdir -p /run/mysqld && chown mysql:mysql /run/mysqld
mysqld_safe >/var/log/mysqld.log 2>&1 &
for _ in $(seq 1 60); do
  mysqladmin ping >/dev/null 2>&1 && break
  sleep 1
done

mysql -e "CREATE DATABASE IF NOT EXISTS dds_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
          CREATE USER IF NOT EXISTS 'dds'@'localhost' IDENTIFIED BY '${DB_PASS}';
          GRANT ALL PRIVILEGES ON dds_db.* TO 'dds'@'localhost';
          FLUSH PRIVILEGES;"

echo "[dds] migrations + seed"
pnpm --filter server migrate
pnpm --filter server seed || echo "[dds] seed skipped/failed — continuing"

echo "[dds] python services"
/opt/dds-venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8000 --app-dir analytics >/var/log/analytics.log 2>&1 &
/opt/dds-venv/bin/python -m uvicorn pathology:app --host 127.0.0.1 --port 8002 --app-dir analytics >/var/log/pathology.log 2>&1 &

echo "[dds] api + web on :7860"
cd /opt/dds/server
exec node dist/index.js
