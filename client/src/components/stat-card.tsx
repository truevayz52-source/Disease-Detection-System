import type { LucideIcon } from "lucide-react"
import { TrendingDown, TrendingUp } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

type StatColor = "rose" | "amber" | "red" | "emerald" | "purple" | "blue" | "slate"

const VARIANTS: Record<StatColor, { grad: string; shadow: string }> = {
  rose: { grad: "from-rose-500 to-rose-700", shadow: "shadow-rose-900/40" },
  amber: { grad: "from-amber-400 to-amber-600", shadow: "shadow-amber-900/40" },
  red: { grad: "from-red-500 to-red-700", shadow: "shadow-red-900/40" },
  emerald: { grad: "from-emerald-500 to-emerald-700", shadow: "shadow-emerald-900/40" },
  purple: { grad: "from-purple-500 to-purple-700", shadow: "shadow-purple-900/40" },
  blue: { grad: "from-blue-500 to-blue-700", shadow: "shadow-blue-900/40" },
  slate: { grad: "from-slate-500 to-slate-700", shadow: "shadow-slate-900/40" },
}

export function DeltaBadge({ value, invert = false }: { value: number | null; invert?: boolean }) {
  if (value === null || value === undefined) return null
  const up = value >= 0
  const bad = invert ? !up : up
  const Icon = up ? TrendingUp : TrendingDown
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[11px] font-semibold backdrop-blur-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]",
        bad ? "bg-black/25 text-white" : "bg-white/25 text-white",
      )}
    >
      <Icon className="size-3" />
      {up ? "+" : ""}{value}% vs prior
    </span>
  )
}

interface StatCardProps {
  label: string
  value: number | string | undefined
  icon: LucideIcon
  color?: StatColor
  /** Secondary caption under the label. */
  sub?: string
  /** Signed % change vs previous period; renders a badge when set. */
  delta?: number | null
  /** Set when an increase is good (defaults to up = bad/red). */
  invertDelta?: boolean
  /** Pulse the card to draw attention (e.g. active alerts > 0). */
  pulse?: boolean
  /** Compact layout (value on top, label below) vs header layout. */
  compact?: boolean
}

/**
 * Shared KPI/stat card: fully colored gradient with a 3D finish —
 * deep colored shadow, top gloss highlight, inner bevel, frosted icon tile,
 * and a hover lift. Used by the dashboard, pathology queue, alerts, etc.
 */
export function StatCard({ label, value, icon: Icon, color = "slate", sub, delta, invertDelta, pulse, compact }: StatCardProps) {
  const v = VARIANTS[color]
  return (
    <Card
      className={cn(
        "relative rounded-xl border-0 bg-gradient-to-br text-white ring-0 shadow-lg transition-all duration-200",
        "hover:-translate-y-1 hover:shadow-xl",
        "before:absolute before:inset-x-0 before:top-0 before:h-1/2 before:rounded-t-xl before:bg-gradient-to-b before:from-white/25 before:to-transparent",
        "after:pointer-events-none after:absolute after:inset-0 after:rounded-xl after:shadow-[inset_0_1px_0_rgba(255,255,255,0.35),inset_0_-2px_4px_rgba(0,0,0,0.25)]",
        v.grad, v.shadow,
        pulse && "animate-pulse",
      )}
    >
      <CardContent className={cn("relative", compact ? "p-3" : "p-4")}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 space-y-0.5">
            {compact ? (
              <>
                <p className="text-2xl font-bold tabular-nums drop-shadow-sm">{value ?? "—"}</p>
                <p className="text-xs font-medium text-white/85">{label}</p>
              </>
            ) : (
              <>
                <p className="text-xs font-semibold text-white/85 tracking-tight">{label}</p>
                <p className="text-2xl font-bold tabular-nums drop-shadow-sm">{value ?? "—"}</p>
              </>
            )}
            {sub && <p className="text-[10px] text-white/70">{sub}</p>}
            {delta !== undefined && <div><DeltaBadge value={delta} invert={invertDelta} /></div>}
          </div>
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/25 backdrop-blur-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_2px_4px_rgba(0,0,0,0.2)]">
            <Icon className="size-4 drop-shadow" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
