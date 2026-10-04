/**
 * PCM microphone capture for the streaming transcription pipeline.
 *
 * Captures mono audio, resamples to 16 kHz and quantizes to signed 16-bit
 * little-endian — the format the Whisper stream endpoint consumes. Raw PCM is
 * used instead of MediaRecorder/WebM because streaming decode windows the
 * samples arbitrarily; container chunks can't be split mid-stream.
 */

const WORKLET_SOURCE = `
class PcmTap extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (ch && ch.length) this.port.postMessage(ch.slice(0))
    return true
  }
}
registerProcessor("pcm-tap", PcmTap)
`

export interface PcmCaptureOptions {
  /** Called with each frame of s16le PCM bytes ready to send upstream. */
  onFrame: (frame: ArrayBuffer) => void
  /** RMS level 0..1 for the mic meter — called per frame. */
  onLevel?: (rms: number) => void
}

export class PcmCapture {
  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private node: AudioWorkletNode | null = null

  static isSupported(): boolean {
    return typeof AudioContext !== "undefined" && typeof AudioWorkletNode !== "undefined" && !!navigator.mediaDevices?.getUserMedia
  }

  async start(opts: PcmCaptureOptions): Promise<void> {
    if (!PcmCapture.isSupported()) throw new Error("Live capture is not supported in this browser. Upload a recording instead.")
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    })
    // The context resamples device rate -> 16 kHz for us.
    this.ctx = new AudioContext({ sampleRate: 16000 })
    const source = this.ctx.createMediaStreamSource(this.stream)
    const workletUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "application/javascript" }))
    try {
      await this.ctx.audioWorklet.addModule(workletUrl)
    } finally {
      URL.revokeObjectURL(workletUrl)
    }
    this.node = new AudioWorkletNode(this.ctx, "pcm-tap")
    this.node.port.onmessage = (event: MessageEvent<Float32Array>) => {
      const samples = event.data
      opts.onLevel?.(Math.sqrt(samples.reduce((acc, s) => acc + s * s, 0) / samples.length))
      const pcm = new Int16Array(samples.length)
      for (let i = 0; i < samples.length; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]))
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff
      }
      opts.onFrame(pcm.buffer)
    }
    source.connect(this.node)
    // Some browsers only run the worklet when it reaches the destination —
    // route through a zero-gain node so the mic never monitors to speakers.
    const mute = this.ctx.createGain()
    mute.gain.value = 0
    this.node.connect(mute)
    mute.connect(this.ctx.destination)
  }

  async stop(): Promise<void> {
    this.node?.disconnect()
    this.node = null
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    await this.ctx?.close()
    this.ctx = null
  }
}
