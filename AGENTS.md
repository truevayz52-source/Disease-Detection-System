# DDS — development notes

## Running the backend

`pnpm dev:server` (or `pnpm --filter server dev`) starts the API on port 4001
(port 4000 is used by the unrelated ZRRTI project on this machine);
`pnpm dev` also starts the web client (5174 — ZRRTI owns 5173) and the
transcription service. Postgres must be reachable via `DATABASE_URL`
(Supabase Supavisor pooler URI, or a local Postgres `dds_db` — config in
`server/.env`). The API binds all interfaces — a phone can reach it over LAN
once Windows Firewall allows inbound TCP 4001:

```
netsh advfirewall firewall add rule name="DDS API 4001" dir=in action=allow protocol=TCP localport=4001
```

(run elevated).

`pnpm --filter server reset:cases --confirm` wipes all transactional data
(patients, death notifications, autopsies, alerts, signals, audit, etc.) while
keeping reference data (facilities, provinces, districts, ICD codes, users) —
use it to start demos from an empty dataset. Also clears `server/uploads/`.

## Early-warning detection

`detectOutbreaks` (`server/src/lib/outbreak.ts`) has a second pass after the
threshold rules: a district+category gets an `early_warning` alert (amber,
risk `EARLY_WARNING_RISK_SCORE`, default 35) when a notifiable disease
reaches `EARLY_WARNING_MIN_CASES` (default 2) inside
`EARLY_WARNING_WINDOW_HOURS` (default 2160 = cumulative) — or when the
`/cusum` Poisson-CUSUM endpoint in `analytics/main.py` flags a low-volume
anomaly. Maternal/Perinatal is excluded (MPDSR instant-alerts); combos with
an active alert never refire. `OUTBREAK_WINDOW_HOURS=336` in `.env` is a
demo setting — use 48–72 in production. Below `PREDICTIONS_MIN_POINTS`
buckets `/analytics/predictions` returns a `rate-baseline` projection.

## Pointing the mobile app at the server

`mobile/lib/data/api_client.dart` resolves the base URL at runtime via
`ServerResolver`: saved override → `DDS_API_URL` / `DDS_PUBLIC_URL`
dart-defines → last-good → platform default (`10.0.2.2:4001` on the Android
emulator, `localhost:4001` elsewhere). Users can change it from the gear on
the sign-in screen or Profile → Security & connection — no rebuild needed.

Build-time overrides:

```
flutter run --dart-define DDS_API_URL=http://192.168.8.39:4001/api
flutter build apk --dart-define DDS_API_URL=http://192.168.8.39:4001/api \
                 --dart-define DDS_PUBLIC_URL=https://api.example.gov.zw/api
```

(If the phone is connected to the PC's mobile hotspot instead of the same
Wi-Fi, use `http://192.168.137.1:4001/api`.)

Auto-discovery: the API broadcasts `DDS:<lanIp>:<port>` on UDP **40401**
every 3 s (`server/src/lib/discovery-beacon.ts`; disable with
`DISCOVERY_BEACON=0`). The app's "Find automatically" listens for the beacon
and scans the local /24 on port 4001. iOS note: broadcast receive is
unreliable there — subnet scan + manual entry are the fallback.

## Biometric sign-in (mobile)

`MainActivity` must stay a **FlutterFragmentActivity** — `local_auth`
requires it (a plain FlutterActivity makes every prompt fail with
`no_fragment_activity`). Biometric unlock works online (stored token is
re-validated against `/auth/me`) and offline (within the 14-day window);
the toggle lives in Profile → Security & connection.

## Windows build quirks

- The project lives under OneDrive at a path >260 chars; `impellerc` fails
  writing shader assets (MAX_PATH). Junctions do NOT help — Flutter
  canonicalizes the project dir back to the real path. What works: copy the
  source to a real short path and build there:

  ```
  robocopy mobile C:\dds-mobile-src /MIR /XJ /XD build .dart_tool ephemeral .gradle /XF *.iml
  cd C:\dds-mobile-src && flutter pub get && flutter build apk --debug
  adb -s <device> install -r build\app\outputs\flutter-apk\app-debug.apk
  ```

- `flutter install` defaults to app-release.apk — pass `--use-application-binary`
  or use `adb install` for debug builds.
- Windows platform builds need Developer Mode enabled (symlinks for plugins).

## Python services

All live in `analytics/` and run in the shared `C:\dds-venv` venv:
`:8000` analytics (`dev:analytics`), `:8001` Whisper transcription
(`dev:transcription`), `:8002` pathology inference (`dev:pathology` →
`PATHOLOGY_INFERENCE_URL`). Pathology accepts multipart `file` and returns
`{modelVersion, anomalyScore, confidenceScore, regions[]}`; set
`PATHOLOGY_MODEL` + install `requirements-pathology-ml.txt` for a real HF
model, otherwise the deterministic heuristic baseline answers.

## i18n — locale fallback rule

`app.dart` `localizationsDelegates` MUST list the `fallback*` delegates in
`l10n/fallback_localizations.dart` BEFORE the `Global*` ones. The app ships
three UI languages — English, chiShona and isiNdebele (`en`/`sn`/`nd`); `nd`
has no Flutter material strings so without the fallbacks every
Scaffold/drawer crashes with "No MaterialLocalizations found" on language
switch. Regression test: `test/locale_switch_test.dart` pumps all active
locales.

## Offline layer (mobile)

- `data/secure_store.dart` — flutter_secure_storage (Keystore/Keychain) for
  tokens, offline credential blobs, and the Hive AES key; falls back to
  `sec:`-prefixed SharedPreferences when the plugin is unavailable (tests).
- `data/local_store.dart` — AES-256 encrypted Hive boxes: `sync_queue`
  (FIFO outbox of v2 `QueuedOp`s), `offline_cases` (local case records with
  sync_status PENDING/SYNCED/REJECTED/CONFLICT), `drafts`, `read_cache`
  (URI→body GET cache, migrated from plaintext SharedPreferences `cache:*`),
  `entity_shadow` (server copy + optimistic overlays per entity). In-memory
  fallback without plugins; `LocalStore.init()` in main().
- `data/offline_accounts.dart` — Argon2id verifiers; offline sign-in allowed
  for 14 days after the last confirmed online session (`lastOnlineAt`).
- `data/mutation_service.dart` — single entry point for every mutation:
  enqueues a `QueuedOp` (coalescing last-write-wins per entity+key), applies
  the overlay instantly, then sends inline while online. Callers use
  `http()/notification()/upload()` + `throwIfFailed()`.
- `data/sync_engine.dart` — UI-free queue replay + field-kit pull. Batches
  notification creates through `POST /offline/sync` (≤20/request, idempotent
  via submissionId); all other ops replay their canonical REST path.
  Outcomes: 2xx→SYNCED, 409→CONFLICT, other 4xx→REJECTED, status-0→halt +
  per-op attempt backoff, 401→needsReauth.
- `data/sync_service.dart` — connectivity/resume/timer triggers driving the
  engine; sets `api.assumeOffline` so GETs serve ReadCache and writes fail
  fast (no socket timeout).
- `data/sync_worker.dart` — workmanager periodic task (`dds-offline-sync`,
  15 min, network-connected) running flush+pull in a background isolate on
  Android/iOS only; cancelled by "remove offline access" sign-out.
- `data/read_cache.dart` / `entity_shadow.dart` / `sync_ops.dart` — the
  stores and op model behind the above.
- Server LWW: `PATCH /notifications/:id` and `/:id/assign` accept
  `clientUpdatedAt` and return `409 {conflict:true, serverUpdatedAt}` when a
  newer server write already landed; `client_updated_at` is persisted for
  audit (db/009-offline-lww.sql).

## Public access — tunnels + pointers

The DB lives on Supabase; the API+web server is the local piece that must
stay reachable. Two public paths, both started by `deploy/start-all.ps1`
(autostarted at login via the `DDS-Stack` Startup shortcut):

- **PRIMARY — ngrok reserved domain** `https://rift-late-sizable.ngrok-free.dev`
  → forwards `:4001` (prod server serves the built web client + API on one
  origin). Stable URL — never changes across restarts.
- **BACKUP — cloudflared quick tunnel** (ephemeral `*.trycloudflare.com` URL).

Both mobile lookup pointers are republished to the **ngrok URL** on boot —
Firebase RTDB (`sync-tunnel-url.mjs`) and the GitHub `tunnel-pointer` branch
(`sync-tunnel-github.mjs`). The GitHub pointer is only repointed to a
cloudflare URL when `deploy/start-tunnel.ps1` runs standalone (ngrok down).

IMPORTANT: `start-all.ps1` runs `server/dist/index.js` — run
`pnpm --filter server build` and `pnpm --filter client build` after code
changes or the prod server serves stale code. The Startup shortcut fires at
**login** — the laptop must power on and sign in for the stack to boot.

## OpenHIM (regional bridge)

Local stack lives in `deploy/openhim/docker-compose.yml`
(`docker compose -f deploy/openhim/docker-compose.yml up -d`): mongo +
OpenHIM core + console + an echo target. Admin UI http://localhost:9090
(root@openhim.org / openhim-password); API https://localhost:8080;
HTTP router http://localhost:5001 — that's `OPENHIM_BASE_URL`.

`deploy/openhim/provision.ps1` creates the `dds` client
(customTokenID `dds-dev-token`) and the `/dds/mortality` channel → echo.
Two OpenHIM gotchas already solved in those files: channel `methods`
must list the HTTP verbs explicitly (empty = match nothing → 404), and
custom-token clients send `Authorization: Custom <token>` (NOT `Bearer`)
behind `authentication_enableCustomTokenAuthentication=true`. The bridge
in `server/src/lib/regional-bridge.ts` sends `Custom` accordingly.

End-to-end check: `POST /api/regional/push?days=30` (analyst/admin JWT)
should report `openhim` ok alongside `dhis2`.

## Tests

`flutter test` — run with `--concurrency=1` on low-core machines: the
Argon2id verifier is memory-hard and parallel test isolates can stall past
the 30s timeout.

## Case workflow

`server/src/lib/case-workflow.ts` is the single source of truth for valid
`death_notifications` status transitions. All edges except `pending_review →
under_review` are gated by dedicated action endpoints (`/certify`, `/reject`,
`/autopsy`, `/assign`); `finalized`, `certified` and `rejected` are terminal.
HMAC signing lives in `server/src/lib/signature.ts` and is keyed by
`SIGNATURE_HMAC_KEY`.
