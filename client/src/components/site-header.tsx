import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { NotificationBell } from "@/components/notification-bell"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { usePreferences } from "@/lib/preferences"
import { LanguageMenu } from "@/components/language-menu"
import { Link } from "react-router-dom"
import { useAuth } from "@/lib/auth"
import { ROLE_LABELS } from "@/lib/roles"
import { Moon, Sun, Search, Monitor, Check, Glasses } from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"

const SUBTITLES: Record<string, string> = {
  "Dashboard": "National mortality surveillance overview",
  "Death Notifications": "Clinical death records and workflow",
  "Pathology Review Queue": "Cases awaiting pathologist review",
  "Autopsy Reports": "Finalised post-mortem examinations",
  "Autopsy Report": "Post-mortem examination detail",
  "Verbal Autopsy": "Community death interviews",
  "Signal Registry": "Detected outbreak signals",
  "MPDSR Workflows": "Maternal and perinatal death reviews",
  "Alerts": "Active outbreak alerts",
  "Outbreak Analytics": "Mortality trends and cluster analysis",
  "Outbreak Map": "Geographic disease distribution",
  "User Management": "Provisioned system accounts",
  "Facilities": "Registered health facilities",
  "Audit Trail": "System activity and compliance log",
  "Notifications": "Your alerts and messages",
  "Search": "Search across records",
}

function initials(name: string) {
  return name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase()
}

export function SiteHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  const { theme, setTheme, t } = usePreferences()
  const { user } = useAuth()
    const today = new Date().toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" })

  return (
    <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center gap-3 border-b border-border bg-background px-4 text-foreground">
      <SidebarTrigger className="-ml-1 text-foreground/70 hover:text-foreground" />

      <div className="min-w-0">
        <div className="flex items-center gap-2.5">
          <h1 className="truncate text-base font-bold tracking-tight">{t(title)}</h1>
        </div>
        <p className="truncate text-xs text-muted-foreground">{subtitle ?? SUBTITLES[title] ?? "MOHCC mortality surveillance"}</p>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <span className="hidden rounded-md bg-muted px-2.5 py-1.5 text-xs font-medium text-muted-foreground md:block">{today}</span>
        <span className="hidden items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-bold tracking-wide text-emerald-700 sm:inline-flex">
          <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />SYSTEM LIVE
        </span>

        {user?.role !== "executive" && <Link to="/search" aria-label={t("Search")} className="rounded-md border border-border p-2 hover:bg-muted"><Search className="size-4" /></Link>}

        <LanguageMenu />

        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={t("Theme settings")}
            className="rounded-md border border-border p-2 hover:bg-muted"
          >
            {theme === "dark" ? <Moon className="size-4" /> : theme === "hc" ? <Glasses className="size-4" /> : theme === "light" ? <Sun className="size-4" /> : <Monitor className="size-4" />}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>{t("Theme")}</DropdownMenuLabel>
            {([
              ["system", Monitor, "System default", "Follow your device setting"],
              ["light", Sun, "Light", "Bright, standard contrast"],
              ["dark", Moon, "Dark", "Dim surfaces, low glare at night"],
              ["hc", Glasses, "High contrast", "Recommended if you wear specs or have eye strain — stronger borders, near-black text, larger type"],
            ] as const).map(([value, Icon, label, hint]) => (
              <DropdownMenuItem key={value} onClick={() => setTheme(value)} className="flex-col items-start gap-0.5 py-2">
                <span className="flex w-full items-center gap-2 font-medium">
                  <Icon className="size-4" />{label}
                  {theme === value && <Check className="ml-auto size-3.5 text-primary" />}
                </span>
                <span className="pl-6 text-[11px] leading-snug text-muted-foreground">{hint}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <div className="px-1.5 pb-1 text-[10px] text-muted-foreground">{t("Saved to your profile")}</div>
          </DropdownMenuContent>
        </DropdownMenu>

        <NotificationBell />

        <Link to="/profile" className="ml-1 flex items-center gap-2 rounded-lg px-1.5 py-1 transition-colors hover:bg-muted">
          <Avatar className="size-9 rounded-lg shadow-md">
            <AvatarFallback className="rounded-lg bg-emerald-600 text-sm font-bold text-white">{initials(user?.name ?? "?")}</AvatarFallback>
          </Avatar>
          <div className="hidden flex-col leading-tight lg:flex">
            <span className="text-sm font-semibold">{user?.name}</span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{user ? t(ROLE_LABELS[user.role] ?? user.role) : ""}</span>
          </div>
        </Link>
      </div>
    </header>
  )
}
