// lib/paneLayout (docs/research/panes-20261019.md §1, §4; steps 1b, 2): the default layout, the shape
// validation of the layout JSON, the limit helpers (6 panes on screen, 3 per column, 8 chips) and the
// conversation pane ops of step 2 (open beside, replace, close, focus, resize, restore).
import { describe, expect, it } from "vitest";
import {
  activeInstance,
  AGENTS_KIND,
  bindPane,
  closePane,
  conversationPanes,
  dropGoneAgents,
  focusedConversation,
  focusPane,
  MAX_CONVERSATION_COLUMNS,
  MIN_COLUMN_SHARE,
  openBeside,
  paneBinding,
  paneShowing,
  resizeColumns,
  restoreLayout,
  showAgent,
  shownAgents,
  canAddChip,
  canShowPane,
  canSplitColumn,
  CONVERSATION_KIND,
  defaultLayout,
  MAIN_PANE,
  MAX_CHIPS,
  MAX_ROWS,
  MAX_VISIBLE_PANES,
  PANE_LAYOUT_VERSION,
  validateLayout,
  visiblePanes,
  type PaneLayout,
} from "../src/renderer/src/lib/paneLayout";

const base = () => defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "a1" });
const clone = (l: PaneLayout): PaneLayout => JSON.parse(JSON.stringify(l)) as PaneLayout;
const conv = (sessionId: string) => ({ kind: CONVERSATION_KIND, binding: { kind: "agent", hostId: "local", sessionId }, params: {}, state: null });

/** A layout of `rows[i]` panes in column i (pane / instance ids p0, p1, …), plus `chips` collapsed panes. */
function grid(rows: number[], chips = 0): PaneLayout {
  let n = 0;
  const l: PaneLayout = { ...base(), cols: [], panes: {}, instances: {}, chips: [], focus: null };
  const add = () => {
    const id = `p${n++}`;
    l.panes[id] = { tabs: [id], active: id, at: n };
    l.instances[id] = conv(id) as PaneLayout["instances"][string];
    return id;
  };
  for (const count of rows) l.cols.push({ w: 1 / rows.length, rows: Array.from({ length: count }, () => ({ pane: add(), h: 1 / count })) });
  for (let i = 0; i < chips; i++) l.chips.push(add());
  l.focus = l.cols[0]?.rows[0]?.pane ?? null;
  return l;
}

describe("default layout (step 1b: derived from today's state)", () => {
  it("is the agent list docked left and one column with the one conversation, focused", () => {
    const l = base();
    expect(l).toEqual({
      v: PANE_LAYOUT_VERSION,
      dock: { left: { kind: AGENTS_KIND, mode: "open", width: 256 } },
      cols: [{ w: 1, rows: [{ pane: MAIN_PANE, h: 1 }] }],
      panes: { [MAIN_PANE]: { tabs: [MAIN_PANE], active: MAIN_PANE, at: 0 } },
      instances: { [MAIN_PANE]: { kind: CONVERSATION_KIND, binding: { kind: "agent", hostId: "local", sessionId: "a1" }, params: {}, state: null } },
      chips: [],
      focus: MAIN_PANE,
      max: null,
    });
    expect(visiblePanes(l)).toEqual([MAIN_PANE]);
    expect(activeInstance(l, MAIN_PANE)?.instance.binding).toEqual({ kind: "agent", hostId: "local", sessionId: "a1" });
    expect(validateLayout(l)).toBe(l);
  });

  it("follows the sidebar (collapsed = rail) and an empty selection", () => {
    const l = defaultLayout({ sidebarOpen: false, sidebarWidth: 300, hostId: "host-a", sessionId: null });
    expect(l.dock.left).toEqual({ kind: AGENTS_KIND, mode: "rail", width: 300 });
    expect(l.instances[MAIN_PANE]!.binding).toEqual({ kind: "agent", hostId: "host-a", sessionId: null });
    expect(validateLayout(l)).not.toBeNull();
  });

  it("survives a JSON round trip (the persisted shape of later steps)", () => {
    expect(validateLayout(JSON.parse(JSON.stringify(base())))).toEqual(base());
  });
});

describe("validateLayout (the layout JSON shape)", () => {
  it("accepts the doc's two-column example and tiled grids within the limits", () => {
    const doc = {
      v: 1,
      dock: { left: { kind: "core.agents", mode: "open", width: 256 } },
      cols: [
        { w: 0.62, rows: [{ pane: "p1", h: 1 }] },
        { w: 0.38, rows: [{ pane: "p2", h: 0.5 }, { pane: "p3", h: 0.5 }] },
      ],
      panes: { p1: { tabs: ["i1", "i4"], active: "i1", at: 1739 }, p2: { tabs: ["i2"], active: "i2", at: 1 }, p3: { tabs: ["i3"], active: "i3", at: 2 }, p5: { tabs: ["i5"], active: "i5", at: 0 } },
      instances: {
        i1: { kind: "core.conversation", binding: { kind: "agent", hostId: "local", sessionId: "s1" }, params: {}, state: null },
        i2: { kind: "files", binding: { kind: "follow" }, params: { path: "." }, state: { open: [] } },
        i3: { kind: "terminal", binding: { kind: "host", hostId: "local" }, params: {}, state: null },
        i4: { kind: "core.conversation", binding: { kind: "agent", hostId: "host-a", sessionId: "s1" }, params: {}, state: null },
        i5: { kind: "clock", binding: { kind: "none" }, params: {}, state: null },
      },
      chips: ["p5"],
      focus: "p1",
      max: null,
    };
    expect(validateLayout(doc)).not.toBeNull();
    expect(validateLayout(grid([3, 3]))).not.toBeNull();
    expect(validateLayout(grid([2, 2, 2], MAX_CHIPS))).not.toBeNull();
    expect(validateLayout({ ...grid([1]), dock: { left: null } })).not.toBeNull();
  });

  it("refuses what is not a layout", () => {
    for (const raw of [null, 1, "x", [], {}, { ...base(), v: 2 }, { ...base(), cols: [] }, { ...base(), dock: {} }, { ...base(), chips: null }]) expect(validateLayout(raw), JSON.stringify(raw)).toBeNull();
  });

  it("refuses more than the limits: 6 panes on screen, 3 per column, 8 chips", () => {
    expect(validateLayout(grid([3, 3, 1]))).toBeNull();
    expect(validateLayout(grid([4]))).toBeNull();
    expect(validateLayout(grid([1], MAX_CHIPS + 1))).toBeNull();
  });

  it("refuses broken references and shares", () => {
    const broken: ((l: PaneLayout) => void)[] = [
      (l) => (l.cols[0]!.rows[0]!.pane = "ghost"), // unknown pane
      (l) => l.cols.push({ w: 0.5, rows: [{ pane: MAIN_PANE, h: 1 }] }), // a pane twice (and widths ≠ 1)
      (l) => (l.cols[0]!.w = 0.5), // widths do not sum to 1
      (l) => (l.cols[0]!.rows[0]!.h = 0), // empty share
      (l) => (l.cols[0]!.rows = []), // empty column
      (l) => (l.panes[MAIN_PANE]!.active = "other"), // active not a tab
      (l) => (l.panes[MAIN_PANE]!.tabs = []), // no tabs
      (l) => (l.panes[MAIN_PANE]!.tabs = ["nope"]), // tab without an instance
      (l) => (l.panes.stray = { tabs: ["stray"], active: "stray", at: 0 }), // a pane neither shown nor a chip
      (l) => (l.instances.stray = conv("x") as PaneLayout["instances"][string]), // an instance in no pane
      (l) => (l.instances[MAIN_PANE]!.binding = { kind: "agent", hostId: "", sessionId: "a" }), // bad binding
      (l) => (l.instances[MAIN_PANE]!.binding = { kind: "elsewhere" } as never),
      (l) => (l.instances[MAIN_PANE]!.kind = ""),
      (l) => (l.focus = "ghost"),
      (l) => (l.max = "ghost"),
      (l) => (l.chips = [MAIN_PANE]), // shown and a chip
      (l) => (l.dock.left = { kind: AGENTS_KIND, mode: "wide" as "open", width: 256 }),
    ];
    for (const [i, change] of broken.entries()) {
      const l = clone(base());
      change(l);
      expect(validateLayout(l), `case ${i}`).toBeNull();
    }
  });

  it("the focus and the maximised pane must be on screen (not a chip)", () => {
    const l = grid([1], 1);
    expect(validateLayout({ ...l, focus: "p1" })).toBeNull();
    expect(validateLayout({ ...l, max: "p0" })).not.toBeNull();
  });
});

describe("limits (helpers for the placement rules of later steps)", () => {
  it("are the owner's numbers", () => {
    expect([MAX_VISIBLE_PANES, MAX_ROWS, MAX_CHIPS]).toEqual([6, 3, 8]);
  });

  it("another pane fits until 6 are on screen; a column splits until 3 rows", () => {
    expect(canShowPane(base())).toBe(true);
    expect(canSplitColumn(base(), 0)).toBe(true);
    expect(canSplitColumn(base(), 1)).toBe(false); // no such column
    expect(canSplitColumn(grid([3, 1]), 0)).toBe(false);
    expect(canSplitColumn(grid([3, 1]), 1)).toBe(true);
    expect(canShowPane(grid([3, 3]))).toBe(false);
    expect(canSplitColumn(grid([3, 2, 1]), 1)).toBe(false); // the column has room, the screen not
  });

  it("another chip fits until 8", () => {
    expect(canAddChip(grid([1], MAX_CHIPS - 1))).toBe(true);
    expect(canAddChip(grid([1], MAX_CHIPS))).toBe(false);
  });
});

describe("conversation panes (step 2: open beside, replace, close, focus, restore)", () => {
  const A = { hostId: "local", sessionId: "a1" };
  const B = { hostId: "local", sessionId: "b2" };
  const C = { hostId: "host-a", sessionId: "c3" };
  /** The same session id on another host: a different agent. */
  const A2 = { hostId: "host-a", sessionId: "a1" };
  const agentsOf = (l: PaneLayout) => conversationPanes(l).map((id) => paneBinding(l, id));
  const two = () => openBeside(base(), B, 10);

  it("plain open replaces the focused pane's agent; an agent already shown gets its pane focused", () => {
    const l = showAgent(base(), B, 5);
    expect(agentsOf(l)).toEqual([B]);
    expect(l.focus).toBe(MAIN_PANE);
    const both = two();
    const back = showAgent(both, A, 20);
    expect(agentsOf(back)).toEqual([A, B]);
    expect(back.focus).toBe(MAIN_PANE);
    expect(back.panes[MAIN_PANE]!.at).toBe(20);
    // the focused (right) pane is replaced, the left one keeps its agent
    const replaced = showAgent(both, C, 30);
    expect(agentsOf(replaced)).toEqual([A, C]);
    expect(replaced.focus).toBe(both.focus);
  });

  it("open beside: a new column right of the focused one, half its width, focused", () => {
    const l = two();
    expect(conversationPanes(l)).toHaveLength(2);
    expect(agentsOf(l)).toEqual([A, B]);
    expect(l.cols.map((c) => c.w)).toEqual([0.5, 0.5]);
    expect(l.focus).not.toBe(MAIN_PANE);
    expect(focusedConversation(l)).toBe(l.focus);
    expect(validateLayout(l)).not.toBeNull();
    expect(shownAgents(l)).toEqual([A, B]);
  });

  it("open beside an agent already shown focuses it; with the focused pane empty it simply shows there", () => {
    const l = two();
    const again = openBeside(l, A, 50);
    expect(conversationPanes(again)).toHaveLength(2);
    expect(again.focus).toBe(MAIN_PANE);
    const empty = defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: null });
    const shown = openBeside(empty, B, 1);
    expect(agentsOf(shown)).toEqual([B]);
  });

  it(`at most ${MAX_CONVERSATION_COLUMNS} columns: beside a full row replaces the other pane, which gets the focus`, () => {
    const l = two();
    const left = focusPane(l, MAIN_PANE, 60);
    const third = openBeside(left, C, 70);
    expect(conversationPanes(third)).toHaveLength(2);
    expect(agentsOf(third)).toEqual([A, C]);
    expect(third.focus).toBe(conversationPanes(third)[1]);
  });

  it("the same session id on two hosts is two agents (two panes)", () => {
    const l = openBeside(base(), A2, 1);
    expect(agentsOf(l)).toEqual([A, A2]);
    expect(paneShowing(l, "host-a", "a1")).toBe(l.focus);
    expect(paneShowing(l, "local", "a1")).toBe(MAIN_PANE);
  });

  it("close: the column goes, the other takes its width and the focus; the last pane never closes", () => {
    const l = two();
    const right = l.focus!;
    const closed = closePane(l, right);
    expect(conversationPanes(closed)).toEqual([MAIN_PANE]);
    expect(closed.cols.map((c) => c.w)).toEqual([1]);
    expect(closed.focus).toBe(MAIN_PANE);
    expect(closed.instances[right]).toBeUndefined();
    expect(validateLayout(closed)).not.toBeNull();
    // closing the unfocused one keeps the focus
    const other = closePane(l, MAIN_PANE);
    expect(other.focus).toBe(right);
    expect(agentsOf(other)).toEqual([B]);
    expect(closePane(closed, MAIN_PANE)).toBe(closed);
    expect(closePane(l, "ghost")).toBe(l);
  });

  it("focus: only a pane on screen; the same focus at the same time changes nothing", () => {
    const l = two();
    const f = focusPane(l, MAIN_PANE, 99);
    expect(f.focus).toBe(MAIN_PANE);
    expect(focusPane(f, MAIN_PANE, 99)).toBe(f);
    expect(focusPane(f, "ghost", 100)).toBe(f);
  });

  it("the divider: shares clamp to the minimum and keep their sum", () => {
    const l = two();
    expect(resizeColumns(l, 0, 0.7).cols.map((c) => c.w)).toEqual([0.7, expect.closeTo(0.3, 6)]);
    expect(resizeColumns(l, 0, 0.01).cols[0]!.w).toBe(MIN_COLUMN_SHARE);
    expect(resizeColumns(l, 0, 0.99).cols[0]!.w).toBe(1 - MIN_COLUMN_SHARE);
    expect(resizeColumns(l, 1, 0.5)).toBe(l);
    expect(resizeColumns(l, 0, Number.NaN)).toBe(l);
  });

  it("gone agents leave their pane; the last pane shows no agent instead", () => {
    const l = two();
    const goneB = dropGoneAgents(l, (_h, id) => id === "b2");
    expect(agentsOf(goneB)).toEqual([A]);
    const goneAll = dropGoneAgents(l, () => true);
    expect(agentsOf(goneAll)).toEqual([{ hostId: "local", sessionId: null }]);
    expect(dropGoneAgents(l, () => false)).toBe(l);
  });

  it("restore: a stored step-2 layout comes back (focus on screen, never maximised); anything else is refused", () => {
    const l = { ...two(), max: null };
    expect(restoreLayout(JSON.parse(JSON.stringify(l)))).toEqual(l);
    expect(restoreLayout({ ...JSON.parse(JSON.stringify(l)), max: l.focus })).toEqual(l);
    expect(restoreLayout(null)).toBeNull();
    expect(restoreLayout(grid([1, 1, 1]))).toBeNull(); // more than two columns
    expect(restoreLayout(grid([2]))).toBeNull(); // a column split in rows (later steps)
    expect(restoreLayout(grid([1], 1))).toBeNull(); // chips (later steps)
    const other = clone(base());
    other.instances[MAIN_PANE]!.kind = "files";
    expect(restoreLayout(other)).toBeNull();
  });

  it("bindPane only rebinds a conversation pane and only when the agent changes", () => {
    const l = base();
    expect(bindPane(l, MAIN_PANE, "local", "a1")).toBe(l);
    expect(paneBinding(bindPane(l, MAIN_PANE, "local", null), MAIN_PANE)).toEqual({ hostId: "local", sessionId: null });
    expect(bindPane(l, "ghost", "local", "x")).toBe(l);
  });
});
