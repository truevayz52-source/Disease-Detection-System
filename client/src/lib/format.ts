export function fmtDate(d: string | Date | null | undefined) {
  if (!d) return "—"
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
}

export function fmtDateTime(d: string | Date | null | undefined) {
  if (!d) return "—"
  return new Date(d).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export const STATUS_LABELS: Record<string, string> = {
  pending_review: "Pending review",
  under_review: "Under review",
  autopsy_complete: "Autopsy complete",
  finalized: "Finalized",
  active: "Active",
  resolved: "Resolved",
  draft: "Draft",
}

export const STATUS_VARIANTS: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  pending_review: "destructive",
  under_review: "default",
  autopsy_complete: "secondary",
  finalized: "outline",
  active: "destructive",
  resolved: "outline",
  draft: "secondary",
}

export function riskVariant(score: number): "destructive" | "default" | "secondary" {
  if (score >= 75) return "destructive"
  if (score >= 50) return "default"
  return "secondary"
}
