// When an urgent occurrence stops needing the owner, its popups are taken back (lib/notifyEvents
// retractNotify → the notifications module → main closes the event big alert / desktop notification).
// Owner bug 2026-10-13: the big alert stayed in the middle of the screen after the approval / question
// had been handled in the app, because only its own 知道了 / 打开 closed it.
//
// Triggers (keys as store.ts emits them):
// - `serverRequest/resolved` of a native request → `req:<agent>:<requestId>` (answered here or elsewhere);
// - a turn end → every `req:<agent>:` of that agent (its requests die with the turn);
// - an owner approval leaving `pending` → `approval:<approvalId>`;
// - the owner looking at an agent (focused window, that agent's conversation shown) → its `req:` / `turn:`;
// - the owner looking at the approvals page → every `approval:`.
// owner_notify records retract themselves in lib/ownerNotifyStore (a record that stopped alerting).
import type { EventEnvelope } from "@cutex-desktop/protocol";
import { agentRetraction, retractNotify, type NotifyRetraction } from "./notifyEvents";

/** What a host feed event takes back (null: nothing). */
export function retractionOfHostEvent(envelope: EventEnvelope, turnEnded: boolean): NotifyRetraction | null {
  const native = envelope.native;
  const agent = envelope.cutexSessionId;
  if (!native || native.kind === "serverRequest") return null;
  if (native.message.method === "serverRequest/resolved") {
    const requestId = (native.message.params as { requestId?: unknown } | undefined)?.requestId;
    return typeof requestId === "string" || typeof requestId === "number" ? { keys: [`req:${agent}:${requestId}`] } : null;
  }
  return turnEnded ? { prefixes: [`req:${agent}:`] } : null;
}

/** An owner approval that is no longer pending (approved / denied / expired …). */
export function retractionOfApproval(change: { approval: { approvalId: string; state: string } } | null): NotifyRetraction | null {
  if (!change || change.approval.state === "pending") return null;
  return { keys: [`approval:${change.approval.approvalId}`] };
}

/** The bits of the app store the look trigger reads. */
export interface LookSlice {
  selectedId: string | null;
  view: { kind: string; page?: string };
}

export const APPROVALS_PAGE = "approvals.page";

/** What the owner is looking at right now (window focused): an agent, the approvals page, or nothing. */
export function lookOf(state: LookSlice, focused: boolean): string | null {
  if (!focused) return null;
  if (state.view.kind === "conversation") return state.selectedId ? `agent:${state.selectedId}` : null;
  return state.view.kind === "page" && state.view.page === APPROVALS_PAGE ? "approvals" : null;
}

/** The retraction for a look (see lookOf). */
export function retractionOfLook(look: string | null): NotifyRetraction | null {
  if (!look) return null;
  if (look === "approvals") return { prefixes: ["approval:"] };
  return look.startsWith("agent:") ? agentRetraction(look.slice("agent:".length)) : null;
}

/** The window events the look trigger follows (no window in unit tests of the store). */
export type LookWindow = Pick<Window, "addEventListener" | "removeEventListener"> & { document: Pick<Document, "hasFocus"> };

/**
 * Follow what the owner looks at: opening an agent (or focusing the window on it) takes back that
 * agent's alerts; the approvals page takes back the approval alerts. Returns the dispose.
 */
export function startLookRetract(store: { getState(): LookSlice; subscribe(listener: (state: LookSlice) => void): () => void }, win: LookWindow | null = typeof window === "undefined" ? null : window): () => void {
  let last: string | null = null;
  const focused = (): boolean => {
    try {
      const doc = win?.document ?? (typeof document === "undefined" ? null : document);
      return typeof doc?.hasFocus === "function" && doc.hasFocus();
    } catch {
      return false;
    }
  };
  const check = () => {
    const look = lookOf(store.getState(), focused());
    if (look === last) return;
    last = look;
    const r = retractionOfLook(look);
    if (r) retractNotify(r);
  };
  const onBlur = () => {
    last = null;
  };
  const off = store.subscribe(check);
  // (unit tests stub a partial window)
  const events = typeof win?.addEventListener === "function" ? win : null;
  events?.addEventListener("focus", check);
  events?.addEventListener("blur", onBlur);
  check();
  return () => {
    off();
    events?.removeEventListener("focus", check);
    events?.removeEventListener("blur", onBlur);
  };
}
