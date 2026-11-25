// Opening a delegation's next step (lib/activityStep): its detail on the right side (lib/delegationOpen), scrolled to the
// part the step is about — the result (checked against the link's answer id) or the review on top. Always the record's
// host and id from the row, never a match by title. When the detail cannot open here (module off, the host is out of
// view) an approval falls back to that host's 审批 page and the rest to `fallback` (the row's old opener).
import { create } from "zustand";
import { openDelegationDetail } from "./delegationOpen";
import { ownSurfaceStep, rowStep, type ActivityStep, type StepAction } from "./activityStep";
import { useApp } from "../store";
import { awaitsOwnerReview } from "./delegations";
import { useDelegations } from "./delegationStore";
import { hostKey } from "./hostKeys";
import { reviewReferences, type AskReviewReference } from "../../../shared/delegationReviews";
import type { AskSummary } from "../../../shared/ipc";

/**
 * The delegation's detail has the approval's card on top (components/DelegationReview): a routing review (on a local
 * record), or the capability review of a delegation waiting in 待审批. Any other approval's card is on the 审批 page.
 */
export function reviewCardInDetail(d: AskSummary | undefined): boolean {
  if (!d || d.closed) return false;
  return awaitsOwnerReview(d) || (!d.remote && reviewReferences(d).some((r) => r.kind === "routing"));
}

/**
 * The detail shows the card of exactly this approval (review 2026-11-25 P2-1: by kind and approval id, never "some card"):
 * - routing: the record's routing reference (DelegationReview shows its first one) is this approval, on a local record;
 * - capability: the delegation waits in 待审批 (its capability card shows only then) and, when the record lists capability
 *   references, this approval is one of them (a record without references finds its card by ask id).
 * A queued delegation waiting for a capability approval while keeping a decided routing reference: not in the detail.
 */
export function approvalCardInDetail(d: AskSummary | undefined, ref: AskReviewReference): boolean {
  if (!d || d.closed) return false;
  const refs = reviewReferences(d);
  if (ref.kind === "routing") return !d.remote && refs.find((r) => r.kind === "routing")?.approvalId === ref.approvalId;
  if (!awaitsOwnerReview(d)) return false;
  const capability = refs.filter((r) => r.kind === "capability");
  return !capability.length || capability.some((r) => r.approvalId === ref.approvalId);
}

/** The step a delegation's own surfaces show (lib/activityStep ownSurfaceStep): 查看审批 only when that approval's card is not shown there. */
export function ownStepOf(d: AskSummary): ActivityStep | null {
  const step = rowStep(d);
  return ownSurfaceStep(step, step?.action?.kind === "approval" ? approvalCardInDetail(d, step.action.ref) : false);
}

export type DetailSection = "result" | "review";

export interface DetailFocusRequest {
  hostId: string;
  askId: string;
  section: DetailSection;
  /** `result`: the answer the link pointed at; the detail says so when the delegation has a newer one. */
  answerId?: string;
  /** `review`: the approval it is about; the detail says so when its card is no longer there (decided elsewhere). */
  approval?: AskReviewReference;
  seq: number;
}

/** One pending focus for the delegation detail (modules/delegations DetailView takes it when it shows that delegation). */
export const useDetailFocus = create<{ request: DetailFocusRequest | null }>(() => ({ request: null }));
let seq = 0;

export function requestDetailFocus(r: Omit<DetailFocusRequest, "seq">): void {
  useDetailFocus.setState({ request: { ...r, seq: ++seq } });
}

/** The detail of `hostId`/`askId` takes its request (null when the pending one is for another delegation). */
export function takeDetailFocus(hostId: string, askId: string): DetailFocusRequest | null {
  const r = useDetailFocus.getState().request;
  if (!r || r.hostId !== hostId || r.askId !== askId) return null;
  useDetailFocus.setState({ request: null });
  return r;
}

export function openStepAction(hostId: string, askId: string, action: StepAction, opts: { title?: string; fallback?: () => void } = {}): void {
  if (action.kind === "approvals") return useApp.getState().openApprovalsOn(hostId);
  // An approval whose card is not in the detail: straight to the host's 审批 page (spec Z3 §2).
  if (action.kind === "approval" && !approvalCardInDetail(useDelegations.getState().byKey[hostKey(hostId, askId)], action.ref)) return useApp.getState().openApprovalsOn(hostId);
  const drop = () => {
    const r = useDetailFocus.getState().request;
    if (r && r.hostId === hostId && r.askId === askId) useDetailFocus.setState({ request: null });
  };
  if (action.kind === "result") requestDetailFocus({ hostId, askId, section: "result", answerId: action.answerId });
  else if (action.kind === "approval") requestDetailFocus({ hostId, askId, section: "review", approval: action.ref });
  const fallback = action.kind === "approval" ? () => useApp.getState().openApprovalsOn(hostId) : opts.fallback;
  openDelegationDetail(hostId, askId, {
    title: opts.title,
    fallback: () => {
      drop();
      fallback?.();
    },
  });
}
