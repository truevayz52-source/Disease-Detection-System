# DDS — development notes

## Running the backend

`pnpm dev:server` (or `pnpm --filter server dev`) starts the API on port 4000;
`pnpm dev` also starts the web client and the transcription service. MySQL
must be running (database `dds_db`, config in `server/.env`). The API binds
all interfaces — a phone can reach it over LAN once Windows Firewall allows
inbound TCP 4000:

```
netsh advfirewall firewall add rule name="DDS API 4000" dir=in action=allow protocol=TCP localport=4000
```

(run elevated).

## Pointing the mobile app at the server

`mobile/lib/data/api_client.dart` defaults: `10.0.2.2:4000` on Android
(emulator only) and `localhost:4000` elsewhere. A physical device needs the
host machine's LAN IP at build/run time:

```
flutter run --dart-define DDS_API_URL=http://192.168.8.39:4000/api
flutter build apk --dart-define DDS_API_URL=http://192.168.8.39:4000/api
```

(If the phone is connected to the PC's mobile hotspot instead of the same
Wi-Fi, use `http://192.168.137.1:4000/api`.)

## Windows build quirks

- The project lives under OneDrive at a path >260 chars; `impellerc` fails
  writing shader assets (MAX_PATH). Build through a short junction instead:

  ```
  New-Item -ItemType Junction -Path C:\dds\mobile -Target <repo>\mobile
  cd C:\dds\mobile; flutter pub get; flutter build apk --debug
  ```

- `mobile\build` is junctioned to `C:\Users\tanak\dds-mobile-build` for the
  same reason.
- Windows platform builds need Developer Mode enabled (symlinks for plugins).

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
