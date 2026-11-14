// A ledger record whose native item is not in the timeline yet (accepted, not read in; or history still loading)
// is drawn as the row its native item will be: the same received renderers fed a message built from the record,
// so the swap to the native row happens in place (owner 2026-11-13: it showed as a bare name + preview first).
// Delegation title / peer come from the delegations store (cutex has no view data on input records yet).
import type { InputRecord, InputSenderKind } from "@cutex-desktop/protocol";
import type { AskRequester, AskSummary } from "../../../../shared/ipc";
import type { ExternalMessage } from "../timeline";

/** What the placeholder reads from the delegation's list row, when this desktop has it. */
export type PlaceholderAsk = Pick<AskSummary, "title" | "requester" | "target" | "targetName" | "attempt">;

const RESULT_KIND = { delegationResult: "answer", delegationQuestion: "question", delegationStatus: "state" } as const;

/** The event body's `source.kind` the native item would carry for this sender. */
function sourceKindOf(kind: InputSenderKind): string {
  return kind === "agent" || kind === "peer" || kind === "owner" ? kind : "service";
}

/** The sender's id as the native event names it (an agent by its cutex session id). */
const senderIdOf = (record: InputRecord) => record.sender.cutexSessionId ?? record.sender.id;

/** The message the record's native external_event will carry, as far as the record (and the ask) tell. */
export function placeholderMessage(record: InputRecord, ask?: PlaceholderAsk | null): ExternalMessage {
  const senderId = senderIdOf(record);
  const preview = record.preview ?? "";
  const base = { senderId, senderName: record.sender.name || senderId, deliveryMode: record.intent?.deliveryMode ?? null, text: preview, eventType: null, sourceKind: sourceKindOf(record.sender.kind) };
  const peer = record.sender.kind === "peer";
  const resultKind = record.kind in RESULT_KIND ? RESULT_KIND[record.kind as keyof typeof RESULT_KIND] : null;
  if (record.askId && resultKind) {
    // Requester side: the sender is the delegation's target (cutex sends its result on the target's behalf).
    // A peer's session id is the remote one: never offered as a local agent (no avatar lookup / link), name only.
    const target = { id: ask?.target || (peer ? null : senderId), name: ask?.targetName ?? record.sender.name ?? null };
    return { ...base, schema: "cutex.delegation-results.v1", data: { items: [{ kind: resultKind, askId: record.askId, title: ask?.title ?? "", target, preview: preview || null }] } };
  }
  if (record.askId && record.kind === "delegationRequest") {
    const requester: AskRequester = ask?.requester ?? (record.sender.kind === "owner" ? { kind: "owner" }
      // peers-v2: keep the paired host's requester a peer (PeerParty, no local jump), as the native row does.
      : peer ? { kind: "peer", peerId: record.sender.host ?? record.sender.id, cutexSessionId: senderId, name: record.sender.name, label: record.sender.host ?? record.sender.id }
      : { kind: "agent", cutexSessionId: senderId, name: record.sender.name });
    // The record's preview of an ASK is its title (cutex inputRecord preview).
    return { ...base, schema: "cutex.delegation-ask.v1", data: { askId: record.askId, attempt: ask?.attempt?.n ?? 1, requester, title: ask?.title || preview } };
  }
  return { ...base, schema: null, data: { senderId, senderName: base.senderName, ...(base.deliveryMode ? { deliveryMode: base.deliveryMode } : {}) } };
}
