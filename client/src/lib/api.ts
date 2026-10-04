/**
 * Fetch wrapper for the DDS REST API. Attaches the JWT, normalizes errors,
 * and bounces to /sign-in on 401 (expired/revoked session).
 */
export class ApiError extends Error {
  status: number
  data?: any
  constructor(status: number, message: string, data?: any) {
    super(message)
    this.status = status
    this.data = data
  }
}

export function getToken(): string | null {
  return localStorage.getItem("dds_token")
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem("dds_token", token)
  else localStorage.removeItem("dds_token")
}

export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken()
  const headers = new Headers(options.headers)
  if (token) headers.set("Authorization", `Bearer ${token}`)
  if (options.body && !(options.body instanceof FormData) && !headers.has("content-type")) {
    headers.set("content-type", "application/json")
  }

  const res = await fetch(`/api${path}`, { ...options, headers })
  if (res.status === 401 && token && path !== "/auth/login" && !path.includes("change-password")) {
    setToken(null)
    if (!location.pathname.startsWith("/sign-in")) {
      location.assign("/sign-in")
    }
    throw new ApiError(401, "Session expired")
  }
  if (!res.ok) {
    let message = res.statusText
    let body: any
    try {
      body = await res.json()
      message = body.error ?? message
    } catch {
      /* non-json error body */
    }
    throw new ApiError(res.status, message, body)
  }
  const ct = res.headers.get("content-type") ?? ""
  return (ct.includes("json") ? res.json() : res.text()) as Promise<T>
}

/** For <img> sources that can't send headers — token rides in the query. */
export function authedFileUrl(imageId: string): string {
  return `/api/images/${imageId}/file?token=${encodeURIComponent(getToken() ?? "")}`
}
