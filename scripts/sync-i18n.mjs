// Copies canonical i18n files into the two client targets:
//   mobile/assets/lang/   (bundled assets — fully offline)
//   client/src/i18n/      (lazy-loaded by Vite import.meta.glob)
// Run: node scripts/sync-i18n.mjs   (or `pnpm i18n:sync`)
import { copyFileSync, mkdirSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const src = join(root, "i18n")
const targets = [
  join(root, "mobile", "assets", "lang"),
  join(root, "client", "src", "i18n"),
]

let copied = 0
for (const dir of readdirSync(join(src, "lang"))) {
  if (!dir.endsWith(".json")) continue
  for (const t of targets) {
    mkdirSync(t, { recursive: true })
    copyFileSync(join(src, "lang", dir), join(t, dir))
    copied++
  }
}
for (const f of ["languages.json", "medical-glossary.json"]) {
  for (const t of targets) {
    mkdirSync(t, { recursive: true })
    copyFileSync(join(src, f), join(t, f))
    copied++
  }
}
console.log(`i18n:sync — copied ${copied} files into mobile/assets/lang and client/src/i18n`)
