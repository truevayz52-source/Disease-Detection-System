import { Outlet } from "react-router-dom"
import { AppSidebar } from "@/components/app-sidebar"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { useAuth } from "@/lib/auth"

export function AppLayout() {
  const { user } = useAuth()
  if (!user) return null

  return (
    <SidebarProvider>
      <AppSidebar role={user.role} user={{ name: user.name, email: user.email, role: user.role }} />
      <SidebarInset className="bg-background min-h-svh text-foreground">
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
  )
}
