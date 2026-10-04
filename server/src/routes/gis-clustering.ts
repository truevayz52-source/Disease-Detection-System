import { Router } from "../lib/router.js"
import { z } from "zod"
import { requireAuth, requireRole } from "../auth/middleware.js"
import { query } from "../db.js"

export const gisClusteringRouter = Router()

// DBSCAN-based spatial clustering for outbreak detection
gisClusteringRouter.post("/cluster", requireAuth, requireRole("public_health_analyst", "system_admin"), async (req, res) => {
  const schema = z.object({
    district: z.string().optional(),
    diseaseCategory: z.string().optional(),
    days: z.number().default(30),
    eps: z.number().default(0.1), // DBSCAN epsilon parameter in degrees (~11km)
    minPts: z.number().default(3), // Minimum points for cluster
  })
  
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "Invalid clustering parameters" })
  
  const { district, diseaseCategory, days, eps, minPts } = parsed.data
  
  // Get death notifications with GPS coordinates
  const deaths = await query<any[]>(
    `SELECT 
      dn.notification_id,
      dn.date_of_death,
      JSON_UNQUOTE(dn.gps_coordinates->'$.lat') as lat,
      JSON_UNQUOTE(dn.gps_coordinates->'$.lng') as lng,
      f.district,
      ic.disease_category
     FROM death_notifications dn
     JOIN facilities f ON f.facility_id = dn.facility_id
     JOIN icd_codes ic ON ic.icd_code = dn.preliminary_icd_code
     WHERE dn.gps_coordinates IS NOT NULL
     ${district ? 'AND f.district = ?' : ''}
     ${diseaseCategory ? 'AND ic.disease_category = ?' : ''}
     AND dn.date_of_death >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
     ORDER BY dn.date_of_death DESC`,
    [district, diseaseCategory, days].filter(Boolean)
  )
  
  // Convert to numeric coordinates
  const points = deaths
    .filter(d => d.lat && d.lng)
    .map(d => ({
      ...d,
      lat: parseFloat(d.lat),
      lng: parseFloat(d.lng),
    }))
  
  // Simple DBSCAN implementation
  const clusters: any[] = []
  const visited = new Set<string>()
  const noise: any[] = []
  
  function distance(p1: any, p2: any): number {
    const R = 6371 // Earth's radius in km
    const dLat = (p2.lat - p1.lat) * Math.PI / 180
    const dLng = (p2.lng - p1.lng) * Math.PI / 180
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(p1.lat * Math.PI / 180) * Math.cos(p2.lat * Math.PI / 180) *
              Math.sin(dLng/2) * Math.sin(dLng/2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
    return R * c
  }
  
  function regionQuery(point: any): any[] {
    return points.filter(p => p.notification_id !== point.notification_id && distance(point, p) <= eps * 111) // Convert degrees to km approx
  }
  
  function expandCluster(point: any, neighbors: any[], clusterId: number): void {
    clusters[clusterId] = clusters[clusterId] || []
    clusters[clusterId].push(point)
    visited.add(point.notification_id)
    
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor.notification_id)) {
        visited.add(neighbor.notification_id)
        const neighborNeighbors = regionQuery(neighbor)
        if (neighborNeighbors.length >= minPts) {
          expandCluster(neighbor, neighborNeighbors, clusterId)
        }
      }
      if (!clusters[clusterId].some((p: any) => p.notification_id === neighbor.notification_id)) {
        clusters[clusterId].push(neighbor)
      }
    }
  }
  
  for (const point of points) {
    if (visited.has(point.notification_id)) continue
    
    const neighbors = regionQuery(point)
    if (neighbors.length < minPts) {
      noise.push(point)
      visited.add(point.notification_id)
    } else {
      expandCluster(point, neighbors, clusters.length)
    }
  }
  
  // Calculate cluster statistics
  const clusterStats = clusters.map((cluster: any[], idx) => {
    const centerLat = cluster.reduce((sum: number, p: any) => sum + p.lat, 0) / cluster.length
    const centerLng = cluster.reduce((sum: number, p: any) => sum + p.lng, 0) / cluster.length
    const diseases: Record<string, number> = {}
    cluster.forEach((p: any) => {
      diseases[p.disease_category] = (diseases[p.disease_category] || 0) + 1
    })
    
    return {
      clusterId: idx,
      center: { lat: centerLat, lng: centerLng },
      size: cluster.length,
      points: cluster,
      diseases,
      district: cluster[0]?.district,
    }
  })
  
  res.json({
    clusters: clusterStats,
    noise,
    totalPoints: points.length,
    clusteredPoints: clusters.reduce((sum, c) => sum + c.length, 0),
  })
})

// Get spatial heatmap data
gisClusteringRouter.get("/heatmap", requireAuth, requireRole("public_health_analyst", "system_admin"), async (req, res) => {
  const district = req.query.district as string
  const days = parseInt(req.query.days as string) || "30"
  
  const deaths = await query<any[]>(
    `SELECT 
      JSON_UNQUOTE(dn.gps_coordinates->'$.lat') as lat,
      JSON_UNQUOTE(dn.gps_coordinates->'$.lng') as lng,
      ic.disease_category,
      dn.date_of_death
     FROM death_notifications dn
     JOIN facilities f ON f.facility_id = dn.facility_id
     JOIN icd_codes ic ON ic.icd_code = dn.preliminary_icd_code
     WHERE dn.gps_coordinates IS NOT NULL
     ${district ? 'AND f.district = ?' : ''}
     AND dn.date_of_death >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
     ORDER BY dn.date_of_death DESC`,
    [district, days].filter(Boolean)
  )
  
  const heatmapData = deaths
    .filter(d => d.lat && d.lng)
    .map(d => ({
      lat: parseFloat(d.lat),
      lng: parseFloat(d.lng),
      weight: 1,
      disease: d.disease_category,
      date: d.date_of_death,
    }))
  
  res.json({ items: heatmapData })
})
