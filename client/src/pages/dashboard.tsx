import { Link } from "react-router-dom"
import useSWR from "swr"
import { Activity, AlertTriangle, Baby, ClipboardList, FileCheck, Hourglass, Plus } from "lucide-react"
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts"
import { SiteHeader } from "@/components/site-header"
import { StatCard } from "@/components/stat-card"
import { DepthDefs, grad, shadow } from "@/components/chart-3d"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { fmtDate, STATUS_LABELS, STATUS_VARIANTS } from "@/lib/format"
import type { DeathNotification, OutbreakAlert } from "@/lib/types"
import { usePreferences } from "@/lib/preferences"

interface DashboardData {
  kpis: {
    deathsLast7Days: number
    deathsPrev7Days: number
    pendingReviews: number
    activeAlerts: number
    finalizedAutopsies: number
    mpdsrLast30Days: number
    mpdsrPrev30Days: number
    totalNotifications: number
  }
  daily: { day: string; count: number }[]
  weekly: { week: string; count: number }[]
  byCategory: { category: string; count: number }[]
  byProvince: { province: string; count: number }[]
  byStatus: { status: string; count: number }[]
}

const fetcher = <T,>(url: string) => api<T>(url)

const CATEGORY_COLORS = ["#e11d48", "#f59e0b", "#8b5cf6", "#0ea5e9", "#10b981", "#f97316", "#64748b", "#d946ef"]

/** Signed % change vs previous period; null when there's no baseline. */
function pctChange(current: number, prev: number) {
  if (!prev) return current > 0 ? 100 : null
  return Math.round(((current - prev) / prev) * 100)
}



const tooltipStyle = { fontSize: 12, borderRadius: 8, border: "1px solid var(--border)" }

export default function DashboardPage() {const{t}=usePreferences();
  const { user } = useAuth()
  const { data } = useSWR<DashboardData>("/analytics/dashboard", fetcher, { refreshInterval: 60_000 })
  const { data: notifications } = useSWR<{ items: DeathNotification[] }>("/notifications", fetcher)
  const { data: alerts } = useSWR<{ items: OutbreakAlert[] }>("/alerts?status=active", fetcher)

  const k = data?.kpis
  const kpis = [
    { label: t("Deaths (7 days)"), value: k?.deathsLast7Days, icon: Activity, delta: pctChange(k?.deathsLast7Days ?? 0, k?.deathsPrev7Days ?? 0), color: "rose" as const },
    { label: t("Pending reviews"), value: k?.pendingReviews, icon: Hourglass, color: "amber" as const },
    { label: t("Active alerts"), value: k?.activeAlerts, icon: AlertTriangle, pulse: (k?.activeAlerts ?? 0) > 0, color: "red" as const },
    { label: t("Finalized autopsies"), value: k?.finalizedAutopsies, icon: FileCheck, color: "emerald" as const },
    { label: t("MPDSR cases (30d)"), value: k?.mpdsrLast30Days, icon: Baby, delta: pctChange(k?.mpdsrLast30Days ?? 0, k?.mpdsrPrev30Days ?? 0), color: "purple" as const },
    { label: t("Total notifications"), value: k?.totalNotifications, icon: ClipboardList, color: "blue" as const },
  ]

  const categoryTotal = data?.byCategory.reduce((a, c) => a + c.count, 0) ?? 0
  const canCreate = user && ["medical_officer", "public_health_analyst", "system_admin"].includes(user.role)

  return (
    <>
      <SiteHeader title={t("Dashboard")} />
      <div className="space-y-6 p-4 lg:p-6 bg-card min-h-[calc(100vh-3.5rem)] text-foreground">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between bg-card p-5 rounded-2xl border border-border/90 shadow-lg">
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-xl font-bold text-foreground tracking-tight">Welcome, {user?.name}</h2>
              <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-2xs">
                MOHCC Live
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">{t("National mortality surveillance and real-time disease detection overview")}</p>
          </div>
          {canCreate && (
            <Button asChild className="bg-primary hover:bg-primary/90 text-white font-semibold shadow-lg">
              <Link to="/notifications/new"><Plus className="size-4 mr-1.5" /> {t("New death notification")}</Link>
            </Button>
          )}
        </div>

        {/* KPI cards with % deltas */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {kpis.map((kpi) => (
            <StatCard key={kpi.label} {...kpi} />
          ))}
        </div>

        {/* Charts row 1: mortality trend + status donut */}
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2 bg-card border border-border/90 shadow-lg rounded-2xl overflow-hidden">
            <CardHeader className="border-b border-slate-100 bg-muted/50 px-5 py-4">
              <CardTitle className="text-sm font-bold text-foreground">{t("Mortality trend — last 30 days")}</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">{t("Daily notified deaths nationwide")}</p>
            </CardHeader>
            <CardContent className="p-4">
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={data?.daily ?? []} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="deaths" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#e11d48" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#e11d48" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 10 }} tickFormatter={(d: string) => d.slice(5)} interval="preserveStartEnd" />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10 }} width={32} />
                  <Tooltip contentStyle={tooltipStyle} labelFormatter={(d) => fmtDate(String(d))} />
                  <Area type="monotone" dataKey="count" name="Deaths" stroke="#e11d48" strokeWidth={2.5} fill="url(#deaths)" style={{ filter: "drop-shadow(0 4px 5px rgba(225,29,72,0.35))" }} />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="bg-card border border-border/90 shadow-lg rounded-2xl overflow-hidden">
            <CardHeader className="border-b border-slate-100 bg-muted/50 px-5 py-4">
              <CardTitle className="text-sm font-bold text-foreground">{t("Notification status")}</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">{t("Workflow distribution")}</p>
            </CardHeader>
            <CardContent className="p-4">
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <DepthDefs id="st" colors={CATEGORY_COLORS} />
                  <Pie
                    data={(data?.byStatus ?? []).map((s) => ({ ...s, name: t(STATUS_LABELS[s.status] ?? s.status) }))}
                    dataKey="count" nameKey="name" innerRadius={52} outerRadius={80} paddingAngle={3} strokeWidth={0}
                    style={{ filter: shadow("st") }}
                  >
                    {(data?.byStatus ?? []).map((_, i) => (
                      <Cell key={i} fill={grad("st", (i + 3) % CATEGORY_COLORS.length)} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* Charts row 2: category donut + province bars */}
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="bg-card border border-border/90 shadow-lg rounded-2xl overflow-hidden">
            <CardHeader className="border-b border-slate-100 bg-muted/50 px-5 py-4">
              <CardTitle className="text-sm font-bold text-foreground">{t("Deaths by category")}</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">{t("90-day share of disease categories")}</p>
            </CardHeader>
            <CardContent className="p-4">
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <DepthDefs id="cat" colors={CATEGORY_COLORS} />
                  <Pie data={data?.byCategory ?? []} dataKey="count" nameKey="category" innerRadius={52} outerRadius={80} paddingAngle={3} strokeWidth={0} style={{ filter: shadow("cat") }}>
                    {(data?.byCategory ?? []).map((_, i) => (
                      <Cell key={i} fill={grad("cat", i % CATEGORY_COLORS.length)} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} formatter={(v, name) => [`${v} (${categoryTotal ? Math.round((Number(v) / categoryTotal) * 100) : 0}%)`, String(name)]} />
                  <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2 bg-card border border-border/90 shadow-lg rounded-2xl overflow-hidden">
            <CardHeader className="border-b border-slate-100 bg-muted/50 px-5 py-4">
              <CardTitle className="text-sm font-bold text-foreground">{t("Deaths by province")}</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">{t("90-day distribution across the 10 provinces")}</p>
            </CardHeader>
            <CardContent className="p-4">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={data?.byProvince ?? []} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                  <DepthDefs id="prov" colors={["#0ea5e9"]} />
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="province" tick={{ fontSize: 10 }} interval={0} angle={-25} textAnchor="end" height={56} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10 }} width={32} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="count" name="Deaths" fill={grad("prov", 0)} radius={[5, 5, 0, 0]} style={{ filter: shadow("prov") }} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* Recent notifications + active alerts */}
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2 bg-card border border-border/90 shadow-lg rounded-2xl overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100 bg-muted/50 px-5 py-4">
              <div>
                <CardTitle className="text-sm font-bold text-foreground">{t("Recent death notifications")}</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">{t("Latest clinical records reported across facilities")}</p>
              </div>
              <Button variant="outline" size="sm" asChild className="text-foreground hover:bg-slate-100 border-border text-xs font-medium">
                <Link to="/notifications">{t("View all")}</Link>
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="border-b border-sidebar-border">
                    <TableHead>{t("Patient")}</TableHead>
                    <TableHead>ICD</TableHead>
                    <TableHead>{t("Facility")}</TableHead>
                    <TableHead>{t("Date of death")}</TableHead>
                    <TableHead>{t("Status")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(notifications?.items ?? []).slice(0, 8).map((n) => (
                    <TableRow key={n.notification_id} className="border-b border-slate-100 hover:bg-muted/80 transition-colors">
                      <TableCell className="font-medium text-foreground">
                        <Link to={`/notifications/${n.notification_id}`} className="hover:text-primary hover:underline">
                          {n.patient_name}
                        </Link>
                        {!!n.is_maternal_perinatal && (
                          <Badge variant="destructive" className="ml-2 text-[10px] font-semibold">MPDSR</Badge>
                        )}
                      </TableCell>
                      <TableCell className="tabular-nums font-medium text-foreground">{n.preliminary_icd_code}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">{n.facility_name}</TableCell>
                      <TableCell className="text-muted-foreground text-xs tabular-nums">{fmtDate(n.date_of_death)}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANTS[n.status] ?? "secondary"} className="text-xs font-medium">
                          {t(STATUS_LABELS[n.status] ?? n.status)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!notifications?.items?.length && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-slate-400 py-8">{t("No notifications recorded yet")}</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="bg-card border border-border/90 shadow-lg rounded-2xl overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100 bg-muted/50 px-5 py-4">
              <div>
                <CardTitle className="text-sm font-bold text-foreground">{t("Active alerts")}</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">{t("Automated surveillance threshold triggers")}</p>
              </div>
              <Button variant="outline" size="sm" asChild className="text-foreground hover:bg-slate-100 border-border text-xs font-medium">
                <Link to="/alerts">{t("All alerts")}</Link>
              </Button>
            </CardHeader>
            <CardContent className="p-4 space-y-3">
              {(alerts?.items ?? []).slice(0, 6).map((a) => (
                <div key={a.alert_id} className="rounded-xl border border-border p-3.5 hover:border-slate-300 transition-colors bg-card shadow-2xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-foreground">{a.disease_category}</span>
                    <Badge variant={a.alert_type === "mpdsr" ? "secondary" : "destructive"} className="text-[11px] font-semibold">
                      {a.alert_type === "mpdsr" ? "MPDSR" : `Risk ${a.risk_score}`}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground font-medium">
                    {a.district} · {a.case_count} case{a.case_count === 1 ? "" : "s"} · {fmtDate(a.triggered_date)}
                  </p>
                </div>
              ))}
              {!alerts?.items?.length && (
                <p className="text-sm text-slate-400 py-6 text-center">{t("No active outbreak alerts.")}</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  )
}
