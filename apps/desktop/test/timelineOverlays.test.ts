// UI review 2026-10-15 #1 / #2: what stays floating over the timeline reserves its band only where it
// crosses the column; the queue card starts compact (count chips) with several kinds or a short window.
import { describe, expect, it } from "vitest";
import { bandPadding, reservedBands } from "../src/renderer/src/lib/timelineReserve";
import { autoCompact, mergeChips, queueChips } from "../src/renderer/src/lib/queueChips";

const scroller = { left: 0, top: 50, right: 1000, bottom: 650 };
const column = { left: 140, top: 50, right: 860, bottom: 2000 };

describe("reservedBands", () => {
  it("reserves the band of a box over the column, by the nearer edge", () => {
    expect(reservedBands(scroller, column, [{ left: 800, top: 58, right: 990, bottom: 90 }])).toEqual({ top: 40, bottom: 0 });
    expect(reservedBands(scroller, column, [{ left: 800, top: 600, right: 990, bottom: 640 }])).toEqual({ top: 0, bottom: 50 });
  });
  it("ignores boxes beside the column or outside the viewport", () => {
    expect(reservedBands(scroller, column, [{ left: 870, top: 58, right: 990, bottom: 300 }, { left: 0, top: 0, right: 130, bottom: 40 }])).toEqual({ top: 0, bottom: 0 });
  });
  it("pads by the band plus a gap, defaults otherwise", () => {
    expect(bandPadding({ top: 0, bottom: 0 })).toEqual({ top: 16, bottom: 32 });
    expect(bandPadding({ top: 40, bottom: 50 })).toEqual({ top: 48, bottom: 62 });
  });
});

describe("queue chips", () => {
  const at = "2026-10-15T00:00:00Z";
  it("counts kinds in reading order; ride-alongs by delivery kind", () => {
    const chips = queueChips({ queued: 2, inserting: 0, paused: 0, asks: 1, nextStep: [
      { id: "a", deliveryKind: "tell", enqueuedAt: at },
      { id: "b", deliveryKind: "answer", enqueuedAt: at },
      { id: "c", deliveryKind: "alarm", enqueuedAt: at },
    ] });
    expect(chips).toEqual([{ kind: "queued", n: 2 }, { kind: "messages", n: 1 }, { kind: "delegations", n: 2 }, { kind: "alarms", n: 1 }]);
  });
  it("merges the same kind from an extra section", () => {
    expect(mergeChips([{ kind: "delegations", n: 2 }, { kind: "delegations", n: 1 }, { kind: "quota", warn: true }])).toEqual([{ kind: "delegations", n: 3 }, { kind: "quota", warn: true }]);
  });
  it("starts compact with several kinds, or a short window and more than one row", () => {
    expect(autoCompact([{ kind: "queued", n: 3 }], 3, false)).toBe(false);
    expect(autoCompact([{ kind: "queued", n: 3 }], 3, true)).toBe(true);
    expect(autoCompact([{ kind: "queued", n: 1 }], 1, true)).toBe(false);
    expect(autoCompact([{ kind: "queued", n: 1 }, { kind: "messages", n: 1 }], 2, false)).toBe(true);
  });
});
