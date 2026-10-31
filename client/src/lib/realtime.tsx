import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import { useNavigate } from "react-router-dom"
import { io, type Socket } from "socket.io-client"
import { mutate } from "swr"
import { toast } from "sonner"
import { getToken } from "./api"
import { useAuth } from "./auth"

interface InboxEvent {
  notification_id?: string
  notification_type?: string
  title?: string
  message?: string
  action_url?: string
}

const RealtimeContext = createContext<{ connected: boolean }>({ connected: false })
export const useRealtime = () => useContext(RealtimeContext)

const DANGER_TYPES = new Set(["outbreak", "rejection"])

/**
 * Connects the signed-in user to the API's socket.io channel. The server
 * pushes "inbox:changed" whenever notifyUser writes a row (outbreak/early-
 * warning alerts, autopsy finalized, death certified, assignments, mentions
 * …). On each push we revalidate the SWR keys that show that state — inbox,
 * alert badges, dashboard KPIs — and raise a toast so the event is seen even
 * if the user is on another page.
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [connected, setConnected] = useState(false)
  const seen = useRef(new Set<string>())

  useEffect(() => {
    if (!user) return
    const socket: Socket = io("/", { auth: { token: getToken() }, transports: ["websocket", "polling"] })
    socket.on("connect", () => setConnected(true))
    socket.on("disconnect", () => setConnected(false))
    socket.on("inbox:changed", (n?: InboxEvent) => {
      mutate(
        (key) => typeof key === "string" && (key.startsWith("/inbox") || key.startsWith("/alerts") || key.startsWith("/analytics/dashboard")),
        undefined,
        { revalidate: true },
      )
      if (!n?.notification_id || seen.current.has(n.notification_id)) return
      seen.current.add(n.notification_id)
      const show = DANGER_TYPES.has(n.notification_type ?? "") ? toast.error : toast
      show(n.title ?? "New notification", {
        description: n.message,
        action: n.action_url ? { label: "View", onClick: () => navigate(n.action_url!) } : undefined,
      })
    })
    return () => {
      socket.disconnect()
      setConnected(false)
    }
  }, [user, navigate])

  return <RealtimeContext.Provider value={{ connected }}>{children}</RealtimeContext.Provider>
}
