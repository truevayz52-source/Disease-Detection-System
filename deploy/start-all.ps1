# DDS — start the whole local stack (run at login via Startup shortcut).
#   Database is hosted on Supabase — no local DB to start.
#   prod server (web+API on :4001) -> analytics -> transcription -> OpenHIM ->
#   ngrok reserved domain (PRIMARY public path, stable URL) ->
#   cloudflared quick tunnel (BACKUP public path) ->
#   republish the stable ngrok URL to BOTH lookup pointers (Firebase + GitHub).
$repo = "C:\Users\tanak\OneDrive\Desktop\School Project\Forensic Mortality System Chapter 1-7\cross-platform-application-development-main\cross-platform-application-development-main"
$logs = "$env:TEMP\dds-startup"
New-Item -ItemType Directory -Force -Path $logs | Out-Null

# Production server — serves the built web client AND the API on :4001
# (single origin; the ngrok tunnel below then exposes the whole app).
# NOTE: run `pnpm build` after code changes before this script is effective.
Start-Process -WindowStyle Hidden -FilePath "C:\Program Files\nodejs\node.exe" `
  -ArgumentList "dist/index.js" -WorkingDirectory "$repo\server" `
  -RedirectStandardOutput "$logs\prod.out" -RedirectStandardError "$logs\prod.err"

Start-Process -WindowStyle Hidden -FilePath "C:\Users\tanak\AppData\Roaming\npm\pnpm.cmd" `
  -ArgumentList "dev:analytics" -WorkingDirectory $repo `
  -RedirectStandardOutput "$logs\analytics.out" -RedirectStandardError "$logs\analytics.err"

Start-Process -WindowStyle Hidden -FilePath "C:\Users\tanak\AppData\Roaming\npm\pnpm.cmd" `
  -ArgumentList "dev:transcription" -WorkingDirectory $repo `
  -RedirectStandardOutput "$logs\transcription.out" -RedirectStandardError "$logs\transcription.err"

# OpenHIM regional-bridge stack (no-op if Docker Desktop isn't running;
# the containers also restart automatically with the daemon).
Start-Process -WindowStyle Hidden -FilePath "C:\Program Files\Docker\Docker\resources\com.docker.cli.exe" `
  -ArgumentList "compose -f `"$repo\deploy\openhim\docker-compose.yml`" up -d" `
  -RedirectStandardOutput "$logs\openhim.out" -RedirectStandardError "$logs\openhim.err"

# PRIMARY public path — the prod server on :4001 serves the built web client
# AND the API, so one reserved domain exposes the whole app.
Start-Process -WindowStyle Hidden -FilePath "C:\tools\ngrok.exe" `
  -ArgumentList "http 4001 --url=rift-late-sizable.ngrok-free.dev" `
  -RedirectStandardOutput "$logs\ngrok.out" -RedirectStandardError "$logs\ngrok.err"

# BACKUP public path — Cloudflare quick tunnel; republishes the GitHub
# pointer to its ephemeral URL itself (start-tunnel.ps1 handles that).
Start-Process -WindowStyle Hidden -FilePath "powershell.exe" `
  -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$repo\deploy\start-tunnel.ps1`"" `
  -RedirectStandardOutput "$logs\cloudflared.out" -RedirectStandardError "$logs\cloudflared.err"

# Keep BOTH mobile-app lookup pointers fresh once the stack is up — the
# pointers always resolve the STABLE ngrok URL; the quick tunnel is only
# repointed to when start-tunnel.ps1 runs alone (ngrok down).
Start-Sleep -Seconds 20
& "C:\Program Files\nodejs\node.exe" "$repo\deploy\sync-tunnel-url.mjs" `
  "https://disease-detetcion-system-default-rtdb.firebaseio.com" `
  "AIzaSyDIiP0H4-QXqQTMOCF3vJ1ZcKucdeKmFUQ" `
  "https://rift-late-sizable.ngrok-free.dev/api" `
  *>> "$logs\publish.log"
& "C:\Program Files\nodejs\node.exe" "$repo\deploy\sync-tunnel-github.mjs" `
  (git -C $repo remote get-url origin) `
  "https://rift-late-sizable.ngrok-free.dev/api" `
  *>> "$logs\publish.log"
