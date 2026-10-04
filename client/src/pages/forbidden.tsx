import { Link } from "react-router-dom"
import { ShieldOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { usePreferences } from "@/lib/preferences"

export default function ForbiddenPage() {const{t}=usePreferences();
  return (
    <main className="flex h-svh flex-col items-center justify-center gap-4 overflow-y-auto p-4 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <ShieldOff className="size-7" />
      </div>
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">{t("Access restricted")}</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Your role does not have permission to view this section of the Disease Detection System. Contact your System Administrator if
          you believe this is an error.
        </p>
      </div>
      <Button asChild>
        <Link to="/dashboard">{t("Back to dashboard")}</Link>
      </Button>
    </main>
  )
}
