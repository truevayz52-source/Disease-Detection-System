import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Save, CheckCircle2 } from "lucide-react"
import { usePreferences } from "@/lib/preferences"

export function CausalChainCOD() {const{t}=usePreferences();
  const [notificationId, setNotificationId] = useState("")
  const [underlyingCause, setUnderlyingCause] = useState("")
  const [intermediateCause, setIntermediateCause] = useState("")
  const [immediateCause, setImmediateCause] = useState("")
  const [contributoryConditions, setContributoryConditions] = useState("")
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    setSaved(false)
    try {
      const response = await fetch("/api/causal-chain/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notificationId,
          underlyingCause,
          intermediateCause,
          immediateCause,
          contributoryConditions: contributoryConditions.split(",").map((c) => c.trim()).filter(Boolean),
        }),
      })
      if (response.ok) {
        setSaved(true)
      }
    } catch (error) {
      console.error("Save error:", error)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle>{t("Structured Causal Chain COD (WHO Standards)")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label>{t("Notification ID")}</Label>
          <Input value={notificationId} onChange={(e) => setNotificationId(e.target.value)} placeholder={t("Enter notification ID")} />
        </div>
        <div>
          <Label>{t("Underlying Cause")}</Label>
          <Input value={underlyingCause} onChange={(e) => setUnderlyingCause(e.target.value)} placeholder={t("e.g., Cholera infection")} />
        </div>
        <div>
          <Label>{t("Intermediate Cause")}</Label>
          <Input value={intermediateCause} onChange={(e) => setIntermediateCause(e.target.value)} placeholder={t("e.g., Severe dehydration")} />
        </div>
        <div>
          <Label>{t("Immediate Cause")}</Label>
          <Input value={immediateCause} onChange={(e) => setImmediateCause(e.target.value)} placeholder={t("e.g., Cardiac arrest")} />
        </div>
        <div>
          <Label>{t("Contributory Conditions (comma-separated)")}</Label>
          <Input value={contributoryConditions} onChange={(e) => setContributoryConditions(e.target.value)} placeholder={t("e.g., Hypertension, Diabetes")} />
        </div>
        <Button onClick={handleSave} disabled={saving || !notificationId || !underlyingCause}>
          <Save className="size-4 mr-2" />
          {saving ? "Saving..." : "Save Causal Chain"}
        </Button>

        {saved && (
          <Alert>
            <CheckCircle2 className="size-4" />
            <AlertDescription>
              Causal chain saved successfully following WHO COD standards.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}
