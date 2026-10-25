/**
 * Mortality-domain signal classifier — keyword rules scoring community death
 * signals (unreported, suspicious, maternal/perinatal, clusters) for the
 * forensic mortality surveillance pipeline. No external AI service.
 */

const KEYWORDS: Record<string, string[]> = {
  injury_trauma: ["accident", "assault", "stab", "gunshot", "shot", "road traffic", "hit by", "run over", "fall", "fracture", "beaten", "attacked", "crush"],
  drowning: ["drown", "river", "dam", "swim", "flood", "well"],
  burns: ["burn", "fire", "scald"],
  poisoning: ["poison", "overdose", "pesticide", "ingested", "toxic", "chemical"],
  maternal: ["pregnant", "pregnancy", "childbirth", "delivery", "labour", "labor", "maternal", "postpartum", "antenatal"],
  neonatal: ["newborn", "neonate", "neonatal", "infant", "baby", "stillbirth", "stillborn"],
  sudden_unexplained: ["collapsed", "sudden", "unexplained", "found dead", "died in his sleep", "died in her sleep", "unattended"],
  outbreak_related: ["cholera", "diarrhoea", "diarrhea", "dysentery", "typhoid", "measles", "meningitis", "cluster"],
}

const DRIVERS: Record<string, string[]> = {
  concealment: ["hidden", "conceal", "unreported", "buried", "secret", "cover up", "cover-up", "not reported"],
  violence: ["murder", "killed", "beaten", "stabbed", "assault", "domestic", "abuse", "foul play"],
  fear: ["fear", "afraid", "worried", "scared", "panic"],
  reporting_delay: ["days ago", "weeks ago", "last week", "last month", "long ago", "delayed", "never reported"],
  access_barrier: ["far", "transport", "distance", "remote", "no clinic", "no mortuary"],
  misinformation: ["rumour", "rumor", "false", "claimed", "alleged", "unconfirmed", "heard"],
}

export interface SignalAnalysis {
  topics: string[]
  drivers: string[]
  sentiment: "negative" | "positive" | "neutral"
  riskScore: number
  recommendedResponses: string[]
  summary: string
}

export function cleanText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ")
}

export function classifyTopics(text: string): string[] {
  const matches = Object.entries(KEYWORDS)
    .filter(([, words]) => words.some((w) => text.includes(w)))
    .map(([topic]) => topic)
  return matches.length ? matches : ["general_mortality_signal"]
}

export function classifyDrivers(text: string): string[] {
  const matches = Object.entries(DRIVERS)
    .filter(([, words]) => words.some((w) => text.includes(w)))
    .map(([driver]) => driver)
  return matches.length ? matches : ["unknown"]
}

export function sentiment(text: string): SignalAnalysis["sentiment"] {
  const negative = ["death", "died", "dead", "killed", "fear", "afraid", "hidden", "assault", "collapsed", "suspicious", "body", "corpse"]
  const positive = ["safe", "recovered", "resolved", "confirmed alive", "false alarm"]
  if (negative.some((w) => text.includes(w))) return "negative"
  if (positive.some((w) => text.includes(w))) return "positive"
  return "neutral"
}

export function riskScore(topics: string[], drivers: string[], text: string): number {
  let score = 20
  if (topics.includes("maternal") || topics.includes("neonatal")) score += 15
  if (topics.includes("injury_trauma") || drivers.includes("violence")) score += 15
  if (topics.includes("outbreak_related")) score += 10
  score += 10 * drivers.filter((d) => d !== "unknown").length
  if (["found dead", "unattended", "suspicious", "concealed", "bodies"].some((t) => text.includes(t))) score += 15
  return Math.min(score, 100)
}

export function recommendedResponses(topics: string[], drivers: string[]): string[] {
  const responses: string[] = []
  if (topics.includes("maternal") || topics.includes("neonatal")) responses.push("mpdsr_review")
  if (drivers.includes("violence") || topics.includes("injury_trauma") || topics.includes("sudden_unexplained")) {
    responses.push("dispatch_forensic_team", "police_referral")
  }
  if (topics.includes("outbreak_related")) responses.push("outbreak_investigation")
  if (drivers.includes("concealment") || drivers.includes("reporting_delay")) responses.push("community_verification")
  return responses.length ? responses : ["verify_death_notification"]
}

export function analyzeText(raw: string): SignalAnalysis {
  const text = cleanText(raw)
  const topics = classifyTopics(text)
  const drivers = classifyDrivers(text)
  const summary = raw.trim().length > 140 ? `${raw.trim().slice(0, 137).trimEnd()}...` : raw.trim()
  return {
    topics,
    drivers,
    sentiment: sentiment(text),
    riskScore: riskScore(topics, drivers, text),
    recommendedResponses: recommendedResponses(topics, drivers),
    summary,
  }
}
