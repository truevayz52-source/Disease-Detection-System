// Active UI languages — English, Shona and isiNdebele. Kept in sync with
// i18n/languages.json and both clients.
export const SUPPORTED_LANGUAGES = [
  "en", // English
  "sn", // chiShona
  "nd", // isiNdebele
] as const

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]

export const LANGUAGE_NAMES: Record<LanguageCode, string> = {
  en: "English",
  sn: "chiShona",
  nd: "isiNdebele",
}
