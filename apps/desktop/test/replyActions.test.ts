import { describe, expect, it } from "vitest";
import { replyBars, turnsFrom } from "../src/renderer/src/lib/replyActions";
import type { TimelineEntry, TurnView } from "../src/renderer/src/lib/timeline";

const turn = (id: string, status: TurnView["status"] = "completed"): TurnView => ({ id, status, startedAt: 1, completedAt: 2, entryIds: [] });
const agent = (id: string, turnId: string, text = id, streaming = false): TimelineEntry => ({ kind: "agent", id, turnId, text, streaming });
const user = (id: string, turnId: string): TimelineEntry => ({ kind: "user", id, turnId, text: id });

describe("replyBars", () => {
  it("one row per finished turn, on its last agent message", () => {
    const turns = [turn("t1"), turn("t2"), turn("t3")];
    const entries = [user("u1", "t1"), agent("a1", "t1"), agent("a1b", "t1", "final 1"), user("u2", "t2"), agent("a2", "t2"), user("u3", "t3"), agent("a3", "t3")];
    const bars = replyBars(turns, entries);
    expect([...bars.keys()]).toEqual(["a1b", "a2", "a3"]);
    expect(bars.get("a1b")).toEqual({ turnId: "t1", text: "final 1", nextTurnId: "t2", laterTurns: 2, latest: false });
    expect(bars.get("a3")).toMatchObject({ nextTurnId: null, laterTurns: 0, latest: true });
  });
  it("skips running turns and streaming messages; latest = newest finished reply", () => {
    const turns = [turn("t1"), turn("t2", "inProgress")];
    const bars = replyBars(turns, [agent("a1", "t1"), agent("a2", "t2", "partial", true)]);
    expect([...bars.keys()]).toEqual(["a1"]);
    expect(bars.get("a1")).toMatchObject({ latest: true, nextTurnId: "t2", laterTurns: 1 });
  });
  it("turns without an agent reply get no row (and don't steal latest)", () => {
    const bars = replyBars([turn("t1"), turn("t2", "interrupted")], [agent("a1", "t1"), user("u2", "t2")]);
    expect([...bars.keys()]).toEqual(["a1"]);
    expect(bars.get("a1")!.latest).toBe(true);
  });
});

describe("turnsFrom", () => {
  it("counts the turn and every later one", () => {
    const turns = [turn("t1"), turn("t2"), turn("t3")];
    expect(turnsFrom(turns, "t2")).toBe(2);
    expect(turnsFrom(turns, "nope")).toBe(0);
  });
});
