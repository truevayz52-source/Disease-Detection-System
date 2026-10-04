import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { FileText, CheckCircle2 } from "lucide-react"
import { usePreferences } from "@/lib/preferences"

export function VerbalAutopsy() {const{t}=usePreferences();
  const [notificationId, setNotificationId] = useState("")
  const [interviewerName, setInterviewerName] = useState("")
  const [interviewDate, setInterviewDate] = useState("")
  const [vaData, setVaData] = useState("{}")
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    setSaved(false)
    try {
      const response = await fetch("/api/verbal-autopsy/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notificationId,
          interviewerName,
          interviewDate,
          vaData: JSON.parse(vaData),
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
        <CardTitle>{t("Standardized Verbal Autopsy (WHO/InterVA-5)")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label>{t("Notification ID")}</Label>
          <Input value={notificationId} onChange={(e) => setNotificationId(e.target.value)} placeholder={t("Enter notification ID")} />
        </div>
        <div>
          <Label>{t("Interviewer Name")}</Label>
          <Input value={interviewerName} onChange={(e) => setInterviewerName(e.target.value)} placeholder={t("Interviewer name")} />
        </div>
        <div>
          <Label>{t("Interview Date")}</Label>
          <Input type="date" value={interviewDate} onChange={(e) => setInterviewDate(e.target.value)} />
        </div>
        <div>
          <Label>{t("VA Data (JSON)")}</Label>
          <textarea
            value={vaData}
            onChange={(e) => setVaData(e.target.value)}
            placeholder='{"symptoms": [...], "duration": "..."}'
            className="w-full mt-1 rounded-md border p-2 min-h-[120px] font-mono text-sm"
          />
        </div>
        <Button onClick={handleSave} disabled={saving || !notificationId || !interviewerName}>
          <FileText className="size-4 mr-2" />
          {saving ? "Saving..." : "Save Verbal Autopsy"}
        </Button>

        {saved && (
          <Alert>
            <CheckCircle2 className="size-4" />
            <AlertDescription>
              Verbal autopsy saved following WHO/InterVA-5 standards.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}
