// ?inputLedger&noteDelivery: SYNTHETIC agent-note delivery rows (cutex fix/nextup-delivery shapes; handoff
// docs/next-up-delivery-ui-handoff.md) laid over the captured ledger scene, for the 接下来 hover / details lines and
// 允许发送's pause-only effect. Never captured evidence: every row says so in `details.fixture`.
import type { InputRecord } from "@cutex-desktop/protocol";

export const NOTE_DELIVERY_SCENE = typeof location !== "undefined" && new URLSearchParams(location.search).has("noteDelivery");
export const NOTE_DELIVERY_FEATURES = ["agent-bus-read-notes-v1", "pre-turn-passive-notes-v1", "passive-note-diagnostics-v1", "owner-carries-v1"] as const;
const FIXTURE = "SYNTHETIC preview row (dev/mockNoteDelivery): cutex fix/nextup-delivery 790bce4a shapes, not a capture";

/** The synthetic note rows of session `id` (times relative to `now`). */
export function noteDeliveryRecords(id: string, now: number, revision: number): InputRecord[] {
  const iso = (ago: number) => new Date(now - ago).toISOString();
  const alice = { kind: "agent" as const, id: "note-sender", name: "note-sender", host: null, cutexSessionId: null };
  const base = (inputId: string, patch: Partial<InputRecord>): InputRecord => ({
    inputId, cutexSessionId: id, kind: "agentMessage", sender: alice, intent: { strategy: null, deliveryMode: "passive", timing: "passive" },
    preview: inputId, createdAt: iso(60_000), state: "waiting", reason: "passive", since: iso(60_000), deadline: null, stage: null, surface: "pendingNotes",
    order: null, turnId: null, timelineItemId: null, runtimeGeneration: 1, attempt: 1, supersededBy: null, batchId: null, askId: null, remote: null,
    stalled: null, actions: ["dismiss"], error: null, evidence: null, rev: 1, stateRevision: revision, updatedAt: iso(30_000),
    ...patch, details: { fixture: FIXTURE, ...patch.details },
  });
  return [
    // An idle agent reads it at its next turn: normal, said calmly.
    base("note-next-turn", { preview: "review queue is clear; nothing waits for you", createdAt: iso(25 * 60_000), since: iso(25 * 60_000),
      details: { deliveryDiagnostics: { stage: "inbox", since: iso(24 * 60_000), sinceEvidence: "firstRecordedNativeEvidence", lastAttemptAt: null, lastAttemptKind: null, lastError: null, waitingFor: "nextTurn", blockedByInputId: null } } }),
    // Waits behind an earlier note of the same sender whose projection failed.
    base("note-blocker", { preview: "feat/mobile-approvals 52af1b280 merged to main", surface: "nextUp", reason: "passive", createdAt: iso(50 * 60_000), since: iso(50 * 60_000),
      stalled: { reason: "noProgress", since: iso(48 * 60_000) },
      details: { projectionFailure: { code: "external_projection_failed", message: "attachment could not be read", retryable: true, attempts: 2, since: iso(48 * 60_000), lastAttemptAt: iso(6 * 60_000) },
        deliveryDiagnostics: { stage: "bus", since: iso(50 * 60_000), sinceEvidence: "durableQueue", lastAttemptAt: iso(6 * 60_000), lastAttemptKind: "preTurnAdmission", lastError: "attachment could not be read", waitingFor: "projection", blockedByInputId: null } } }),
    base("note-behind", { preview: "and please rebase before the next kit", surface: "nextUp", createdAt: iso(40 * 60_000), since: iso(40 * 60_000),
      details: { blockedByInputId: "note-blocker", projectionFailure: { code: "external_projection_blocked", blockedByInputId: "note-blocker", message: "an earlier input of this sender is blocked", retryable: true, attempts: 0, since: iso(40 * 60_000), lastObservedAt: iso(60_000) },
        deliveryDiagnostics: { stage: "bus", since: iso(40 * 60_000), sinceEvidence: "durableQueue", lastAttemptAt: null, lastAttemptKind: null, lastError: null, waitingFor: "earlierInput", blockedByInputId: "note-blocker" } } }),
    // Paused by the owner and held at an old boundary: 允许发送 lifts the pause only.
    base("note-paused-stale", { preview: "weekly ops summary", surface: "nextUp", reason: "staleHeld", actions: ["releaseHold", "dismiss"], createdAt: iso(3 * 3600_000), since: iso(3 * 3600_000),
      details: { staleReleaseAllowed: true, ownerHold: true, releaseEffect: "removeOwnerPauseOnly",
        deliveryDiagnostics: { stage: "bus", since: iso(3 * 3600_000), sinceEvidence: "durableQueue", lastAttemptAt: null, lastAttemptKind: null, lastError: null, waitingFor: "ownerResume", blockedByInputId: null } } }),
    // Owner 2026-11-23 (delegation-347359): a note the turn already read (its body is the x31v2 row of turn-3 in eva's
    // history) whose receipt has not come yet and whose record went stale — the history row must show no 已等 / 放弃.
    ...(id === "eva" ? [base("note-in-history", { preview: "release notes 草稿放在 docs/release-notes.md 了", surface: "timeline", state: "accepted", reason: null,
      turnId: "turn-3", timelineItemId: "x31v2", createdAt: iso(176 * 60_000), since: iso(174 * 60_000), stalled: { reason: "noProgress", since: iso(174 * 60_000) }, actions: ["dismiss", "retry"] })] : []),
  ];
}
