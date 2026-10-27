/**
 * Syndromic surveillance taxonomy for morbidity_reports. Each syndrome maps
 * onto an icd_codes disease_category so morbidity alerts dedupe against the
 * same district+category space as the mortality passes. An explicit icd_code
 * on a report always wins over this map.
 */
export const SYNDROMES = [
  "acute_watery_diarrhoea",
  "bloody_diarrhoea",
  "jaundice",
  "acute_respiratory_infection",
  "febrile_rash_illness",
  "meningitis_suspected",
  "vector_fever",
  "acute_fever_undifferentiated",
  "other",
] as const

export type Syndrome = (typeof SYNDROMES)[number]

export const SYNDROME_CATEGORY: Record<Syndrome, string> = {
  acute_watery_diarrhoea: "Infectious - Waterborne",
  bloody_diarrhoea: "Infectious - Waterborne",
  jaundice: "Infectious - Waterborne",
  acute_respiratory_infection: "Infectious - Respiratory",
  febrile_rash_illness: "Infectious - Respiratory",
  meningitis_suspected: "Infectious - Respiratory",
  vector_fever: "Infectious - Vector-borne",
  acute_fever_undifferentiated: "Ill-defined",
  other: "Ill-defined",
}
