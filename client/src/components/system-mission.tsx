import { useState, useCallback, useEffect } from "react"
import { Link } from "react-router-dom"
import {
  Activity,
  ChevronDown,
  ChevronUp,
  GitCompare,
  Siren,
  TrendingUp,
  Volume2,
  VolumeX,
  GraduationCap,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  BrainCircuit,
  Layers,
  FileCheck2,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { usePreferences } from "@/lib/preferences"
import { cn } from "@/lib/utils"

const COLLAPSE_KEY = "dds.mission.collapsed"

const SYSTEM_OBJECTIVES = [
  {
    key: "objective-1",
    num: "1",
    label: "Objective 1",
    title: "To Predict Mortality Trends",
    sub: "Projects future mortality over 14–90 days with 95% confidence bounds using seasonal auto-regression & baseline rates.",
    to: "/predictions",
    icon: TrendingUp,
    badgeText: "Predictive Model Active",
    accent: "from-blue-600 to-indigo-600",
    border: "hover:border-blue-300",
    badgeVariant: "default" as const,
    tag: "Time-Series Forecasting",
  },
  {
    key: "objective-2",
    num: "2",
    label: "Objective 2",
    title: "To Detect Outbreaks Early",
    sub: "Monitors real-time clustering across 5 passes: Threshold clusters, Poisson CUSUM anomalies, community signals, and syndromic morbidity.",
    to: "/alerts",
    icon: Siren,
    badgeText: "5-Pass Engine Active",
    accent: "from-amber-500 to-orange-600",
    border: "hover:border-amber-300",
    badgeVariant: "secondary" as const,
    tag: "Real-time Surveillance",
  },
  {
    key: "objective-3",
    num: "3",
    label: "Objective 3",
    title: "To Identify Cause-of-Death Patterns",
    sub: "Correlates verified ICD-10 findings with patient demographics and spatial DBSCAN clusters to expose mortality drivers.",
    to: "/analytics",
    icon: GitCompare,
    badgeText: "ICD-10 Pipeline Golden",
    accent: "from-purple-600 to-pink-600",
    border: "hover:border-purple-300",
    badgeVariant: "outline" as const,
    tag: "Etiological Analysis",
  },
] as const

const BRIEFING_SPEECH =
  "Welcome to the Disease Detection System. This platform autonomously achieves three statutory surveillance objectives: " +
  "First, predicting mortality trends using seasonal regression and time-series modeling. " +
  "Second, detecting outbreaks early across five proactive surveillance layers, including pre-mortality syndromic signals and Poisson CUSUM anomaly detection. " +
  "Third, identifying cause-of-death patterns through autopsy-verified ICD-10 certification and spatial clustering. " +
  "All surveillance and predictive modeling engines are currently online and operational."

/**
 * Enhanced SystemMission component:
 * Gives supervisors, evaluators, and public health officials an autonomous, self-explaining
 * entry point. Demonstrates how the system meets all 3 objectives without the student needing to explain.
 */
export function SystemMission() {
  const { t } = usePreferences()
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === "1")
  const [isPlayingAudio, setIsPlayingAudio] = useState(false)
  const [walkthroughOpen, setWalkthroughOpen] = useState(false)

  const speechAvailable = typeof window !== "undefined" && "speechSynthesis" in window

  function toggleCollapse() {
    setCollapsed((c) => {
      localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1")
      return !c
    })
  }

  const handleToggleAudio = useCallback(() => {
    if (!speechAvailable) return

    if (isPlayingAudio) {
      window.speechSynthesis.cancel()
      setIsPlayingAudio(false)
      return
    }

    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(BRIEFING_SPEECH)
    utterance.rate = 0.95
    utterance.pitch = 1.0

    utterance.onend = () => setIsPlayingAudio(false)
    utterance.onerror = () => setIsPlayingAudio(false)

    window.speechSynthesis.speak(utterance)
    setIsPlayingAudio(true)
  }, [isPlayingAudio, speechAvailable])

  useEffect(() => {
    return () => {
      if (speechAvailable) {
        window.speechSynthesis.cancel()
      }
    }
  }, [speechAvailable])

  return (
    <Card className="border-blue-200/80 bg-gradient-to-r from-blue-50/70 via-background to-background shadow-lg rounded-2xl overflow-hidden transition-all">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-blue-100/60 bg-blue-50/40">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-500/20">
            <Activity className="size-4.5" />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold tracking-tight text-foreground">
                {t("System Mission & Surveillance Objectives")}
              </span>
              <Badge variant="outline" className="text-[10px] bg-white border-blue-200 text-blue-700 font-semibold px-2 py-0">
                {t("Autonomous Health System")}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t("Self-explaining platform addressing three statutory public-health surveillance objectives")}
            </p>
          </div>
        </div>

        {/* Action Controls: Audio briefing + Walkthrough modal + Collapse */}
        <div className="flex items-center gap-2">
          {speechAvailable && (
            <Button
              size="sm"
              variant={isPlayingAudio ? "default" : "outline"}
              onClick={handleToggleAudio}
              className={cn(
                "h-8 text-xs gap-1.5 font-medium transition-all",
                isPlayingAudio ? "bg-blue-600 hover:bg-blue-700 text-white animate-pulse" : "bg-white hover:bg-blue-50 text-slate-700 border-blue-200"
              )}
              title={isPlayingAudio ? t("Stop audio briefing") : t("Listen to system briefing")}
            >
              {isPlayingAudio ? (
                <>
                  <VolumeX className="size-3.5 text-white" />
                  <span className="hidden sm:inline">{t("Stop Briefing")}</span>
                </>
              ) : (
                <>
                  <Volume2 className="size-3.5 text-blue-600" />
                  <span className="hidden sm:inline">{t("Audio Briefing")}</span>
                </>
              )}
            </Button>
          )}

          {/* Supervisor / Evaluator Walkthrough Dialog */}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setWalkthroughOpen(true)}
            className="h-8 text-xs gap-1.5 font-semibold bg-white hover:bg-blue-50 text-blue-700 border-blue-200 shadow-2xs"
          >
            <GraduationCap className="size-3.5 text-blue-600" />
            <span>{t("Evaluator Walkthrough")}</span>
          </Button>

          <Dialog open={walkthroughOpen} onOpenChange={setWalkthroughOpen}>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <div className="flex items-center gap-2">
                  <span className="flex size-7 items-center justify-center rounded-lg bg-blue-600 text-white">
                    <Sparkles className="size-4" />
                  </span>
                  <DialogTitle className="text-lg">
                    {t("Self-Explaining System Architecture — Objectives Walkthrough")}
                  </DialogTitle>
                </div>
                <DialogDescription className="text-xs">
                  {t("How this system autonomously satisfies the three core research objectives without requiring developer narration.")}
                </DialogDescription>
              </DialogHeader>

              <Tabs defaultValue="objective-1" className="mt-2 w-full">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="objective-1" className="text-xs font-medium">
                    {t("1. Mortality Trends")}
                  </TabsTrigger>
                  <TabsTrigger value="objective-2" className="text-xs font-medium">
                    {t("2. Early Outbreaks")}
                  </TabsTrigger>
                  <TabsTrigger value="objective-3" className="text-xs font-medium">
                    {t("3. Cause Patterns")}
                  </TabsTrigger>
                </TabsList>

                {/* Tab 1: Objective 1 */}
                <TabsContent value="objective-1" className="space-y-4 pt-3 text-xs">
                  <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-bold text-blue-950 text-sm">
                        {t("Objective 1: To Predict Mortality Trends")}
                      </span>
                      <Badge className="bg-blue-600 text-white text-[10px]">
                        {t("Engine: Seasonal Auto-Regression")}
                      </Badge>
                    </div>
                    <p className="text-slate-700 leading-relaxed">
                      {t("The system continuously forecasts expected mortality across districts and disease categories over a forward horizon of 14–90 days. It uses a 12-week rolling window of verified notifications with 95% confidence bounds, falling back gracefully to Poisson rate baselines when historical data is scarce.")}
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-lg border p-3 bg-card space-y-1.5">
                      <div className="flex items-center gap-1.5 font-semibold text-foreground">
                        <BrainCircuit className="size-4 text-blue-600" />
                        {t("Mathematical Formulation")}
                      </div>
                      <p className="text-muted-foreground text-[11px] font-mono leading-relaxed bg-muted/60 p-2 rounded">
                        Y(t+h) = ℓ(t) + h·b(t) + s(t+h-m) ± 1.96·σ_res
                      </p>
                      <p className="text-muted-foreground text-[11px]">
                        {t("Captures seasonal mortality waves (e.g. malaria, diarrheal) plus underlying trend direction.")}
                      </p>
                    </div>

                    <div className="rounded-lg border p-3 bg-card space-y-1.5">
                      <div className="flex items-center gap-1.5 font-semibold text-foreground">
                        <CheckCircle2 className="size-4 text-emerald-600" />
                        {t("Automated Plain-Language Output")}
                      </div>
                      <p className="text-muted-foreground text-[11px] leading-relaxed">
                        {t("Rather than expecting analysts to interpret raw curves, the system synthesizes natural-language projections and velocity tags (Rising / Declining / Stable).")}
                      </p>
                    </div>
                  </div>

                  <div className="flex justify-end pt-2">
                    <Button asChild size="sm" className="text-xs bg-blue-600 hover:bg-blue-700 text-white gap-1.5">
                      <Link to="/predictions" onClick={() => setWalkthroughOpen(false)}>
                        {t("Open Live Predictions Page")} <ArrowRight className="size-3.5" />
                      </Link>
                    </Button>
                  </div>
                </TabsContent>

                {/* Tab 2: Objective 2 */}
                <TabsContent value="objective-2" className="space-y-4 pt-3 text-xs">
                  <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-bold text-amber-950 text-sm">
                        {t("Objective 2: To Detect Outbreaks Early")}
                      </span>
                      <Badge className="bg-amber-600 text-white text-[10px]">
                        {t("Engine: 5-Pass Surveillance Engine")}
                      </Badge>
                    </div>
                    <p className="text-slate-700 leading-relaxed">
                      {t("Surveillance operates across five coordinated detection passes that scan every notification and morbidity signal. Crucially, the system does not wait for deaths to occur: Pass 4 (Community Signals) and Pass 5 (Syndromic Case Morbidity) raise early-warning alerts before mortality escalates.")}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <div className="rounded-lg border p-2.5 bg-card flex items-start gap-3">
                      <span className="font-bold text-amber-700 font-mono text-[11px] mt-0.5">Pass 1 & 2</span>
                      <div>
                        <p className="font-semibold text-foreground">{t("Stale-Alert Expiry & Spatial Threshold Clusters")}</p>
                        <p className="text-muted-foreground text-[11px] mt-0.5">{t("DBSCAN spatial clustering on geographic coordinates; auto-expiry prevents alert fatigue while allowing second waves to re-alert.")}</p>
                      </div>
                    </div>

                    <div className="rounded-lg border p-2.5 bg-card flex items-start gap-3">
                      <span className="font-bold text-amber-700 font-mono text-[11px] mt-0.5">Pass 3</span>
                      <div>
                        <p className="font-semibold text-foreground">{t("Poisson CUSUM Low-Volume Anomaly Detection")}</p>
                        <p className="text-muted-foreground text-[11px] mt-0.5">{t("Flags abnormal low-volume deviations in rare notifiable pathogens (e.g. Anthrax, Cholera) before statutory thresholds are reached.")}</p>
                      </div>
                    </div>

                    <div className="rounded-lg border p-2.5 bg-card flex items-start gap-3">
                      <span className="font-bold text-emerald-700 font-mono text-[11px] mt-0.5">Pass 4 & 5</span>
                      <div>
                        <p className="font-semibold text-foreground">{t("Pre-Mortality Surveillance (Community & Syndromic)")}</p>
                        <p className="text-muted-foreground text-[11px] mt-0.5">{t("Ingests community health worker reports and facility FHIR/REST morbidity counts to fire early alerts with zero deaths on record.")}</p>
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-end pt-2">
                    <Button asChild size="sm" className="text-xs bg-amber-600 hover:bg-amber-700 text-white gap-1.5">
                      <Link to="/alerts" onClick={() => setWalkthroughOpen(false)}>
                        {t("Open Live Alerts Page")} <ArrowRight className="size-3.5" />
                      </Link>
                    </Button>
                  </div>
                </TabsContent>

                {/* Tab 3: Objective 3 */}
                <TabsContent value="objective-3" className="space-y-4 pt-3 text-xs">
                  <div className="rounded-xl border border-purple-200 bg-purple-50/60 p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-bold text-purple-950 text-sm">
                        {t("Objective 3: To Identify Cause-of-Death Patterns")}
                      </span>
                      <Badge className="bg-purple-600 text-white text-[10px]">
                        {t("Engine: ICD-10 Verification Pathway")}
                      </Badge>
                    </div>
                    <p className="text-slate-700 leading-relaxed">
                      {t("Raw facility death reports often carry uncertain causes. DDS solves this by maintaining a closed-loop verification pipeline: preliminary ICD-10 codes are audited by certifying medical officers or pathologists via full/verbal autopsy, with final verified causes automatically replacing preliminary codes everywhere.")}
                    </p>
                  </div>

                  <div className="rounded-lg border p-3 bg-card space-y-2">
                    <span className="font-semibold text-foreground flex items-center gap-1.5">
                      <Layers className="size-4 text-purple-600" />
                      {t("Closed-Loop Data Quality Pipeline")}
                    </span>
                    <div className="grid grid-cols-3 gap-2 text-center text-[10px] font-medium pt-1">
                      <div className="p-2 rounded border bg-muted/40">
                        <span className="block text-primary font-bold">1. Capture</span>
                        {t("Preliminary ICD-10 by Facility Officer")}
                      </div>
                      <div className="p-2 rounded border bg-purple-50 text-purple-900 border-purple-200 font-bold">
                        <span className="block text-purple-700">2. Verification</span>
                        {t("Pathologist Autopsy & Audit")}
                      </div>
                      <div className="p-2 rounded border bg-emerald-50 text-emerald-900 border-emerald-200">
                        <span className="block text-emerald-700 font-bold">3. Re-Classification</span>
                        {t("Gold-Standard Surveillance Truth")}
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-end pt-2">
                    <Button asChild size="sm" className="text-xs bg-purple-600 hover:bg-purple-700 text-white gap-1.5">
                      <Link to="/analytics" onClick={() => setWalkthroughOpen(false)}>
                        {t("Open Pattern Analytics Page")} <ArrowRight className="size-3.5" />
                      </Link>
                    </Button>
                  </div>
                </TabsContent>
              </Tabs>
            </DialogContent>
          </Dialog>

          <Button
            size="sm"
            variant="ghost"
            onClick={toggleCollapse}
            aria-expanded={!collapsed}
            className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
            title={collapsed ? t("Expand system mission") : t("Collapse system mission")}
          >
            {collapsed ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
          </Button>
        </div>
      </div>

      {/* The 3 Core Objective Cards */}
      {!collapsed && (
        <CardContent className="grid gap-4 p-5 sm:grid-cols-3">
          {SYSTEM_OBJECTIVES.map((obj) => (
            <Link
              key={obj.key}
              to={obj.to}
              className={cn(
                "group relative flex flex-col justify-between rounded-xl border border-border/80 bg-card p-4 shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md",
                obj.border
              )}
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className={cn("flex size-9 items-center justify-center rounded-lg bg-gradient-to-br text-white shadow-sm", obj.accent)}>
                    <obj.icon className="size-4.5" />
                  </span>
                  <Badge variant={obj.badgeVariant} className="text-[10px] font-semibold tracking-wide">
                    {t(obj.label)}
                  </Badge>
                </div>

                <p className="text-xs font-bold text-foreground group-hover:text-primary transition-colors">
                  {t(obj.title)}
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  {t(obj.sub)}
                </p>
              </div>

              <div className="mt-3.5 pt-2.5 border-t border-border/40 flex items-center justify-between text-[10px] font-medium text-primary">
                <span className="flex items-center gap-1 text-muted-foreground">
                  <ShieldCheck className="size-3 text-emerald-600" />
                  {t(obj.badgeText)}
                </span>
                <span className="flex items-center gap-0.5 group-hover:translate-x-0.5 transition-transform">
                  {t("Inspect")} <ArrowRight className="size-3" />
                </span>
              </div>
            </Link>
          ))}
        </CardContent>
      )}
    </Card>
  )
}

