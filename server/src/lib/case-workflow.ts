import { query } from "../db.js"
import { httpError } from "./notification-service.js"
import { notifyUser } from "../routes/notifications-realtime.js"

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

/**
 * Auto-assign unassigned pending_review cases to the least-loaded active
 * pathologist (round-robin over the open-case ranking) and notify the
 * assignee — cases never just sit in the queue. Returns rows assigned.
 */
export async function autoAssignPendingReviews(limit = 20): Promise<number> {
  const reviewers = await query<any[]>(
    `SELECT u.user_id, COUNT(dn.notification_id) AS open_cases
     FROM users u
     LEFT JOIN death_notifications dn ON dn.assigned_to = u.user_id
       AND dn.status IN ('pending_review','under_review')
     WHERE u.status = 'active' AND u.role = 'pathologist'
     GROUP BY u.user_id ORDER BY open_cases ASC, u.user_id`,
  )
  if (!reviewers.length) return 0
  const pending = await query<any[]>(
    `SELECT notification_id, is_maternal_perinatal FROM death_notifications
     WHERE status = 'pending_review' AND assigned_to IS NULL
     ORDER BY created_at ASC LIMIT ?`,
    [limit],
  )
  let assigned = 0
  for (const n of pending) {
    const target = reviewers[assigned % reviewers.length].user_id
    const due = new Date(Date.now() + reviewSlaHours(!!n.is_maternal_perinatal) * 3600 * 1000)
    const updated = await query<any>(
      `UPDATE death_notifications SET assigned_to = ?, review_due_at = ?
       WHERE notification_id = ? AND assigned_to IS NULL AND status = 'pending_review'`,
      [target, due, n.notification_id],
    )
    if (Number((updated as { affectedRows?: number })?.affectedRows ?? 1) > 0) {
      assigned++
      void notifyUser(target, "Case assigned", `Case ${n.notification_id} has been assigned to you.`, `/notifications/${n.notification_id}`, "assignment").catch(() => {})
    }
  }
  return assigned
}
