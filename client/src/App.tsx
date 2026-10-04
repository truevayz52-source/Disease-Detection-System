import { lazy, Suspense } from "react"
import { PreferencesProvider } from "@/lib/preferences"
const UserProfile = lazy(() => import("@/pages/user-profile"))
const PasswordReset = lazy(() => import("@/pages/password-reset"))
const NotificationsCenter = lazy(() => import("@/pages/notifications-center"))
const OfflineSync = lazy(() => import("@/pages/offline-sync-dashboard"))
const SignalRegistryPage = lazy(() => import("@/pages/signals"))
const MpdsrPage = lazy(() => import("@/pages/workflows").then(m => ({default:m.MpdsrPage})))
const ThresholdPage = lazy(() => import("@/pages/workflows").then(m => ({default:m.ThresholdPage})))
const CrossBorderPage = lazy(() => import("@/pages/workflows").then(m => ({default:m.CrossBorderPage})))
const ExecutivePage = lazy(() => import("@/pages/operations").then(m => ({default:m.ExecutivePage})))
const ForecastPage = lazy(() => import("@/pages/operations").then(m => ({default:m.ForecastPage})))
const ReportsPage = lazy(() => import("@/pages/operations").then(m => ({default:m.ReportsPage})))
const SecurityPage = lazy(() => import("@/pages/operations").then(m => ({default:m.SecurityPage})))
const SettingsPage = lazy(() => import("@/pages/operations").then(m => ({default:m.SettingsPage})))
const SearchPage = lazy(() => import("@/pages/operations").then(m => ({default:m.SearchPage})))
const GpsPage = lazy(() => import("@/pages/operations").then(m => ({default:m.GpsPage})))
const VoicePage = lazy(() => import("@/pages/operations").then(m => ({default:m.VoicePage})))
import { Navigate, Outlet, Route, Routes } from "react-router-dom"
import { useAuth, type Role } from "@/lib/auth"
import { AppLayout } from "@/components/app-layout"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ServiceWorkerRegistration } from "@/components/service-worker-registration"
import SignInPage from "@/pages/sign-in"
import ForbiddenPage from "@/pages/forbidden"
import DashboardPage from "@/pages/dashboard"
import NotificationsPage from "@/pages/notifications"
import NotificationNewPage from "@/pages/notification-new"
import NotificationDetailPage from "@/pages/notification-detail"
import PathologyQueuePage from "@/pages/pathology-queue"
import PathologyReviewPage from "@/pages/pathology-review"
import AutopsiesPage from "@/pages/autopsies"
import AutopsyDetailPage from "@/pages/autopsy-detail"
import AnalyticsPage from "@/pages/analytics"
import AnalyticsMapPage from "@/pages/analytics-map"
import AlertsPage from "@/pages/alerts"
import AdminUsersPage from "@/pages/admin-users"
import AdminFacilitiesPage from "@/pages/admin-facilities"
import AuditPage from "@/pages/audit"

function RequireAuth() {
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">Loading…</div>
    )
  }
  if (!user) return <Navigate to="/sign-in" replace />
  return <Outlet />
}

export function RequireRole({ roles }: { roles: Role[] }) {
  const { user } = useAuth()
  if (!user || !roles.includes(user.role)) return <Navigate to="/forbidden" replace />
  return <Outlet />
}

export default function App() {
  const { user } = useAuth()
  return (
    <PreferencesProvider><TooltipProvider delay={200}><Suspense fallback={<div className="p-8" role="status">Loading workspace…</div>}>
      <Routes>
        <Route path="/sign-in" element={<SignInPage />} />
        <Route path="/forgot-password" element={<PasswordReset />} />
        <Route path="/reset-password" element={<PasswordReset />} />
        <Route path="/forbidden" element={<ForbiddenPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<AppLayout />}>
            <Route path="/" element={<Navigate to={user ? "/dashboard" : "/sign-in"} replace />} />
            <Route path="/dashboard" element={user?.role === "executive" ? <ExecutivePage /> : <DashboardPage />} />
            <Route path="/profile" element={<UserProfile />} />
            <Route path="/notifications-center" element={<NotificationsCenter />} />
            <Route element={<RequireRole roles={["medical_officer","mortuary_clerk","pathologist","public_health_analyst","system_admin"]} />}><Route path="/search" element={<SearchPage />} /></Route>
            <Route element={<RequireRole roles={["medical_officer","mortuary_clerk","system_admin"]} />}><Route path="/offline-sync" element={<OfflineSync />} /><Route path="/voice-autopsy" element={<VoicePage />} /></Route>
            <Route element={<RequireRole roles={["medical_officer","mortuary_clerk","public_health_analyst","system_admin"]} />}><Route path="/signals" element={<SignalRegistryPage />} /></Route>
            <Route element={<RequireRole roles={["medical_officer","public_health_analyst","system_admin"]} />}><Route path="/mpdsr" element={<MpdsrPage />} /><Route path="/cross-border" element={<CrossBorderPage />} /></Route>
            <Route element={<RequireRole roles={["medical_officer","system_admin"]} />}><Route path="/gps-dashboard" element={<GpsPage />} /></Route>
            <Route element={<RequireRole roles={["public_health_analyst","system_admin"]} />}><Route path="/alert-config" element={<ThresholdPage />} /><Route path="/resource-allocation" element={<ForecastPage />} /></Route>
            <Route element={<RequireRole roles={["public_health_analyst","system_admin","executive"]} />}><Route path="/reports" element={<ReportsPage />} /><Route path="/executive-dashboard" element={<ExecutivePage />} /></Route>
            <Route element={<RequireRole roles={["system_admin"]} />}><Route path="/security-dashboard" element={<SecurityPage />} /><Route path="/system-settings" element={<SettingsPage />} /></Route>
            <Route element={<RequireRole roles={["medical_officer", "mortuary_clerk", "public_health_analyst", "system_admin"]} />}>
              <Route path="/notifications" element={<NotificationsPage />} />
              <Route path="/notifications/new" element={<NotificationNewPage />} />
            </Route>
            <Route path="/notifications/:id" element={<NotificationDetailPage />} />
            <Route element={<RequireRole roles={["pathologist", "system_admin"]} />}>
              <Route path="/pathology/queue" element={<PathologyQueuePage />} />
              <Route path="/pathology/review/:id" element={<PathologyReviewPage />} />
            </Route>
            <Route element={<RequireRole roles={["pathologist", "public_health_analyst", "system_admin"]} />}>
              <Route path="/autopsy" element={<AutopsiesPage />} />
              <Route path="/autopsy/:id" element={<AutopsyDetailPage />} />
            </Route>
            <Route element={<RequireRole roles={["public_health_analyst", "system_admin"]} />}>
              <Route path="/analytics" element={<AnalyticsPage />} />
              <Route path="/analytics/map" element={<AnalyticsMapPage />} />
              <Route path="/audit" element={<AuditPage />} />
            </Route>
            <Route path="/alerts" element={<AlertsPage />} />
            <Route element={<RequireRole roles={["system_admin"]} />}>
              <Route path="/admin/users" element={<AdminUsersPage />} />
              <Route path="/admin/facilities" element={<AdminFacilitiesPage />} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
      <Toaster />
      <ServiceWorkerRegistration />
    </Suspense></TooltipProvider></PreferencesProvider>
  )
}
