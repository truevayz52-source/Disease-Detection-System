import dotenv from "dotenv"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, "../.env") })

export const config = {
  port: Number(process.env.PORT ?? 4000),
  clientOrigin: process.env.CLIENT_ORIGIN ?? "http://localhost:5173",
  mysql: {
    host: process.env.MYSQL_HOST ?? "127.0.0.1",
    port: process.env.MYSQL_PORT ? Number(process.env.MYSQL_PORT) : 3306,
    user: process.env.MYSQL_USER ?? "root",
    password: process.env.MYSQL_PASSWORD ?? "",
    database: process.env.MYSQL_DATABASE ?? "dds_db",
    // External managed MySQL (e.g. Aiven free tier) requires TLS; local
    // MariaDB stays plain. MYSQL_SSL=1 enables it without pinning a CA cert.
    ssl: process.env.MYSQL_SSL === "1" ? { rejectUnauthorized: false } : undefined,
  },
  jwtSecret: process.env.JWT_SECRET ?? (process.env.NODE_ENV === "production"
    ? (() => { throw new Error("JWT_SECRET must be set in production") })()
    : "dev-only-insecure-secret"),
  jwtExpiresHours: Number(process.env.JWT_EXPIRES_HOURS ?? 8),
  analyticsUrl: process.env.ANALYTICS_URL ?? "http://127.0.0.1:8000",
  outbreakThreshold: Number(process.env.OUTBREAK_THRESHOLD ?? 8),
  outbreakWindowHours: Number(process.env.OUTBREAK_WINDOW_HOURS ?? 48),
  communityApiKey: process.env.COMMUNITY_API_KEY ?? null,
  mysqlTimeZone: process.env.MYSQL_TIMEZONE ?? "+02:00",
  // Streaming transcription endpoint on the Python service. Derived from
  // WHISPER_URL unless overridden — http://…/transcribe -> ws://…/stream.
  whisperWsUrl: process.env.WHISPER_WS_URL ?? (process.env.WHISPER_URL
    ? process.env.WHISPER_URL.replace(/^http/, "ws").replace(/\/transcribe\/?$/, "/stream")
    : null),
  uploadsDir: path.resolve(__dirname, "../uploads"),
}
