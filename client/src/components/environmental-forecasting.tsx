import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { MapPin, Thermometer, Droplets, Wind } from "lucide-react"
import { usePreferences } from "@/lib/preferences"

export function EnvironmentalForecasting() {const{t}=usePreferences();
  const [district, setDistrict] = useState("")
  const [dataType, setDataType] = useState("rainfall")
  const [forecasting, setForecasting] = useState(false)
  const [forecast, setForecast] = useState<any>(null)

  const handleForecast = async () => {
    setForecasting(true)
    try {
      const response = await fetch(`/api/environmental/${district}?type=${dataType}&days=30`)
      const data = await response.json()
      setForecast(data)
    } catch (error) {
      console.error("Forecasting error:", error)
    } finally {
      setForecasting(false)
    }
  }

  const getDataIcon = (type: string) => {
    switch (type) {
      case "rainfall": return <Droplets className="size-4" />
      case "temperature": return <Thermometer className="size-4" />
      case "humidity": return <Droplets className="size-4" />
      case "water_level": return <MapPin className="size-4" />
      default: return <Wind className="size-4" />
    }
  }

  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle>{t("Climate & Environmental Outbreak Forecasting")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>District</Label>
            <Input value={district} onChange={(e) => setDistrict(e.target.value)} placeholder={t("Enter district")} />
          </div>
          <div>
            <Label>{t("Data Type")}</Label>
            <select
              value={dataType}
              onChange={(e) => setDataType(e.target.value)}
              className="w-full mt-1 rounded-md border p-2"
            >
              <option value="rainfall">Rainfall</option>
              <option value="temperature">Temperature</option>
              <option value="humidity">Humidity</option>
              <option value="water_level">{t("Water Level")}</option>
            </select>
          </div>
        </div>
        <Button onClick={handleForecast} disabled={forecasting || !district}>
          {forecasting ? "Analyzing..." : "Generate Forecast"}
        </Button>

        {forecast && (
          <Alert>
            <AlertDescription>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  {getDataIcon(dataType)}
                  <span className="font-medium">{dataType.toUpperCase()} Data</span>
                </div>
                <p>{forecast.items?.length || 0} data points retrieved</p>
                <p className="text-sm text-muted-foreground">
                  Forecasting correlates environmental data with baseline mortality trends to predict vector-borne disease outbreaks.
                </p>
              </div>
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}
