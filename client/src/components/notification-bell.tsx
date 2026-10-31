import { Link } from "react-router-dom"
import { Bell } from "lucide-react"
import useSWR from "swr"
import { api } from "@/lib/api"
import { useRealtime } from "@/lib/realtime"
import { usePreferences } from "@/lib/preferences"

export function NotificationBell() {const{t}=usePreferences();
  const { data } = useSWR<any>("/inbox", api, { refreshInterval: 60000 })
  const { connected } = useRealtime()

  return (
    <Link
      className="relative rounded-md border border-border p-2 hover:bg-muted"
      to="/notifications-center"
      aria-label={`Notifications: ${data?.unread ?? 0} unread`}
      title={connected ? "Live notifications connected" : "Notifications reconnecting; periodic refresh active"}
    >
      <Bell className="size-4" />
      {data?.unread > 0 && (
        <span className="absolute -right-1 -top-1 rounded-full bg-destructive px-1.5 text-[10px] text-white">
          {data.unread}
        </span>
      )}
      <span className={`absolute bottom-1 right-1 size-1.5 rounded-full ${connected ? "bg-green-600" : "bg-amber-500"}`} />
    </Link>
  )
}
