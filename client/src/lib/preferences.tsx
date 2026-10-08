import { createContext, useContext, useState, useEffect, useMemo, type ReactNode } from "react"
import { api } from "./api"
import { useAuth } from "./auth"
import languagesMetaJson from "../i18n/languages.json"
import { setDateLocale } from "./format"

// Canonical 16-language registry (synced from i18n/languages.json).
export type Language = keyof typeof languagesMetaJson
export interface LanguageInfo {
  name: string
  nativeName: string
  written: boolean
  draft?: boolean
  note?: string
}
export const LANGUAGES = languagesMetaJson as Record<Language, LanguageInfo>
export const LANGUAGE_CODES = Object.keys(LANGUAGES) as Language[]
export const languageInfo = (code: string): LanguageInfo => LANGUAGES[code as Language] ?? LANGUAGES.en

// Dictionaries are lazy-imported from client/src/i18n/<code>.json
// (synced from the canonical i18n/lang/ source — run `pnpm i18n:sync`).
// When online, the latest overlay is fetched from `/api/i18n/:lang` and
// merged on top, so updated or generated translations apply without a rebuild.
type Dict = Record<string, string>
const loaders = import.meta.glob<{ default: Dict }>("../i18n/*.json")
const dicts: Record<string, Dict> = {}
const pending: Record<string, Promise<Dict>> = {}
function loadDict(code: string): Promise<Dict> {
  if (dicts[code]) return Promise.resolve(dicts[code])
  pending[code] ??= Promise.all([
    loaders[`../i18n/${code}.json`]?.()
      .then((m) => (m.default ?? {}))
      .catch(() => ({})) ?? Promise.resolve({}),
    api(`/api/i18n/${code}`).catch(() => ({} as Dict)),
  ]).then(([bundled, remote]) => {
    dicts[code] = { ...bundled, ...(remote as Dict) }
    return dicts[code]
  })
  return pending[code]
}
void loadDict("en")

type Theme = "system" | "light" | "dark" | "hc"

interface Preferences {
  theme: Theme
  language: Language
  /** Language metadata for the active language (e.g. the ZSL note). */
  languageInfo: LanguageInfo
  setTheme: (v: Theme) => void
  setLanguage: (v: Language) => void
  /** Translate an English UI literal; `{name}` placeholders are interpolated
   * from `vars`. Missing entries fall back to the English key. */
  t: (s: string, vars?: Record<string, unknown>) => string
}
const Context = createContext<Preferences>({
  theme: "system",
  language: "en",
  languageInfo: LANGUAGES.en,
  setTheme: () => {},
  setLanguage: () => {},
  t: (s) => s,
})

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [theme, setThemeState] = useState<Theme>((localStorage.getItem("dds_theme") || "system") as Theme)
  const [language, setLanguageState] = useState<Language>((localStorage.getItem("dds_language") || "en") as Language)
  const [dict, setDict] = useState<Dict>(dicts[language] ?? {})

  // Adopt the authenticated profile's preferences once known.
  useEffect(() => {
    if (user) api("/user/preferences").then((r) => {
      if (r.preferences.theme) setThemeState(r.preferences.theme)
      if (r.preferences.language) setLanguageState(r.preferences.language)
    }).catch(() => {})
  }, [user?.userId])

  // Theme side-effects (dark / high-contrast classes on <html>).
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)")
    const apply = () => {
      const root = document.documentElement
      root.classList.toggle("dark", theme === "dark" || (theme === "system" && media.matches))
      root.classList.toggle("hc", theme === "hc")
    }
    apply()
    media.addEventListener("change", apply)
    localStorage.setItem("dds_theme", theme)
    return () => media.removeEventListener("change", apply)
  }, [theme])

  // Language side-effects: <html lang>, localStorage, lazy dictionary load.
  useEffect(() => {
    const info = languageInfo(language)
    document.documentElement.lang = info.written ? language : "en"
    setDateLocale(info.written ? `${language}-ZW` : "en-GB")
    localStorage.setItem("dds_language", language)
    void loadDict(language).then(setDict)
  }, [language])

  function save(key: string, value: string) {
    if (user) void api("/user/preferences", { method: "PATCH", body: JSON.stringify({ key, value }) }).catch(() => {})
  }

  const value = useMemo<Preferences>(() => ({
    theme,
    language,
    languageInfo: languageInfo(language),
    setTheme: (v) => { setThemeState(v); save("theme", v) },
    setLanguage: (v) => { setLanguageState(v); save("language", v) },
    t: (s, vars) => {
      let out = dict[s] || s
      if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => vars[k] != null ? String(vars[k]) : m)
      return out
    },
  }), [theme, language, dict])

  return <Context.Provider value={value}>{children}</Context.Provider>
}

export const usePreferences = () => useContext(Context)
