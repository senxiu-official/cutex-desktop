// 工作区 = 组 (docs/design/039-workspace-groups.md): the remembered workspaces (lib/workspaceSets) and the layout change
// that shows one (lib/paneLayout showAgentsLayout).
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
import { conversationPanes, defaultLayout, openBeside, paneBinding, setAllowThreeColumns, showAgentsLayout, type PaneLayout } from "../src/renderer/src/lib/paneLayout";
import { observe, readSets, setOf, setsFromOpen, splitOut, trimSets, withoutMember, type AgentId, type WsSet } from "../src/renderer/src/lib/workspaceSets";

const a = (sessionId: string): AgentId => ({ hostId: "local", sessionId });
const ids = (n = 0) => () => `s${n++}`;
const members = (sets: readonly WsSet[]) => sets.map((s) => s.members.map((m) => m.sessionId).join("+"));

describe("observe: the agents on screen are one workspace; the others stay as they were", () => {
  it("a first workspace is created; the same one again is touched, not duplicated", () => {
    let sets = observe([], [a("A"), a("B")], 10, ids());
    expect(members(sets)).toEqual(["A+B"]);
    sets = observe(sets, [a("B"), a("A")], 20, ids());
    expect(sets).toHaveLength(1);
    expect(sets[0]).toMatchObject({ at: 20, members: [a("B"), a("A")] });
  });

  it("a full switch (A+B → C): A+B stays whole, C is a new workspace; back to A: A+B again", () => {
    let sets = observe([], [a("A"), a("B")], 10, ids());
    sets = observe(sets, [a("C")], 20, ids(5));
    expect(members(sets).sort()).toEqual(["A+B", "C"]);
    sets = observe(sets, [a("A"), a("B")], 30, ids(9));
    expect(members(sets).sort()).toEqual(["A+B", "C"]);
    expect(setOf(sets, a("A"))!.at).toBe(30);
  });

  it("a replaced column (A+B → A+C): B is left on its own, A is in the new workspace A+C", () => {
    let sets = observe([], [a("A"), a("B")], 10, ids());
    sets = observe(sets, [a("A"), a("C")], 20, ids(5));
    expect(members(sets).sort()).toEqual(["A+C", "B"]);
  });

  it("an agent belongs to one workspace: C added to A+B's column row leaves its old one", () => {
    let sets = observe([], [a("C"), a("D")], 5, ids());
    sets = observe(sets, [a("A"), a("B")], 10, ids(5));
    sets = observe(sets, [a("A"), a("C")], 20, ids(9));
    expect(members(sets).sort()).toEqual(["A+C", "B", "D"]);
  });

  it("nothing on screen changes nothing", () => {
    const sets = observe([], [a("A")], 10, ids());
    expect(observe(sets, [], 20)).toBe(sets);
  });
});

describe("the tray's recents", () => {
  const sets: WsSet[] = ["A", "B", "C", "D", "E", "F", "G", "H"].map((x, i) => ({ id: x, members: [a(x)], at: i }));

  it("at most 6, newest first, the oldest drop", () => {
    expect(trimSets(sets, () => false).map((s) => s.id)).toEqual(["H", "G", "F", "E", "D", "C"]);
  });

  it("a pinned workspace does not count, and the one on screen never drops", () => {
    const keep = trimSets(sets, (x) => x.sessionId === "A", [a("B")]).map((s) => s.id);
    expect(keep).toContain("A");
    expect(keep).toContain("B");
    expect(keep).toHaveLength(7);
  });

  it("splitting one out leaves it a workspace of its own; removing a member drops an emptied set", () => {
    const ab = observe([], [a("A"), a("B")], 10, ids());
    expect(members(splitOut(ab, a("B"), 20, ids(5))).sort()).toEqual(["A", "B"]);
    expect(splitOut(observe([], [a("A")], 1, ids()), a("A"), 2)).toHaveLength(1);
    expect(withoutMember(ab, a("A")).map((s) => s.members.length)).toEqual([1]);
    expect(withoutMember(withoutMember(ab, a("A")), a("B"))).toEqual([]);
  });
});

describe("stored sets", () => {
  it("malformed entries are dropped and an agent is in one set only", () => {
    const read = readSets({ sets: [{ id: "x", members: [{ hostId: "local", sessionId: "A" }, { hostId: "local", sessionId: "A" }, { nope: 1 }], at: 5 }, { id: "y", members: [{ hostId: "local", sessionId: "A" }], at: 1 }, { id: "", members: [] }, 3] });
    expect(read.map((s) => [s.id, s.members.length])).toEqual([["x", 1]]);
    expect(readSets(null)).toEqual([]);
  });

  it("the old 「打开着」 list becomes single-agent workspaces", () => {
    expect(setsFromOpen([{ hostId: "local", sessionId: "A", at: 3 }], ids()).map((s) => [s.id, s.at, s.members[0]!.sessionId])).toEqual([["s0", 3, "A"]]);
  });
});

describe("showAgentsLayout: the columns show a workspace", () => {
  const base = (sessionId: string): PaneLayout => defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId });
  const shown = (l: PaneLayout) => conversationPanes(l).map((id) => paneBinding(l, id)?.sessionId);
  const ab = openBeside(base("A"), a("B"), 10);

  it("A+B on screen → C: one column shows C (A+B leave together)", () => {
    expect(shown(showAgentsLayout(ab, [a("C")], a("C"), 20))).toEqual(["C"]);
  });

  it("C → A+B: a column is added; the columns that already show a member stay", () => {
    const c = base("C");
    expect(shown(showAgentsLayout(c, [a("A"), a("B")], a("A"), 20))).toEqual(["A", "B"]);
    // B kept in its column, the other one rebound to A, A first.
    const bc = openBeside(base("B"), a("C"), 10);
    expect(shown(showAgentsLayout(bc, [a("A"), a("B")], a("B"), 20))).toEqual(["A", "B"]);
  });

  it("the focus goes to the agent clicked; two agents are never shown twice", () => {
    const l = showAgentsLayout(ab, [a("B"), a("A")], a("A"), 20);
    expect(shown(l)).toEqual(["B", "A"]);
    expect(paneBinding(l, l.focus!)?.sessionId).toBe("A");
  });

  it("at most two columns unless 「允许 3 个工作区」 is on; no room: only the focused agent", () => {
    expect(shown(showAgentsLayout(base("A"), [a("A"), a("B"), a("C")], a("A"), 20))).toEqual(["A", "B"]);
    setAllowThreeColumns(true);
    try {
      expect(shown(showAgentsLayout(base("A"), [a("A"), a("B"), a("C")], a("A"), 20))).toEqual(["A", "B", "C"]);
    } finally {
      setAllowThreeColumns(false);
    }
    expect(shown(showAgentsLayout(ab, [a("A"), a("B")], a("B"), 20, false))).toEqual(["A"]);
  });
});
