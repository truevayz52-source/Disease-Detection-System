import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { CheckCircle2, Clock } from "lucide-react"
import { usePreferences } from "@/lib/preferences"

export function MPDSRTracker() {const{t}=usePreferences();
  const [notificationId, setNotificationId] = useState("")
  const [responseStatus, setResponseStatus] = useState("pending")
  const [investigationNotes, setInvestigationNotes] = useState("")
  const [systemicCauses, setSystemicCauses] = useState("")
  const [correctiveActions, setCorrectiveActions] = useState("")
  const [responsibleDepartment, setResponsibleDepartment] = useState("")
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    setSaved(false)
    try {
      const response = await fetch("/api/mpdsr/workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notificationId,
          responseStatus,
          investigationNotes,
          systemicCauses: systemicCauses.split(",").map((c) => c.trim()).filter(Boolean),
          correctiveActions: correctiveActions.split(",").map((c) => c.trim()).filter(Boolean),
          responsibleDepartment,
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
        <CardTitle>{t("Closed-Loop MPDSR Action Tracker")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label>{t("Notification ID")}</Label>
          <Input value={notificationId} onChange={(e) => setNotificationId(e.target.value)} placeholder={t("Enter notification ID")} />
        </div>
        <div>
          <Label>{t("Response Status")}</Label>
          <select
            value={responseStatus}
            onChange={(e) => setResponseStatus(e.target.value)}
            className="w-full mt-1 rounded-md border p-2"
          >
            <option value="pending">{t("Pending")}</option>
            <option value="in_progress">{t("In Progress")}</option>
            <option value="investigation">{t("Under Investigation")}</option>
            <option value="closed">{t("Closed")}</option>
          </select>
        </div>
        <div>
          <Label>{t("Investigation Notes")}</Label>
          <textarea
            value={investigationNotes}
            onChange={(e) => setInvestigationNotes(e.target.value)}
            placeholder={t("Detailed investigation notes...")}
            className="w-full mt-1 rounded-md border p-2 min-h-[80px]"
          />
        </div>
        <div>
          <Label>{t("Systemic Causes (comma-separated)")}</Label>
          <Input value={systemicCauses} onChange={(e) => setSystemicCauses(e.target.value)} placeholder={t("e.g., Lack of blood, Transport delays")} />
        </div>
        <div>
          <Label>{t("Corrective Actions (comma-separated)")}</Label>
          <Input value={correctiveActions} onChange={(e) => setCorrectiveActions(e.target.value)} placeholder={t("e.g., Improve blood bank, Hire ambulance")} />
        </div>
        <div>
          <Label>{t("Responsible Department")}</Label>
          <Input value={responsibleDepartment} onChange={(e) => setResponsibleDepartment(e.target.value)} placeholder={t("Department name")} />
        </div>
        <Button onClick={handleSave} disabled={saving || !notificationId}>
          <Clock className="size-4 mr-2" />
          {saving ? "Saving..." : "Update MPDSR Workflow"}
        </Button>

        {saved && (
          <Alert>
            <CheckCircle2 className="size-4" />
            <AlertDescription>
              MPDSR workflow updated. 7-day audit committee timeline tracking active.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}
