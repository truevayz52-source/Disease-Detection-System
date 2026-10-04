import { Link, useNavigate } from "react-router-dom"
import { LogOut } from "lucide-react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { useAuth, type Role } from "@/lib/auth"
import { ROLE_LABELS } from "@/lib/roles"
import { usePreferences } from "@/lib/preferences"

function initials(name: string) {const{t}=usePreferences();
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase()
}

export function NavUser({ user }: { user: { name: string; email: string; role: Role } }) {const{t}=usePreferences();
  const navigate = useNavigate()
  const { signOut } = useAuth()

  async function handleSignOut() {
    await signOut()
    navigate("/sign-in")
  }

  return (
    <div className="flex flex-col gap-2.5 px-2 pb-2 group-data-[collapsible=icon]:items-center">
      <Link
        to="/profile"
        className="flex items-center gap-2.5 rounded-lg px-1 py-1 transition-colors hover:bg-white/10 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
        title={t("My Profile")}
      >
        <Avatar className="size-9 shrink-0 rounded-lg shadow-md">
          <AvatarFallback className="rounded-lg bg-emerald-600 text-sm font-bold text-white">
            {initials(user.name)}
          </AvatarFallback>
        </Avatar>
        <div className="grid min-w-0 flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
          <span className="truncate text-sm font-semibold text-white">{user.name}</span>
          <span className="truncate text-[10px] font-semibold uppercase tracking-wider text-white/60">
            {ROLE_LABELS[user.role]}
          </span>
        </div>
      </Link>
      <button
        onClick={handleSignOut}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-400/40 bg-red-950/40 px-3 py-2 text-xs font-semibold text-red-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition-all hover:bg-red-900/50 hover:text-red-200 group-data-[collapsible=icon]:size-9 group-data-[collapsible=icon]:p-0"
        title={t("Sign Out")}
      >
        <LogOut className="size-3.5" />
        <span className="group-data-[collapsible=icon]:hidden">{t("Sign Out")}</span>
      </button>
    </div>
  )
}
