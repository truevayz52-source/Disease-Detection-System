import crypto from "node:crypto"
import dotenv from "dotenv"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, "../.env") })

export const config = {
  port: Number(process.env.PORT ?? 4000),
  clientOrigin: process.env.CLIENT_ORIGIN ?? "http://localhost:5173",
  // Postgres connection string — Supabase Supavisor pooled URI (port 6543)
  // for hosted, or a local Postgres URI for development.
  databaseUrl: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/dds_db",
  // SSL is required by hosted Postgres (Supabase). Explicit via DATABASE_SSL=1,
  // or auto-detected from the URL.
  databaseSsl: ["1", "true"].includes(process.env.DATABASE_SSL ?? "") || /\.supabase\.(com|co)([:/?]|$)/.test(process.env.DATABASE_URL ?? ""),
  // Session time zone applied to each pooled connection — named zone;
  // Zimbabwe has no DST so Africa/Harare is a fixed UTC+2.
  dbTimeZone: process.env.DB_TIMEZONE ?? "Africa/Harare",
  // Supabase project (Phase 2 hybrid auth): service-role calls stay server-side.
  supabaseUrl: process.env.SUPABASE_URL ?? null,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? null,
  supabaseJwtSecret: process.env.SUPABASE_JWT_SECRET ?? null,
  // JWKS endpoint — verifies asymmetrically-signed tokens from projects using
  // the newer Supabase signing keys. Defaults to the standard auth path.
  supabaseJwksUrl: process.env.SUPABASE_JWKS_URL ?? (process.env.SUPABASE_URL
    ? `${process.env.SUPABASE_URL.replace(/\/$/, "")}/auth/v1/.well-known/jwks.json`
    : null),
  jwtSecret: process.env.JWT_SECRET ?? (process.env.NODE_ENV === "production"
    ? (() => { throw new Error("JWT_SECRET must be set in production") })()
    : "dev-only-insecure-secret"),
  jwtExpiresHours: Number(process.env.JWT_EXPIRES_HOURS ?? 8),
  analyticsUrl: process.env.ANALYTICS_URL ?? "http://127.0.0.1:8000",
  outbreakThreshold: Number(process.env.OUTBREAK_THRESHOLD ?? 8),
  outbreakWindowHours: Number(process.env.OUTBREAK_WINDOW_HOURS ?? 48),
  // Low-volume early-warning layer: fires an 'early_warning' alert for a small
  // cluster long before the full outbreak threshold is crossed. The window
  // defaults to 90 days so detection is effectively cumulative — tighten in
  // production deployments.
  earlyWarningMinCases: Number(process.env.EARLY_WARNING_MIN_CASES ?? 2),
  earlyWarningWindowHours: Number(process.env.EARLY_WARNING_WINDOW_HOURS ?? 2160),
  earlyWarningRiskScore: Number(process.env.EARLY_WARNING_RISK_SCORE ?? 35),
  // Decision-limit multiplier for the Poisson CUSUM in analytics/main.py.
  cusumLimit: Number(process.env.CUSUM_LIMIT ?? 3),
  // Community-signal layer: aggregates health_signals + community_reports per
  // district inside the window; fires an 'early_warning' alert when the
  // severity-weighted count reaches the floor, or on a single critical item.
  signalMinReports: Number(process.env.SIGNAL_MIN_REPORTS ?? 3),
  signalWindowHours: Number(process.env.SIGNAL_WINDOW_HOURS ?? 72),
  signalRiskScore: Number(process.env.SIGNAL_RISK_SCORE ?? 45),
  // Stale 'outbreak'/'early_warning' alerts auto-resolve after this many hours
  // so a second wave in the same district+category can re-alert. MPDSR alerts
  // are excluded — those always require human review.
  alertAutoResolveHours: Number(process.env.ALERT_AUTO_RESOLVE_HOURS ?? 336),
  // Morbidity (syndromic) layer: pools morbidity_reports case counts per
  // district+category inside the window; crossing the floor fires an
  // 'early_warning' alert — the only feed that sees illness before death.
  morbidityMinCases: Number(process.env.MORBIDITY_MIN_CASES ?? 10),
  morbidityWindowHours: Number(process.env.MORBIDITY_WINDOW_HOURS ?? 168),
  morbidityRiskScore: Number(process.env.MORBIDITY_RISK_SCORE ?? 50),
  // Below this many buckets a forecast falls back to a rate-based baseline.
  predictionsMinPoints: Number(process.env.PREDICTIONS_MIN_POINTS ?? 3),
  // Sliding idle-session timeout — the session's expires_at is bumped forward
  // on every authenticated request; it lapses when idle longer than this.
  sessionIdleMinutes: Number(process.env.SESSION_IDLE_MINUTES ?? 30),
  communityApiKey: process.env.COMMUNITY_API_KEY ?? null,
  // Streaming transcription endpoint on the Python service. Derived from
  // WHISPER_URL unless overridden — http://…/transcribe -> ws://…/stream.
  whisperWsUrl: process.env.WHISPER_WS_URL ?? (process.env.WHISPER_URL
    ? process.env.WHISPER_URL.replace(/^http/, "ws").replace(/\/transcribe\/?$/, "/stream")
    : null),
  uploadsDir: path.resolve(__dirname, "../uploads"),
  // HMAC key for autopsy/medical-certification report signing. In production
  // this should be a 256-bit (64-hex) secret independent of JWT_SECRET. When
  // unset in dev we derive a stable key from JWT_SECRET so certificates still
  // carry a signature fingerprint; this is not suitable for production.
  signatureHmacKey: process.env.SIGNATURE_HMAC_KEY ?? (() => {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SIGNATURE_HMAC_KEY must be set in production")
    }
    console.warn("[config] SIGNATURE_HMAC_KEY not set; deriving from JWT_SECRET for dev only")
    return crypto.createHash("sha256").update(process.env.JWT_SECRET ?? "dev-only-insecure-secret").digest("hex")
  })(),
}
