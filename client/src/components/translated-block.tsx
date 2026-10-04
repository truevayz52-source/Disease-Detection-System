import { useEffect, useState } from "react"
import { Languages, Loader2 } from "lucide-react"
import { translateClinicalText } from "@/lib/translate"
import { usePreferences } from "@/lib/preferences"

/**
 * Renders a clinical narrative translated into the active UI language via
 * /api/translate (PII is masked before the request). Falls back to the
 * medical glossary offline, then the original text — record viewing never
 * breaks. Shows a machine-translation disclaimer and show-original toggle.
 */
export function TranslatedBlock({
  text,
  pii = [],
  className = "whitespace-pre-wrap text-sm",
}: {
  text: string | null | undefined
  /** PII literals to mask before translation (patient name, national ID…). */
  pii?: (string | null | undefined)[]
  className?: string
}) {
  const { language, t } = usePreferences()
  const [translated, setTranslated] = useState<string | null>(null)
  const [showOriginal, setShowOriginal] = useState(false)
  const [pending, setPending] = useState(false)
  const [source, setSource] = useState<string>("original")

  useEffect(() => {
    setTranslated(null)
    setShowOriginal(false)
    if (!text || language === "en") return
    let alive = true
    setPending(true)
    void translateClinicalText(text, language, pii.filter((x): x is string => !!x)).then((r) => {
      if (!alive) return
      setTranslated(r.text)
      setSource(r.source)
      setPending(false)
    })
    return () => {
      alive = false
    }
  }, [text, language])

  if (!text) return null
  if (language === "en") return <p className={className}>{text}</p>

  const body = showOriginal || !translated ? text : translated
  return (
    <div>
      {pending ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" /> {t("Translating…")}
        </p>
      ) : null}
      <p className={className}>{body}</p>
      <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
        {translated && !showOriginal ? (
          <span className="inline-flex items-center gap-1">
            <Languages className="size-3" />
            {source === "glossary"
              ? t("Offline glossary translation")
              : t("Machine translation — verify clinically")}
          </span>
        ) : null}
        {translated ? (
          <button type="button" className="underline" onClick={() => setShowOriginal((v) => !v)}>
            {showOriginal ? t("Show translation") : t("Show original")}
          </button>
        ) : null}
      </div>
    </div>
  )
}
