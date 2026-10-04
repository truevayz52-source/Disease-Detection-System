import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Search, ArrowRight } from "lucide-react"
import { usePreferences } from "@/lib/preferences"

export function DualICDCoding() {const{t}=usePreferences();
  const [query, setQuery] = useState("")
  const [version, setVersion] = useState("ICD-10")
  const [icd10Code, setIcd10Code] = useState("")
  const [results, setResults] = useState<any[]>([])
  const [converting, setConverting] = useState(false)
  const [conversion, setConversion] = useState<any>(null)

  const handleSearch = async () => {
    try {
      const response = await fetch(`/api/dual-coding/search?q=${query}&version=${version}`)
      const data = await response.json()
      setResults(data.items || [])
    } catch (error) {
      console.error("Search error:", error)
    }
  }

  const handleConvert = async () => {
    setConverting(true)
    try {
      const response = await fetch("/api/dual-coding/convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ icd10Code }),
      })
      const data = await response.json()
      setConversion(data)
    } catch (error) {
      console.error("Conversion error:", error)
    } finally {
      setConverting(false)
    }
  }

  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle>{t("Automated Dual ICD Coding (ICD-10 / ICD-11)")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>{t("ICD Version")}</Label>
            <select
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              className="w-full mt-1 rounded-md border p-2"
            >
              <option value="ICD-10">{t("ICD-10")}</option>
              <option value="ICD-11">{t("ICD-11")}</option>
            </select>
          </div>
          <div>
            <Label>{t("Search Query")}</Label>
            <div className="flex gap-2 mt-1">
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Search codes...")} />
              <Button onClick={handleSearch} size="icon">
                <Search className="size-4" />
              </Button>
            </div>
          </div>
        </div>

        {results.length > 0 && (
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {results.map((result) => (
              <div
                key={result.icd_code}
                className="p-2 border rounded hover:bg-muted cursor-pointer"
                onClick={() => setIcd10Code(result.icd_code)}
              >
                <p className="font-medium">{result.icd_code}</p>
                <p className="text-sm text-muted-foreground">{result.description}</p>
              </div>
            ))}
          </div>
        )}

        <div className="border-t pt-4">
          <Label>{t("ICD-10 to ICD-11 Conversion")}</Label>
          <div className="flex gap-2 mt-1">
            <Input value={icd10Code} onChange={(e) => setIcd10Code(e.target.value)} placeholder={t("Enter ICD-10 code")} />
            <Button onClick={handleConvert} disabled={converting || !icd10Code}>
              <ArrowRight className="size-4 mr-2" />
              {converting ? "Converting..." : "Convert"}
            </Button>
          </div>
        </div>

        {conversion && (
          <Alert>
            <AlertDescription>
              <div className="space-y-2">
                <p className="font-medium">{t("Conversion Result")}</p>
                <p>ICD-10: {conversion.icd10Code}</p>
                <p>ICD-11: {conversion.icd11Code || "No mapping available"}</p>
                <p className="text-sm text-muted-foreground">
                  {conversion.converted ? "Mapping found" : "No direct mapping available"}
                </p>
              </div>
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}
