// The width-drag trace's rule (lib/dragTrace dragSuspects, delegation d17283): the same as the browser fuzz — only the
// two panels beside the edge change width (rails between them only slide), and the release keeps every edge.
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));

import { dragSuspects, type TraceFrame } from "../src/renderer/src/lib/dragTrace";

const row = (...xs: [string, number, number][]) => xs.map(([tag, l, r]) => ({ tag, l, r }));
const frame = (phase: TraceFrame["phase"], t: number, panels: TraceFrame["panels"]): TraceFrame => ({ phase, t, panels });

describe("drag trace: what a drag changed beyond its edge", () => {
  const start = frame("start", 0, row(["sidebar", 8, 264], ["conv:main", 272, 1042], ["shelf:right", 1050, 1500]));

  it("the seam between the column and the Shelf: two panels beside each other — nothing to report", () => {
    const moved = row(["sidebar", 8, 264], ["conv:main", 272, 942], ["shelf:right", 950, 1500]);
    expect(dragSuspects([start, frame("move", 16, moved), frame("release", 300, moved), frame("settled", 1000, moved)])).toEqual([]);
  });

  it("the owner's case: the edge between A and B moved, C changed too", () => {
    const moved = row(["sidebar", 8, 300], ["conv:main", 308, 1042], ["shelf:right", 1050, 1450]);
    expect(dragSuspects([start, frame("move", 16, moved)])).toEqual(["move@16ms: sidebar 256→292, conv:main 770→734, shelf:right 450→400"]);
  });

  it("two panels that are not beside each other changed", () => {
    const moved = row(["sidebar", 8, 300], ["conv:main", 308, 1042], ["shelf:right", 1050, 1450]).map((p, i) => (i === 1 ? { ...p, l: 272 } : p));
    expect(dragSuspects([start, frame("move", 16, moved)])[0]).toMatch(/sidebar 256→292, shelf:right 450→400/);
  });

  it("a rail between two columns only slides with the edge", () => {
    const s = frame("start", 0, row(["conv:a", 272, 900], ["rail:a", 908, 948], ["conv:b", 956, 1544]));
    const m = frame("move", 16, row(["conv:a", 272, 800], ["rail:a", 808, 848], ["conv:b", 856, 1544]));
    expect(dragSuspects([s, m])).toEqual([]);
  });

  it("the release did not keep what the drag showed", () => {
    const moved = row(["sidebar", 8, 264], ["conv:main", 272, 942], ["shelf:right", 950, 1500]);
    const after = row(["sidebar", 8, 264], ["conv:main", 272, 942], ["shelf:right", 950, 1450]);
    expect(dragSuspects([start, frame("move", 16, moved), frame("settled", 1000, after)])).toContain("release moved shelf:right: 950–1500 → 950–1450");
  });
});
