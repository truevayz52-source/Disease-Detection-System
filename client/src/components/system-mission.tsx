import { useState } from "react"
import { Link } from "react-router-dom"
import { Activity, ChevronDown, ChevronUp, GitCompare, Siren, TrendingUp } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { usePreferences } from "@/lib/preferences"
import { cn } from "@/lib/utils"

const COLLAPSE_KEY = "dds.mission.collapsed"

const PILLARS = [
  {
    icon: TrendingUp,
    to: "/predictions",
    title: "Mortality Trend Forecasting",
    sub: "Projects future mortality over the next 30–90 days using historical death records.",
    accent: "from-blue-500 to-blue-700",
  },
  {
    icon: Siren,
    to: "/alerts",
    title: "Early Outbreak Surveillance",
    sub: "Monitors real-time clustering of deaths across districts to trigger early warnings.",
    accent: "from-amber-500 to-amber-700",
  },
  {
    icon: GitCompare,
    to: "/analytics",
    title: "Cause-of-Death Pattern Explorer",
    sub: "Correlates demographics and ICD-10 findings to identify leading mortality drivers.",
    accent: "from-purple-500 to-purple-700",
  },
] as const

/**
 * "System mission" card — states what the system does in plain language, so
 * the dashboard explains itself the moment it opens. Collapsible; the state
 * persists in localStorage so it remembers the officer's preference.
 */
export function SystemMission() {
  const { t } = usePreferences()
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === "1")

  function toggle() {
    setCollapsed((c) => {
      localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1")
      return !c
    })
  }

  return (
    <Card className="border-blue-200/60 bg-gradient-to-r from-blue-50/80 via-card to-card shadow-lg rounded-2xl overflow-hidden">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        className="flex w-full items-center gap-3 px-5 py-3.5 text-left hover:bg-blue-50/60 transition-colors"
      >
        <span className="flex size-8 items-center justify-center rounded-lg bg-blue-600 text-white">
          <Activity className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-foreground">{t("System mission — what DDS does")}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {t("Forecasts mortality trends · detects outbreaks early · explains cause-of-death patterns")}
          </span>
        </span>
        {collapsed ? <ChevronDown className="size-4 text-muted-foreground" /> : <ChevronUp className="size-4 text-muted-foreground" />}
      </button>
      {!collapsed && (
        <CardContent className="grid gap-3 border-t border-blue-100 px-5 pb-5 pt-4 sm:grid-cols-3">
          {PILLARS.map((p) => (
            <Link
              key={p.title}
              to={p.to}
              className="group rounded-xl border border-border/70 bg-card p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
            >
              <span className={cn("mb-2.5 flex size-9 items-center justify-center rounded-lg bg-gradient-to-br text-white shadow", p.accent)}>
                <p.icon className="size-4.5" />
              </span>
              <p className="text-xs font-semibold text-foreground group-hover:text-blue-700">{t(p.title)}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{t(p.sub)}</p>
            </Link>
          ))}
        </CardContent>
      )}
    </Card>
  )
}
