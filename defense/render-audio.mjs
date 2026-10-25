// Renders mock-defense-script.txt to mock-defense.wav using Windows SAPI.
// STUDENT lines -> David (male), PANEL lines -> Zira (female).
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const dir = path.dirname(fileURLToPath(import.meta.url))
const scriptPath = path.join(dir, "mock-defense-script.txt")
const outPath = path.join(dir, "mock-defense.wav")
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dds-defense-"))

const lines = fs.readFileSync(scriptPath, "utf-8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
const segments = []
for (const [i, line] of lines.entries()) {
  const m = line.match(/^(STUDENT|PANEL):\s*(.*)$/)
  if (!m) continue
  const voice = m[1] === "STUDENT" ? "Microsoft David Desktop" : "Microsoft Zira Desktop"
  const text = m[2].replace(/'/g, "''")
  const wav = path.join(tmp, `seg-${String(i).padStart(3, "0")}.wav`)
  const ps = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SelectVoice('${voice}'); $s.SetOutputToWaveFile('${wav.replace(/'/g, "''")}'); $s.Speak('${text}'); $s.Dispose()`
  execFileSync("powershell", ["-NoProfile", "-Command", ps])
  segments.push(fs.readFileSync(wav))
}

// Concatenate PCM WAV segments: keep first header, join data chunks.
function parseWav(buf) {
  const dataOffset = buf.indexOf("data", 12)
  const dataSize = buf.readUInt32LE(dataOffset + 4)
  return { header: buf.subarray(0, dataOffset + 8), data: buf.subarray(dataOffset + 8, dataOffset + 8 + dataSize) }
}
const parts = segments.map(parseWav)
const totalData = parts.reduce((a, p) => a + p.data.length, 0)
const header = Buffer.from(parts[0].header)
// Patch RIFF size and data size for the merged file.
header.writeUInt32LE(36 + totalData, 4)
header.writeUInt32LE(totalData, header.length - 4)
fs.writeFileSync(outPath, Buffer.concat([header, ...parts.map((p) => p.data)]))
fs.rmSync(tmp, { recursive: true, force: true })
console.log(`Wrote ${outPath} (${(totalData / 16000).toFixed(1)}s)`)
