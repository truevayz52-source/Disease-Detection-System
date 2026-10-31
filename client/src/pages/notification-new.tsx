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
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { IntelligenceSummary, type CaseInsightsResponse } from "@/components/intelligence-summary"
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
  facilityId: string
  linkedSignalId: string
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
  facilityId: "",
  linkedSignalId: "",
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
                {!!c.is_notifiable && <span className="text-[10px] text-destructive">{t("notifiable")}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// Searchable facility combobox — the list is too long to scroll through.
function FacilityPicker({
  facilities,
  value,
  onPick,
  invalid,
}: {
  facilities: Facility[]
  value: string
  onPick: (id: string) => void
  invalid?: boolean
}) {
  const { t } = usePreferences()
  const [q, setQ] = useState("")
  const [open, setOpen] = useState(false)
  const selected = facilities.find((f) => f.facility_id === value)

  const matches = useMemo(() => {
    const s = q.trim().toLowerCase()
    const list = s
      ? facilities.filter((f) =>
          `${f.facility_name} ${f.district} ${f.province}`.toLowerCase().includes(s),
        )
      : facilities
    return list.slice(0, 100)
  }, [q, facilities])

  return (
    <div className="relative">
      <Input
        id="facility"
        placeholder={t("Search facility by name, district or province…")}
        value={open ? q : selected ? `${selected.facility_name} — ${selected.district}` : ""}
        aria-invalid={invalid || undefined}
        onFocus={() => {
          setOpen(true)
          setQ("")
        }}
        onChange={(e) => setQ(e.target.value)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-popover p-1 shadow-md">
          {matches.length === 0 && (
            <li className="px-2 py-1.5 text-sm text-muted-foreground">{t("No facilities match your search")}</li>
          )}
          {matches.map((f) => (
            <li key={f.facility_id}>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                onMouseDown={() => {
                  onPick(f.facility_id)
                  setOpen(false)
                }}
              >
                <span className="flex-1">
                  {f.facility_name} — {f.district}
                </span>
                <span className="text-xs text-muted-foreground">{f.province}</span>
              </button>
            </li>
          ))}
          {matches.length === 100 && (
            <li className="px-2 py-1 text-xs text-muted-foreground">{t("Keep typing to narrow the list…")}</li>
          )}
        </ul>
      )}
    </div>
  )
}

function FieldError({ msg }: { msg?: string }) {
  return msg ? <p className="text-xs text-destructive">{msg}</p> : null
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
  const [insightView, setInsightView] = useState<{ id: string; data: CaseInsightsResponse | null } | null>(null)
  const [attemptedSteps, setAttemptedSteps] = useState<Set<number>>(new Set())
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

  // Mirrors the server-side notification schema (notification-service.ts):
  // fullName 2–255 letters, nationalId ≤60, age int 0–150, address ≤512,
  // summary ≤8000, date of death not in the future.
  const errors = useMemo(() => {
    const e: Partial<Record<keyof FormState, string>> = {}
    const name = form.fullName.trim()
    if (name.length > 0 && name.length < 2) e.fullName = "Full name must be at least 2 characters"
    else if (name.length > 255) e.fullName = "Full name cannot exceed 255 characters"
    else if (name.length > 0 && !/^[\p{L}\s.'-]+$/u.test(name)) e.fullName = "Full name may only contain letters, spaces, hyphens and apostrophes"
    const nid = form.nationalId.trim()
    if (nid.length > 60) e.nationalId = "National ID cannot exceed 60 characters"
    else if (nid && !/^\d{2}-\d{5,8}[A-Za-z]\d{2}$/.test(nid))
      e.nationalId = "National ID must follow the format 63-204918A12"
    if (form.age !== "") {
      if (!/^\d+$/.test(form.age.trim())) e.age = "Age must be a whole number"
      else if (Number(form.age) > 150) e.age = "Age must be between 0 and 150"
    }
    const addr = form.residentialAddress.trim()
    if (addr.length > 512) e.residentialAddress = "Address cannot exceed 512 characters"
    else if (addr && !/^[\p{L}\p{N}\s,.'#/()-]+$/u.test(addr))
      e.residentialAddress = "Address contains invalid characters"
    else if (addr && !/\p{L}{2}/u.test(addr))
      e.residentialAddress = "Address must include a street or place name"
    else if (addr && addr.replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/).filter(Boolean).length < 2)
      e.residentialAddress = "Enter a fuller address (e.g. street and suburb or city)"
    if (form.clinicalSummary.length > 8000) e.clinicalSummary = "Summary cannot exceed 8000 characters"
    if (form.dateOfDeath && Date.parse(form.dateOfDeath) > Date.now()) e.dateOfDeath = "Date of death cannot be in the future"
    return e
  }, [form])

  const showErr = (key: keyof FormState) => attemptedSteps.has(step) || !!form[key]

  const step1Valid =
    form.fullName.trim().length >= 2 &&
    !errors.fullName &&
    !errors.nationalId &&
    !errors.age &&
    !errors.residentialAddress &&
    !!form.gender
  const step2Valid =
    !!form.facilityId &&
    !!form.dateOfDeath &&
    !errors.dateOfDeath &&
    !!form.icdCode &&
    !errors.clinicalSummary

  async function submit() {
    setSubmitting(true)
    // Coordinates come from the selected facility's stored GPS fix — officers
    // never type lat/lng (Ch 4.2: location = reporting facility).
    const facility = facilities?.items.find((f) => f.facility_id === form.facilityId)
    const payload = {
      submissionId: crypto.randomUUID(),
      patient: {
        nationalId: form.nationalId || null,
        fullName: form.fullName.trim(),
        age: form.age ? Number(form.age) : null,
        gender: form.gender,
        residentialAddress: form.residentialAddress || null,
        latitude: facility?.latitude ?? null,
        longitude: facility?.longitude ?? null,
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
      // Best-effort back-link: this notification was created from a signal.
      if (form.linkedSignalId) {
        try {
          await api(`/signals/${form.linkedSignalId}/workflow`, {
            method: "PATCH",
            body: JSON.stringify({ linkedNotificationId: res.notificationId }),
          })
        } catch {
          /* link failure must not lose the notification */
        }
      }
      if (res.mpdsrAlertId) toast.warning(t("MPDSR alert generated for this maternal/perinatal death."))
      else if (res.alertsCreated.length) toast.warning(`${res.alertsCreated.length} outbreak alert(s) triggered.`)
      else toast.success(t("Death notification recorded."))
      // Self-explaining: pull the per-case interpretation so the officer
      // sees the System Intelligence Summary before landing on the record.
      let ins: CaseInsightsResponse | null = null
      try { ins = await api<CaseInsightsResponse>(`/notifications/${res.notificationId}/insights`) } catch { /* summary is optional */ }
      if (ins) setInsightView({ id: res.notificationId, data: ins })
      else navigate(`/notifications/${res.notificationId}`)
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
              <CardDescription>{t("Deceased person's identity details")}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="fullName">{t("Full name *")}</Label>
                <Input
                  id="fullName"
                  maxLength={255}
                  aria-invalid={!!errors.fullName || (attemptedSteps.has(step) && !form.fullName.trim())}
                  value={form.fullName}
                  onChange={(e) => set("fullName", e.target.value)}
                />
                <FieldError
                  msg={
                    errors.fullName ??
                    (attemptedSteps.has(step) && !form.fullName.trim() ? t("Full name is required") : undefined)
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="nationalId">{t("National ID")}</Label>
                <Input id="nationalId" maxLength={60} aria-invalid={!!errors.nationalId} value={form.nationalId} onChange={(e) => set("nationalId", e.target.value)} placeholder={t("63-204918A12")} />
                <FieldError msg={showErr("nationalId") ? errors.nationalId : undefined} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="age">{t("Age")}</Label>
                  <Input id="age" type="number" min={0} max={150} aria-invalid={!!errors.age} value={form.age} onChange={(e) => set("age", e.target.value)} />
                  <FieldError msg={showErr("age") ? errors.age : undefined} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="gender">{t("Gender *")}</Label>
                  <Select value={form.gender} onValueChange={(v) => set("gender", v ?? "")}>
                    <SelectTrigger id="gender" aria-invalid={attemptedSteps.has(step) && !form.gender}><SelectValue placeholder={t("Select")} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="male">{t("Male")}</SelectItem>
                      <SelectItem value="female">{t("Female")}</SelectItem>
                      <SelectItem value="other">{t("Other")}</SelectItem>
                    </SelectContent>
                  </Select>
                  <FieldError msg={attemptedSteps.has(step) && !form.gender ? t("Gender is required") : undefined} />
                </div>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="address">{t("Residential address")}</Label>
                <Input id="address" maxLength={512} aria-invalid={!!errors.residentialAddress} value={form.residentialAddress} onChange={(e) => set("residentialAddress", e.target.value)} />
                <FieldError msg={showErr("residentialAddress") ? errors.residentialAddress : undefined} />
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
                <FacilityPicker
                  facilities={facilities?.items ?? []}
                  value={form.facilityId}
                  invalid={attemptedSteps.has(step) && !form.facilityId}
                  onPick={(id) => set("facilityId", id)}
                />
                <FieldError
                  msg={attemptedSteps.has(step) && !form.facilityId ? t("Reporting facility is required") : undefined}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dod">{t("Date & time of death *")}</Label>
                <Input
                  id="dod"
                  type="datetime-local"
                  max="9999-12-31T23:59"
                  aria-invalid={!!errors.dateOfDeath || (attemptedSteps.has(step) && !form.dateOfDeath)}
                  value={form.dateOfDeath}
                  onChange={(e) => set("dateOfDeath", e.target.value)}
                />
                <FieldError
                  msg={
                    errors.dateOfDeath ??
                    (attemptedSteps.has(step) && !form.dateOfDeath ? t("Date of death is required") : undefined)
                  }
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
                <FieldError
                  msg={attemptedSteps.has(step) && !form.icdCode ? t("Preliminary cause of death is required") : undefined}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="summary">{t("Clinical summary")}</Label>
                <Textarea
                  id="summary"
                  rows={4}
                  maxLength={8000}
                  aria-invalid={!!errors.clinicalSummary}
                  value={form.clinicalSummary}
                  onChange={(e) => set("clinicalSummary", e.target.value)}
                  placeholder={t("Brief clinical history and circumstances of death…")}
                />
                <FieldError msg={errors.clinicalSummary} />
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
                <dt className="text-muted-foreground">{t("Patient")}</dt>
                <dd>{form.fullName}</dd>
                <dt className="text-muted-foreground">{t("National ID")}</dt>
                <dd>{form.nationalId || "—"}</dd>
                <dt className="text-muted-foreground">{t("Age / Gender")}</dt>
                <dd>{form.age || "—"} / {form.gender}</dd>
                <dt className="text-muted-foreground">{t("Address")}</dt>
                <dd>{form.residentialAddress || "—"}</dd>
                <dt className="text-muted-foreground">{t("Facility")}</dt>
                <dd>{facilities?.items.find((f) => f.facility_id === form.facilityId)?.facility_name ?? form.facilityId}</dd>
                <dt className="text-muted-foreground">{t("Date of death")}</dt>
                <dd>{form.dateOfDeath?.replace("T", " ")}</dd>
                <dt className="text-muted-foreground">{t("Preliminary ICD")}</dt>
                <dd>{form.icdCode} — {icdDesc}</dd>
                <dt className="text-muted-foreground">{t("MPDSR")}</dt>
                <dd>{form.isMaternalPerinatal ? "Yes — alert will be raised" : "No"}</dd>
                {form.clinicalSummary && (
                  <>
                    <dt className="text-muted-foreground">{t("Summary")}</dt>
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
            <Button
              onClick={() => {
                const valid = step === 0 ? step1Valid : step2Valid
                if (!valid) {
                  setAttemptedSteps((s) => new Set(s).add(step))
                  toast.error(t("Please correct the highlighted fields before continuing."))
                  return
                }
                setStep((s) => s + 1)
              }}
            >
              Next <ChevronRight className="size-4" />
            </Button>
          ) : (
            <Button onClick={submit} disabled={submitting}>
              {submitting && <Loader2 className="size-4 animate-spin" />} Submit notification
            </Button>
          )}
        </div>
      </div>
      {/* Post-submit "system explains itself" dialog — closing it navigates
          to the case record, where the same summary lives permanently. */}
      <Dialog open={!!insightView} onOpenChange={(o) => { if (!o && insightView) navigate(`/notifications/${insightView.id}`) }}>
        <DialogContent className="max-w-lg">
          <IntelligenceSummary data={insightView?.data ?? undefined} loading={!insightView?.data} />
          <DialogFooter>
            <Button onClick={() => insightView && navigate(`/notifications/${insightView.id}`)}>{t("View case")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
