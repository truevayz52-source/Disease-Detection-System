import { usePreferences } from "@/lib/preferences"
import { Link, useLocation } from "react-router-dom"
import {
  Activity,
  AlertTriangle,
  ClipboardPlus,
  FileSearch,
  LayoutDashboard,
  ListChecks,
  Map,
  Radio,
  ScrollText,
  ShieldAlert,
  Stethoscope,
  Users,
} from "lucide-react"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import type { Role } from "@/lib/auth"
import { NavUser } from "@/components/nav-user"

type NavItem = {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  roles: Role[]
}

const NAV_ITEMS: NavItem[] = [
{
    href: "/dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    roles: ["medical_officer", "pathologist", "public_health_analyst", "system_admin", "mortuary_clerk", "executive"],
  },
{
    href: "/notifications",
    label: "Death Notifications",
    icon: ClipboardPlus,
    roles: ["medical_officer", "public_health_analyst", "system_admin", "mortuary_clerk"],
  },
{
    href: "/pathology/queue",
    label: "Pathology Review Queue",
    icon: FileSearch,
    roles: ["pathologist"],
  },
{
    href: "/autopsy",
    label: "Autopsy Reports",
    icon: Stethoscope,
    roles: ["pathologist", "public_health_analyst", "system_admin"],
  },
{href:"/voice-autopsy",label: "Verbal Autopsy",icon:ListChecks,roles:["medical_officer","mortuary_clerk","system_admin"]},
{href:"/signals",label: "Signal Registry",icon:Radio,roles:["medical_officer","mortuary_clerk","public_health_analyst","system_admin"]},
{href:"/mpdsr",label: "MPDSR Workflows",icon:ListChecks,roles:["medical_officer","public_health_analyst","system_admin"]},
{
    href: "/alerts",
    label: "Alerts",
    icon: AlertTriangle,
    roles: ["medical_officer", "pathologist", "public_health_analyst", "system_admin"],
  },
{
    href: "/analytics",
    label: "Outbreak Analytics",
    icon: Activity,
    roles: ["public_health_analyst", "system_admin"],
  },
{
    href: "/analytics/map",
    label: "Outbreak Map",
    icon: Map,
    roles: ["public_health_analyst", "system_admin"],
  },
{href:"/cross-border",label: "Cross-border Tracking",icon:ListChecks,roles:["medical_officer","public_health_analyst","system_admin"]},
{href:"/resource-allocation",label: "Resource Forecasting",icon:ListChecks,roles:["public_health_analyst","system_admin"]},
{href:"/reports",label: "Reports",icon:ListChecks,roles:["public_health_analyst","system_admin","executive"]},
{href:"/gps-dashboard",label: "GPS Tracking",icon:ListChecks,roles:["medical_officer","system_admin"]},
{href:"/offline-sync",label: "Offline Sync",icon:ListChecks,roles:["medical_officer","mortuary_clerk","system_admin"]},
{
    href: "/admin/users",
    label: "User Management",
    icon: Users,
    roles: ["system_admin"],
  },
{
    href: "/admin/facilities",
    label: "Facilities",
    icon: ListChecks,
    roles: ["system_admin"],
  },
{href:"/alert-config",label: "Alert Thresholds",icon:ListChecks,roles:["public_health_analyst","system_admin"]},
{href:"/security-dashboard",label: "Security Dashboard",icon:ShieldAlert,roles:["system_admin"]},
{
    href: "/audit",
    label: "Audit Trail",
    icon: ScrollText,
    roles: ["public_health_analyst", "system_admin"],
  },
{href:"/system-settings",label: "System Settings",icon:ListChecks,roles:["system_admin"]}
]

export function AppSidebar({
  role,
  user,
}: {
  role: Role
  user: { name: string; email: string; role: Role }
}) {
  const { t } = usePreferences()
  const { pathname } = useLocation()
  const items = NAV_ITEMS.filter((item) => item.roles.includes(role))

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border/60 pb-2.5">
        <div className="flex items-center gap-3 px-2 py-2">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white p-1.5 shadow-md ring-2 ring-sidebar-primary/60">
            <img
              src="/mohcc-logo.png"
              alt="MOHCC Logo"
              className="size-full object-contain"
            />
          </div>
          <div className="flex flex-col leading-tight group-data-[collapsible=icon]:hidden">
            <span className="text-sm font-bold text-white tracking-tight">{t("Disease Detection System")}</span>
            <span className="text-[11px] font-semibold text-emerald-400">{t("MOHCC Zimbabwe")}</span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs font-semibold tracking-wider uppercase text-white/50 px-3">{t("Workspace")}</SidebarGroupLabel>
          <SidebarGroupContent className="pt-1">
            <SidebarMenu className="gap-1 px-1">
              {items.map((item) => {
                const active = item.href === items.filter(candidate => pathname === candidate.href || pathname.startsWith(candidate.href + "/")).sort((a,b) => b.href.length - a.href.length)[0]?.href
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      className={`transition-all rounded-lg text-sm font-medium ${
                        active
                          ? "bg-sidebar-primary text-white font-semibold shadow-lg"
                          : "text-white/80 hover:bg-white/10 hover:text-white"
                      }`}
                      render={
                        <Link to={item.href} className="flex items-center gap-3 px-2.5 py-2">
                          <item.icon className={`size-4.5 ${active ? "text-white" : "text-white/70"}`} />
                          <span>{t(item.label)}</span>
                        </Link>
                      }
                      isActive={active}
                      tooltip={t(item.label)}
                    />
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border/60 pt-2">
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  )
}

