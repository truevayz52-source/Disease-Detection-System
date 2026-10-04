import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import useSWR from "swr"
import { toast } from "sonner"
import { Check, ChevronLeft, ChevronRight, Loader2 } from "lucide-react"
import { SiteHeader } from "@/components/site-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { clearDraft, enqueue, loadDraft, saveDraft } from "@/lib/offline-queue"
import type { Facility, IcdCode } from "@/lib/types"
import { usePreferences } from "@/lib/preferences"

interface FormState {
  nationalId: string
  fullName: string
  age: string
  gender: string
  residentialAddress: string
  latitude: string
  longitude: string
  facilityId: string
  dateOfDeath: string
  icdCode: string
  clinicalSummary: string
  isMaternalPerinatal: boolean
}

const EMPTY: FormState = {
  nationalId: "",
  fullName: "",
  age: "",
  gender: "",
  residentialAddress: "",
  latitude: "",
  longitude: "",
  facilityId: "",
  dateOfDeath: "",
  icdCode: "",
  clinicalSummary: "",
  isMaternalPerinatal: false,
}

const STEPS = ["Patient demographics", "Death details", "Review & submit"]

function IcdPicker({ value, onPick }: { value: string; onPick: (code: string, desc: string) => void }) {const{t}=usePreferences();
  const [q, setQ] = useState("")
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<IcdCode[]>([])
  const timer = useRef<ReturnType<typeof setTimeout>>(null)

  // Debounced ICD autocomplete (Ch 5.2: cause-of-death fields autocomplete).
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      try {
        const r = await api<{ items: IcdCode[] }>(`/icd-codes?q=${encodeURIComponent(q)}`)
        setItems(r.items)
      } catch {
        /* keep last list */
      }
    }, 200)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [q])

  return (
    <div className="relative">
      <Input
        placeholder={t("Type ICD code or disease name…")}
        value={open ? q : value}
        onFocus={() => {
          setOpen(true)
          setQ("")
        }}
        onChange={(e) => setQ(e.target.value)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && items.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-popover p-1 shadow-md">
          {items.map((c) => (
            <li key={c.icd_code}>
              <button
                type="button"
                className="flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                onMouseDown={() => {
                  onPick(c.icd_code, c.description)
                  setOpen(false)
                }}
              >
                <span className="font-mono text-xs font-semibold">{c.icd_code}</span>
                <span className="flex-1">{c.description}</span>
                {!!c.is_notifiable && <span className="text-[10px] text-destructive">notifiable</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function NotificationNewPage() {const{t}=usePreferences();
  const navigate = useNavigate()
  const { user } = useAuth()
  const [step, setStep] = useState(0)
  const [form, setForm] = useState<FormState>(() => {
    const draft = loadDraft()
    return draft ? { ...EMPTY, ...(draft.data as Partial<FormState>) } : EMPTY
  })
  const [icdDesc, setIcdDesc] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const { data: facilities } = useSWR<{ items: Facility[] }>("/facilities", (u: string) => api(u))

  const draftRestored = useMemo(() => loadDraft() !== null, [])

  // Autosave draft on every change (Ch 5.3 offline caching).
  useEffect(() => {
    saveDraft(form)
  }, [form])

  useEffect(() => {
    if (user?.role === "medical_officer" && user.facilityId && !form.facilityId) {
      setForm((f) => ({ ...f, facilityId: user.facilityId! }))
    }
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  const step1Valid = form.fullName.trim().length >= 2 && !!form.gender
  const step2Valid = !!form.facilityId && !!form.dateOfDeath && !!form.icdCode

  async function submit() {
    setSubmitting(true)
    const payload = {
      submissionId: crypto.randomUUID(),
      patient: {
        nationalId: form.nationalId || null,
        fullName: form.fullName.trim(),
        age: form.age ? Number(form.age) : null,
        gender: form.gender,
        residentialAddress: form.residentialAddress || null,
        latitude: form.latitude ? Number(form.latitude) : null,
        longitude: form.longitude ? Number(form.longitude) : null,
      },
      facilityId: form.facilityId,
      dateOfDeath: form.dateOfDeath,
      preliminaryIcdCode: form.icdCode,
      clinicalSummary: user?.role === "mortuary_clerk" ? null : form.clinicalSummary || null,
      isMaternalPerinatal: form.isMaternalPerinatal,
    }
    try {
      const res = await api<{ notificationId: string; mpdsrAlertId: string | null; alertsCreated: unknown[] }>(
        "/notifications",
        { method: "POST", body: JSON.stringify(payload) },
      )
      clearDraft()
      if (res.mpdsrAlertId) toast.warning(t("MPDSR alert generated for this maternal/perinatal death."))
      else if (res.alertsCreated.length) toast.warning(`${res.alertsCreated.length} outbreak alert(s) triggered.`)
      else toast.success(t("Death notification recorded."))
      navigate(`/notifications/${res.notificationId}`)
    } catch (err) {
      // TC-05: on network failure queue the record locally and tell the officer.
      if (!navigator.onLine || (err instanceof TypeError)) {
        await enqueue(payload)
        clearDraft()
        toast.warning(t("Network unavailable — record cached locally and will sync on reconnect."))
        navigate("/notifications")
      } else {
        toast.error(err instanceof Error ? err.message : "Submission failed")
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <SiteHeader title={t("New Death Notification")} />
      <div className="mx-auto max-w-2xl space-y-6 p-4 lg:p-6">
        {draftRestored && step === 0 && (
          <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            A saved draft was restored from this device.
          </p>
        )}
        <ol className="flex items-center gap-2 text-xs">
          {STEPS.map((s, i) => (
            <li key={s} className={`flex items-center gap-1.5 ${i === step ? "font-medium" : "text-muted-foreground"}`}>
              <span
                className={`flex size-5 items-center justify-center rounded-full border text-[10px] ${
                  i < step ? "border-primary bg-primary text-primary-foreground" : ""
                }`}
              >
                {i < step ? <Check className="size-3" /> : i + 1}
              </span>
              {s}
              {i < STEPS.length - 1 && <span className="mx-1 h-px w-6 bg-border" />}
            </li>
          ))}
        </ol>

        {step === 0 && (
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="text-base">{t("Patient demographics")}</CardTitle>
              <CardDescription>{t("Deceased person's identity details (Ch 4.2)")}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="fullName">{t("Full name *")}</Label>
                <Input id="fullName" value={form.fullName} onChange={(e) => set("fullName", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="nationalId">{t("National ID")}</Label>
                <Input id="nationalId" value={form.nationalId} onChange={(e) => set("nationalId", e.target.value)} placeholder={t("63-204918A12")} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="age">Age</Label>
                  <Input id="age" type="number" min={0} max={150} value={form.age} onChange={(e) => set("age", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="gender">{t("Gender *")}</Label>
                  <Select value={form.gender} onValueChange={(v) => set("gender", v ?? "")}>
                    <SelectTrigger id="gender"><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="male">Male</SelectItem>
                      <SelectItem value="female">Female</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="address">{t("Residential address")}</Label>
                <Input id="address" value={form.residentialAddress} onChange={(e) => set("residentialAddress", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lat">{t("Latitude (optional)")}</Label>
                <Input id="lat" type="number" step="any" value={form.latitude} onChange={(e) => set("latitude", e.target.value)} placeholder="-17.82" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lng">{t("Longitude (optional)")}</Label>
                <Input id="lng" type="number" step="any" value={form.longitude} onChange={(e) => set("longitude", e.target.value)} placeholder="31.05" />
              </div>
            </CardContent>
          </Card>
        )}

        {step === 1 && (
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="text-base">{t("Death details")}</CardTitle>
              <CardDescription>{t("Facility, date/time and preliminary ICD cause")}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="space-y-2">
                <Label htmlFor="facility">{t("Reporting facility *")}</Label>
                <Select value={form.facilityId} onValueChange={(v) => set("facilityId", v ?? "")}>
                  <SelectTrigger id="facility"><SelectValue placeholder={t("Select facility")} /></SelectTrigger>
                  <SelectContent>
                    {(facilities?.items ?? []).map((f) => (
                      <SelectItem key={f.facility_id} value={f.facility_id}>
                        {f.facility_name} — {f.district}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="dod">{t("Date & time of death *")}</Label>
                <Input
                  id="dod"
                  type="datetime-local"
                  value={form.dateOfDeath}
                  onChange={(e) => set("dateOfDeath", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("Preliminary cause of death (ICD-10) *")}</Label>
                <IcdPicker
                  value={form.icdCode ? `${form.icdCode} — ${icdDesc}` : ""}
                  onPick={(code, desc) => {
                    set("icdCode", code)
                    setIcdDesc(desc)
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="summary">{t("Clinical summary")}</Label>
                <Textarea
                  id="summary"
                  rows={4}
                  value={form.clinicalSummary}
                  onChange={(e) => set("clinicalSummary", e.target.value)}
                  placeholder={t("Brief clinical history and circumstances of death…")}
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={form.isMaternalPerinatal}
                  onCheckedChange={(v) => set("isMaternalPerinatal", v === true)}
                />
                Maternal or perinatal death (triggers MPDSR alert)
              </label>
            </CardContent>
          </Card>
        )}

        {step === 2 && (
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="text-base">{t("Review & submit")}</CardTitle>
              <CardDescription>{t("Verify details before committing the record")}</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <dt className="text-muted-foreground">Patient</dt>
                <dd>{form.fullName}</dd>
                <dt className="text-muted-foreground">{t("National ID")}</dt>
                <dd>{form.nationalId || "—"}</dd>
                <dt className="text-muted-foreground">{t("Age / Gender")}</dt>
                <dd>{form.age || "—"} / {form.gender}</dd>
                <dt className="text-muted-foreground">Address</dt>
                <dd>{form.residentialAddress || "—"}</dd>
                <dt className="text-muted-foreground">Facility</dt>
                <dd>{facilities?.items.find((f) => f.facility_id === form.facilityId)?.facility_name ?? form.facilityId}</dd>
                <dt className="text-muted-foreground">{t("Date of death")}</dt>
                <dd>{form.dateOfDeath?.replace("T", " ")}</dd>
                <dt className="text-muted-foreground">{t("Preliminary ICD")}</dt>
                <dd>{form.icdCode} — {icdDesc}</dd>
                <dt className="text-muted-foreground">MPDSR</dt>
                <dd>{form.isMaternalPerinatal ? "Yes — alert will be raised" : "No"}</dd>
                {form.clinicalSummary && (
                  <>
                    <dt className="text-muted-foreground">Summary</dt>
                    <dd className="sm:col-span-1 whitespace-pre-wrap">{form.clinicalSummary}</dd>
                  </>
                )}
              </dl>
            </CardContent>
          </Card>
        )}

        <div className="flex justify-between">
          <Button variant="outline" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
            <ChevronLeft className="size-4" /> Back
          </Button>
          {step < 2 ? (
            <Button onClick={() => setStep((s) => s + 1)} disabled={step === 0 ? !step1Valid : !step2Valid}>
              Next <ChevronRight className="size-4" />
            </Button>
          ) : (
            <Button onClick={submit} disabled={submitting}>
              {submitting && <Loader2 className="size-4 animate-spin" />} Submit notification
            </Button>
          )}
        </div>
      </div>
    </>
  )
}
