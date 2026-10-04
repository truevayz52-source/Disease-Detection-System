# Optional services and resumed enhancement work

The application runs without external services. Configure the following variables
in `server/.env`, then restart the API. The System Settings page reports whether
each service is configured; this does not certify connectivity or model quality.

## Email

Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, and, if required by your mail server,
`SMTP_USER` and `SMTP_PASSWORD`. Use `SMTP_SECURE=true` for implicit TLS (usually
465), or false for STARTTLS (usually 587). TLS and certificate validation are
required. See [Nodemailer SMTP documentation](https://nodemailer.com/smtp).

Password-reset requests use SMTP when configured, falling back to the existing
`PASSWORD_RESET_WEBHOOK_URL` integration otherwise. Failed deliveries invalidate
their reset tokens and preserve the generic response to avoid exposing accounts.
Report schedules support opt-in email notices to the schedule owner's account;
the email contains a sign-in link, not report contents. Delivery failures do not
discard generated reports. Failed report email notices are logged but not retried.

## Local audio transcription

Install `analytics/requirements-transcription.txt` into your Python environment.
Run `python analytics/setup_transcription.py` once to download the English model.
The [faster-whisper engine](https://github.com/SYSTRAN/faster-whisper) includes an
audio decoder; a separate FFmpeg installation is not required.
Optionally set `WHISPER_MODEL_PATH` to a different local faster-whisper model directory in the Python service's
environment. Start it with:

```powershell
python -m uvicorn transcription:app --app-dir analytics --host 127.0.0.1 --port 8001
```

Set `WHISPER_URL=http://127.0.0.1:8001/transcribe` in `server/.env`. If using
`WHISPER_API_KEY`, set the same value in both processes. Keep this service bound
to loopback. No model downloads happen during a transcription request.

The Verbal Autopsy screen uploads audio of at most 20 MB for an accessible case.
The local adapter supports English; Shona and Ndebele require manual transcripts.
Generated text is editable and is saved only through **Save reviewed transcript**.
The Python service deletes temporary audio after each inference. CPU inference
may exceed the API's two-minute timeout for long recordings.

## Pathology inference

Set `PATHOLOGY_INFERENCE_URL` to an approved service's inference endpoint and
optionally `PATHOLOGY_API_KEY`. The API sends a multipart `file` containing the
selected stored specimen image; it does not send patient metadata. The service
must respond with:

```json
{
  "modelVersion": "your-model-version",
  "anomalyScore": 0.2,
  "confidenceScore": 0.8,
  "regions": [{"x": 0.1, "y": 0.2, "width": 0.4, "height": 0.3}]
}
```

Scores and normalized region coordinates must be within 0–1 and regions must
fit inside the image. Results are stored with the model version and displayed
in pathology review. Regions are stored but image overlays are not yet rendered.
This adapter does not supply or clinically validate a model, automatically make
a diagnosis, or finalize an autopsy. Redirects are rejected to avoid forwarding
credentials or specimen data to another destination.

## WHO ICD-11

Register for WHO API credentials and set `WHO_CLIENT_ID`, `WHO_CLIENT_SECRET`,
and `WHO_ICD_RELEASE` to a published MMS release identifier. Authentication follows
the [WHO client credentials protocol](https://icd.who.int/docs/icd-api/API-Authentication/).
The pathology screen offers reference search through `/api/icd-codes/who?q=...`.
Results remain separate from the existing local ICD-10 case catalog; importing
and migrating clinical coding requires a separate terminology migration.

## Dynamic clinical-text translation

`POST /api/translate` proxies narrative translation (autopsy findings,
clinical summaries, verbal-autopsy transcripts) to an external provider
server-side so no API key ships in client bundles.

```env
TRANSLATE_PROVIDER=gemini
GEMINI_API_KEY=
TRANSLATE_MODEL=gemini-1.5-flash
```

Privacy guarantees — enforced by `server/src/lib/deidentify.ts` (mirrored in
`mobile/lib/data/deidentify.dart` and `client/src/lib/translate.ts`):

- Names, ZW national IDs, phone numbers, emails, coordinates, and long digit
  runs are replaced with `⟦n⟧` placeholders **before** the external call;
  callers may also pass explicit PII literals (patient/facility names) to mask.
- Results are cached server-side by hash of the *masked* text. The audit
  record stores `{targetLang, chars}` only — never clinical text.
- Unconfigured or failed requests return `503` / the original text; clients
  then apply the bundled `i18n/medical-glossary.json` term substitutions and
  finally display the source text — record viewing never blocks offline.
- Mobile may use a direct Gemini call only when built with
  `--dart-define DDS_TRANSLATE_KEY=…`; the server proxy remains the default.
- Machine-translated output always renders with a "verify clinically"
  disclaimer and a show-original toggle.

## Validation and remaining work

Run `pnpm --filter server test`, `pnpm build`, and
`pnpm --filter server exec tsx scripts/test-integration.ts`. Integration tests
create a dedicated temporary database, verify six-role authorization, 2FA,
offline replay, notifications and audit integrity, then remove that database.
They do not send external email or require external model credentials.

The broad enhancement proposal remains a roadmap. Distributed blockchain,
regional health bridges, clinical model validation, full ICD-11 coding migration,
complete translations, image overlays, geofencing, and full accessibility and
mobile acceptance testing are not completed by these adapters. Live SMTP, WHO,
Whisper and pathology calls still require deployment configuration and validation.

Local setup: `pnpm dev:transcription` starts the configured Windows Python service. The default model directory is `analytics/models/base.en`. Recordings are uploaded for inference, deleted afterward, and the reviewed transcript can be saved to its selected case.
