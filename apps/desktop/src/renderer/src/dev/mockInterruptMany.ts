// ?inputLedger&ledgerScene=turn&interruptMany: cutex interrupt-send-many-v1 (r292) plus three SYNTHETIC unread owner
// 插话 in the running turn, laid over the captured scene, so 打断并发送 shows "send these 3" and Esc (cli preset) takes
// all three. Never captured evidence: every row says so in `details.fixture`.
import type { InputRecord, SessionDelivery } from "@cutex-desktop/protocol";

export const INTERRUPT_MANY_SCENE = typeof location !== "undefined" && new URLSearchParams(location.search).has("interruptMany");
export const INTERRUPT_MANY_FEATURES = ["interrupt-send-many-v1"] as const;
const FIXTURE = "SYNTHETIC preview row (dev/mockInterruptMany): cutex fix/interrupt-send-many 0f8e76a8 shapes, not a capture";

/** Three unread 插话 of session `id` in its running turn (none without one). */
export function interruptManyRecords(id: string, delivery: SessionDelivery, now: number, revision: number): InputRecord[] {
  const turnId = delivery.turn?.turnId;
  if (!turnId) return [];
  const texts = ["also check the Windows build", "and keep the old flag for one release", "skip the docs for now"];
  // An earlier batch member the host definitely did not send (blocked; its Retry is offered).
  const blockedAt = new Date(now - 10 * 60_000).toISOString();
  const blocked = {
    inputId: "steer-many-blocked", cutexSessionId: id, kind: "owner", sender: { kind: "owner", id: "owner", name: "Owner", host: null, cutexSessionId: null }, intent: { strategy: "interrupt", deliveryMode: null, timing: "nextStep" },
    preview: "rerun the flaky test first", createdAt: blockedAt, state: "waiting", reason: "nativeHeld", since: blockedAt, deadline: null, stage: null, surface: "nextUp",
    order: null, turnId: null, timelineItemId: null, runtimeGeneration: delivery.runtimeGeneration, attempt: 1, supersededBy: null, batchId: null, askId: null,
    remote: null, stalled: null, actions: ["retry", "dismiss"], error: null, evidence: null, rev: 9, stateRevision: revision, updatedAt: blockedAt,
    details: { fixture: FIXTURE, nativeReason: "hook_blocked", interruptBatch: { attempt: 1, deferred: false, blocked: true, notSubmittedReason: "hook_blocked" } },
  } as InputRecord;
  return [blocked, ...texts.map((text, i) => {
    const at = new Date(now - (3 - i) * 40_000).toISOString();
    return {
      inputId: `steer-many-${i + 1}`, cutexSessionId: id, kind: "owner", sender: { kind: "owner", id: "owner", name: "Owner", host: null, cutexSessionId: null }, intent: { strategy: "auto", deliveryMode: null, timing: "nextStep" },
      preview: text, createdAt: at, state: "accepted", reason: null, since: at, deadline: null, stage: "offered", surface: "nextUp",
      order: null, turnId, timelineItemId: null, runtimeGeneration: delivery.runtimeGeneration, attempt: 1, supersededBy: null, batchId: null, askId: null,
      remote: null, stalled: null, actions: ["interruptSend", "dismiss"], error: null, evidence: null, rev: 2 + i, stateRevision: revision, updatedAt: at,
      details: { fixture: FIXTURE },
    } as InputRecord;
  })];
}
