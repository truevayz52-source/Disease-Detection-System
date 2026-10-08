import dgram from "node:dgram"
import os from "node:os"

/**
 * UDP LAN discovery beacon — broadcasts `DDS:<lanIp>:<port>` every few seconds
 * so the mobile app can auto-locate the API on the local network without a
 * hard-coded address. Best-effort: broadcast is dropped on some networks
 * (AP isolation, VPNs); the app also supports subnet scan and manual entry.
 *
 * Disabled with DISCOVERY_BEACON=0.
 */
const BEACON_PORT = 40401
const INTERVAL_MS = 3000

function lanIp(): string | null {
  for (const infos of Object.values(os.networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family === "IPv4" && !info.internal) return info.address
    }
  }
  return null
}

export function startDiscoveryBeacon(port: number) {
  if (process.env.DISCOVERY_BEACON === "0") return
  const ip = lanIp()
  if (!ip) {
    console.warn("[beacon] no LAN interface found — discovery beacon disabled")
    return
  }
  const sock = dgram.createSocket({ type: "udp4", reuseAddr: true })
  sock.on("error", (err) => {
    console.warn(`[beacon] socket error: ${err.message}`)
    try { sock.close() } catch { /* noop */ }
  })
  sock.bind(() => {
    try {
      sock.setBroadcast(true)
    } catch (err) {
      console.warn(`[beacon] broadcast unavailable: ${err}`)
      sock.close()
      return
    }
    const payload = Buffer.from(`DDS:${ip}:${port}`)
    const timer = setInterval(() => {
      sock.send(payload, BEACON_PORT, "255.255.255.255", (err) => {
        if (err) console.warn(`[beacon] send failed: ${err.message}`)
      })
    }, INTERVAL_MS)
    timer.unref()
    console.log(`[beacon] broadcasting DDS:${ip}:${port} on UDP ${BEACON_PORT}`)
  })
}
