import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AlertTriangle, CheckCircle2 } from "lucide-react"
import { usePreferences } from "@/lib/preferences"

export function DynamicOutbreakDetection() {const{t}=usePreferences();
  const [district, setDistrict] = useState("")
  const [diseaseCategory, setDiseaseCategory] = useState("")
  const [windowDays, setWindowDays] = useState(7)
  const [detecting, setDetecting] = useState(false)
  const [result, setResult] = useState<any>(null)

  const handleDetect = async () => {
    setDetecting(true)
    try {
      const response = await fetch("/api/outbreak/detect-dynamic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ district, diseaseCategory, windowDays }),
      })
      const data = await response.json()
      setResult(data)
    } catch (error) {
      console.error("Detection error:", error)
    } finally {
      setDetecting(false)
    }
  }

  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle>{t("Dynamic Outbreak Threshold Engine")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>{t("District")}</Label>
            <Input value={district} onChange={(e) => setDistrict(e.target.value)} placeholder={t("Enter district")} />
          </div>
          <div>
            <Label>{t("Disease Category")}</Label>
            <Input value={diseaseCategory} onChange={(e) => setDiseaseCategory(e.target.value)} placeholder={t("e.g., Cholera")} />
          </div>
          <div>
            <Label>{t("Window (Days)")}</Label>
            <Input type="number" value={windowDays} onChange={(e) => setWindowDays(parseInt(e.target.value))} />
          </div>
        </div>
        <Button onClick={handleDetect} disabled={detecting || !district}>
          {detecting ? "Analyzing..." : "Run CUSUM Detection"}
        </Button>

        {result && (
          <Alert variant={result.outbreakDetected ? "destructive" : "default"}>
            {result.outbreakDetected ? (
              <AlertTriangle className="size-4" />
            ) : (
              <CheckCircle2 className="size-4" />
            )}
            <AlertDescription>
              <div className="space-y-2">
                <p className="font-medium">
                  {result.outbreakDetected ? "OUTBREAK DETECTED" : "No outbreak detected"}
                </p>
                <p>CUSUM Score: {result.currentCUSUM.toFixed(2)} / {result.threshold}</p>
                <p>Baseline Mean: {result.baseline.mean.toFixed(2)} cases/day</p>
                <p>Baseline Std Dev: {result.baseline.std.toFixed(2)}</p>
              </div>
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}
