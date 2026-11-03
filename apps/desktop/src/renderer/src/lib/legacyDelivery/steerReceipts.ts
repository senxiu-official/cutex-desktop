// LEGACY(input-ledger-v1): frozen delivery inference for older hosts.
// Delete only when EVERY host advertises input-ledger-v1 (including hachimi).
import type { EventEnvelope } from "@cutex-desktop/protocol";
import type { TimelineState } from "../timeline";

export type SteerStage = "registered" | "offered" | "contextPersisted";
export interface SteerReceipt { turnId: string; stage: SteerStage }
const rank: Record<SteerStage, number> = { registered: 0, offered: 1, contextPersisted: 2 };

/** Runtime receipts are separate from transcript visibility. Offered is NOT persisted. */
export function applySteerReceipt(timeline: TimelineState, event: EventEnvelope): boolean {
  const message = event.native?.message;
  if (event.native?.kind !== "notification" || !message ||
      !["claude/input/stageChanged", "claude/input/contextPersisted"].includes(message.method)) return false;
  const p = message.params as { threadId?: unknown; turnId?: unknown; clientId?: unknown; stage?: unknown } | undefined;
  if (!p || p.threadId !== timeline.threadId || typeof p.clientId !== "string" || !p.clientId.trim() ||
      typeof p.turnId !== "string" || !p.turnId.trim()) return false;
  const stage = message.method === "claude/input/contextPersisted" ? "contextPersisted" : p.stage;
  if (stage !== "registered" && stage !== "offered" && stage !== "contextPersisted") return false;
  const before = timeline.steerReceipts?.get(p.clientId);
  // Unread inputs can carry to a later turn; progress must still be monotonic.
  if (before && rank[before.stage] >= rank[stage]) return false;
  timeline.steerReceipts = new Map(timeline.steerReceipts).set(p.clientId, { turnId: p.turnId, stage });
  return true;
}
