import { Check } from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { LANGUAGES, LANGUAGE_CODES, usePreferences, type Language } from "@/lib/preferences"

/** Google's Material "translate" glyph (文A) — the recognisable language
 * switcher symbol used by Google products. Filled style (not stroked) like
 * the original; inherits colour from the parent via currentColor. */
function GoogleTranslateIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z" />
    </svg>
  )
}

/** Language switcher listing the supported languages — mirrors the
 * mobile LanguageMenuButton. */
export function LanguageMenu() {
  const { language, setLanguage, t } = usePreferences()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        type="button"
        aria-label={t("Language")}
        className="rounded-md border border-border p-2 hover:bg-muted"
      >
        <GoogleTranslateIcon className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-96 w-56 overflow-y-auto">
        <DropdownMenuLabel>{t("Language")}</DropdownMenuLabel>
        {LANGUAGE_CODES.map((code) => {
          const info = LANGUAGES[code as Language]
          return (
            <DropdownMenuItem key={code} onClick={() => setLanguage(code as Language)} className="flex-col items-start gap-0.5 py-1.5">
              <span className="flex w-full items-center gap-2 font-medium">
                {info.nativeName}
                {language === code && <Check className="ml-auto size-3.5 text-primary" />}
              </span>
              {info.draft && (
                <span className="text-[10px] leading-snug text-muted-foreground">
                  {t("Draft — pending native review")}
                </span>
              )}
            </DropdownMenuItem>
          )
        })}
        <DropdownMenuSeparator />
        <div className="px-1.5 pb-1 text-[10px] text-muted-foreground">{t("Saved to your profile")}</div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
