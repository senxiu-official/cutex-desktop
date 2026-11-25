// Current blocker and next step of a delegation (cutex r295 Z3 `activityLink`, spec .claude/reports/r295-z3-activity-desktop-spec.md):
// `GET /v2/asks` rows carry where it is stuck now (`blocker`) and the one navigation that helps (`next`), with the
// references to open (the delegation, its current routing / capability approval, its result). The links confer no
// authority: every destination applies its own checks. Rows are untrusted wire data, so everything goes through
// `askActivityLink`; a host without the field (older cutex) gets null and every surface keeps its old words and buttons.
// Pure (test/activityStep.test.ts).
import type { AskReviewReference } from "../../../shared/delegationReviews";

/** Blockers this desktop has words for. A newer value is not guessed at: the row keeps its old words. */
export const ACTIVITY_BLOCKERS = ["approval", "question", "outcomeUnknown", "acceptance", "failed", "quota", "login", "paused", "waitingForEvent", "targetBusy", "held"] as const;
export type ActivityBlocker = (typeof ACTIVITY_BLOCKERS)[number];

/** Next steps. `none` for a value this desktop does not know (it shows no button for it). */
export const ACTIVITY_NEXTS = ["none", "wait", "openDelegation", "openApproval", "openResult", "openNativeRequest"] as const;
export type ActivityNext = (typeof ACTIVITY_NEXTS)[number];

export interface AskActivityLink {
  askId: string;
  approval: AskReviewReference | null;
  result: { askId: string; answerId: string } | null;
  /** null: nothing blocks it (or it is closed). A value this desktop has no words for is null too (`unknownBlocker`). */
  blocker: ActivityBlocker | null;
  /** The host said something blocks it, in a word this desktop does not know. */
  unknownBlocker: boolean;
  next: ActivityNext;
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const id = (v: unknown): string | null => (typeof v === "string" && ID.test(v) ? v : null);

function reviewRef(raw: unknown): AskReviewReference | null {
  const r = obj(raw);
  const approvalId = id(r?.approvalId);
  if (!r || (r.kind !== "routing" && r.kind !== "capability") || !approvalId) return null;
  return { kind: r.kind, approvalId, projectId: typeof r.projectId === "string" ? r.projectId : null };
}

/**
 * The row's `activityLink`, checked; null when the host sends none (older cutex) or one that does not belong to this row
 * (another ask id: a link is never reused across delegations).
 */
export function askActivityLink(row: { askId: string; activityLink?: unknown }): AskActivityLink | null {
  const raw = obj(row.activityLink);
  if (!raw) return null;
  const delegation = obj(raw.delegation);
  if (delegation?.kind !== "delegation" || delegation.askId !== row.askId) return null;
  const result = obj(raw.result);
  const answerId = id(result?.answerId);
  const okResult = result?.kind === "delegationResult" && result.askId === row.askId && answerId ? { askId: row.askId, answerId } : null;
  const blockerRaw = typeof raw.blocker === "string" && raw.blocker ? raw.blocker : null;
  const blocker = blockerRaw && (ACTIVITY_BLOCKERS as readonly string[]).includes(blockerRaw) ? (blockerRaw as ActivityBlocker) : null;
  let next: ActivityNext = typeof raw.next === "string" && (ACTIVITY_NEXTS as readonly string[]).includes(raw.next) ? (raw.next as ActivityNext) : "none";
  const approval = reviewRef(raw.approval);
  // A destination without its reference falls back to the delegation (cutex does the same; a malformed one here too).
  if (next === "openApproval" && !approval) next = "openDelegation";
  if (next === "openResult" && !okResult) next = "openDelegation";
  if (next === "openNativeRequest") next = "openDelegation";
  return { askId: row.askId, approval, result: okResult, blocker, unknownBlocker: !!blockerRaw && !blocker, next };
}

/** Where a next-step button goes. `wait` and `none` have no button (a row shows only navigation that works). */
export type StepAction =
  | { kind: "delegation" }
  | { kind: "approval"; ref: AskReviewReference }
  | { kind: "result"; answerId: string }
  /** An agent's owner approval (not a delegation's review): the host's 审批 page. */
  | { kind: "approvals" };

export interface ActivityStep {
  blocker: ActivityBlocker;
  next: ActivityNext;
  action: StepAction | null;
}

/** The step a row shows: null when nothing blocks it, the host has no link, or its blocker is not one this desktop knows. */
export function askStep(link: AskActivityLink | null): ActivityStep | null {
  if (!link?.blocker) return null;
  const action: StepAction | null =
    link.next === "openDelegation" ? { kind: "delegation" }
    : link.next === "openApproval" && link.approval ? { kind: "approval", ref: link.approval }
    : link.next === "openResult" && link.result ? { kind: "result", answerId: link.result.answerId }
    : null;
  return { blocker: link.blocker, next: link.next, action };
}

/** An agent waiting for an owner approval (cutex Summary need `ownerApproval`: blocker approval, next openApproval). */
export const OWNER_APPROVAL_STEP: ActivityStep = { blocker: "approval", next: "openApproval", action: { kind: "approvals" } };

/** The step of a row (shortcut for both). */
export function rowStep(row: { askId: string; activityLink?: unknown }): ActivityStep | null {
  return askStep(askActivityLink(row));
}

/** Two steps show the same (memoised rows compare on it). */
export function sameStep(a: ActivityStep | null | undefined, b: ActivityStep | null | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.blocker !== b.blocker || a.next !== b.next) return false;
  const x = a.action, y = b.action;
  if (!x || !y) return x === y;
  if (x.kind !== y.kind) return false;
  if (x.kind === "result" && y.kind === "result") return x.answerId === y.answerId;
  if (x.kind === "approval" && y.kind === "approval") return x.ref.approvalId === y.ref.approvalId && x.ref.kind === y.ref.kind;
  return true;
}

/** The blocker's words (`delegation.step.blocker.*`). */
export const blockerKey = (b: ActivityBlocker): string => `delegation.step.blocker.${b}`;

/** A next step's words: a button label, or `等待` as plain text; null for `none`. */
export function nextKey(step: ActivityStep): string | null {
  if (step.action) return `delegation.step.next.${step.action.kind === "approvals" ? "approval" : step.action.kind}`;
  return step.next === "wait" ? "delegation.step.next.wait" : null;
}

/**
 * The step a delegation's own surfaces (its card, its side detail, its 接下来 row) show. They already say the state in
 * their status word and decide a pending review in place, so only a step that goes somewhere else is left: the result
 * (`openResult`), or the approval when no review buttons are shown here (`inlineReview` false). Null: nothing to add.
 */
export function ownSurfaceStep(step: ActivityStep | null, inlineReview: boolean): ActivityStep | null {
  if (!step?.action) return null;
  if (step.action.kind === "result") return step;
  if (step.action.kind === "approval" && !inlineReview) return step;
  return null;
}
