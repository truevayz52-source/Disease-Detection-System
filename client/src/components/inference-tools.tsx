import { useState, useEffect, useRef } from "react"
import useSWR from "swr"
import { api } from "@/lib/api"
import { Action, Field, LoadState, Panel, Rows } from "@/components/workspace"
import { PcmCapture } from "@/lib/audio-capture"
import { openTranscriptionStream, type TranscriptionStream } from "@/lib/transcription-stream"
import { toast } from "sonner"
import { usePreferences } from "@/lib/preferences"

/**
 * Verbal-autopsy audio intake: live agreement-confirmed transcription from
 * the local Whisper service, or batch file upload. Every word pushed via
 * onText was confirmed by the service's repeated-window decode — there is no
 * draft tier. Ndebele is unsupported by Whisper and gets manual guidance.
 */
export function AudioTranscription({ notificationId, language, onText }: { notificationId: string; language: string; onText: (text: string) => void }) {
  const { t } = usePreferences()
  const status = useSWR<{ configured: boolean }>("/voice/status", api)
  const [recording, setRecording] = useState(false)
  const [pending, setPending] = useState("")
  const [level, setLevel] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [file, setFile] = useState<File>()
  const capture = useRef<PcmCapture | null>(null)
  const stream = useRef<TranscriptionStream | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined)

  async function stopRecording() {
    clearInterval(timer.current)
    const c = capture.current; capture.current = null
    const s = stream.current; stream.current = null
    await c?.stop().catch(() => {})
    if (s) { await s.finish(); s.close() }
    setRecording(false)
    setPending("")
    setLevel(0)
  }

  // Stopping on unmount and on case/language change prevents a stream bound
  // to the old notification from writing text into the new selection.
  useEffect(() => () => { void stopRecording() }, [notificationId, language])

  async function startRecording() {
    if (!notificationId) throw Error(t("Select a case first"))
    if (!status.data?.configured) throw Error(t("The transcription service is not configured"))
    const s = await openTranscriptionStream(
      { notificationId, language },
      {
        onFinal: (t) => { setPending(""); onText(t) },
        onPending: setPending,
        onError: (m) => toast.error(m),
        onClose: (done) => { if (recording && !done) { setRecording(false); toast.error(t("Transcription stream closed — confirmed text was kept.")) } },
      },
    )
    stream.current = s
    const c = new PcmCapture()
    await c.start({ onFrame: (f) => s.send(f), onLevel: setLevel })
    capture.current = c
    setElapsed(0)
    setRecording(true)
    timer.current = setInterval(() => setElapsed((e) => e + 1), 1000)
  }

  async function upload() {
    if (!notificationId) throw Error(t("Select a case first"))
    if (!file) throw Error(t("Choose an audio file first"))
    const body = new FormData()
    body.append("file", file)
    body.append("notificationId", notificationId)
    body.append("language", language)
    const result = await api("/voice/transcribe", { method: "POST", body })
    onText(result.text)
    setFile(undefined)
    toast.success(t("Audio transcribed — review before saving"))
  }

  if (language === "nd") {
    return (
      <div className="space-y-3 rounded-lg border p-4">
        <p className="text-sm text-muted-foreground">
          Ndebele is not supported by the transcription engine — no Whisper model includes it.
          Type or paste the transcript below and save it; recording stays available as a
          reference attachment via the case's image upload if needed.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center gap-3">
        <Action variant="outline" disabled={!status.data?.configured} onClick={async () => { recording ? await stopRecording() : await startRecording() }}>
          {recording ? "Stop and finalize" : "Start live transcription"}
        </Action>
        {recording && (
          <>
            <span className="text-sm tabular-nums">{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}</span>
            <span className="h-2 w-24 overflow-hidden rounded bg-muted"><span className="block h-full bg-primary transition-[width]" style={{ width: `${Math.min(100, Math.round(level * 400))}%` }} /></span>
          </>
        )}
      </div>
      {status.data && !status.data.configured && (
        <p className="text-xs text-muted-foreground">{t("Transcription service is not configured — upload and live capture are disabled.")}</p>
      )}
      {language === "sn" && (
        <p className="text-xs text-muted-foreground">{t("Shona transcription accuracy is limited — review the output carefully against the audio.")}</p>
      )}
      {pending && <p className="text-sm italic text-muted-foreground">{pending}</p>}
      <div className="flex items-center gap-3 border-t pt-3">
        <input className="block w-full text-sm" type="file" accept="audio/*" onChange={(e) => setFile(e.target.files?.[0])} disabled={recording} />
        <Action variant="outline" disabled={recording || !status.data?.configured} onClick={upload}>
          Transcribe file
        </Action>
      </div>
      <p className="text-xs text-muted-foreground">
        Confirmed words appear in the transcript as they are finalized. Processing is local —
        no audio leaves this machine.
      </p>
    </div>
  )
}

export function PathologyInference({ imageId }: { imageId: string }) {
  const { t } = usePreferences()
  const { data, error } = useSWR<any>(`/ai/pathology/results/${imageId}`, api)

  // AI pathology analysis is not yet implemented
  return (
    <Panel title={t("AI pre-screening")}>
      <p className="text-sm text-muted-foreground">
        AI-assisted pathology pre-screening is under development.
        This feature will use deep learning models to highlight potential anomalies in histological images.
        Model output will require pathologist review and does not finalize the diagnosis.
      </p>
      <Action variant="outline" disabled>
        Analyze selected image (Coming Soon)
      </Action>
      <LoadState error={error} />
      {data?.items?.length > 0 && (
        <Rows items={data.items} columns={[["model_version", "Model"], ["anomaly_score", "Anomaly score"], ["confidence_score", "Confidence"], ["analysis_timestamp", "Analyzed"]]} />
      )}
    </Panel>
  )
}

export function WhoLookup() {
  const { t } = usePreferences()
  const [q, setQ] = useState(""), [items, setItems] = useState<any[]>([])
  return <Panel title={t("WHO ICD-11 reference")}><p className="text-sm text-muted-foreground">{t("Reference lookup in the configured WHO release. Case coding continues to use the local catalog.")}</p><Field label={t("Search ICD-11")} value={q} onChange={setQ} /><Action variant="outline" onClick={async () => { setItems([]); const result = await api(`/icd-codes/who?q=${encodeURIComponent(q)}`); setItems(result.items) }}>{t("Search WHO catalog")}</Action>{items.length > 0 && <Rows items={items} columns={[["code", "Code"], ["title", "Description"], ["release", "Release"]]} />}</Panel>
}
