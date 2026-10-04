import fs from 'node:fs'
function edit(file,fn){fs.writeFileSync(file,fn(fs.readFileSync(file,'utf8')))}
edit('client/src/App.tsx',s=>{
  s=`import { lazy, Suspense } from "react"
import { PreferencesProvider } from "@/lib/preferences"
const UserProfile = lazy(() => import("@/pages/user-profile"))
const NotificationsCenter = lazy(() => import("@/pages/notifications-center"))
const OfflineSync = lazy(() => import("@/pages/offline-sync-dashboard"))
${['MpdsrPage','ThresholdPage','CrossBorderPage'].map(name=>`const ${name} = lazy(() => import("@/pages/workflows").then(m => ({default:m.${name}})))`).join('\n')}
${['ExecutivePage','ForecastPage','ReportsPage','SecurityPage','SettingsPage','SearchPage','GpsPage','VoicePage'].map(name=>`const ${name} = lazy(() => import("@/pages/operations").then(m => ({default:m.${name}})))`).join('\n')}
`+s
  s=s.replace('<TooltipProvider delay={200}>','<PreferencesProvider><TooltipProvider delay={200}><Suspense fallback={<div className="p-8" role="status">Loading workspace…</div>}>').replace('</TooltipProvider>','</Suspense></TooltipProvider></PreferencesProvider>')
  s=s.replace('<Route path="/dashboard" element={<DashboardPage />} />',`<Route path="/dashboard" element={user?.role === "executive" ? <ExecutivePage /> : <DashboardPage />} />
            <Route path="/profile" element={<UserProfile />} />
            <Route path="/notifications-center" element={<NotificationsCenter />} />
            <Route element={<RequireRole roles={["medical_officer","mortuary_clerk","pathologist","public_health_analyst","system_admin"]} />}><Route path="/search" element={<SearchPage />} /></Route>
            <Route element={<RequireRole roles={["medical_officer","mortuary_clerk","system_admin"]} />}><Route path="/offline-sync" element={<OfflineSync />} /><Route path="/voice-autopsy" element={<VoicePage />} /></Route>
            <Route element={<RequireRole roles={["medical_officer","public_health_analyst","system_admin"]} />}><Route path="/mpdsr" element={<MpdsrPage />} /><Route path="/cross-border" element={<CrossBorderPage />} /></Route>
            <Route element={<RequireRole roles={["medical_officer","system_admin"]} />}><Route path="/gps-dashboard" element={<GpsPage />} /></Route>
            <Route element={<RequireRole roles={["public_health_analyst","system_admin"]} />}><Route path="/alert-config" element={<ThresholdPage />} /><Route path="/resource-allocation" element={<ForecastPage />} /></Route>
            <Route element={<RequireRole roles={["public_health_analyst","system_admin","executive"]} />}><Route path="/reports" element={<ReportsPage />} /><Route path="/executive-dashboard" element={<ExecutivePage />} /></Route>
            <Route element={<RequireRole roles={["system_admin"]} />}><Route path="/security-dashboard" element={<SecurityPage />} /><Route path="/system-settings" element={<SettingsPage />} /></Route>`)
  s=s.replace('roles={["medical_officer", "public_health_analyst", "system_admin"]}', 'roles={["medical_officer", "mortuary_clerk", "public_health_analyst", "system_admin"]}')
  return s
})
edit('client/src/components/app-sidebar.tsx',s=>{
  s='import { usePreferences } from "@/lib/preferences"\n'+s
  const all=['medical_officer','pathologist','public_health_analyst','system_admin','mortuary_clerk','executive']
  const nav=[['/profile','My Profile',all],['/notifications-center','Notifications',all],['/search','Search',all.filter(r=>r!=='executive')],['/offline-sync','Offline Sync',['medical_officer','mortuary_clerk','system_admin']],['/mpdsr','MPDSR Workflows',['medical_officer','public_health_analyst','system_admin']],['/cross-border','Cross-border Tracking',['medical_officer','public_health_analyst','system_admin']],['/voice-autopsy','Verbal Autopsy',['medical_officer','mortuary_clerk','system_admin']],['/gps-dashboard','GPS Tracking',['medical_officer','system_admin']],['/resource-allocation','Resource Forecasting',['public_health_analyst','system_admin']],['/alert-config','Alert Thresholds',['public_health_analyst','system_admin']],['/reports','Reports',['public_health_analyst','system_admin','executive']],['/security-dashboard','Security Dashboard',['system_admin']],['/system-settings','System Settings',['system_admin']]]
  s=s.replace('const NAV_ITEMS: NavItem[] = [','const NAV_ITEMS: NavItem[] = [\n'+nav.map(([href,label,roles])=>`{href:${JSON.stringify(href)},label:${JSON.stringify(label)},icon:${href.includes('security')?'ShieldAlert':'ListChecks'},roles:${JSON.stringify(roles)}},`).join('\n'))
  s=s.replace('roles: ["medical_officer", "pathologist", "public_health_analyst", "system_admin"],','roles: ["medical_officer", "pathologist", "public_health_analyst", "system_admin", "mortuary_clerk", "executive"],')
  s=s.replace('roles: ["medical_officer", "public_health_analyst", "system_admin"],','roles: ["medical_officer", "public_health_analyst", "system_admin", "mortuary_clerk"],')
  s=s.replace('  const { pathname }','  const { t } = usePreferences()\n  const { pathname }').replace('<span>{item.label}</span>','<span>{t(item.label)}</span>')
  return s
})
edit('client/src/components/site-header.tsx',s=>s.replace('import { AlertsBell } from "@/components/alerts-bell"',`import { NotificationBell } from "@/components/notification-bell"
import { usePreferences } from "@/lib/preferences"
import { Link } from "react-router-dom"
import { useAuth } from "@/lib/auth"
import { Moon, Sun, Search } from "lucide-react"`).replace('  return (','  const { theme, setTheme, t } = usePreferences()\n  const { user } = useAuth()\n  return (').replace('{title}</h1>','{t(title)}</h1>').replace('<AlertsBell />',`{user?.role !== "executive" && <Link to="/search" aria-label="Search" className="rounded p-2 hover:bg-muted"><Search className="size-4" /></Link>}
        <button aria-label="Toggle dark mode" className="rounded p-2 hover:bg-muted" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}</button>
        <NotificationBell />`).replace('border-slate-200 bg-white/95','border-border bg-background/95').replace('supports-backdrop-filter:bg-white/80','').replaceAll('text-slate-900','text-foreground').replaceAll('text-slate-700','text-foreground'))
edit('client/src/components/nav-user.tsx',s=>s.replace('<DropdownMenuItem onClick={handleSignOut}', '<DropdownMenuItem onClick={() => navigate("/profile")}>My Profile</DropdownMenuItem>\n            <DropdownMenuItem onClick={handleSignOut}'))
edit('client/src/lib/auth.tsx',s=>s.replace('password: string) => Promise<void>','password: string, code?: string) => Promise<void>').replace('async function signIn(email: string, password: string)', 'async function signIn(email: string, password: string, code?: string)').replace('JSON.stringify({ email, password })','JSON.stringify({ email, password, code: code || undefined })'))
edit('client/src/pages/sign-in.tsx',s=>s.replace('  const [email,','  const [code,setCode] = useState("")\n  const [email,').replace('signIn(email, password)','signIn(email, password, code)').replace(/setError\(\s*err instanceof ApiError[\s\S]*?\)\n      setLoading/, 'setError(err instanceof Error ? err.message : "Sign-in failed")\n      setLoading').replace('<Button type="submit"', '<div className="space-y-1.5"><Label htmlFor="two-factor">Authenticator or recovery code (if enabled)</Label><Input id="two-factor" autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value)} /></div>\n                <Button type="submit"').replace('name@mohcc.gov.zw','name@mohcc.org.zw').replace('tabIndex={-1}','tabIndex={0}'))
edit('client/src/lib/api.ts',s=>s.replace('if (res.status === 401) {','if (res.status === 401 && token && path !== "/auth/login" && !path.includes("change-password")) {'))
edit('client/src/pages/admin-users.tsx',s=>s.replace('"public_health_analyst", "system_admin"]','"public_health_analyst", "system_admin", "mortuary_clerk", "executive"]'))
edit('client/src/pages/notification-new.tsx',s=>s.replace('    const payload = {','    const payload = {\n      submissionId: crypto.randomUUID(),').replace('        enqueue(payload)','        await enqueue(payload)').replace('clinicalSummary: form.clinicalSummary || null','clinicalSummary: user?.role === "mortuary_clerk" ? null : form.clinicalSummary || null'))
edit('client/src/pages/notification-detail.tsx',s=>('import { CommentThread } from "@/components/comment-thread"\n'+s).replace('<div className="space-y-6 lg:col-span-2">','<div className="space-y-6 lg:col-span-2"><CommentThread notificationId={id!} />'))
edit('client/src/components/service-worker-registration.tsx',s=>s.replace('import { useEffect } from "react"','import { useEffect } from "react"\nimport { syncQueue } from "@/lib/offline-queue"').replace('  useEffect(() => {','  useEffect(() => {\n    const sync = () => { void syncQueue().catch(() => {}) }\n    window.addEventListener("online", sync)\n    const timer = setInterval(sync, 30000)\n    return () => { window.removeEventListener("online", sync); clearInterval(timer) }\n  }, [])\n  useEffect(() => {'))
edit('client/vite.config.ts',s=>s.replace('"/api": "http://localhost:4000",','"/api": "http://localhost:4000",\n      "/socket.io": { target: "http://localhost:4000", ws: true },'))
edit('client/src/components/app-layout.tsx',s=>s.replace('bg-white min-h-svh text-slate-900','bg-background min-h-svh text-foreground'))
for(const folder of ['client/src/pages','client/src/components'])for(const name of fs.readdirSync(folder)){if(!name.endsWith('.tsx')||name==='sign-in.tsx'||name==='app-sidebar.tsx')continue;edit(`${folder}/${name}`,s=>s.replaceAll('bg-white','bg-card').replaceAll('text-slate-900','text-foreground').replaceAll('text-slate-700','text-foreground').replaceAll('text-slate-600','text-muted-foreground').replaceAll('text-slate-500','text-muted-foreground').replaceAll('border-slate-200','border-border').replaceAll('bg-slate-50','bg-muted'))}
