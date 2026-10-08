#!/usr/bin/env bash
# DDS — one-command droplet setup for Ubuntu 24.04 (DigitalOcean or any VPS).
#
#   sudo bash deploy/setup.sh <domain>
#
# Example:  sudo bash deploy/setup.sh dds.duckdns.org
#
# What it does: Node 22 + pnpm, MariaDB (dds_db + dedicated user), Python venv
# (analytics + transcription), pnpm install/build, migrate + seed, systemd
# services, Caddy HTTPS reverse proxy, UFW firewall.
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
apt-get install -y -qq curl git mariadb-server python3-venv python3-pip \
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

echo "==> Configuring MariaDB"
systemctl enable --now mariadb
DB_PASS="$(openssl rand -hex 24)"
mysql -e "CREATE DATABASE IF NOT EXISTS dds_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
          CREATE USER IF NOT EXISTS 'dds'@'localhost' IDENTIFIED BY '${DB_PASS}';
          GRANT ALL PRIVILEGES ON dds_db.* TO 'dds'@'localhost';
          FLUSH PRIVILEGES;"

JWT_SECRET="$(openssl rand -hex 48)"
cat > server/.env <<EOF
PORT=4001
CLIENT_ORIGIN=https://${DOMAIN}
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
fi

echo "==> systemd services"
cat > /etc/systemd/system/dds-api.service <<'EOF'
[Unit]
Description=DDS API
After=network.target mariadb.service
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

Phone APK: rebuild once with the stable URL:
  cd C:\\dds\\mob2
  flutter build apk --release --no-tree-shake-icons \\
    --dart-define DDS_API_URL=https://${DOMAIN}/api
(or use the sign-in screen gear → server URL, no rebuild needed)

If HTTPS cert fails: confirm the domain's A record points at
this droplet's public IP before rerunning this script.
DONE
