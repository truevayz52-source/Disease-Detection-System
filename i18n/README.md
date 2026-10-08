# DDS i18n — Zimbabwe 16-language support

One canonical translation source shared by the React web client, the Flutter
app and (for language metadata) the Express API.

## Key scheme

**Keys are English source strings**, e.g. `"Death Notifications": "Zviziviso
zerufu"`. Rationale:

- The web client's existing `t()` in `lib/preferences.tsx` already works this
  way — zero re-keying of existing call sites.
- Missing translations degrade to readable English automatically (the key IS
  the fallback), so no screen can ever show a raw symbolic key.
- One dictionary set serves both clients.

Trade-off: editing English copy orphans the old key. Run `pnpm i18n:check` to
detect keys present in dictionaries but no longer referenced in code.

`{placeholder}` interpolation: `"Offline — {n} item(s) pending sync"` — callers
pass values; translators must keep placeholders verbatim (enforced by
`i18n:check`).

## Directory layout

```
i18n/
  languages.json          canonical language list (code → names, written flag)
  lang/<code>.json        UI dictionaries, English-literal keys
  medical-glossary.json   offline fallback glossary for dynamic text
scripts/
  sync-i18n.mjs           copies canonical files into the two clients
  check-i18n.mjs          scans code for t()/tr() keys, validates parity
```

Sync targets (generated — do not edit directly):

- `mobile/assets/lang/*.json`  (bundled with the app; works offline)
- `client/src/i18n/*.json`     (lazy-loaded via Vite `import.meta.glob`)

## Commands

```bash
pnpm i18n:sync     # copy canonical files into mobile/assets/lang + client/src/i18n
pnpm i18n:scan     # scan t()/tr() call sites, regenerate i18n/lang/en.json
pnpm i18n:check    # validate JSON, key parity and placeholder preservation
pnpm i18n:corpora  # harvest verified strings from open-source gettext catalogs
pnpm i18n:build    # machine-generate missing keys (GEMINI_API_KEY) + report
```

## Dictionary provenance

Dictionary values resolve in three tiers, in order:

1. `i18n/corpora/<code>.json` — human-verified strings matched from public
   gettext catalogs (GNOME/KDE/LibreOffice). Coverage is small because these
   languages are poorly represented in FOSS l10n.
2. Existing seed values in `i18n/lang/<code>.json` — earlier curated seeds.
3. Machine translation via `scripts/build-dictionaries.mjs` — Gemini
   (`GEMINI_API_KEY`/`TRANSLATE_MODEL` in `server/.env`) with a model fallback
   chain for free-tier congestion; MyMemory is the keyless fallback.

Machine output is always draft-marked in `_meta`; low-resource languages
(Chibarwe, Kalanga, Tshwa, Nambya, Ndau, Tonga) have no reliable MT coverage —
their output is best-effort with family-hint prompting and needs review by
MOHCC language services before production use. Provider responses are cached
in `i18n/.cache/` (gitignored) so re-runs are incremental.

## Languages (Constitution of Zimbabwe, s.6)

| Code | Language | Status |
|------|----------|--------|
| en | English | base |
| sn | chiShona | draft — needs native review |
| nd | isiNdebele | draft — needs native review |
| ny | Chewa / Chinyanja | draft — needs native review |
| ts | Xitsonga (Shangani) | draft — needs native review |
| st | Sesotho | draft — needs native review |
| tn | Setswana | draft — needs native review |
| ve | Tshivenda | draft — needs native review |
| xh | isiXhosa | draft — needs native review |
| toi | chiTonga | draft — low-resource, needs native review |
| kck | TjiKalanga | draft — low-resource, needs native review |
| nmq | ChiNambya | draft — low-resource, needs native review |
| ndc | ChiNdau | draft — low-resource, needs native review |
| sbn | Chibarwe | draft — low-resource, needs native review |
| huc | Koisan / Tshwa | draft — low-resource, needs native review |
| zsl | Zimbabwe Sign Language | non-text — selector entry renders English + notice; signed video guidance is a planned module |

Notes:

- `zsl` is used as the internal code for Zimbabwe Sign Language per the project
  spec (in ISO 639-3 `zsl` denotes Zambian Sign Language). It is an
  application-internal identifier only.
- `flutter_localizations` (Material widget chrome: date pickers, dialogs) does
  not cover most of these locales; unsupported locales fall back to English
  chrome. This is expected and acceptable.
- All non-English dictionaries are machine-generated drafts pending review by
  native speakers / MOHCC language services. Clinical terminology requires
  professional validation before production use.

## Dynamic text translation

Static dictionaries cover UI chrome only. Record text (autopsy findings,
clinical summaries, transcripts) goes through `POST /api/translate`, which
de-identifies the text (see `server/src/lib/deidentify.ts`) before calling the
configured provider — Gemini never receives names, IDs, addresses or facility
details. Offline, `medical-glossary.json` provides term-level substitution.
