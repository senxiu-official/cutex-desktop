import { describe, expect, it } from "vitest";
import type { TimelineEntry, TimelineState } from "../src/renderer/src/lib/timeline";
import { nextProgressAt, SILENT_GAP_MS, silentGapSeconds, turnProgressMark } from "../src/renderer/src/lib/silentGap";

const agent = (id: string, text: string, streaming = false): TimelineEntry => ({ kind: "agent", id, text, turnId: "t1", streaming });
const tool = (id: string, status: string): TimelineEntry => ({ kind: "tool", id, turnId: "t1", item: { id, type: "fileChange", status } as never });
const user = (id: string): TimelineEntry => ({ kind: "user", id, text: "hi", turnId: "t1" });

function timeline(entries: TimelineEntry[], active = true): Pick<TimelineState, "activeTurnId" | "turns" | "entries"> {
  return {
    activeTurnId: active ? "t1" : null,
    turns: [{ id: "t1", status: active ? "inProgress" : "completed", startedAt: 1, completedAt: null, entryIds: entries.map((e) => e.id) }],
    entries: new Map(entries.map((e) => [e.id, e])),
  };
}

describe("turnProgressMark", () => {
  it("is null without a running turn", () => {
    expect(turnProgressMark(timeline([user("u")], false))).toBeNull();
  });

  it("changes on a new entry, a delta, the end of streaming and a tool status", () => {
    const marks = [
      turnProgressMark(timeline([user("u")])),
      turnProgressMark(timeline([user("u"), agent("a", "He", true)])),
      turnProgressMark(timeline([user("u"), agent("a", "Hello", true)])),
      turnProgressMark(timeline([user("u"), agent("a", "Hello", false)])),
      turnProgressMark(timeline([user("u"), agent("a", "Hello"), tool("p", "inProgress")])),
      turnProgressMark(timeline([user("u"), agent("a", "Hello"), tool("p", "completed")])),
    ];
    expect(new Set(marks).size).toBe(marks.length);
  });

  it("is stable while nothing arrives", () => {
    const entries = [user("u"), agent("a", "Hello")];
    expect(turnProgressMark(timeline(entries))).toBe(turnProgressMark(timeline([...entries])));
  });
});

describe("nextProgressAt", () => {
  it("keeps the time while the mark is unchanged and restarts on change", () => {
    const first = nextProgressAt(null, "m1", 1000);
    expect(first).toEqual({ mark: "m1", at: 1000 });
    expect(nextProgressAt(first, "m1", 9000)).toBe(first);
    expect(nextProgressAt(first, "m2", 9000)).toEqual({ mark: "m2", at: 9000 });
  });
});

describe("silentGapSeconds", () => {
  it("shows nothing before the threshold", () => {
    expect(silentGapSeconds("working", 0, SILENT_GAP_MS - 1)).toBeNull();
  });

  it("counts whole seconds of silence once the threshold is reached", () => {
    expect(silentGapSeconds("working", 0, SILENT_GAP_MS)).toBe(3);
    expect(silentGapSeconds("working", 1000, 12_900)).toBe(11);
  });

  it("only applies when nothing else explains the wait", () => {
    for (const activity of ["command", "editing", "reasoning", "replying", "approval", "question", "tool", null]) {
      expect(silentGapSeconds(activity, 0, 60_000)).toBeNull();
    }
    expect(silentGapSeconds("working", null, 60_000)).toBeNull();
  });
});
