// Two inserts in a row (owner, remote 2026-10-26): the Claude runtime read both at one tool boundary and history
// shows them as one user message holding both lines, under an id that is neither insert's. Both stayed
// 「已插入当前回合」: delivery was matched only by each insert's own id or its whole text. A message of their turn
// that holds two or more of them, in the order sent, now records them all. Replays events through the real reducer.
import { describe, expect, it } from "vitest";
import { applyEvent, emptyTimeline, type TimelineState } from "../src/renderer/src/lib/timeline";
import { newPendingSteer, recordedSteers, settlePendingSteers } from "../src/renderer/src/lib/pendingSteers";

const native = (method: string, params: Record<string, unknown>) => ({ native: { kind: "notification", message: { method, params: { threadId: "t", ...params } } } }) as never;
const started = (s: TimelineState, id: string) => applyEvent(s, native("turn/started", { turn: { id, status: "inProgress", items: [], startedAt: 1 } }));
const user = (s: TimelineState, turnId: string, id: string, text: string, clientId?: string) =>
  applyEvent(s, native("item/completed", { turnId, item: { type: "userMessage", id, ...(clientId ? { clientId } : {}), content: [{ type: "text", text, text_elements: [] }] } }));

function busyTurn() {
  const s = emptyTimeline();
  started(s, "T1");
  user(s, "T1", "u-prompt", "整理一下第二节", "c-prompt");
  return s;
}

describe("merged steers", () => {
  it("one history message holding both inserts (no clientId) records both; the turn keeps running", () => {
    const s = busyTurn();
    const steers = [newPendingSteer(s, "c-1", "先别改图", 0, "T1"), newPendingSteer(s, "c-2", "表 2 也要更新", 0, "T1")];
    user(s, "T1", "u-merged", "先别改图\n表 2 也要更新");
    expect([...recordedSteers(steers, s)].sort()).toEqual(["c-1", "c-2"]);
    expect(settlePendingSteers(steers, s).pending).toEqual([]);
  });

  it("a foreign id, blank lines and a runtime frame between them still match", () => {
    const s = busyTurn();
    const steers = [newPendingSteer(s, "c-1", "first  line", 0, "T1"), newPendingSteer(s, "c-2", "second", 0, "T1")];
    user(s, "T1", "steer-x", "The user sent this message while you were working:\nfirst line\n\n\nThe user sent this message while you were working:\nsecond", "runtime-merged-1");
    expect([...recordedSteers(steers, s)].sort()).toEqual(["c-1", "c-2"]);
  });

  it("three inserts: the merged message holds the first two, the third arrives on its own", () => {
    const s = busyTurn();
    const steers = ["a", "b", "c"].map((x) => newPendingSteer(s, `c-${x}`, `msg ${x}`, 0, "T1"));
    user(s, "T1", "u-ab", "msg a\nmsg b");
    expect([...recordedSteers(steers, s)].sort()).toEqual(["c-a", "c-b"]);
    user(s, "T1", "u-c", "msg c", "c-c");
    expect([...recordedSteers(steers, s)].sort()).toEqual(["c-a", "c-b", "c-c"]);
  });

  it("order matters, and one insert inside a longer message is not enough", () => {
    const s = busyTurn();
    const steers = [newPendingSteer(s, "c-1", "alpha", 0, "T1"), newPendingSteer(s, "c-2", "beta", 0, "T1")];
    user(s, "T1", "u-rev", "beta then alpha");
    expect([...recordedSteers(steers, s)]).toEqual([]);
    user(s, "T1", "u-one", "something about alpha only");
    expect([...recordedSteers(steers, s)]).toEqual([]);
  });

  it("a message already in the turn when they were sent never counts (the prompt that quoted both)", () => {
    const s = emptyTimeline();
    started(s, "T1");
    user(s, "T1", "u-prompt", "reply ok or yes");
    const steers = [newPendingSteer(s, "c-1", "ok", 0, "T1"), newPendingSteer(s, "c-2", "yes", 0, "T1")];
    expect([...recordedSteers(steers, s)]).toEqual([]);
  });

  it("another turn's message does not record them", () => {
    const s = busyTurn();
    const steers = [newPendingSteer(s, "c-1", "x1", 0, "T1"), newPendingSteer(s, "c-2", "x2", 0, "T1")];
    started(s, "T2");
    user(s, "T2", "u-other", "x1 x2");
    expect([...recordedSteers(steers, s)]).toEqual([]);
  });
});
