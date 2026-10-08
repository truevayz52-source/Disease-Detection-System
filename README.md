# Disease Detection System (DDS)

Digital mortality surveillance and outbreak detection for the Zimbabwe Ministry
of Health and Child Care (MOHCC). Replaces paper-based death notification with
an auditable, role-based workflow covering intake, tele-pathology review,
autopsy certification, outbreak analytics and GIS mapping.

## Architecture

```
client/      React 19 SPA (Vite, Tailwind, shadcn/base-ui)      → http://localhost:5173
server/      Express + TypeScript REST API (JWT, Argon2, RBAC)  → http://localhost:4000
analytics/   FastAPI ML service (scikit-learn DBSCAN + LR)      → http://localhost:8000
mobile/      Flutter app (Android/iOS/Windows) — same REST API
db/          MariaDB/MySQL schema (dds_db)                      → 127.0.0.1:3306
e2e/         Playwright suite (TC-01 … TC-05, RBAC, audit)
```

The Flutter app mirrors the web client's design and role-based workflows
(sign-in, dashboard, notifications, pathology, autopsies, alerts, analytics,
admin). It talks to the same Express API — run `pnpm dev:server` first, then:

```bash
cd mobile
flutter run                                    # desktop/web → localhost:4001
flutter run -d android                         # emulator → 10.0.2.2:4001
flutter run --dart-define DDS_API_URL=http://<host>:4001/api  # physical device
```

The app can also find the server at runtime: the sign-in screen gear (or
Profile → Security & connection) opens a server sheet with manual entry and
**Find automatically** — it listens for the API's UDP discovery beacon (port
40401, `DISCOVERY_BEACON=0` disables) and scans the local subnet. The last
working address is remembered per device; `DDS_PUBLIC_URL` can be baked in
as a fixed public endpoint. Biometric sign-in (fingerprint/Face ID) unlocks
the device-activated offline account and validates the session live when
online — enable it via the post-login prompt or Profile → Security.

The Vite dev server proxies `/api/*` to the Express API on :4001. The API calls
the Python analytics service with a 2.5s timeout and automatically falls back
to a built-in Node implementation when it is down — the UI always works.

Python services (all optional, all in `analytics/`, run via `C:\dds-venv`):

| Service | Port | Script | Purpose |
|---|---|---|---|
| `main.py` | 8000 | `pnpm dev:analytics` | ML clustering/forecasting (Node fallback exists) |
| `transcription.py` | 8001 | `pnpm dev:transcription` | Whisper VA transcription |
| `pathology.py` | 8002 | `pnpm dev:pathology` | Specimen-image analysis for `POST /api/ai/pathology/analyze` — HF model via `PATHOLOGY_MODEL` (needs `requirements-pathology-ml.txt`), else deterministic `dds-patho-heuristic-1.0` baseline |

## Integrations (admin → System Settings → Connected services)

- **Pathology model** — `PATHOLOGY_INFERENCE_URL` (+ optional `PATHOLOGY_API_KEY`). Dev: `http://127.0.0.1:8002/analyze`.
- **Regional bridge** — `POST /api/regional/push` sends district-level mortality *aggregates only* (never case data) to the configured targets: DHIS2 `dataValueSets` (`DHIS2_*` envs; dev points at the public demo `play.im.dhis2.org/stable-2-43-2`) and/or an OpenHIM FHIR channel (`OPENHIM_*` envs).
- **WHO ICD-11** — register free at https://icd.who.int/icdapi → *View API access key* → set `WHO_CLIENT_ID`, `WHO_CLIENT_SECRET`, `WHO_ICD_RELEASE` (e.g. `2025-01`). Without it, the ICD picker uses bundled ICD-10.
- **Email (SMTP)** — powers password reset + scheduled reports. Dev uses a free [Ethereal](https://ethereal.email) test mailbox (mail is captured in its web inbox, not delivered). For real delivery use a free tier such as Brevo (300/day, `smtp-relay.brevo.com:587`, no card required).
- **AI translation** — `GEMINI_API_KEY` + `TRANSLATE_PROVIDER=gemini`; all text is de-identified before dispatch.

## Prerequisites

- Node.js 20+ and pnpm 11
- MariaDB/MySQL running on `127.0.0.1:3306` (XAMPP `C:\xap` works — root, no password)
- Python 3.12 for the analytics service (optional — the API falls back without it)

## Setup

```bash
# 1. Install dependencies
pnpm install --ignore-scripts

# 2. Create and load the database
mysql -u root -e "CREATE DATABASE IF NOT EXISTS dds_db"
mysql -u root dds_db < db/001-schema.sql

# 3. Configure the API
cp server/.env.example server/.env   # or create it — see variables below

# 4. Seed demo data (facilities, ICD-10 codes, users, a demo outbreak cluster)
pnpm migrate
pnpm seed

# 5. Analytics service (optional but recommended)
python -m venv C:\dds-venv
C:\dds-venv\Scripts\pip install -r analytics\requirements.txt

# 5b. Transcription service (optional — verbal-autopsy voice intake)
C:\dds-venv\Scripts\pip install -r analytics\requirements-transcription.txt
# Download the multilingual checkpoint once (~1.6 GB; English + Shona):
#   huggingface-cli download Systran/faster-whisper-large-v3-turbo --local-dir analytics/models/turbo
C:\dds-venv\Scripts\python -m uvicorn transcription:app --port 8001 --app-dir analytics
# or: pnpm dev:transcription

# 6. Run everything
pnpm dev            # API :4000 + SPA :5173 (concurrently)
pnpm dev:analytics  # ML service :8000 (separate terminal)
```

Open http://localhost:5173 and sign in.

### Demo accounts (all use password `password123`)

| Email | Role | Access |
|-------|------|--------|
| `t.moyo@mohcc.org.zw` | medical_officer | Death notification intake (facility-scoped) |
| `c.ndlovu@mohcc.org.zw` | pathologist | Pathology queue, image review, autopsy reports |
| `r.chikafu@mohcc.org.zw` | public_health_analyst | Analytics, outbreak map, alerts, audit trail |
| `sysadmin@mohcc.org.zw` | system_admin | Everything + user/facility management |
| `t.moyo.clerk@mohcc.org.zw` | mortuary_clerk | Demographics, backlog, certificates (restricted) |
| `r.chikwamba@mohcc.org.zw` | executive | View-only macro dashboard (aggregate data only) |

The seed also plants a **12-case waterborne disease cluster in Harare inside 48
hours** — the outbreak engine fires a real alert on first run so TC-04 is
visible immediately on the Alerts / Analytics / Map pages.

## Environment variables (`server/.env`)

```env
PORT=4000
CLIENT_ORIGIN=http://localhost:5173
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=
MYSQL_DATABASE=dds_db
JWT_SECRET=<random hex>
JWT_EXPIRES_HOURS=8
ANALYTICS_URL=http://127.0.0.1:8000
OUTBREAK_THRESHOLD=8
OUTBREAK_WINDOW_HOURS=48
MYSQL_TIMEZONE=+02:00          # session TZ pinned per pooled connection
COMMUNITY_API_KEY=             # optional x-api-key gate on /api/community/report
WHISPER_URL=http://127.0.0.1:8001/transcribe   # batch transcription
WHISPER_API_KEY=               # shared secret for the Python service
WHISPER_WS_URL=                # optional; derived from WHISPER_URL (/stream)
TRANSLATE_PROVIDER=gemini      # external AI provider for translate + AI assists
TRANSLATE_MODEL=gemini-3.1-flash-lite
GEMINI_API_KEY=                # server-side only; never shipped to clients
```

### External AI calls — privacy guards

All Gemini traffic is server-side through `server/src/lib/ai.ts` (and
`/api/translate` for dynamic text). The contract, enforced for every call:

1. **De-identification first** — record PII literals (names, IDs, facility,
   provider) plus regex catches for ZW national IDs, phones, emails and
   coordinates become ⟦n⟧ tokens before dispatch. A post-mask assertion
   refuses the call if any caller-supplied literal survives.
2. **Token round-trip** — ⟦n⟧ tokens in the response are re-substituted
   server-side (or client-side for /api/translate), so authorised users see
   readable text while the provider only ever saw tokens.
3. **Aggregate-only explain** — `/api/ai/explain` accepts an allowlisted set
   of aggregate keys (disease, district, counts, thresholds); record-level
   fields are rejected with 400 before any external call.
4. **No content in logs** — the audit trail records task, char count and
   masked-field counts only; request/response text is never written.
5. **Draft labelling** — every AI surface in the UI carries an
   "AI-generated draft — verify" notice; nothing is persisted automatically.

Endpoints: `POST /api/ai/summarize`, `POST /api/ai/extract` (VA transcript →
structured notification fields), `POST /api/ai/explain` (alert narrative).
All are `requireAuth` + rate-limited; extract/explain are role-scoped.

### Verbal-autopsy transcription

`/api/voice/stream` proxies microphone PCM (16 kHz s16le) to the Whisper
service over WebSocket. The service re-decodes a rolling window and only
returns text confirmed by consecutive passes, so the transcript in the UI is
always final quality — there is no draft/uncorrected tier. Uploading a
recording to `POST /voice/transcribe` uses the same model in batch mode.
Languages: English and Shona; Ndebele is not supported by Whisper and falls
back to manual entry.

## Localization — all 16 official languages

Both clients (web `client/` and Flutter `mobile/`) ship a full language
selector covering the 16 official Zimbabwean languages:

| Code | Language | Code | Language |
|------|----------|------|----------|
| `en` | English (base) | `sbn` | Chibarwe (draft) |
| `sn` | chiShona | `kck` | Kalanga (draft) |
| `nd` | isiNdebele | `huc` | Koisan/Tshwa (draft) |
| `ny` | Chewa | `nmq` | Nambya (draft) |
| `ts` | Xitsonga/Shangani | `ndc` | Ndau (draft) |
| `st` | Sesotho | `toi` | chiTonga |
| `tn` | Setswana | `ve` | Tshivenḓa |
| `xh` | isiXhosa | `zsl` | ZW Sign Language¹ |

¹ ZSL renders English text plus a notice that signed video guidance is a
planned module.

- **Canonical source:** `i18n/lang/<code>.json` — keys are the English source
  strings; missing entries always fall back to English (never raw keys).
- **Selectors:** web site header + My Profile page, mobile app bar + profile.
  Selection persists locally and syncs to `users.language` when signed in.
- **Workflow:** `pnpm i18n:scan` regenerates the key inventory into
  `i18n/lang/en.json`; `pnpm i18n:sync` copies dictionaries into
  `mobile/assets/lang/` and `client/src/i18n/`; `pnpm i18n:check` validates
  JSON, key parity and `{placeholder}` preservation.
- **Dynamic clinical text** (autopsy findings, clinical summaries, verbal
  autopsy transcripts) translates on demand through `POST /api/translate`
  with mandatory de-identification — see INTEGRATIONS.md. Offline, a bundled
  medical glossary substitutes known terms and otherwise shows the original.

All non-English dictionaries are marked **draft — pending native-speaker
review**; low-resource languages (Chibarwe, Kalanga, Koisan/Tshwa, Nambya,
Ndau) have seed coverage only.

## API overview

All endpoints are under `/api`. Every request except `/auth/login` requires
`Authorization: Bearer <jwt>`.

| Area | Endpoints |
|------|-----------|
| Auth | `POST /auth/login`, `GET /auth/me`, `POST /auth/logout` |
| ICD | `GET /icd-codes?q=` |
| Facilities | `GET/POST /facilities`, `PATCH /facilities/:id` |
| Notifications | `GET/POST /notifications`, `GET/PATCH /notifications/:id`, `POST /notifications/:id/autopsy` |
| Tele-pathology | `POST/GET /notifications/:id/images`, `GET /images/:id/file` |
| Autopsies | `GET /autopsies`, `GET /autopsies/:id`, `PATCH /autopsies/:id/finalize` |
| Alerts | `GET /alerts`, `GET /alerts/active-count`, `PATCH /alerts/:id/resolve` |
| Analytics | `GET /analytics/summary|trends|geo|clusters`, `POST /analytics/detect`, `GET /analytics/engine-status` |
| Admin | `GET/POST /users`, `PATCH /users/:id`, `GET /audit`, `GET /audit/verify` |
| Certificate | `GET /notifications/:id/certificate` (printable HTML → PDF via browser print) |

## Testing

```bash
pnpm --filter client typecheck
pnpm --filter server typecheck
pnpm build          # client + server production build
pnpm test:e2e       # Playwright — requires dev servers running
pnpm --filter e2e report
```

E2E coverage: TC-01 notification intake, TC-02 tele-pathology upload + autopsy
+ certificate, TC-03 RBAC/401-403, TC-04 seeded outbreak detection, TC-05
offline-queue resilience — plus login, nav visibility, alerts, map and audit
checks.

## Notes

- **Optional integrations:** see [INTEGRATIONS.md](INTEGRATIONS.md) for SMTP,
  local Whisper, pathology inference, WHO ICD-11 reference lookup, and limits.

- **Windows MAX_PATH:** this project lives under a deep OneDrive path; pnpm is
  configured with `nodeLinker: hoisted` (flat `node_modules`) in
  `pnpm-workspace.yaml` so spawned binaries (esbuild etc.) stay under the
  260-char process limit. Do not switch back to the `.pnpm` linker.
- **Audit trail:** every mutation appends a SHA-256 hash-chained row to
  `audit_log`; `/api/audit/verify` walks the chain to prove integrity.
- **Offline resilience:** the notification form autosaves a draft to
  localStorage and queues failed submissions for replay (TC-05).
- **PWA:** manifest + service worker are served by the SPA; API calls are never
  cached (stale surveillance data is unsafe).
