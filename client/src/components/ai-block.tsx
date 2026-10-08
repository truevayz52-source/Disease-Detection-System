import { useState } from "react"
import { Loader2, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { aiSummarize } from "@/lib/ai"
import { usePreferences } from "@/lib/preferences"

/**
 * "Summarise with AI" helper for clinical narrative. The text is masked with
 * ⟦n⟧ PII tokens before it leaves the client; the draft is badged so staff
 * verify it before relying on it — same convention as TranslatedBlock.
 */
export function AiSummaryBlock({
  text,
  pii = [],
  className = "",
}: {
  text: string | null | undefined
  /** PII literals from the record (patient name, national ID…). */
  pii?: (string | null | undefined)[]
  className?: string
}) {
  const { language, t } = usePreferences()
  const [summary, setSummary] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  if (!text?.trim()) return null

  async function run() {
    setPending(true)
    try {
      setSummary(await aiSummarize(text!, { pii, lang: language }))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("AI summarisation failed"))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className={className}>
      {!summary && (
        <Button type="button" size="sm" variant="outline" onClick={run} disabled={pending}>
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
          {pending ? t("Summarising…") : t("Summarise with AI")}
        </Button>
      )}
      {summary && (
        <div className="rounded-md border border-dashed bg-muted/30 p-3">
          <p className="whitespace-pre-wrap text-sm">{summary}</p>
          <p className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground">
            <Sparkles className="size-3" />
            {t("AI-generated draft — verify against the record before use")}
            <button type="button" className="underline" onClick={() => setSummary(null)}>{t("Dismiss")}</button>
          </p>
        </div>
      )}
    </div>
  )
}
