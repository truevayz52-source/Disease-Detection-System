import { Router as ExpressRouter, type RequestHandler } from "express"

// Express 4 does not forward rejected async handlers to error middleware.
export function Router() {
  const router = ExpressRouter()
  for (const method of ["get", "post", "patch", "put", "delete", "use"] as const) {
    const original = (router[method] as Function).bind(router)
    ;(router as any)[method] = (...args: any[]) => original(...args.map(function wrap(arg: any): any {
      if (Array.isArray(arg)) return arg.map(wrap)
      if (typeof arg !== "function" || arg.length === 4 || arg.stack) return arg
      const handler: RequestHandler = (req, res, next) => {
        try { Promise.resolve(arg(req, res, next)).catch(next) } catch (error) { next(error) }
      }
      return handler
    }))
  }
  return router
}
