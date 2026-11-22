// 结束跟进 on a stuck message (state surfaces WP-D5, fix plan S9; cutex r289 agent-bus-owner-end-followup-v1,
// `POST /v2/agent-bus/stuck-messages/end-follow-up`): the host records the follow-up closed with outcome unconfirmed, by
// the owner, without runtime evidence, and the message is never redriven. It does not claim the recipient got it
// (followUp.endedMessage: 已结束跟进 · 送达未确认). One request per message: an uncertain answer (connection lost) keeps
// its action id, so clicking again replays the same request (the host answers changed: false), never a second one.
import { create } from "zustand";
import type { StuckBusMessage } from "../../../../shared/ipc";
import { OWNER_DISPOSITION_FEATURES, OWNER_DISPOSITION_UNSUPPORTED, type MessageEndFollowUpRequest, type MessageEndFollowUpResult } from "../../../../shared/ownerDispositions";

/** The host feature that offers 结束跟进 on messages and also tombstones live-only discards (N9). */
export const MESSAGE_END_FOLLOW_UP_FEATURE = OWNER_DISPOSITION_FEATURES.messageEndFollowUp[0];

/** The reason sent with 结束跟进 (kept on the closure). */
export const MESSAGE_FOLLOW_UP_REASON = "owner ended follow-up from the cleanup page";

export type EndFollowUpPhase = "pending" | "ended" | "uncertain" | "error";
export interface EndFollowUpEntry {
  phase: EndFollowUpPhase;
  actionId: string;
  /** What the message said (for the 已结束跟进 list after the row leaves the stuck list). */
  preview: string;
  /** error: `conflict` (followUp.actionConflict), `unsupported` (followUp.oldHost), `gone`, `failed` (+ message). */
  error?: "conflict" | "unsupported" | "gone" | "failed";
  message?: string;
}

export type EndFollowUpOutcome = { kind: "ended" } | { kind: "conflict" } | { kind: "unsupported" } | { kind: "gone" } | { kind: "failed"; message: string };

/** What the host's answer means. */
export function endFollowUpOutcome(result: MessageEndFollowUpResult): EndFollowUpOutcome {
  if (result.ok) return { kind: "ended" };
  const { code, message } = result.error;
  if (code === "action_id_conflict" || code === "idempotency_conflict") return { kind: "conflict" };
  if (code === OWNER_DISPOSITION_UNSUPPORTED) return { kind: "unsupported" };
  if (code === "message_not_found") return { kind: "gone" };
  return { kind: "failed", message: message || code };
}

export const endFollowUpKey = (hostId: string, messageId: string) => JSON.stringify([hostId, messageId]);

export const useEndFollowUps = create<{ entries: Record<string, EndFollowUpEntry> }>(() => ({ entries: {} }));
const put = (key: string, entry: EndFollowUpEntry) => useEndFollowUps.setState((s) => ({ entries: { ...s.entries, [key]: entry } }));

/** The request for `m`; `actionId` is reused from an uncertain earlier attempt. */
export function endFollowUpRequest(m: Pick<StuckBusMessage, "messageId" | "semanticSha256">, actionId: string): MessageEndFollowUpRequest {
  return { messageId: m.messageId, actionId, reason: MESSAGE_FOLLOW_UP_REASON, ...(m.semanticSha256 ? { expectedSemanticSha256: m.semanticSha256 } : {}) };
}

/** 结束跟进 on `m` through `api` (the page's target host). Never retried automatically. */
export async function endMessageFollowUp(
  api: { messageEndFollowUp(request: MessageEndFollowUpRequest): Promise<MessageEndFollowUpResult> },
  hostId: string,
  m: Pick<StuckBusMessage, "messageId" | "semanticSha256" | "contentPreview">,
  newId: () => string = () => crypto.randomUUID(),
): Promise<EndFollowUpOutcome | null> {
  const key = endFollowUpKey(hostId, m.messageId);
  const before = useEndFollowUps.getState().entries[key];
  if (before?.phase === "pending" || before?.phase === "ended") return null;
  const actionId = before?.phase === "uncertain" ? before.actionId : newId();
  put(key, { phase: "pending", actionId, preview: m.contentPreview });
  try {
    const outcome = endFollowUpOutcome(await api.messageEndFollowUp(endFollowUpRequest(m, actionId)));
    put(key, outcome.kind === "ended" ? { phase: "ended", actionId, preview: m.contentPreview } : { phase: "error", actionId, preview: m.contentPreview, error: outcome.kind, ...(outcome.kind === "failed" ? { message: outcome.message } : {}) });
    return outcome;
  } catch (e) {
    // Not known whether the host recorded it: keep the action id for an explicit replay.
    put(key, { phase: "uncertain", actionId, preview: m.contentPreview, message: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

/** Messages of `hostId` whose follow-up ended here (newest last), for the list under the table. */
export function endedOn(entries: Record<string, EndFollowUpEntry>, hostId: string): { messageId: string; preview: string }[] {
  return Object.entries(entries).flatMap(([key, e]) => {
    const [host, messageId] = JSON.parse(key) as [string, string];
    return host === hostId && e.phase === "ended" ? [{ messageId, preview: e.preview }] : [];
  });
}
