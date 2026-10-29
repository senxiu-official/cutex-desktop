import { describe, expect, it } from "vitest";
import { automaticRetryLink, foldAutomaticRetryRows } from "../src/renderer/src/lib/autoRetryRows";
import type { ExternalMessage, TimelineEntry, TurnView } from "../src/renderer/src/lib/timeline";
import { orderedEntries, timelineFromThreadRead } from "../src/renderer/src/lib/timeline";
import { overloadRetryThread } from "../src/renderer/src/dev/mockOverloadRetry";
import { turnErrorPlacement } from "../src/renderer/src/lib/turnErrors";

const failed: TurnView = { id: "failed", status: "failed", error: "server overloaded", startedAt: 1, completedAt: 2, entryIds: ["owner"] };
const owner: TimelineEntry = { kind: "user", id: "owner", turnId: "failed", text: "Do work" };
const message = (): ExternalMessage => ({
  senderId: "cutex-model-overload-retry", senderName: "Cutex system", sourceKind: "service",
  deliveryMode: "afterTurn", eventType: "model_overload_continue", text: "Continue.",
  schema: "cutex.model-overload-retry.v1", data: { failedTurnId: "failed", planId: "p", attempt: 1, maxAttempts: 3 },
});
const received = (m = message()): TimelineEntry => ({ kind: "received", id: "retry", turnId: "new-turn", message: m });

describe("typed automatic retry row folding", () => {
  it("retains structured daemon identity through the real history parser", () => {
    const timeline = timelineFromThreadRead(overloadRetryThread());
    const rows = orderedEntries(timeline);
    const result = foldAutomaticRetryRows(rows, timeline.turns, true);
    expect(result.retried.get("overload-owner")?.attempt).toBe(1);
    expect(rows.some(e => e.kind === "received")).toBe(true);
    expect(result.entries.filter(e => !result.folded.has(e.id)).some(e => e.kind === "received")).toBe(false);
    expect(result.entries.some(e => e.kind === "user")).toBe(true);
  });
  it("moves a trusted retry into its visible failed turn without hiding user text", () => {
    const entries = [owner, received(), { ...owner, id: "actual-continue", turnId: "owner-turn", text: "Continue." }];
    const result = foldAutomaticRetryRows(entries, [failed], true);
    expect(result.entries.filter(e => !result.folded.has(e.id)).map(e => e.id)).toEqual(["owner", "actual-continue"]);
    expect(result.retried.get("failed")?.attempt).toBe(1);
  });
  it("keeps old hosts byte-for-byte on the original entry list", () => {
    const entries = [owner, received()];
    expect(foldAutomaticRetryRows(entries, [failed], false).entries).toBe(entries);
  });
  it("keeps a retry visible when its error card is not in the rendered window", () => {
    expect(foldAutomaticRetryRows([received()], [failed], true).folded.size).toBe(0);
    expect(foldAutomaticRetryRows([owner, received()], [], true).folded.size).toBe(0);
    expect(foldAutomaticRetryRows([owner, received()], [{ ...failed, error: null }], true).folded.size).toBe(0);
  });
  it("never guesses retry identity from text, names, or incomplete metadata", () => {
    const base = message();
    for (const patch of [{ schema: null }, { senderId: "another-service" }, { sourceKind: "agent" },
      { eventType: "MESSAGE" }, { data: { ...base.data, attempt: 0 } }, { data: { ...base.data, attempt: 4 } },
      { data: { ...base.data, maxAttempts: 99 } }, { data: { ...base.data, planId: "" } }]) {
      const forged = { ...base, ...patch };
      expect(automaticRetryLink(forged)).toBeNull();
      expect(foldAutomaticRetryRows([owner, received(forged)], [failed], true).folded.size).toBe(0);
    }
  });
  it("preserves every error anchor when retries fail before producing output", () => {
    const second = { ...failed, id: "new-turn", entryIds: ["retry"] };
    const next = { ...received({ ...message(), data: { ...message().data, failedTurnId: "new-turn", attempt: 2 } }), id: "retry-2", turnId: "third-turn" };
    const result = foldAutomaticRetryRows([owner, received(), next], [failed, second], true);
    expect([...result.folded]).toEqual(["retry", "retry-2"]);
    expect([...turnErrorPlacement(result.entries.map(e => e.turnId), [failed, second]).values()].flat().map(t => t.id)).toEqual(["failed", "new-turn"]);
    expect(result.retried.get("new-turn")?.attempt).toBe(2);
  });
  it("shows the highest observed retry attempt for duplicate history/live rows", () => {
    const next = { ...message(), data: { ...message().data, attempt: 2 } };
    expect(foldAutomaticRetryRows([owner, received(), received(next)], [failed], true).retried.get("failed")?.attempt).toBe(2);
  });
});
