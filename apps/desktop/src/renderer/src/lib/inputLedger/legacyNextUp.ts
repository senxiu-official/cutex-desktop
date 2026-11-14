// Next Up on a host without the input ledger (legacy path): its rows keep their old behaviour (queue items, steers,
// optimistic sends), but every status word and button word comes from the Next Up registry (registry 1.4 §六, review
// 2026-11-14 finding 8). This file only maps a legacy row to a registry state and effects; no new states or words.
import type { NextUpEffectId, NextUpStateId } from "./nextUpRegistry";

/** An optimistic send (lib/legacyDelivery/outbox OutboxEntry) as a registry state. */
export function legacyOutboxState(entry: { state: string; stage?: string; waitingForPrevious?: boolean }): NextUpStateId {
  if (entry.state === "failed") return "failed";
  if (entry.state === "held") return "queued";
  if (entry.state === "confirmed") return "awaitingRead";
  if (entry.state === "sending" && entry.waitingForPrevious) return "queued";
  return "sending";
}

/** A failed optimistic send's buttons: 重新发送 / 放回输入框 / 放弃 (registry state 13). */
export const LEGACY_FAILED_SEND_EFFECTS = ["retry", "moveToComposer", "dismiss"] as const satisfies readonly NextUpEffectId[];

/** A steer the native has not read yet: it goes in at the next read point (state 4); paused ones are state 7. */
export const legacySteerState = (paused: boolean): NextUpStateId => paused ? "paused" : "awaitingRead";

/** An owner queue item: queued; in a paused section paused; the first one while a turn runs waits for it (state 3). */
export function legacyItemState(item: { paused?: boolean; afterTurn?: boolean }): NextUpStateId {
  if (item.paused) return "paused";
  return item.afterTurn ? "afterWork" : "queued";
}
