// The 16 official languages of Zimbabwe (Constitution, s.6). Canonical codes —
// kept in sync with i18n/languages.json and both clients.
// Note: "zsl" is used internally for Zimbabwe Sign Language per the project
// spec (ISO 639-3 assigns zsl to Zambian Sign Language); it is a non-text
// language — the UI renders English plus an explanatory notice.
export const SUPPORTED_LANGUAGES = [
  "en", // English
  "sn", // chiShona
  "nd", // isiNdebele
  "ny", // Chewa / Chinyanja
  "sbn", // Chibarwe
  "kck", // Kalanga
  "huc", // Koisan / Tshwa
  "nmq", // Nambya
  "ndc", // Ndau
  "ts", // Shangani / Xitsonga
  "st", // Sesotho
  "toi", // chiTonga
  "tn", // Setswana
  "ve", // Tshivenda
  "xh", // isiXhosa
  "zsl", // Zimbabwe Sign Language (non-text)
] as const

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]

export const LANGUAGE_NAMES: Record<LanguageCode, string> = {
  en: "English",
  sn: "chiShona",
  nd: "isiNdebele",
  ny: "Chichewa / Chinyanja",
  sbn: "Chibarwe",
  kck: "TjiKalanga",
  huc: "Tshwa",
  nmq: "ChiNambya",
  ndc: "ChiNdau",
  ts: "Xitsonga",
  st: "Sesotho",
  toi: "chiTonga",
  tn: "Setswana",
  ve: "Tshivenda",
  xh: "isiXhosa",
  zsl: "Zimbabwe Sign Language",
}
