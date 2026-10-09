---
title: Disease Detection System
sdk: docker
app_port: 7860
---

# Disease Detection System

Full-stack forensic mortality surveillance system (Express API + React client +
MariaDB + FastAPI analytics) running in a single container.

- Web app + REST API share port 7860 (`/api/*` → API, everything else → SPA).
- MariaDB runs in-container and is re-seeded on every boot — storage is
  ephemeral, so data resets on restart.
- Whisper transcription is disabled (heavy deps); analytics + pathology
  services run on internal ports 8000/8002.

## Space secrets

| Name | Purpose |
|---|---|
| `GEMINI_API_KEY` | Gemini key for `/api/translate` + i18n fill (optional) |
| `PUBLIC_ORIGIN` | CORS origin override (optional) |
