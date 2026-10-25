import { useEffect, useRef, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "./auth"
import { getToken } from "./api"

/** How long a session can sit idle before the client auto-signs out.
 *  Must be shorter than the server's SESSION_IDLE_MINUTES so the client
 *  always ends the session before the server-side row lapses. */
const IDLE_MINUTES = 28
const WARNING_MINUTES = 2 // toast heads-up this long before signing out
const MS_IDLE = IDLE_MINUTES * 60_000
const MS_WARN = (IDLE_MINUTES - WARNING_MINUTES) * 60_000

const ACTIVITY_EVENTS = ["mousedown", "mousemove", "keydown", "touchstart", "scroll"] as const

/**
 * Track mouse/keyboard/scroll activity and auto-sign out when the user has
 * been idle for IDLE_MINUTES. Mounted inside AppLayout so it covers every
 * authenticated page. The server-side sliding expiry backs it up — this is
 * the friendly, proactive path.
 */
export function useIdleTimeout() {
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const lastActive = useRef(Date.now())
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const warned = useRef(false)

  const doSignOut = useCallback(() => {
    if (!getToken()) return
    signOut()
      .catch(() => {})
      .finally(() => navigate("/sign-in", { replace: true }))
  }, [signOut, navigate])

  const reset = useCallback(() => {
    lastActive.current = Date.now()
    warned.current = false
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      // First warning — then sign out WARNING_MINUTES later.
      warned.current = true
      import("sonner").then(({ toast }) => {
        toast.warning(`Session expires in ${WARNING_MINUTES} minutes — move the mouse or press a key to stay signed in.`)
      }).catch(() => {})
      timer.current = setTimeout(doSignOut, MS_WARN)
    }, MS_IDLE - MS_WARN)
  }, [doSignOut])

  useEffect(() => {
    const handler = () => reset()
    for (const e of ACTIVITY_EVENTS) document.addEventListener(e, handler, { passive: true })
    reset()
    return () => {
      for (const e of ACTIVITY_EVENTS) document.removeEventListener(e, handler)
      if (timer.current) clearTimeout(timer.current)
    }
  }, [reset])
}
