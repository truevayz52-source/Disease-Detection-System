import { usePreferences } from "@/lib/preferences"


/** Lighten (+) or darken (−) a hex color by pct (0–100). */
export function shade(hex: string, pct: number) {const{t}=usePreferences();
  const n = parseInt(hex.slice(1), 16)
  const amt = Math.round(2.55 * pct)
  const r = Math.min(255, Math.max(0, (n >> 16) + amt))
  const g = Math.min(255, Math.max(0, ((n >> 8) & 0xff) + amt))
  const b = Math.min(255, Math.max(0, (n & 0xff) + amt))
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`
}

/**
 * SVG <defs> that give flat chart series a 3D finish:
 *  - per-color vertical gradients (lighter top → darker bottom)
 *  - a soft drop-shadow filter so series appear raised off the canvas
 * Place once inside any <PieChart>/<BarChart>/<AreaChart>, then reference
 * `fill={grad(id, i)}` on <Cell>/<Bar> and `style={{ filter: shadow(id) }}`
 * on the series.
 */
export function DepthDefs({ id, colors }: { id: string; colors: string[] }) {
  return (
    <defs>
      {colors.map((c, i) => (
        <linearGradient key={i} id={`g${id}${i}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={shade(c, 18)} />
          <stop offset="55%" stopColor={c} />
          <stop offset="100%" stopColor={shade(c, -22)} />
        </linearGradient>
      ))}
      {colors.map((c, i) => (
        <linearGradient key={`h${i}`} id={`h${id}${i}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={shade(c, 18)} />
          <stop offset="55%" stopColor={c} />
          <stop offset="100%" stopColor={shade(c, -22)} />
        </linearGradient>
      ))}
      <filter id={`ds${id}`} x="-30%" y="-30%" width="160%" height="160%">
        <feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="#000" floodOpacity="0.25" />
      </filter>
    </defs>
  )
}

/** Build gradient/shadow refs for a DepthDefs instance. Must be called with
 * the same id that DepthDefs rendered — see useDepth() below. */
export function depthId(rawId: string) {
  return rawId.replace(/[^a-zA-Z0-9]/g, "")
}
export function grad(id: string, i: number, horizontal = false) {
  return `url(#${horizontal ? "h" : "g"}${id}${i})`
}
export function shadow(id: string) {
  return `url(#ds${id})`
}
