// Privacy gate for external translation calls. Every string leaving the DDS
// environment is masked first: caller-supplied literals (patient/facility/
// provider names, IDs — taken from the record being viewed) plus regex
// catches for common identifiers are replaced with numbered placeholders
// (⟦1⟧ … ⟦n⟧). The translation provider therefore receives de-identified
// text only. Clients re-substitute placeholders for display via unmaskPii.
//
// The same algorithm is mirrored in mobile/lib/data/deidentify.dart and
// client/src/lib/translate.ts — keep them in sync.

const PATTERNS: RegExp[] = [
  /\b\d{2}-\d{5,7}[A-Z]\d{2}\b/g, // Zimbabwe national ID e.g. 63-123456A78
  /\b(?:\+263|0)7\d{8}\b/g, // ZW mobile numbers
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, // emails
  /-?\d{1,2}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}/g, // lat,lng pairs
  /\b\d{6,}\b/g, // long digit runs (IDs, serials)
]

export function maskPii(text: string, extraLiterals: string[] = []) {
  const map: Record<string, string> = {}
  let masked = text
  const nextToken = () => `⟦${Object.keys(map).length + 1}⟧`
  // Caller-supplied record literals first (longest-first so "Tendai Moyo"
  // masks before a shorter "Moyo" could partially match).
  for (const lit of [...extraLiterals].sort((a, b) => b.length - a.length)) {
    const v = lit.trim()
    if (v.length >= 2 && masked.includes(v)) {
      const token = nextToken()
      map[token] = v
      masked = masked.split(v).join(token)
    }
  }
  for (const re of PATTERNS) {
    masked = masked.replace(re, m => {
      const token = nextToken()
      map[token] = m
      return token
    })
  }
  return { masked, map }
}

export function unmaskPii(text: string, map: Record<string, string>) {
  let out = text
  // Longest token index last is irrelevant — tokens are unique literals.
  for (const [token, value] of Object.entries(map)) out = out.split(token).join(value)
  return out
}
