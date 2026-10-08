import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { MapPin, MessageSquare, CheckCircle2 } from "lucide-react"
import { usePreferences } from "@/lib/preferences"

export function ImageAnnotations() {const{t}=usePreferences();
  const [imageId, setImageId] = useState("")
  const [annotationType, setAnnotationType] = useState("marker")
  const [textNote, setTextNote] = useState("")
  const [adding, setAdding] = useState(false)
  const [added, setAdded] = useState(false)
  const [annotations, setAnnotations] = useState<any[]>([])

  const handleAddAnnotation = async () => {
    setAdding(true)
    setAdded(false)
    try {
      const response = await fetch("/api/image-annotations/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageId,
          annotationType,
          coordinates: { x: 100, y: 100, width: 50, height: 50 }, // Simulated coordinates
          textNote,
        }),
      })
      if (response.ok) {
        setAdded(true)
        loadAnnotations()
      }
    } catch (error) {
      console.error("Add error:", error)
    } finally {
      setAdding(false)
    }
  }

  const loadAnnotations = async () => {
    try {
      const response = await fetch(`/api/image-annotations/${imageId}`)
      const data = await response.json()
      setAnnotations(data.items || [])
    } catch (error) {
      console.error("Load error:", error)
    }
  }

  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle>{t("Interactive Canvas & Diagnostic Annotations")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label>{t("Image ID")}</Label>
          <Input value={imageId} onChange={(e) => setImageId(e.target.value)} placeholder={t("Enter image ID")} />
        </div>
        <div>
          <Label>{t("Annotation Type")}</Label>
          <select
            value={annotationType}
            onChange={(e) => setAnnotationType(e.target.value)}
            className="w-full mt-1 rounded-md border p-2"
          >
            <option value="marker">{t("Marker")}</option>
            <option value="measurement">{t("Measurement")}</option>
            <option value="text">{t("Text Note")}</option>
            <option value="voice">{t("Voice Note")}</option>
          </select>
        </div>
        <div>
          <Label>{t("Text Note")}</Label>
          <textarea
            value={textNote}
            onChange={(e) => setTextNote(e.target.value)}
            placeholder={t("Diagnostic notes...")}
            className="w-full mt-1 rounded-md border p-2 min-h-[60px]"
          />
        </div>
        <div className="flex gap-2">
          <Button onClick={handleAddAnnotation} disabled={adding || !imageId}>
            <MapPin className="size-4 mr-2" />
            {adding ? "Adding..." : "Add Annotation"}
          </Button>
          <Button onClick={loadAnnotations} variant="outline" disabled={!imageId}>
            <MessageSquare className="size-4 mr-2" />
            Load Annotations
          </Button>
        </div>

        {added && (
          <Alert>
            <CheckCircle2 className="size-4" />
            <AlertDescription>
              Annotation added to image.
            </AlertDescription>
          </Alert>
        )}

        {annotations.length > 0 && (
          <div className="space-y-2 max-h-48 overflow-y-auto">
            <p className="font-medium">Existing Annotations ({annotations.length})</p>
            {annotations.map((ann) => (
              <div key={ann.annotation_id} className="p-2 border rounded text-sm">
                <p className="font-medium">{ann.annotation_type}</p>
                <p className="text-muted-foreground">{ann.text_note || "No text note"}</p>
                <p className="text-xs text-muted-foreground">By: {ann.annotator_name}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
