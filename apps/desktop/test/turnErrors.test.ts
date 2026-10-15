import { describe, expect, it } from "vitest";
import type { EventEnvelope } from "@cutex-desktop/protocol";
import { applyEvent, orderedEntries, timelineFromThreadRead, turnErrorText } from "../src/renderer/src/lib/timeline";
import { turnErrorPlacement } from "../src/renderer/src/lib/turnErrors";

function native(method: string, params: unknown): EventEnvelope {
  return {
    contractVersion: 2, eventId: "e", cursor: "c", streamId: "s", sequence: 1, receivedAt: "",
    cutexSessionId: "me", hostId: "h", source: "app_server", sensitivity: "owner", correlation: {},
    native: { kind: "notification", message: { method, params } },
  };
}

// The Claude adapter's first turn of a new quick chat, 2026-10-11 14:39 (host-a, claude-r9): the
// official CLI could not refresh the OAuth token, the turn failed with only the user message.
const userItem = { type: "userMessage", id: "u1", clientId: "c1", content: [{ type: "text", text: "Hi, Claude", text_elements: [] }] };
const failedTurn = {
  id: "t1", status: "failed", startedAt: 100, completedAt: 127, items: [userItem], itemsView: "full",
  error: { message: "Official Claude OAuth refresh failed. Check the official CLI login/refresh state.", codexErrorInfo: "unauthorized", additionalDetails: null },
};

describe("failed turns", () => {
  it("keeps turn.error from turn/completed (live) so a failed first message is visible", () => {
    const state = timelineFromThreadRead({ thread: { id: "th", turns: [] } });
    applyEvent(state, native("turn/started", { threadId: "th", turn: { id: "t1", status: "inProgress", startedAt: 100, items: [] } }));
    applyEvent(state, native("item/completed", { threadId: "th", turnId: "t1", item: userItem }));
    applyEvent(state, native("turn/completed", { threadId: "th", turn: failedTurn }));
    expect(state.turns[0]).toMatchObject({ status: "failed", error: failedTurn.error.message });
    // Only the input row exists: the error must be placed after it, the header alone never shows.
    const segmentTurnIds = orderedEntries(state).map((entry) => entry.turnId);
    const placed = turnErrorPlacement(segmentTurnIds, state.turns);
    expect([...placed.entries()].map(([i, turns]) => [i, turns.map((t) => t.id)])).toEqual([[segmentTurnIds.length - 1, ["t1"]]]);
  });

  it("keeps turn.error from thread/read (reload)", () => {
    const state = timelineFromThreadRead({ thread: { id: "th", turns: [failedTurn, { id: "t2", status: "completed", items: [] }] } });
    expect(state.turns.map((t) => t.error ?? null)).toEqual([failedTurn.error.message, null]);
  });

  it("joins message and additionalDetails, ignores empty errors", () => {
    expect(turnErrorText({ message: "Usage limit", additionalDetails: "resets 15:00" })).toBe("Usage limit\nresets 15:00");
    expect(turnErrorText({ message: "same", additionalDetails: "same" })).toBe("same");
    expect(turnErrorText({ message: "" })).toBeNull();
    expect(turnErrorText(null)).toBeNull();
  });

  it("places each failed turn's error after its last segment only", () => {
    const turns = [
      { id: "a", status: "failed" as const, startedAt: 1, completedAt: 2, entryIds: [], error: "boom" },
      { id: "b", status: "completed" as const, startedAt: 3, completedAt: 4, entryIds: [] },
      { id: "c", status: "failed" as const, startedAt: 5, completedAt: 6, entryIds: [], error: null },
    ];
    const placed = turnErrorPlacement(["a", "a", null, "b", "c"], turns);
    expect([...placed.keys()]).toEqual([1]);
  });
});
