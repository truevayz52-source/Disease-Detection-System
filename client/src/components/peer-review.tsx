import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { UserCheck, CheckCircle2 } from "lucide-react"
import { usePreferences } from "@/lib/preferences"

export function PeerReview() {const{t}=usePreferences();
  const [imageId, setImageId] = useState("")
  const [reviewerId, setReviewerId] = useState("")
  const [requesting, setRequesting] = useState(false)
  const [requested, setRequested] = useState(false)
  const [reviewId, setReviewId] = useState("")
  const [reviewNotes, setReviewNotes] = useState("")
  const [recommendation, setRecommendation] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const handleRequestReview = async () => {
    setRequesting(true)
    setRequested(false)
    try {
      const response = await fetch("/api/peer-review/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageId, reviewerId }),
      })
      const data = await response.json()
      setReviewId(data.reviewId)
      setRequested(true)
    } catch (error) {
      console.error("Request error:", error)
    } finally {
      setRequesting(false)
    }
  }

  const handleSubmitReview = async () => {
    setSubmitting(true)
    setSubmitted(false)
    try {
      const response = await fetch(`/api/peer-review/${reviewId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewNotes, recommendation }),
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
        <CardTitle>{t("Diagnostic Concurrence & Peer Review")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label>{t("Image ID")}</Label>
          <Input value={imageId} onChange={(e) => setImageId(e.target.value)} placeholder={t("Enter image ID")} />
        </div>
        <div>
          <Label>{t("Reviewer ID")}</Label>
          <Input value={reviewerId} onChange={(e) => setReviewerId(e.target.value)} placeholder={t("Enter reviewer user ID")} />
        </div>
        <Button onClick={handleRequestReview} disabled={requesting || !imageId || !reviewerId}>
          <UserCheck className="size-4 mr-2" />
          {requesting ? "Requesting..." : "Request Peer Review"}
        </Button>

        {requested && (
          <>
            <Alert>
              <CheckCircle2 className="size-4" />
              <AlertDescription>
                Peer review requested. Review ID: {reviewId}
              </AlertDescription>
            </Alert>
            <div className="border-t pt-4">
              <Label>{t("Review Notes")}</Label>
              <textarea
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.target.value)}
                placeholder={t("Review notes...")}
                className="w-full mt-1 rounded-md border p-2 min-h-[60px]"
              />
              <Label className="mt-2">Recommendation</Label>
              <Input value={recommendation} onChange={(e) => setRecommendation(e.target.value)} placeholder={t("e.g., Confirm diagnosis, Request additional tests")} />
              <Button onClick={handleSubmitReview} disabled={submitting || !reviewNotes} className="mt-2">
                {submitting ? "Submitting..." : "Submit Review"}
              </Button>
            </div>
          </>
        )}

        {submitted && (
          <Alert>
            <CheckCircle2 className="size-4" />
            <AlertDescription>
              Peer review submitted successfully.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}
