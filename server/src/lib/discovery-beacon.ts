import dgram from "node:dgram"
import os from "node:os"

/**
 * UDP LAN discovery beacon — broadcasts `DDS:<lanIp>:<port>` every few seconds
 * so the mobile app can auto-locate the API on the local network without a
 * hard-coded address. Best-effort: broadcast is dropped on some networks
 * (AP isolation, VPNs); the app also supports subnet scan and manual entry.
 *
 * The interface list is re-read on every tick — switching Wi-Fi networks or
 * plugging/unplugging Ethernet is picked up within one interval, no restart.
 * Each interface's directed broadcast carries that interface's own address,
 * so virtual adapters (Hyper-V/WSL/Docker) don't poison the advertisement.
 *
 * Disabled with DISCOVERY_BEACON=0.
 */
const BEACON_PORT = 40401
const INTERVAL_MS = 3000

function addrToInt(addr: string): number {
  const parts = addr.split(".").map(Number)
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
}

function intToAddr(n: number): string {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".")
}

/** Every non-internal IPv4 interface paired with its directed broadcast
 *  address (ip | ~netmask). */
function broadcastTargets(): { ip: string; bcast: string }[] {
  const out: { ip: string; bcast: string }[] = []
  for (const infos of Object.values(os.networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family !== "IPv4" || info.internal) continue
      const ip = addrToInt(info.address)
      const mask = addrToInt(info.netmask)
      out.push({ ip: info.address, bcast: intToAddr((ip & mask) | (~mask >>> 0)) })
    }
  }
  return out
}

export function startDiscoveryBeacon(port: number) {
  if (process.env.DISCOVERY_BEACON === "0") return
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
    let announced = ""
    const timer = setInterval(() => {
      const targets = broadcastTargets()
      // Log only when the set changes — the tick would spam the console.
      const signature = targets.map((t) => t.ip).sort().join(",")
      if (signature !== announced) {
        announced = signature
        if (targets.length) {
          console.log(`[beacon] broadcasting DDS on UDP ${BEACON_PORT}: ${targets.map((t) => `${t.ip}:${port}`).join(", ")}`)
        } else {
          console.warn("[beacon] no LAN interface — beacon idle")
        }
      }
      for (const t of targets) {
        // Per-interface directed broadcast, then the limited broadcast as a
        // fallback for stacks that drop subnet-directed broadcasts.
        for (const dest of [t.bcast, "255.255.255.255"]) {
          sock.send(Buffer.from(`DDS:${t.ip}:${port}`), BEACON_PORT, dest, () => {})
        }
      }
    }, INTERVAL_MS)
    timer.unref()
  })
}
