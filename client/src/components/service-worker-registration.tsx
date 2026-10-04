import { useEffect } from "react"
import { syncQueue } from "@/lib/offline-queue"

/**
 * Registers the PWA service worker so DDS can be installed on Android
 * and iOS home screens and keeps working with degraded connectivity in
 * rural health facilities (Chapter 1.3 objective: accessible, resilient
 * reporting infrastructure).
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    const sync = () => { void syncQueue().catch(() => {}) }
    window.addEventListener("online", sync)
    const timer = setInterval(sync, 30000)
    return () => { window.removeEventListener("online", sync); clearInterval(timer) }
  }, [])
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return
    if (!import.meta.env.PROD) return

    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.error(")[dds] Service worker registration failed", err)
    })
  }, [])

  return null
}
