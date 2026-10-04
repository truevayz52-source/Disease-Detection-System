import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Package, CheckCircle2, ArrowRight } from "lucide-react"
import { usePreferences } from "@/lib/preferences"

export function SpecimenTracking() {const{t}=usePreferences();
  const [notificationId, setNotificationId] = useState("")
  const [specimenType, setSpecimenType] = useState("")
  const [collectionLocation, setCollectionLocation] = useState("")
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState(false)
  const [specimenQr, setSpecimenQr] = useState("")
  const [trackingId, setTrackingId] = useState("")
  const [qrLookup, setQrLookup] = useState("")
  const [trackingInfo, setTrackingInfo] = useState<any>(null)

  const handleCreateTracking = async () => {
    setCreating(true)
    setCreated(false)
    try {
      const response = await fetch("/api/specimen-tracking/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationId, specimenType, collectionLocation }),
      })
      const data = await response.json()
      setSpecimenQr(data.specimenQr)
      setTrackingId(data.trackingId)
      setCreated(true)
    } catch (error) {
      console.error("Create error:", error)
    } finally {
      setCreating(false)
    }
  }

  const handleLookup = async () => {
    try {
      const response = await fetch(`/api/specimen-tracking/qr/${qrLookup}`)
      const data = await response.json()
      setTrackingInfo(data.item)
    } catch (error) {
      console.error("Lookup error:", error)
    }
  }

  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle>{t("LIS Chain-of-Custody Tracking")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label>{t("Notification ID")}</Label>
          <Input value={notificationId} onChange={(e) => setNotificationId(e.target.value)} placeholder={t("Enter notification ID")} />
        </div>
        <div>
          <Label>{t("Specimen Type")}</Label>
          <Input value={specimenType} onChange={(e) => setSpecimenType(e.target.value)} placeholder={t("e.g., Tissue sample, Blood sample")} />
        </div>
        <div>
          <Label>{t("Collection Location")}</Label>
          <Input value={collectionLocation} onChange={(e) => setCollectionLocation(e.target.value)} placeholder={t("e.g., Harare Central Hospital")} />
        </div>
        <Button onClick={handleCreateTracking} disabled={creating || !notificationId || !specimenType}>
          <Package className="size-4 mr-2" />
          {creating ? "Creating..." : "Create Tracking Record"}
        </Button>

        {created && (
          <>
            <Alert>
              <CheckCircle2 className="size-4" />
              <AlertDescription>
                <div className="space-y-1">
                  <p>{t("Tracking record created successfully")}</p>
                  <p className="font-mono text-sm">QR Code: {specimenQr}</p>
                </div>
              </AlertDescription>
            </Alert>
            <div className="border-t pt-4">
              <Label>{t("Lookup by QR Code")}</Label>
              <div className="flex gap-2 mt-1">
                <Input value={qrLookup} onChange={(e) => setQrLookup(e.target.value)} placeholder={t("Enter QR code")} />
                <Button onClick={handleLookup} variant="outline" disabled={!qrLookup}>
                  <ArrowRight className="size-4 mr-2" />
                  Lookup
                </Button>
              </div>
            </div>
          </>
        )}

        {trackingInfo && (
          <Alert>
            <AlertDescription>
              <div className="space-y-1">
                <p className="font-medium">{t("Specimen Information")}</p>
                <p>Type: {trackingInfo.specimen_type}</p>
                <p>Status: {trackingInfo.status}</p>
                <p>Current Location: {trackingInfo.current_location}</p>
                <p>Collected by: {trackingInfo.collector_name}</p>
              </div>
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}
