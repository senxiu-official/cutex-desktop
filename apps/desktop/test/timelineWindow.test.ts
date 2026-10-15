import { describe, expect, it } from "vitest";
import { recentEntries } from "../src/renderer/src/lib/timelineWindow";
import type { TimelineEntry, TurnView } from "../src/renderer/src/lib/timeline";

const turns = ["t1", "t2", "t3", "t4"].map((id) => ({ id }) as TurnView);
const entries = [
  { kind: "user", id: "u1", turnId: "t1", text: "a" },
  { kind: "agent", id: "a1", turnId: "t1", text: "b", streaming: false },
  { kind: "user", id: "u2", turnId: "t2", text: "c" },
  { kind: "user", id: "u3", turnId: "t3", text: "d" },
  { kind: "agent", id: "a3", turnId: "t3", text: "e", streaming: false },
  { kind: "user", id: "u4", turnId: "t4", text: "f" },
] as unknown as TimelineEntry[];

describe("recentEntries", () => {
  it("keeps everything when the history is short or the limit is off", () => {
    expect(recentEntries(entries, turns, 4)).toEqual({ entries, hiddenTurns: 0 });
    expect(recentEntries(entries, turns, 0)).toEqual({ entries, hiddenTurns: 0 });
  });

  it("starts at the first entry of the oldest kept turn", () => {
    const r = recentEntries(entries, turns, 2);
    expect(r.hiddenTurns).toBe(2);
    expect(r.entries.map((e) => e.id)).toEqual(["u3", "a3", "u4"]);
  });
});
