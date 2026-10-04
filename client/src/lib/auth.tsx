import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { api, getToken, setToken } from "./api"

export type Role = "medical_officer" | "pathologist" | "public_health_analyst" | "system_admin" | "mortuary_clerk" | "executive"

export interface SessionUser {
  userId: string
  email: string
  name: string
  role: Role
  facilityId: string | null
  province: string | null
  district: string | null
  phone: string | null
  department: string | null
  language: string
  timezone: string
  avatarUrl: string | null
  lastLoginAt: string | null
  failedLoginAttempts: number
  lockedUntil: string | null
}

interface AuthState {
  user: SessionUser | null
  loading: boolean
  signIn: (email: string, password: string, code?: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!getToken()) {
      setLoading(false)
      return
    }
    api<{ user: SessionUser }>("/auth/me")
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false))
  }, [])

  async function signIn(email: string, password: string, code?: string) {
    const res = await api<{ token: string; user: SessionUser }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password, code: code || undefined }),
    })
    setToken(res.token)
    setUser(res.user)
  }

  async function signOut() {
    try {
      await api("/auth/logout", { method: "POST" })
    } catch {
      /* best effort — clear locally regardless */
    }
    setToken(null)
    setUser(null)
  }

  return <AuthContext.Provider value={{ user, loading, signIn, signOut }}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>")
  return ctx
}
