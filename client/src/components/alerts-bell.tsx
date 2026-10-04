import { Link } from "react-router-dom"
import useSWR from "swr"
import { Bell } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { api } from "@/lib/api"

const fetcher = (url: string) => api<{ count: number }>(url)

/**
 * Polls the active-alert count so any signed-in user sees new outbreak
 * alerts without a manual refresh (Chapter 1.3 objective: real-time,
 * synchronous alerting across the system).
 */
export function AlertsBell() {
  const { data } = useSWR("/alerts/active-count", fetcher, { refreshInterval: 15000 })
  const count = data?.count ?? 0

  return (
    <Button variant="ghost" size="icon" className="relative" asChild>
      <Link to="/alerts" aria-label={`${count} active outbreak alerts`}>
        <Bell className="size-4.5" />
        {count > 0 && (
          <Badge
            variant="destructive"
            className="absolute -top-1 -right-1 h-4.5 min-w-4.5 rounded-full px-1 text-[10px] tabular-nums"
          >
            {count > 99 ? "99+" : count}
          </Badge>
        )}
      </Link>
    </Button>
  )
}
