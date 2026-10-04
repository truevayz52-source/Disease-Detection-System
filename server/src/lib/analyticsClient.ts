import { config } from "../config.js"

/**
 * Thin client for the Python FastAPI analytics service (scikit-learn).
 * Hard 3s timeout: if the service is down, callers fall back to the Node
 * implementation so analytics never block clinical workflows (Ch 5.3).
 */
export async function callPython<T>(path: string, body: unknown): Promise<T | null> {
  try {
    const res = await fetch(`${config.analyticsUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

export async function pythonHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${config.analyticsUrl}/health`, { signal: AbortSignal.timeout(2000) })
    return res.ok
  } catch {
    return false
  }
}
