# DDS — development notes

## Running the backend

`pnpm dev:server` (or `pnpm --filter server dev`) starts the API on port 4001
(port 4000 is used by the unrelated ZRRTI project on this machine);
`pnpm dev` also starts the web client (5174 — ZRRTI owns 5173) and the
transcription service. MySQL must be running (database `dds_db`, config in
`server/.env`). The API binds all interfaces — a phone can reach it over LAN
once Windows Firewall allows inbound TCP 4001:

```
netsh advfirewall firewall add rule name="DDS API 4001" dir=in action=allow protocol=TCP localport=4001
```

(run elevated).

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
`l10n/fallback_localizations.dart` BEFORE the `Global*` ones. Most of the 16
locales have no Flutter material strings — without the fallbacks every
Scaffold/drawer crashes with "No MaterialLocalizations found" on language
switch. Regression test: `test/locale_switch_test.dart` pumps all 16 locales.

## Offline layer (mobile)

- `data/secure_store.dart` — flutter_secure_storage (Keystore/Keychain) for
  tokens, offline credential blobs, and the Hive AES key; falls back to
  `sec:`-prefixed SharedPreferences when the plugin is unavailable (tests).
- `data/local_store.dart` — AES-256 encrypted Hive boxes: `sync_queue`
  (FIFO outbox), `offline_cases` (local case records with sync_status),
  `drafts`. In-memory fallback without plugins; `LocalStore.init()` in main().
- `data/offline_accounts.dart` — Argon2id verifiers; offline sign-in allowed
  for 14 days after the last confirmed online session (`lastOnlineAt`).
- `data/sync_service.dart` — replays the queue on server reachability and
  marks offline_cases SYNCED / REJECTED.

## Tests

`flutter test` — run with `--concurrency=1` on low-core machines: the
Argon2id verifier is memory-hard and parallel test isolates can stall past
the 30s timeout.
