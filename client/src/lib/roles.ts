import type { Role } from "./auth"

export const ROLE_LABELS: Record<Role, string> = {
  medical_officer: "Medical Officer",
  pathologist: "Pathologist",
  public_health_analyst: "Public Health Analyst",
  system_admin: "System Administrator",
  mortuary_clerk: "Mortuary Clerk",
  executive: "Executive",
}

export const ROLE_BADGE_VARIANT: Record<Role, "default" | "secondary" | "outline"> = {
  medical_officer: "default",
  pathologist: "secondary",
  public_health_analyst: "outline",
  system_admin: "outline",
  mortuary_clerk: "default",
  executive: "secondary",
}
