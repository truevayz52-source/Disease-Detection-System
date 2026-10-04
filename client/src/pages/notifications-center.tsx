import { useMemo, useState } from "react"
import useSWR from "swr"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import {
  BellOff, BellRing, CalendarClock, CheckCheck, CircleAlert, FileText,
  Info, MailOpen, Radio, Stethoscope, Trash2, TriangleAlert,
} from "lucide-react"
import { SiteHeader } from "@/components/site-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { api } from "@/lib/api"
import { usePreferences } from "@/lib/preferences"

interface InboxItem {
  notification_id: string
  notification_type: string
  title: string
  message: string | null
  action_url: string | null
  is_read: number
  created_at: string
}

const TYPE_META: Record<string, { icon: typeof Info; tone: string; label: string }> = {
  alert: { icon: TriangleAlert, tone: "bg-red-600/10 text-red-600", label: "Alert" },
  warning: { icon: CircleAlert, tone: "bg-amber-500/10 text-amber-600", label: "Warning" },
  autopsy: { icon: Stethoscope, tone: "bg-indigo-500/10 text-indigo-600", label: "Autopsy" },
  report: { icon: FileText, tone: "bg-blue-500/10 text-blue-600", label: "Report" },
  signal: { icon: Radio, tone: "bg-purple-500/10 text-purple-600", label: "Signal" },
  reminder: { icon: CalendarClock, tone: "bg-teal-500/10 text-teal-600", label: "Reminder" },
  info: { icon: Info, tone: "bg-muted text-muted-foreground", label: "Info" },
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
}

export default function NotificationsCenter() {const{t}=usePreferences();
  const { data, error, isLoading, mutate } = useSWR<{ items: InboxItem[]; unread: number }>(
    "/inbox", api, { refreshInterval: 15_000 },
  )
  const [tab, setTab] = useState<"all" | "unread" | "read">("all")

  const items = useMemo(() => {
    const list = data?.items ?? []
    if (tab === "unread") return list.filter((n) => !n.is_read)
    if (tab === "read") return list.filter((n) => n.is_read)
    return list
  }, [data, tab])

  const unread = data?.unread ?? 0

  async function act(fn: () => Promise<unknown>, ok?: string) {
    try { await fn(); if (ok) toast.success(ok); mutate() }
    catch (err) { toast.error(err instanceof Error ? err.message : "Action failed") }
  }

  return (
    <>
      <SiteHeader title="Notifications" />
      <div className="mx-auto w-full max-w-4xl space-y-4 p-4 lg:p-6">
        {/* header row */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-primary/10 p-2 text-primary"><BellRing className="size-5" /></div>
            <div>
              <p className="text-sm font-semibold">Inbox</p>
              <p className="text-xs text-muted-foreground">
                {unread > 0 ? `${unread} unread` : "You're all caught up"} · auto-refreshes
              </p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div className="flex rounded-lg border p-0.5 text-xs">
              {(["all", "unread", "read"] as const).map((tb) => (
                <button
                  key={tb}
                  onClick={() => setTab(tb)}
                  className={`rounded-md px-3 py-1 font-medium capitalize transition-colors ${tab === tb ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {tb}
                </button>
              ))}
            </div>
            {unread > 0 && (
              <Button size="sm" variant="outline" onClick={() => act(() => api("/inbox/read-all", { method: "PATCH" }), "All marked read")}>
                <CheckCheck className="size-4" /> Mark all read
              </Button>
            )}
          </div>
        </div>

        {/* list */}
        <Card className="shadow-lg">
          <CardContent className="p-0">
            {isLoading && <p className="p-8 text-center text-sm text-muted-foreground">{t("Loading…")}</p>}
            {error && <p className="p-8 text-center text-sm text-destructive">{t("Failed to load notifications.")}</p>}
            {!isLoading && !error && !items.length && (
              <div className="flex flex-col items-center gap-2 p-12 text-center">
                <BellOff className="size-8 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">
                  {tab === "unread" ? "No unread notifications." : tab === "read" ? "No read notifications." : "No notifications yet."}
                </p>
              </div>
            )}
            <ul className="divide-y">
              {items.map((n) => {
                const meta = TYPE_META[n.notification_type] ?? TYPE_META.info
                const Icon = meta.icon
                const isUnread = !n.is_read
                return (
                  <li key={n.notification_id} className={`flex gap-3 px-4 py-3.5 transition-colors hover:bg-muted/40 ${isUnread ? "bg-primary/5" : ""}`}>
                    <div className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg ${meta.tone}`}>
                      <Icon className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className={`truncate text-sm ${isUnread ? "font-semibold" : "font-medium"}`}>{n.title}</p>
                        {isUnread && <span className="size-2 shrink-0 rounded-full bg-blue-600" />}
                        <Badge variant="outline" className="shrink-0 text-[10px]">{meta.label}</Badge>
                      </div>
                      {n.message && <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{n.message}</p>}
                      <p className="mt-1 text-[11px] text-muted-foreground/70">{timeAgo(n.created_at)} · {new Date(n.created_at).toLocaleString()}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-center">
                      {n.action_url?.startsWith("/") && !n.action_url.startsWith("//") && (
                        <Button size="sm" variant="ghost" asChild>
                          <Link to={n.action_url}>Open</Link>
                        </Button>
                      )}
                      {isUnread && (
                        <Button size="sm" variant="ghost" title={t("Mark read")}
                          onClick={() => act(() => api(`/inbox/${n.notification_id}/read`, { method: "PATCH" }))}>
                          <MailOpen className="size-4" />
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" title="Dismiss" className="text-muted-foreground hover:text-destructive"
                        onClick={() => act(() => api(`/inbox/${n.notification_id}`, { method: "DELETE" }), "Dismissed")}>
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  )
}
