import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import { CheckCheck, CheckCircle2, Loader2, Radar, Siren, Volume2, VolumeX } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { usePreferences } from "@/lib/preferences"
import type { OutbreakAlert } from "@/lib/types"

const REPEAT_MS = 15_000
const VOICE_KEY = "dds.alertVoice"

/** Spoken label per alert type — acronyms spelled out for the voice. */
function speakableType(a: OutbreakAlert) {
  return a.alert_type === "mpdsr" ? "M P D S R" : a.alert_type === "early_warning" ? "early warning" : "outbreak"
}

function alertTypeLabel(a: OutbreakAlert, t: (s: string) => string) {
  return a.alert_type === "mpdsr" ? "MPDSR" : a.alert_type === "early_warning" ? t("Early warning") : t("Outbreak")
}

function announcementText(alerts: OutbreakAlert[]) {
  const head = alerts.length === 1
    ? "Attention. One active surveillance alert requires analyst action."
    : `Attention. ${alerts.length} active surveillance alerts require analyst action.`
  const body = alerts
    .map((a) => `${speakableType(a)} alert — ${a.disease_category}, ${a.district} district, ${a.case_count} case${a.case_count === 1 ? "" : "s"} on record.`)
    .join(" ")
  return `${head} ${body}`
}

/**
 * Audible alert announcer for the duty analyst at MOHCC headquarters.
 * Speaks the active alert set aloud every few seconds until the analyst
 * takes one of the response actions (acknowledge, open triage, re-run
 * detection, resolve). Acknowledgement is per alert-set: any change to the
 * active alert IDs re-arms the voice so a new alert is never silently
 * swallowed by an earlier acknowledgement.
 */
export function AlertAnnouncer({ alerts, onChanged }: { alerts: OutbreakAlert[]; onChanged?: () => void }) {
  const { t } = usePreferences()
  const { user } = useAuth()
  const canManage = user?.role === "public_health_analyst"
  const speechOk = typeof window !== "undefined" && "speechSynthesis" in window

  const alertKey = alerts.map((a) => a.alert_id).sort().join(",")
  const [ackedKey, setAckedKey] = useState("")
  const [voiceOn, setVoiceOn] = useState(() => localStorage.getItem(VOICE_KEY) !== "0")
  const [busy, setBusy] = useState<string | null>(null)
  const acknowledged = ackedKey === alertKey

  const speak = useCallback(() => {
    if (!speechOk || !alerts.length) return
    const utterance = new SpeechSynthesisUtterance(announcementText(alerts))
    utterance.rate = 1
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utterance)
  }, [speechOk, alerts])

  // Voice loop — repeats until acknowledged or the alert set clears.
  useEffect(() => {
    if (!speechOk || !voiceOn || acknowledged || !alerts.length) return
    speak()
    const id = window.setInterval(speak, REPEAT_MS)
    return () => {
      window.clearInterval(id)
      window.speechSynthesis.cancel()
    }
  }, [speechOk, voiceOn, acknowledged, alerts.length, speak])

  function silence() {
    if (speechOk) window.speechSynthesis.cancel()
    setAckedKey(alertKey)
  }

  function toggleVoice() {
    const next = !voiceOn
    localStorage.setItem(VOICE_KEY, next ? "1" : "0")
    setVoiceOn(next)
    if (!next && speechOk) window.speechSynthesis.cancel()
    else if (next && alerts.length) speak()
  }

  async function rescan() {
    silence()
    setBusy("rescan")
    try {
      const r = await api<{ created: unknown[] }>("/analytics/detect", { method: "POST" })
      toast.success(r.created.length ? t("{n} new alert(s) raised", { n: r.created.length }) : t("Detection scan complete — no new alerts"))
      onChanged?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Detection scan failed")
    } finally {
      setBusy(null)
    }
  }

  async function resolveAlert(a: OutbreakAlert) {
    silence()
    setBusy(a.alert_id)
    try {
      await api(`/alerts/${a.alert_id}/resolve`, { method: "PATCH" })
      toast.success(t("Alert resolved."))
      onChanged?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Resolve failed")
    } finally {
      setBusy(null)
    }
  }

  if (!alerts.length || acknowledged) return null

  return (
    <div className="animate-siren-glow rounded-2xl border-2 bg-gradient-to-r from-red-600 to-red-800 p-4 text-white shadow-lg">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="flex items-center gap-2">
          <Siren className="size-5 animate-pulse" />
          <span className="text-sm font-bold tracking-wide uppercase">
            {t("Active alert")} — {alerts.length} {t("requiring analyst action")}
          </span>
        </span>
        {speechOk && (
          <span className="flex items-center gap-1 text-[11px] font-medium text-white/80">
            {voiceOn ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5" />}
            {voiceOn ? t("voice announcing") : t("voice muted")}
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {speechOk && (
            <Button size="sm" variant="secondary" onClick={toggleVoice} className="bg-white/15 text-white hover:bg-white/25 border-0">
              {voiceOn ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
              {voiceOn ? t("Mute voice") : t("Unmute voice")}
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={silence} className="bg-white text-red-700 hover:bg-red-50 font-semibold">
            <CheckCheck className="size-4" /> {t("Acknowledge")}
          </Button>
          <Button size="sm" variant="secondary" asChild className="bg-white/15 text-white hover:bg-white/25 border-0">
            <Link to="/alerts" onClick={silence}>{t("Open alert triage")}</Link>
          </Button>
          {canManage && (
            <Button size="sm" variant="secondary" onClick={rescan} disabled={busy === "rescan"} className="bg-white/15 text-white hover:bg-white/25 border-0">
              {busy === "rescan" ? <Loader2 className="size-4 animate-spin" /> : <Radar className="size-4" />}
              {t("Re-run detection")}
            </Button>
          )}
        </div>
      </div>
      <ul className="mt-3 space-y-1.5">
        {alerts.map((a) => (
          <li key={a.alert_id} className="flex flex-wrap items-center gap-2 rounded-lg bg-black/20 px-3 py-1.5 text-xs">
            <Badge variant="secondary" className="bg-white/20 text-white border-0 text-[10px] font-semibold">
              {alertTypeLabel(a, t)}
            </Badge>
            <span className="font-semibold">{a.disease_category}</span>
            <span className="text-white/80">
              {a.district} · {a.case_count} {a.case_count === 1 ? t("case") : t("cases")} · {t("risk")} {a.risk_score}
            </span>
            {canManage && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => resolveAlert(a)}
                disabled={busy === a.alert_id}
                className="ml-auto h-6 bg-white/15 px-2 text-[11px] text-white hover:bg-white/25 border-0"
              >
                {busy === a.alert_id ? <Loader2 className="size-3 animate-spin" /> : <CheckCircle2 className="size-3" />}
                {t("Resolve")}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
