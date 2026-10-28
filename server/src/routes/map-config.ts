import { Router } from "../lib/router.js"
import { requireAuth } from "../auth/middleware.js"
import { resolveMapTiles } from "../lib/map-tiles.js"

export const mapConfigRouter = Router()

// Basemap tile config for the web (Leaflet) and mobile (flutter_map)
// surveillance maps — see lib/map-tiles.ts for the provider chain.
mapConfigRouter.get("/config/map", requireAuth, async (_req, res) => {
  res.json(await resolveMapTiles())
})
