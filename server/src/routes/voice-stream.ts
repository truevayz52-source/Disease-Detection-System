import { WebSocketServer, WebSocket } from "ws"
import type { IncomingMessage } from "node:http"
import type { Server as HttpServer } from "node:http"
import type { Duplex } from "node:stream"
import { query } from "../db.js"
import { writeAudit } from "../lib/audit.js"
import { validateSessionToken } from "../websocket/index.js"
import { config } from "../config.js"

const VOICE_ROLES = new Set(["medical_officer", "mortuary_clerk", "system_admin"])
// Frames arriving before the upstream Whisper socket opens are buffered.
const MAX_BUFFERED_FRAMES = 600

function fail(client: WebSocket, code: number, reason: string) {
  if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
    client.close(code, reason)
  }
}

async function handle(client: WebSocket, url: URL, req: IncomingMessage) {
  const user = await validateSessionToken(url.searchParams.get("token") ?? "").catch(() => null)
  if (!user || !VOICE_ROLES.has(user.role)) return fail(client, 4401, "Unauthorized")

  const notificationId = url.searchParams.get("notificationId") ?? ""
  const language = url.searchParams.get("language") ?? "en"
  const [row] = await query<any[]>("SELECT facility_id FROM death_notifications WHERE notification_id=?", [notificationId])
  if (!row) return fail(client, 4404, "Notification not found")
  const facilityScoped = user.role === "medical_officer" || user.role === "mortuary_clerk"
  if (facilityScoped && (!user.facility_id || row.facility_id !== user.facility_id)) {
    return fail(client, 4403, "This case belongs to another facility")
  }
  if (!config.whisperWsUrl) return fail(client, 4503, "Transcription service is not configured")

  const upstream = new WebSocket(config.whisperWsUrl, {
    headers: process.env.WHISPER_API_KEY ? { authorization: `Bearer ${process.env.WHISPER_API_KEY}` } : {},
  })
  const pending: (Buffer | string)[] = []
  let upstreamOpen = false

  upstream.on("open", () => {
    upstreamOpen = true
    upstream.send(JSON.stringify({ language }))
    for (const frame of pending.splice(0)) upstream.send(frame)
  })
  upstream.on("message", (data, isBinary) => {
    if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary })
  })
  const closeBoth = () => {
    if (client.readyState === WebSocket.OPEN) client.close()
    if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) upstream.close()
  }
  upstream.on("close", () => { void audit(); closeBoth() })
  upstream.on("error", () => { void audit(); closeBoth() })

  client.on("message", (data, isBinary) => {
    if (upstreamOpen && upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary })
    else if (pending.length < MAX_BUFFERED_FRAMES) pending.push(data as Buffer)
  })
  client.on("close", closeBoth)
  client.on("error", closeBoth)

  let audited = false
  async function audit() {
    if (audited) return
    audited = true
    await writeAudit(null, {
      userId: user.user_id,
      action: "stream_transcribe",
      entityType: "death_notifications",
      entityId: notificationId,
      details: { language, ip: req.socket.remoteAddress ?? null },
    }).catch(() => {})
  }
}

/** Attaches the voice-stream WebSocket proxy on /api/voice/stream.
 *  Socket.IO owns /socket.io/ — other paths fall through to this handler. */
export function attachVoiceStream(server: HttpServer) {
  const wss = new WebSocketServer({ noServer: true })
  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    let url: URL
    try {
      url = new URL(req.url ?? "", "http://localhost")
    } catch {
      socket.destroy()
      return
    }
    if (url.pathname !== "/api/voice/stream") return
    wss.handleUpgrade(req, socket, head, (client) => {
      void handle(client, url, req).catch(() => fail(client, 1011, "Internal error"))
    })
  })
}
