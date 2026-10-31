import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { GitCompare, Siren, TrendingUp } from "lucide-react"
import { usePreferences } from "@/lib/preferences"

export interface CaseInsightsResponse {
  caseRef: string
  district: string | null
  category: string
  insights: { objective: "trend" | "outbreak" | "pattern"; label: string; text: string }[]
}

const ICONS = { trend: TrendingUp, outbreak: Siren, pattern: GitCompare } as const
const ICON_STYLE = {
  trend: "bg-blue-100 text-blue-700",
  outbreak: "bg-amber-100 text-amber-700",
  pattern: "bg-purple-100 text-purple-700",
} as const

/**
 * "System Intelligence Summary" — renders the three objective-aligned,
 * plain-language interpretations the API generates for a case. Used on the
 * case detail page and inside the post-submit dialog; the text itself comes
 * pre-generated from /notifications/:id/insights so web + mobile match.
 */
export function IntelligenceSummary({ data, loading }: { data?: CaseInsightsResponse; loading?: boolean }) {
  const { t } = usePreferences()
  return (
    <Card className="border-blue-200/70 bg-blue-50/40 shadow-lg">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{t("System Intelligence Summary")}</CardTitle>
        <CardDescription className="text-xs">
          {data?.caseRef ? `${t("How the system read this entry")} — ${data.caseRef}` : t("How the system read this entry")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {loading && !data && <p className="text-xs text-muted-foreground">{t("Computing interpretation…")}</p>}
        {(data?.insights ?? []).map((i) => {
          const Icon = ICONS[i.objective]
          return (
            <div key={i.objective} className="flex items-start gap-3 rounded-lg border border-blue-100 bg-white/70 px-3 py-2.5">
              <span className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md ${ICON_STYLE[i.objective]}`}>
                <Icon className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{i.label}</p>
                <p className="text-xs leading-relaxed text-foreground">{i.text}</p>
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
