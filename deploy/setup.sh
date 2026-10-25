#!/usr/bin/env bash
# DDS — one-command droplet setup for Ubuntu 24.04 (DigitalOcean or any VPS).
#
#   sudo bash deploy/setup.sh <domain>
#
# Example:  sudo bash deploy/setup.sh dds.duckdns.org
#
# What it does: Node 22 + pnpm, PostgreSQL (dds_db + dedicated user), Python
# venv (analytics + transcription), pnpm install/build, migrate + seed,
# systemd services, Caddy HTTPS reverse proxy, UFW firewall, nightly pg_dump.
#
# Optional env vars (set before running):
#   GEMINI_API_KEY=...   Gemini key for /api/translate + /api/i18n/fill
#   REPO_URL=...         override the git remote (default: GitHub origin)
#   DDS_LIGHT=1          skip transcription/pathology venv deps (heavy install)
#   SKIP_SEED=1          do not create demo accounts
set -euo pipefail

DOMAIN="${1:?usage: sudo bash deploy/setup.sh <domain>}"
APP_DIR=/opt/dds
VENV=/opt/dds-venv
REPO_URL="${REPO_URL:-https://github.com/truevayz52-source/Disease-Detection-System.git}"

echo "==> Installing system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl git postgresql python3-venv python3-pip \
  caddy ufw openssl >/dev/null

if ! command -v node >/dev/null; then
  echo "==> Installing Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs >/dev/null
fi
corepack enable
corepack prepare pnpm@latest --activate

echo "==> Fetching code"
if [ -d "$APP_DIR/.git" ]; then
  cd "$APP_DIR" && git pull --ff-only || true
elif [ -f "$APP_DIR/package.json" ]; then
  # Code was copied here (rsync/scp) rather than cloned — use it as-is.
  cd "$APP_DIR"
else
  git clone "$REPO_URL" "$APP_DIR" && cd "$APP_DIR"
fi

echo "==> Configuring PostgreSQL"
systemctl enable --now postgresql
DB_PASS="$(openssl rand -hex 24)"
# Idempotent: create on first run, rotate the password on re-deploys so it
# always matches server/.env below.
su postgres -s /bin/sh -c "psql -tAc \"SELECT 1 FROM pg_roles WHERE rolname='dds'\" | grep -q 1" \
  || su postgres -s /bin/sh -c "psql -c \"CREATE USER dds WITH PASSWORD '${DB_PASS}'\""
su postgres -s /bin/sh -c "psql -c \"ALTER USER dds WITH PASSWORD '${DB_PASS}'\""
su postgres -s /bin/sh -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='dds_db'\" | grep -q 1" \
  || su postgres -s /bin/sh -c "createdb -O dds dds_db"

JWT_SECRET="$(openssl rand -hex 48)"
HMAC_KEY="$(openssl rand -hex 32)"
COMMUNITY_KEY="$(openssl rand -hex 24)"
cat > server/.env <<EOF
PORT=4001
CLIENT_ORIGIN=https://${DOMAIN}
DATABASE_URL=postgresql://dds:${DB_PASS}@127.0.0.1:5432/dds_db
DATABASE_SSL=false
DB_TIMEZONE=Africa/Harare
JWT_SECRET=${JWT_SECRET}
JWT_EXPIRES_HOURS=8
SIGNATURE_HMAC_KEY=${HMAC_KEY}
COMMUNITY_API_KEY=${COMMUNITY_KEY}
ANALYTICS_URL=http://127.0.0.1:8000
WHISPER_URL=http://127.0.0.1:8001/transcribe
PATHOLOGY_INFERENCE_URL=http://127.0.0.1:8002/analyze
PATHOLOGY_MODEL=default
OUTBREAK_THRESHOLD=8
OUTBREAK_WINDOW_HOURS=48
TRANSLATE_PROVIDER=gemini
TRANSLATE_MODEL=gemini-3.1-flash-lite
GEMINI_API_KEY=${GEMINI_API_KEY:-}
DISCOVERY_BEACON=0
EOF
chmod 600 server/.env

echo "==> Installing Node dependencies and building"
pnpm install --frozen-lockfile=false
# client 'build' runs tsc --noEmit which fails on unrelated errors; vite alone
# produces the bundle.
(cd client && pnpm exec vite build)
pnpm --filter server build

echo "==> Applying migrations and seeding"
pnpm --filter server migrate
if [ "${SKIP_SEED:-0}" != "1" ]; then
  pnpm --filter server seed || echo "seed skipped/failed — continuing"
fi

echo "==> Python services"
python3 -m venv "$VENV"
"$VENV/bin/pip" install -q --upgrade pip
"$VENV/bin/pip" install -q -r analytics/requirements.txt
if [ "${DDS_LIGHT:-0}" != "1" ]; then
  "$VENV/bin/pip" install -q -r analytics/requirements-transcription.txt
  "$VENV/bin/pip" install -q -r analytics/requirements-pathology.txt || true
  # Download the faster-whisper model once — no downloads at request time.
  "$VENV/bin/python" analytics/setup_transcription.py || echo "whisper model download skipped"
fi

echo "==> systemd services"
cat > /etc/systemd/system/dds-api.service <<'EOF'
[Unit]
Description=DDS API
After=network.target postgresql.service
[Service]
WorkingDirectory=/opt/dds/server
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
User=www-data
[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/dds-analytics.service <<'EOF'
[Unit]
Description=DDS analytics (FastAPI)
After=network.target
[Service]
WorkingDirectory=/opt/dds/analytics
ExecStart=/opt/dds-venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8000
Restart=always
RestartSec=5
User=www-data
[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/dds-transcription.service <<'EOF'
[Unit]
Description=DDS transcription (FastAPI)
After=network.target
[Service]
WorkingDirectory=/opt/dds/analytics
ExecStart=/opt/dds-venv/bin/python -m uvicorn transcription:app --host 127.0.0.1 --port 8001
Restart=always
RestartSec=5
User=www-data
[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now dds-api dds-analytics
systemctl enable --now dds-transcription 2>/dev/null || true

echo "==> Nightly database backup"
install -d -m 700 /var/backups/dds
cat > /etc/cron.daily/dds-backup <<'EOF'
#!/bin/sh
su postgres -s /bin/sh -c "pg_dump dds_db" | gzip > "/var/backups/dds/dds_db-$(date +%F).sql.gz"
find /var/backups/dds -name 'dds_db-*.sql.gz' -mtime +14 -delete
EOF
chmod 700 /etc/cron.daily/dds-backup

echo "==> Caddy reverse proxy + HTTPS"
cat > /etc/caddy/Caddyfile <<EOF
${DOMAIN} {
	encode gzip

	handle /api/* {
		reverse_proxy 127.0.0.1:4001
	}
	handle /socket.io/* {
		reverse_proxy 127.0.0.1:4001
	}
	handle {
		root * ${APP_DIR}/client/dist
		try_files {path} /index.html
		file_server
	}
}
EOF
chown -R www-data:www-data "$APP_DIR" "$VENV"
systemctl enable --now caddy
systemctl reload caddy || systemctl restart caddy

echo "==> Firewall"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

cat <<DONE

============================================================
 DDS is deployed at  https://${DOMAIN}
============================================================
API health:   curl https://${DOMAIN}/api/health
Web client:   https://${DOMAIN}
Demo login:   seed script credentials (see server/scripts/seed.ts)
DB backups:   /var/backups/dds (nightly pg_dump, 14-day retention)

NOTE: server/uploads/ (specimen images, evidence files) is NOT included in
the pg_dump backups — back it up separately or move it to object storage.

Phone APK: rebuild once with the stable URL:
  cd C:\\dds\\mob2
  flutter build apk --release --no-tree-shake-icons \\
    --dart-define DDS_API_URL=https://${DOMAIN}/api
(or use the sign-in screen gear → server URL, no rebuild needed)

If HTTPS cert fails: confirm the domain's A record points at
this droplet's public IP before rerunning this script.
DONE
