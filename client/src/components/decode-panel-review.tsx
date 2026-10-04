import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Users, CheckCircle2 } from "lucide-react"
import { usePreferences } from "@/lib/preferences"

export function DecodePanelReview() {const{t}=usePreferences();
  const [notificationId, setNotificationId] = useState("")
  const [panelMembers, setPanelMembers] = useState("")
  const [consensusCause, setConsensusCause] = useState("")
  const [creating, setCreating] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [panelId, setPanelId] = useState("")
  const [created, setCreated] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const handleCreatePanel = async () => {
    setCreating(true)
    setCreated(false)
    try {
      const response = await fetch("/api/decode-panel/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notificationId,
          panelMembers: panelMembers.split(",").map((m) => m.trim()).filter(Boolean),
        }),
      })
      const data = await response.json()
      setPanelId(data.panelId)
      setCreated(true)
    } catch (error) {
      console.error("Create error:", error)
    } finally {
      setCreating(false)
    }
  }

  const handleSubmitConsensus = async () => {
    setSubmitting(true)
    setSubmitted(false)
    try {
      const response = await fetch(`/api/decode-panel/${panelId}/consensus`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consensusCause }),
      })
      if (response.ok) {
        setSubmitted(true)
      }
    } catch (error) {
      console.error("Submit error:", error)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle>{t("Multi-Expert DeCoDe Panel Review")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label>{t("Notification ID")}</Label>
          <Input value={notificationId} onChange={(e) => setNotificationId(e.target.value)} placeholder={t("Enter notification ID")} />
        </div>
        <div>
          <Label>{t("Panel Members (User IDs, comma-separated)")}</Label>
          <Input value={panelMembers} onChange={(e) => setPanelMembers(e.target.value)} placeholder={t("user-id-1, user-id-2, user-id-3")} />
        </div>
        <Button onClick={handleCreatePanel} disabled={creating || !notificationId || !panelMembers}>
          <Users className="size-4 mr-2" />
          {creating ? "Creating..." : "Create Panel"}
        </Button>

        {created && (
          <>
            <Alert>
              <CheckCircle2 className="size-4" />
              <AlertDescription>
                Panel created successfully. Panel ID: {panelId}
              </AlertDescription>
            </Alert>
            <div className="border-t pt-4">
              <Label>{t("Consensus Diagnosis")}</Label>
              <Input value={consensusCause} onChange={(e) => setConsensusCause(e.target.value)} placeholder={t("Final consensus cause of death")} />
              <Button onClick={handleSubmitConsensus} disabled={submitting || !consensusCause} className="mt-2">
                {submitting ? "Submitting..." : "Submit Consensus"}
              </Button>
            </div>
          </>
        )}

        {submitted && (
          <Alert>
            <CheckCircle2 className="size-4" />
            <AlertDescription>
              Consensus diagnosis submitted. Panel review completed.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}
