// Harvests human-verified UI strings from public open-source localisation
// corpora (GNU gettext .po files) for languages that have them, writing
// i18n/corpora/<code>.json maps of  English source string -> translation.
//
// Sources (best-effort; failures are logged, never fatal):
//   - GNOME / gtk+ / other freedesktop projects mirror PO catalogs on GitHub
//   - KDE l10n SVN mirror (websvn) serves raw .po for many African locales
//   - translate.org.za archives (Southern African languages)
//
// Only pairs whose msgid EXACTLY matches a key in i18n/lang/en.json are kept
// (plus a case-insensitive pass), and only when every {placeholder} survives.
//
// Run: node scripts/fetch-corpora.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const en = JSON.parse(readFileSync(join(root, "i18n", "lang", "en.json"), "utf8"))
const enKeys = new Set(Object.keys(en).filter((k) => !k.startsWith("_")))
const enLower = new Map([...enKeys].map((k) => [k.toLowerCase(), k]))

// Our code -> candidate upstream gettext codes in the catalogs we fetch.
const LANG_CODES = {
  st: ["st"], tn: ["tn"], ts: ["ts"], ve: ["ve"], xh: ["xh"],
  sn: ["sn"], nd: ["nd", "nr"], ny: ["ny"], toi: ["toi", "to"],
}

// Public PO catalogs. Each entry: { url, code, charset? }
// KDE l10n svn mirror — kde4messages are old but stable for UI terms.
const SOURCES = []
for (const [code, ups] of Object.entries(LANG_CODES)) {
  for (const up of ups) {
    SOURCES.push(
      { code, url: `https://websvn.kde.org/*checkout*/trunk/l10n-kde4/${up}/messages/kdelibs/kdelibs4.po?revision=HEAD` },
      { code, url: `https://websvn.kde.org/*checkout*/trunk/l10n-kf5/${up}/messages/kdelibs/kdelibs4.po` },
    )
  }
}
// GNOME gtk3 po files on GitHub mirror (gnome-i18n moved to gitlab; github mirror is read-only)
for (const [code, ups] of Object.entries(LANG_CODES)) {
  for (const up of ups) {
    SOURCES.push({ code, url: `https://raw.githubusercontent.com/GNOME/gtk/main/po/${up}.po` })
    SOURCES.push({ code, url: `https://raw.githubusercontent.com/GNOME/glib/main/po/${up}.po` })
  }
}

const TIMEOUT = 15000

async function fetchText(url) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), TIMEOUT)
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { "user-agent": "dds-i18n-corpora/1.0" } })
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    if (buf.byteLength < 100 || buf.byteLength > 8_000_000) return null
    const text = new TextDecoder("utf-8").decode(buf)
    if (!text.includes("msgid")) return null
    return text
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

// Minimal .po parser: msgid "..." / msgstr "..." pairs, multiline joins, skips fuzzy/header.
function parsePo(src) {
  const pairs = []
  let msgid = null, msgstr = null, state = null, fuzzy = false
  const flush = () => {
    if (msgid != null && msgstr != null && !fuzzy && msgid !== "") pairs.push([msgid, msgstr])
    msgid = msgstr = null; fuzzy = false
  }
  const unq = (s) => {
    try { return JSON.parse(s) } catch { return null }
  }
  for (const raw of src.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === "" || line === "#, fuzzy") { if (line === "") { flush(); state = null } else if (line.includes("fuzzy")) fuzzy = true; continue }
    if (line.startsWith("#")) continue
    if (line.startsWith("msgid ")) {
      if (state === "str") flush()
      msgid = unq(line.slice(6)) ?? ""; state = "id"; continue
    }
    if (line.startsWith("msgstr ")) {
      msgstr = unq(line.slice(7)) ?? ""; state = "str"; continue
    }
    if (line.startsWith('"')) {
      const v = unq(line)
      if (v == null) continue
      if (state === "id") msgid = (msgid ?? "") + v
      else if (state === "str") msgstr = (msgstr ?? "") + v
    }
  }
  flush()
  return pairs
}

const placeholderRe = /\{[^{}]+\}/g
const keepPlaceholders = (enKey, tr) => {
  const need = enKey.match(placeholderRe) ?? []
  return need.every((p) => tr.includes(p))
}

const out = {}
const report = []
for (const src of SOURCES) {
  const po = await fetchText(src.url)
  if (!po) { report.push(`✗ ${src.code} ${src.url}`); continue }
  const pairs = parsePo(po)
  const map = (out[src.code] ??= {})
  let hits = 0
  for (const [id, tr] of pairs) {
    const key = enKeys.has(id) ? id : enLower.get(id.toLowerCase())
    if (!key) continue
    const clean = tr.trim()
    if (!clean || clean === key) continue
    if (!keepPlaceholders(key, clean)) continue
    if (!(key in map)) { map[key] = clean; hits++ }
  }
  report.push(`${hits ? "✓" : "·"} ${src.code} ${src.url.split("/").slice(-1)[0]} — ${pairs.length} entries, ${hits} matched`)
}

mkdirSync(join(root, "i18n", "corpora"), { recursive: true })
let wrote = 0
for (const [code, map] of Object.entries(out)) {
  writeFileSync(join(root, "i18n", "corpora", `${code}.json`), JSON.stringify({ _meta: "Human-verified strings harvested from open-source gettext catalogs; win over machine output for identical keys.", ...map }, null, 2) + "\n")
  wrote++
}
console.log(report.join("\n"))
console.log(`\ncorpora written for ${wrote} languages: ${Object.entries(out).map(([c, m]) => `${c}=${Object.keys(m).length}`).join(", ") || "none"}`)
