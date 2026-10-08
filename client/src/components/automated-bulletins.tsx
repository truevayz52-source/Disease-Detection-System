import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { FileText, Download } from "lucide-react"
import { usePreferences } from "@/lib/preferences"

export function AutomatedBulletins() {
  const { t } = usePreferences()
  const [type, setType] = useState("weekly")
  const [district, setDistrict] = useState("")
  const [generating, setGenerating] = useState(false)
  const [bulletin, setBulletin] = useState<any>(null)

  const handleGenerate = async () => {
    setGenerating(true)
    try {
      const response = await fetch("/api/bulletins/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, district }),
      })
      const data = await response.json()
      setBulletin(data.bulletin)
    } catch (error) {
      console.error("Bulletin generation error:", error)
    } finally {
      setGenerating(false)
    }
  }

  const handleDownload = () => {
    if (!bulletin) return
    const blob = new Blob([JSON.stringify(bulletin, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${type}-bulletin-${district || "national"}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle>{t("Automated Epidemiological Bulletins")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>{t("Report Type")}</Label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full mt-1 rounded-md border p-2"
            >
              <option value="daily">{t("Daily")}</option>
              <option value="weekly">{t("Weekly")}</option>
              <option value="monthly">{t("Monthly")}</option>
            </select>
          </div>
          <div>
            <Label>{t("District (Optional)")}</Label>
            <input
              value={district}
              onChange={(e) => setDistrict(e.target.value)}
              placeholder={t("Leave empty for national")}
              className="w-full mt-1 rounded-md border p-2"
            />
          </div>
        </div>
        <Button onClick={handleGenerate} disabled={generating}>
          <FileText className="size-4 mr-2" />
          {generating ? "Generating..." : "Generate Bulletin"}
        </Button>

        {bulletin && (
          <>
            <Alert>
              <AlertDescription>
                <div className="space-y-2">
                  <p className="font-medium">{t("Bulletin Generated Successfully")}</p>
                  <p>Total Cases: {bulletin.summary.totalCases}</p>
                  <p>Active Alerts: {bulletin.summary.activeAlerts}</p>
                  <p>Resolved Alerts: {bulletin.summary.resolvedAlerts}</p>
                  <p>Period: {bulletin.period.start} to {bulletin.period.end}</p>
                </div>
              </AlertDescription>
            </Alert>
            <Button onClick={handleDownload} variant="outline">
              <Download className="size-4 mr-2" />
              Download JSON
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  )
}
