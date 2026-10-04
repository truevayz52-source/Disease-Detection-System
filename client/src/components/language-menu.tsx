import { Check, Globe } from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { LANGUAGES, LANGUAGE_CODES, usePreferences, type Language } from "@/lib/preferences"

/** Globe button listing all 16 official Zimbabwe languages — mirrors the
 * mobile LanguageMenuButton. Selecting ZSL shows English text plus the
 * signed-video notice (languageInfo.note). */
export function LanguageMenu() {
  const { language, setLanguage, t } = usePreferences()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Language"
        className="rounded-md border border-border p-2 hover:bg-muted"
      >
        <Globe className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-96 w-56 overflow-y-auto">
        <DropdownMenuLabel>Language</DropdownMenuLabel>
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
              {info.note && (
                <span className="text-[10px] leading-snug text-muted-foreground">
                  {t("English text; signed video planned")}
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
