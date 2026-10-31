import type { NextFunction, Request, Response } from "express"

const store = new Map<string, { at: number; body: unknown }>()

/**
 * Short-TTL JSON response cache for hot read endpoints (polled badges,
 * dashboards, list views). Every sequential Supabase query costs ~220ms of
 * round-trip — a 10–60s in-process cache turns repeat polls into ~1ms.
 * Keys default to method+URL+userId so facility-scoped payloads never leak
 * across users. Mutations bypass the cache entirely (POST/PATCH/DELETE
 * aren't wrapped).
 */
export function ttlCache(seconds: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.method}:${req.originalUrl}:${req.user?.userId ?? "anon"}`
    const hit = store.get(key)
    if (hit && Date.now() - hit.at < seconds * 1000) {
      res.json(hit.body)
      return
    }
    const send = res.json.bind(res)
    res.json = ((body: unknown) => {
      if (store.size > 500) {
        const now = Date.now()
        for (const [k, v] of store) if (now - v.at > 60_000) store.delete(k)
      }
      store.set(key, { at: Date.now(), body })
      return send(body)
    }) as typeof res.json
    next()
  }
}
