import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Send, Mail, MessageSquare, Phone } from "lucide-react"
import { usePreferences } from "@/lib/preferences"

export function EmergencyDispatch() {const{t}=usePreferences();
  const [recipients, setRecipients] = useState("")
  const [message, setMessage] = useState("")
  const [subject, setSubject] = useState("")
  const [channels, setChannels] = useState<string[]>(["email"])
  const [dispatching, setDispatching] = useState(false)
  const [result, setResult] = useState<any>(null)

  const toggleChannel = (channel: string) => {
    setChannels((prev) =>
      prev.includes(channel) ? prev.filter((c) => c !== channel) : [...prev, channel]
    )
  }

  const handleDispatch = async () => {
    setDispatching(true)
    try {
      const response = await fetch("/api/emergency/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipients: recipients.split(",").map((r) => r.trim()),
          channels,
          message,
          subject,
          priority: "high",
        }),
      })
      const data = await response.json()
      setResult(data)
    } catch (error) {
      console.error("Dispatch error:", error)
    } finally {
      setDispatching(false)
    }
  }

  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle>{t("Multi-Channel Emergency Dispatch")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label>{t("Recipients (User IDs, comma-separated)")}</Label>
          <Input value={recipients} onChange={(e) => setRecipients(e.target.value)} placeholder={t("user-id-1, user-id-2")} />
        </div>
        <div>
          <Label>Subject</Label>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={t("Emergency alert subject")} />
        </div>
        <div>
          <Label>Message</Label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t("Emergency message content")}
            className="w-full mt-1 rounded-md border p-2 min-h-[100px]"
          />
        </div>
        <div>
          <Label>Channels</Label>
          <div className="flex gap-2 mt-2">
            {[
              { id: "email", icon: Mail, label: "Email" },
              { id: "sms", icon: Phone, label: "SMS" },
              { id: "whatsapp", icon: MessageSquare, label: "WhatsApp" },
            ].map((channel) => (
              <Button
                key={channel.id}
                variant={channels.includes(channel.id) ? "default" : "outline"}
                size="sm"
                onClick={() => toggleChannel(channel.id)}
              >
                <channel.icon className="size-4 mr-2" />
                {channel.label}
              </Button>
            ))}
          </div>
        </div>
        <Button onClick={handleDispatch} disabled={dispatching || !recipients || !message}>
          <Send className="size-4 mr-2" />
          {dispatching ? "Dispatching..." : "Send Emergency Alert"}
        </Button>

        {result && (
          <Alert>
            <AlertDescription>
              <p>Successfully dispatched to {result.dispatched} recipients</p>
              <p className="text-sm text-muted-foreground mt-2">
                Channels: {result.results?.map((r: any) => r.channel).join(", ")}
              </p>
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}
