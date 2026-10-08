import { useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { Activity, Eye, EyeOff, FileSearch, Loader2, MapPin, WifiOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { useAuth } from "@/lib/auth"
import { ApiError } from "@/lib/api"
import { usePreferences } from "@/lib/preferences"
import { LanguageMenu } from "@/components/language-menu"

export default function SignInPage() {const{t}=usePreferences();
  const navigate = useNavigate()
  const { signIn } = useAuth()
  const [code,setCode] = useState("")
  const [needsCode, setNeedsCode] = useState(false)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await signIn(email, password, code)
      navigate("/dashboard", { replace: true })
    } catch (err) {
      if (err instanceof ApiError && err.data?.requiresTwoFactor) setNeedsCode(true)
      setError(err instanceof Error ? err.message : "Sign-in failed")
      setLoading(false)
    }
  }

  const features = [
    {
      icon: Activity,
      title: t("Outbreak detection"),
      desc: t("Real-time mortality surveillance, automated threshold alerts & early cluster warnings"),
      tag: t("Live Surveillance"),
    },
    {
      icon: FileSearch,
      title: t("Tele-pathology"),
      desc: t("Remote digital specimen review and authenticated digital autopsy certification"),
      tag: t("Digital Forensics"),
    },
    {
      icon: MapPin,
      title: t("GIS analytics"),
      desc: t("District → provincial → national disease mapping, hotspot heatmaps and spatial mortality patterns"),
      tag: t("Geospatial Intel"),
    },
    {
      icon: WifiOff,
      title: t("Offline field sync"),
      desc: t("Capture mortality data in the field without connectivity — records queue locally and sync when back online"),
      tag: t("Field Ready"),
    },
  ]

  return (
    <main className="h-svh overflow-hidden lg:grid lg:grid-cols-2">
      {/* Left — branded hero panel (ultra-dark green shade with extra-large white circle MOHCC logo) */}
      <div className="hidden lg:flex min-h-0 flex-col items-center justify-center gap-6 bg-[#02180d] p-8 text-white lg:p-8 xl:p-12 border-r border-white/10 relative overflow-y-auto">
        <div className="flex flex-col items-center gap-6 max-w-xl w-full my-auto">
          {/* Official MOHCC Logo — extra-large white circle badge with enlarged logo */}
          <div className="flex size-[clamp(10rem,38vh,26rem)] shrink-0 items-center justify-center rounded-full bg-white p-3 sm:p-4 lg:p-5 shadow-2xl ring-8 ring-white/20 select-none transition-all">
            <img
              src="/mohcc-logo.png"
              alt="Ministry of Health and Child Care — Zimbabwe"
              className="size-full object-contain drop-shadow-md"
            />
          </div>

          {/* Under logo circlement — lower left aligned content */}
          <div className="flex flex-col items-start text-left w-full max-w-lg gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight lg:text-3xl text-white">
                {t("Disease Detection System")}
              </h1>
              <p className="mt-1 text-sm font-medium text-emerald-400">
                {t("Ministry of Health and Child Care — Zimbabwe")}
              </p>
            </div>

            {/* Single combined card with invisible format — only words and sleek indicators visible */}
            <div className="w-full bg-transparent border-0 shadow-none p-0 space-y-3.5 text-left">
              {features.map((f) => (
                <div key={f.title} className="flex items-start gap-3 group">
                  <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30 group-hover:bg-emerald-500/25 transition-colors">
                    <f.icon className="size-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-white tracking-tight group-hover:text-emerald-200 transition-colors">
                        {f.title}
                      </span>
                      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                        {f.tag}
                      </span>
                    </div>
                    <p className="text-xs text-white/80 leading-relaxed mt-0.5 font-normal">
                      {f.desc}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Right — sign-in form (fully compatible with white background) */}
      <div className="relative flex h-full min-h-0 justify-center overflow-y-auto bg-white p-4 sm:p-6 lg:p-10">
        <div className="absolute right-4 top-4">
          <LanguageMenu />
        </div>
        <div className="my-auto w-full max-w-md space-y-4 [@media(max-height:700px)]:space-y-2">
          {/* Mobile top branding badge */}
          <div className="text-center lg:hidden pb-1">
            <p className="text-xs font-semibold tracking-wider uppercase text-primary">
              {t("Ministry of Health and Child Care · Zimbabwe")}
            </p>
          </div>

          <Card className="border-2 border-slate-300 shadow-2xl bg-white text-black rounded-2xl ring-1 ring-slate-400/30">
            <CardHeader className="items-center text-center pb-2">
              <img
                src="/zimbabwe-coat-of-arms.png"
                alt="Coat of arms of Zimbabwe"
                className="mx-auto mb-2.5 h-16 [@media(max-height:700px)]:h-11 w-auto object-contain drop-shadow-sm"
              />
              <CardTitle className="text-xl font-bold tracking-tight text-black">
                {t("Sign in to DDS")}
              </CardTitle>
              <CardDescription className="text-xs text-black font-medium">
                {t("Disease Detection System")}
              </CardDescription>
            </CardHeader>

            <CardContent className="px-6 pt-2 pb-6 [@media(max-height:700px)]:pb-4">
              <form onSubmit={onSubmit} className="space-y-4 [@media(max-height:700px)]:space-y-3">
                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-sm font-bold text-black">
                    {t("Email Address")}
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t("name@mohcc.org.zw")}
                    className="h-10 px-3 bg-white border-2 border-slate-400 text-black placeholder:text-black/60 focus-visible:ring-2 focus-visible:ring-blue-600/30 focus-visible:border-blue-600 shadow-lg rounded-lg font-medium"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="password" className="text-sm font-bold text-black">
                    {t("Password")}
                  </Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={t("Enter your password")}
                      className="h-10 px-3 pr-10 bg-white border-2 border-slate-400 text-black placeholder:text-black/60 focus-visible:ring-2 focus-visible:ring-blue-600/30 focus-visible:border-blue-600 shadow-lg rounded-lg font-medium"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      tabIndex={0}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-black hover:text-black/70 transition-colors p-1 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 cursor-pointer"
                      aria-label={showPassword ? t("Hide password") : t("Show password")}
                    >
                      {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>

                {needsCode && (
                  <div className="space-y-1.5">
                    <Label htmlFor="two-factor" className="text-sm font-bold text-black">{t("Authenticator or recovery code")}</Label>
                    <Input id="two-factor" autoComplete="one-time-code" required value={code} onChange={e => setCode(e.target.value)} placeholder={t("Enter the code sent to your email")} className="h-10 px-3 bg-white border-2 border-slate-400 text-black placeholder:text-black/60 focus-visible:ring-2 focus-visible:ring-blue-600/30 focus-visible:border-blue-600 shadow-lg rounded-lg font-medium" />
                  </div>
                )}
                <Button type="submit" className="h-10 w-full font-semibold shadow-md mt-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white transition-all cursor-pointer" disabled={loading}>
                  {loading && <Loader2 className="size-4 animate-spin mr-2" />}
                  {t("Sign in")}
                </Button>
                <Link to="/forgot-password" className="block text-center text-sm underline text-blue-600 hover:text-blue-700">{t("Forgot password?")}</Link>
              </form>
            </CardContent>

            <CardFooter className="border-t-2 border-slate-200 bg-slate-50/90 px-6 py-3.5 [@media(max-height:700px)]:py-2 rounded-b-2xl">
              <p className="w-full text-center text-xs text-black font-medium">
                {t("Authorised personnel only.")}
              </p>
            </CardFooter>
          </Card>
        </div>
      </div>
    </main>
  )
}
