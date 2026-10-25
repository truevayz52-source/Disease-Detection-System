import { readFileSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { join } from "node:path"

const dir = fileURLToPath(new URL(".", import.meta.url))
const src = readFileSync(join(dir, "mock-defense-script.txt"), "utf8")

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
const lines = src.split(/\r?\n/).filter(Boolean).map((l) => {
  const i = l.indexOf(":")
  const who = l.slice(0, i).trim()
  const text = esc(l.slice(i + 1).trim())
  const cls = who === "PANEL" ? "panel" : "student"
  const label = who === "PANEL" ? "Panel" : "Student"
  return `<div class="turn ${cls}"><span class="who">${label}</span><p>${text}</p></div>`
})

const html = `<!doctype html><html><head><meta charset="utf-8"><title>Mock Defense Script — DDS</title>
<style>
@page { margin: 2.2cm 2cm; }
body { font-family: Georgia, "Times New Roman", serif; font-size: 11.5pt; line-height: 1.55; color: #1a1a1a; max-width: 720px; margin: 0 auto; }
header { border-bottom: 3px solid #166534; padding-bottom: 14px; margin-bottom: 24px; }
h1 { font-family: "Segoe UI", Arial, sans-serif; font-size: 20pt; color: #14532d; margin: 0 0 4px; }
.sub { font-family: "Segoe UI", Arial, sans-serif; font-size: 10pt; color: #555; }
.turn { margin: 0 0 14px; padding: 10px 14px; border-radius: 6px; }
.turn p { margin: 4px 0 0; }
.who { font-family: "Segoe UI", Arial, sans-serif; font-size: 9pt; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; }
.panel { background: #f1f5f9; border-left: 4px solid #64748b; }
.panel .who { color: #475569; }
.student { background: #f0fdf4; border-left: 4px solid #16a34a; }
.student .who { color: #15803d; }
footer { margin-top: 28px; padding-top: 10px; border-top: 1px solid #ccc; font-family: "Segoe UI", Arial, sans-serif; font-size: 8.5pt; color: #777; }
</style></head><body>
<header><h1>Disease Detection System</h1><div class="sub">Mock Defense Script — Student &amp; Panel Dialogue · Capstone Project Defense Practice</div></header>
${lines.join("\n")}
<footer>Generated from defense/mock-defense-script.txt — practice with the matching audio track: defense/mock-defense.wav</footer>
</body></html>`

const htmlPath = join(dir, "mock-defense-script.html")
writeFileSync(htmlPath, html)

const edges = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
]
const pdf = join(dir, "mock-defense-script.pdf")
for (const edge of edges) {
  try {
    execFileSync(edge, ["--headless", "--disable-gpu", `--print-to-pdf=${pdf}`, `file:///${htmlPath.replace(/\\/g, "/")}`], { timeout: 60000 })
    break
  } catch (e) {
    if (edge === edges[edges.length - 1]) throw e
  }
}
console.log("PDF written:", pdf)
