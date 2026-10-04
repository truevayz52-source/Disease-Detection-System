/**
 * Port of the BIIMZim rules-based signal classifier
 * (backend/biim-platform/ai_adapter/app/classifier.py) — pure keyword rules,
 * no external AI service. Same scoring formula and dictionaries.
 */

const KEYWORDS: Record<string, string[]> = {
  vaccine_confidence: ["vaccine", "vaccination", "aefi", "immunization"],
  service_delivery: ["clinic", "nurse", "medicine", "payment", "fee", "waiting"],
  cholera: ["cholera", "diarrhoea", "diarrhea", "water"],
  ebola: ["ebola", "burial", "isolation"],
}

const DRIVERS: Record<string, string[]> = {
  fear: ["fear", "afraid", "worried", "unsafe", "danger"],
  mistrust: ["trust", "mistrust", "government", "hide", "secret"],
  access_barrier: ["far", "transport", "closed", "distance", "access"],
  cost: ["fee", "payment", "cost", "money"],
  quality_of_care: ["rude", "waiting", "stockout", "medicine", "quality"],
  misinformation: ["rumour", "rumor", "false", "heard", "claim"],
  safety_concerns: ["infertility", "death", "side effect", "harm"],
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
  return matches.length ? matches : ["general_biim_signal"]
}

export function classifyDrivers(text: string): string[] {
  const matches = Object.entries(DRIVERS)
    .filter(([, words]) => words.some((w) => text.includes(w)))
    .map(([driver]) => driver)
  return matches.length ? matches : ["unknown"]
}

export function sentiment(text: string): SignalAnalysis["sentiment"] {
  const negative = ["fear", "worried", "unsafe", "death", "complaint", "mistrust", "infertility"]
  const positive = ["resolved", "trusted", "safe", "improved"]
  if (negative.some((w) => text.includes(w))) return "negative"
  if (positive.some((w) => text.includes(w))) return "positive"
  return "neutral"
}

export function riskScore(topics: string[], drivers: string[], text: string): number {
  let score = 20
  if (topics.includes("vaccine_confidence")) score += 15
  if (topics.includes("cholera") || topics.includes("ebola")) score += 15
  score += 10 * drivers.filter((d) => d !== "unknown").length
  if (["death", "infertility", "cross-border", "border"].some((t) => text.includes(t))) score += 15
  return Math.min(score, 100)
}

export function recommendedResponses(topics: string[], drivers: string[]): string[] {
  const responses: string[] = []
  if (drivers.includes("misinformation") || topics.includes("vaccine_confidence")) {
    responses.push("trusted_health_worker_dialogue", "myth_busting_brief")
  }
  if (topics.includes("service_delivery") || drivers.includes("quality_of_care")) {
    responses.push("service_correction_follow_up")
  }
  if (drivers.includes("mistrust")) responses.push("community_leader_engagement")
  return responses.length ? responses : ["monitor_and_verify"]
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
