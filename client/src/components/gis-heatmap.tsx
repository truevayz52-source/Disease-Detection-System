import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { MapPin, AlertCircle } from "lucide-react"
import { usePreferences } from "@/lib/preferences"

export function GISHeatmap() {const{t}=usePreferences();
  const [district, setDistrict] = useState("")
  const [days, setDays] = useState(30)
  const [loading, setLoading] = useState(false)
  const [heatmapData, setHeatmapData] = useState<any>(null)

  const handleLoadHeatmap = async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/gis/heatmap?district=${district}&days=${days}`)
      const data = await response.json()
      setHeatmapData(data)
    } catch (error) {
      console.error("Heatmap error:", error)
    } finally {
      setLoading(false)
    }
  }

  const handleCluster = async () => {
    setLoading(true)
    try {
      const response = await fetch("/api/gis/cluster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ district, days, eps: 0.1, minPts: 3 }),
      })
      const data = await response.json()
      setHeatmapData(data)
    } catch (error) {
      console.error("Clustering error:", error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle>{t("Spatiotemporal GIS Heatmaps & Clustering")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>District</Label>
            <Input value={district} onChange={(e) => setDistrict(e.target.value)} placeholder={t("Enter district")} />
          </div>
          <div>
            <Label>Days</Label>
            <Input type="number" value={days} onChange={(e) => setDays(parseInt(e.target.value))} />
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={handleLoadHeatmap} disabled={loading || !district}>
            <MapPin className="size-4 mr-2" />
            {loading ? "Loading..." : "Load Heatmap"}
          </Button>
          <Button onClick={handleCluster} variant="outline" disabled={loading || !district}>
            <AlertCircle className="size-4 mr-2" />
            Run DBSCAN Clustering
          </Button>
        </div>

        {heatmapData && (
          <Alert>
            <AlertDescription>
              <div className="space-y-2">
                <p className="font-medium">
                  {heatmapData.clusters ? "Clustering Results" : "Heatmap Data"}
                </p>
                {heatmapData.clusters && (
                  <>
                    <p>Clusters detected: {heatmapData.clusters.length}</p>
                    <p>Total points: {heatmapData.totalPoints}</p>
                    <p>Clustered points: {heatmapData.clusteredPoints}</p>
                    <p>Noise points: {heatmapData.noise.length}</p>
                  </>
                )}
                {heatmapData.items && (
                  <p>Heatmap points: {heatmapData.items.length}</p>
                )}
                <p className="text-sm text-muted-foreground">
                  Spatial visualization using DBSCAN algorithm to detect disease clusters across district borders.
                </p>
              </div>
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}
