/**
 * WebSocket client for the agreement-confirmed transcription stream.
 *
 * Server events: {final, pending} while streaming, {final, done:true} on
 * finalize, {error, done:true} on terminal failure. `final` text is stable —
 * it was confirmed by the service's repeated-window decode and never changes.
 */
import { getToken } from "./api"

export interface StreamCallbacks {
  onFinal: (text: string) => void
  onPending?: (text: string) => void
  onError?: (message: string) => void
  onClose?: (done: boolean) => void
}

export interface TranscriptionStream {
  send: (frame: ArrayBuffer) => void
  /** Send the finalize frame; resolves when the server emits done. */
  finish: () => Promise<void>
  close: () => void
}

export function openTranscriptionStream(
  opts: { notificationId: string; language: string },
  cb: StreamCallbacks,
): Promise<TranscriptionStream> {
  const params = new URLSearchParams({
    token: getToken() ?? "",
    notificationId: opts.notificationId,
    language: opts.language,
  })
  const proto = location.protocol === "https:" ? "wss" : "ws"
  const ws = new WebSocket(`${proto}://${location.host}/api/voice/stream?${params}`)

  return new Promise((resolve, reject) => {
    let doneReceived = false
    let finishResolve: (() => void) | null = null

    ws.onopen = () => {
      resolve({
        send: (frame) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(frame)
        },
        finish: () =>
          new Promise<void>((res) => {
            finishResolve = res
            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "finalize" }))
            else res()
            // Safety: never hang the UI waiting for a dropped socket.
            setTimeout(res, 15000)
          }),
        close: () => ws.close(),
      })
    }
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data))
        if (msg.error) cb.onError?.(msg.error)
        if (msg.pending) cb.onPending?.(msg.pending)
        if (msg.final) cb.onFinal?.(msg.final)
        if (msg.done) {
          doneReceived = true
          finishResolve?.()
        }
      } catch { /* ignore malformed frames */ }
    }
    ws.onerror = () => {
      reject(new Error("Could not reach the transcription service"))
      cb.onError?.("Could not reach the transcription service")
    }
    ws.onclose = () => {
      cb.onClose?.(doneReceived)
      finishResolve?.()
    }
  })
}
