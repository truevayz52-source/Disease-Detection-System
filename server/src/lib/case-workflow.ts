import { query } from "../db.js"
import { httpError } from "./notification-service.js"

/** All legal statuses for a death notification. */
export const CASE_STATUSES = [
  "pending_review",
  "under_review",
  "autopsy_complete",
  "certified",
  "finalized",
  "rejected",
] as const

export type CaseStatus = (typeof CASE_STATUSES)[number]

/** Terminal states can never change. */
export const TERMINAL_STATUSES = new Set<CaseStatus>(["finalized", "certified", "rejected"])

/** Legal status transitions. Key = current; value = allowed next states. */
const TRANSITIONS: Record<CaseStatus, Set<CaseStatus>> = {
  pending_review: new Set<CaseStatus>(["under_review", "autopsy_complete", "certified", "rejected"]),
  under_review: new Set<CaseStatus>(["autopsy_complete", "certified", "rejected"]),
  autopsy_complete: new Set<CaseStatus>(["finalized"]),
  certified: new Set<CaseStatus>([]),
  finalized: new Set<CaseStatus>([]),
  rejected: new Set<CaseStatus>([]),
}

export function isCaseStatus(value: string): value is CaseStatus {
  return CASE_STATUSES.includes(value as CaseStatus)
}

export function canTransition(from: CaseStatus, to: CaseStatus): boolean {
  return TRANSITIONS[from].has(to)
}

export function isTerminal(status: CaseStatus): boolean {
  return TERMINAL_STATUSES.has(status)
}

export function transitionError(from: CaseStatus, to: CaseStatus): Error {
  return httpError(
    409,
    `Illegal status transition: cannot move from '${from}' to '${to}'. ` +
      `Allowed from '${from}': ${[...TRANSITIONS[from]].join(", ") || "none (terminal)"}.`,
  )
}

/** Throws if the notification is in a terminal state (certified/finalized/rejected). */
export async function assertCaseOpen(notificationId: string): Promise<void> {
  const [row] = await query<any[]>("SELECT status FROM death_notifications WHERE notification_id = ?", [
    notificationId,
  ])
  if (!row) throw httpError(404, "Notification not found")
  if (isTerminal(row.status as CaseStatus)) {
    throw httpError(409, `Case is ${row.status} and cannot be modified`)
  }
}

/** Validate a requested transition, throwing on failure. */
export function validateTransition(from: CaseStatus, to: CaseStatus): void {
  if (!isCaseStatus(to)) throw httpError(400, `Unknown status: ${to}`)
  if (!canTransition(from, to)) throw transitionError(from, to)
}

/** SLA hours for a notification, based on clinical flags. */
export function reviewSlaHours(isMaternalPerinatal: boolean): number {
  return isMaternalPerinatal ? 48 : 72
}
