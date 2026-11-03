// Panes step 4 (docs/desktop-modules.md §24.10 → step 4; research panes-20261019.md §1 limits, §4 interactions,
// §7 row 4): chips (collapse to the tray, back next to the old neighbours, ×, ≤ 8 with the oldest closing
// unless it would end something), LRU within the limits, minSize (a tab instead of a column that does not
// fit; the tool area gives way as the drawer), maximise (never stored), moving conversation columns, the
// pane keys and the Esc chain, and the chips stored with the layout (both areas) and restored.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SideBinding } from "../src/renderer/src/modules/slots";
import type { ItemId } from "../src/renderer/src/modules/types";
import {
  chipShowing,
  clearMaximized,
  closeChip,
  collapseConversation,
  conversationPanes,
  CONVERSATION_MIN_W,
  defaultLayout,
  dropGoneAgents,
  focusedConversation,
  isEmptyPane,
  joinLayout,
  MAIN_PANE,
  MAX_CHIPS,
  MAX_STORED_CHIPS,
  moveConversation,
  openBeside,
  overflowChips,
  paneBinding,
  paneInDirection,
  replaceToChip,
  restoreConversation,
  restoreLayout,
  showAgent,
  showPageIn,
  splitLayout,
  toggleMaximized,
  toolPartOf,
  toolRawOf,
  validateLayout,
  type PaneLayout,
} from "../src/renderer/src/lib/paneLayout";
import {
  applyOpen,
  chipHolding,
  closeInstances,
  collapseCard,
  emptyLayout,
  findCard,
  frameMins,
  joinInto,
  locate,
  locateChip,
  moveToNewColumn,
  place,
  placeSpec,
  prepareForSave,
  restoreCard,
  sanitizeLayout,
  SINGLETON_KEY,
  type SideLayout,
  shelvesOf,
  shelfOfPage,
} from "../src/renderer/src/lib/sideLayout";
import { sideFrame } from "../src/renderer/src/lib/sideFrame";
import { escChainStep, type EscChainInput } from "../src/renderer/src/lib/escChain";
import { passThroughKey } from "../src/renderer/src/modules/terminal/terminalState";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));

const A = { hostId: "local", sessionId: "a1" };
const B = { hostId: "local", sessionId: "b2" };
const C = { hostId: "local", sessionId: "c3" };
const base = (sessionId: string | null = "a1") => defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId });
const agents = (l: PaneLayout) => conversationPanes(l).map((id) => paneBinding(l, id)?.sessionId ?? null);
const chipAgents = (l: PaneLayout) => l.chips.map((id) => paneBinding(l, id)?.sessionId ?? null);
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

// ── the work area ───────────────────────────────────────────────────────────────────────────────

describe("conversation chips (「—」, the tray, back next to the old neighbours)", () => {
  /** a1 | b2, b2 focused. */
  const two = () => openBeside(base(), B, 10);

  it("collapse: the column goes, the other takes its width and the focus; the chip remembers its neighbours", () => {
    const l = two();
    const right = l.focus!;
    const c = collapseConversation(l, right, 20);
    expect(agents(c)).toEqual(["a1"]);
    expect(c.cols.map((col) => col.w)).toEqual([1]);
    expect(c.chips).toEqual([right]);
    expect(c.panes[right]!.home).toMatchObject({ at: 20, left: MAIN_PANE, right: null, col: 1, w: 0.5 });
    expect(c.focus).toBe(MAIN_PANE);
    expect(validateLayout(c)).not.toBeNull();
    // A pane with no agent has nothing to keep; an unknown pane neither.
    expect(collapseConversation(base(null), MAIN_PANE, 1)).toEqual(base(null));
    expect(collapseConversation(l, "ghost", 1)).toBe(l);
  });

  it("the last conversation pane leaves an empty one (today's empty state) in its place", () => {
    const c = collapseConversation(base(), MAIN_PANE, 5);
    expect(agents(c)).toEqual([null]);
    const empty = conversationPanes(c)[0]!;
    expect(isEmptyPane(c, empty)).toBe(true);
    expect(c.focus).toBe(empty);
    expect(c.chips).toEqual([MAIN_PANE]);
    expect(validateLayout(c)).not.toBeNull();
    // A click on the chip: it takes the empty pane's place again (focused).
    const back = restoreConversation(c, MAIN_PANE, 6);
    expect(agents(back)).toEqual(["a1"]);
    expect(conversationPanes(back)).toEqual([MAIN_PANE]);
    expect(back.chips).toEqual([]);
    expect(back.panes[MAIN_PANE]!.home).toBeUndefined();
    expect(back.panes[empty]).toBeUndefined();
    expect(back.focus).toBe(MAIN_PANE);
    expect(validateLayout(back)).not.toBeNull();
  });

  it("restore: next to its old left / right neighbour, with its old width; focused unless asked not to", () => {
    const l = two();
    const right = l.focus!;
    // Collapse the left one: it comes back left of the right one.
    const c = collapseConversation(l, MAIN_PANE, 30);
    expect(c.panes[MAIN_PANE]!.home).toMatchObject({ left: null, right });
    const back = restoreConversation(c, MAIN_PANE, 31);
    expect(agents(back)).toEqual(["a1", "b2"]);
    expect(back.cols.map((col) => col.w)).toEqual([0.5, 0.5]);
    expect(back.focus).toBe(MAIN_PANE);
    const quiet = restoreConversation(c, MAIN_PANE, 31, { focus: false });
    expect(quiet.focus).toBe(right);
    // The neighbour is gone meanwhile: its old column index.
    const r2 = collapseConversation(l, right, 40);
    const swapped = showAgent(r2, C, 41);
    expect(agents(restoreConversation(swapped, right, 42))).toEqual(["c3", "b2"]);
  });

  it(`LRU: a third conversation coming back (≤ ${2} columns) sends the least recently used one to the tray`, () => {
    const l = two(); // a1 at 0, b2 at 10
    const withChip = replaceToChip(l, MAIN_PANE, C, 11); // c3 shows left, a1 → chip
    expect(agents(withChip)).toEqual(["c3", "b2"]);
    expect(chipAgents(withChip)).toEqual(["a1"]);
    const chip = withChip.chips[0]!;
    // Touch the left pane so b2 (at 10) is the least recently used one.
    const touched = { ...withChip, panes: { ...withChip.panes, [MAIN_PANE]: { ...withChip.panes[MAIN_PANE]!, at: 50 } } };
    const back = restoreConversation(touched, chip, 60);
    expect(agents(back)).toEqual(["c3", "a1"]);
    expect(chipAgents(back)).toEqual(["b2"]);
    expect(back.focus).toBe(chip);
    expect(validateLayout(back)).not.toBeNull();
  });

  it("open beside with two columns: the other pane shows it, its agent goes to the tray (was: replaced); in the tray: it comes back", () => {
    const l = two();
    const third = openBeside(focusedConversationOn(l, MAIN_PANE), C, 70);
    expect(agents(third)).toEqual(["a1", "c3"]);
    expect(chipAgents(third)).toEqual(["b2"]);
    expect(chipShowing(third, "local", "b2")).toBe(third.chips[0]);
    // Plain open of the agent in the tray: back right of the pane it was in (c3 now); the least recently
    // used conversation (a1) makes room.
    const back = showAgent(third, B, 80);
    expect(agents(back)).toEqual(["c3", "b2"]);
    expect(chipAgents(back)).toEqual(["a1"]);
    expect(paneBinding(back, back.focus!)?.sessionId).toBe("b2");
  });

  it("minSize: open beside without the width for another column — the focused pane shows it, its agent goes to the tray", () => {
    const l = openBeside(base(), B, 5, { room: false });
    expect(agents(l)).toEqual(["b2"]);
    expect(chipAgents(l)).toEqual(["a1"]);
    expect(l.panes[l.chips[0]!]!.home).toMatchObject({ left: MAIN_PANE });
  });

  it("× on a chip closes the pane and its tabs; gone agents leave the tray", () => {
    const c = collapseConversation(openBeside(base(), B, 10), MAIN_PANE, 20);
    const closed = closeChip(c, MAIN_PANE);
    expect(closed.chips).toEqual([]);
    expect(closed.panes[MAIN_PANE]).toBeUndefined();
    expect(closed.instances[MAIN_PANE]).toBeUndefined();
    expect(validateLayout(closed)).not.toBeNull();
    expect(closeChip(c, "ghost")).toBe(c);
    expect(dropGoneAgents(c, (_h, id) => id === "a1").chips).toEqual([]);
    expect(dropGoneAgents(c, () => false)).toBe(c);
  });

  it("a page over the conversation closes when it collapses (pages are never kept)", () => {
    const l = showPageIn(two(), MAIN_PANE, "projects.page", {});
    const c = collapseConversation(l, MAIN_PANE, 3);
    expect(c.panes[MAIN_PANE]!.tabs).toEqual([MAIN_PANE]);
  });
});

/** `l` with `paneId` focused. */
function focusedConversationOn(l: PaneLayout, paneId: string): PaneLayout {
  return { ...l, focus: paneId };
}

describe("maximise (in memory only)", () => {
  it("toggles a pane on screen; never a chip; another maximise replaces it; joinLayout / restoreLayout drop it", () => {
    const l = openBeside(base(), B, 1);
    const right = l.focus!;
    const m = toggleMaximized(l, right);
    expect(m.max).toBe(right);
    expect(toggleMaximized(m, right).max).toBeNull();
    expect(toggleMaximized(m, MAIN_PANE).max).toBe(MAIN_PANE);
    expect(toggleMaximized(l, "ghost")).toBe(l);
    expect(clearMaximized(m).max).toBeNull();
    expect(clearMaximized(l)).toBe(l);
    expect(joinLayout(m, null).max).toBeNull();
    expect(restoreLayout(roundTrip({ ...m }))!.max).toBeNull();
    // Collapsing the maximised pane ends it.
    expect(collapseConversation(m, right, 2).max).toBeNull();
  });
});

describe("moving a conversation column (drag by its header)", () => {
  it("left / right of the other one, or to an edge; nothing when it would not move", () => {
    const l = openBeside(base(), B, 1);
    const right = l.focus!;
    expect(agents(moveConversation(l, right, { near: MAIN_PANE, side: "left" }))).toEqual(["b2", "a1"]);
    expect(agents(moveConversation(l, right, { edge: "left" }))).toEqual(["b2", "a1"]);
    expect(agents(moveConversation(l, MAIN_PANE, { edge: "right" }))).toEqual(["b2", "a1"]);
    expect(moveConversation(l, right, { near: MAIN_PANE, side: "right" })).toBe(l);
    expect(moveConversation(l, right, { edge: "right" })).toBe(l);
    expect(moveConversation(l, right, { near: right, side: "left" })).toBe(l);
    expect(moveConversation(l, "ghost", { edge: "left" })).toBe(l);
    // Widths travel with their column.
    const wide = { ...l, cols: [{ ...l.cols[0]!, w: 0.7 }, { ...l.cols[1]!, w: 0.3 }] };
    expect(moveConversation(wide, right, { edge: "left" }).cols.map((c) => c.w)).toEqual([0.3, 0.7]);
  });
});

// ── the tool area ───────────────────────────────────────────────────────────────────────────────

const FOLLOW: SideBinding = { kind: "follow", hostId: "local" };
const WS: SideBinding = { kind: "workspace", hostId: "local", key: "w1" };
let clock = 100;

function open(layout: SideLayout, kind: string, binding: SideBinding, key: string | null = SINGLETON_KEY, home = "workspace", page?: string) {
  const input = { kind: kind as ItemId, binding, key, state: null, v: 1, pinned: false };
  const decision = place(layout, { ...input, transient: false, activePage: layout.activePage, columnOpen: layout.open, page: page ?? layout.pages.find(p => p.groups.includes(home))?.id }, placeSpec({ home }));
  return applyOpen(layout, decision, input, ++clock, { reveal: true, home });
}

/** One tool column: files, changes, terminal [t1, t2]. */
function tools() {
  let l = emptyLayout();
  const files = open(l, "workspace.files", FOLLOW);
  l = files.layout;
  const changes = open(l, "workspace.changes", FOLLOW);
  l = changes.layout;
  const t1 = open(l, "terminal.pty", WS, "t1");
  l = t1.layout;
  const t2 = open(l, "terminal.pty", WS, "t2");
  l = t2.layout;
  const card = (id: string) => locate(l, id)!.card.id;
  return { layout: l, page: l.pages[0]!.id, inst: { files: files.instanceId, changes: changes.instanceId, t1: t1.instanceId, t2: t2.instanceId }, cards: { files: card(files.instanceId), changes: card(changes.instanceId), terminal: card(t1.instanceId) } };
}
const kinds = (l: SideLayout) => l.pages.map((p) => p.cards.map((c) => c.kind));

describe("tool chips", () => {
  it("collapse: the card leaves its column with its way back (column, neighbours); its instances stay", () => {
    const t = tools();
    const c = collapseCard(t.layout, t.cards.changes, 200);
    expect(kinds(c)).toEqual([["workspace.files", "terminal.pty"]]);
    expect(c.chips).toHaveLength(1);
    expect(c.chips![0]).toMatchObject({ card: { id: t.cards.changes }, page: { id: t.page, index: 0 }, above: t.cards.files, below: t.cards.terminal, at: 200 });
    expect(c.instances[t.inst.changes]).toBeDefined();
    expect(locate(c, t.inst.changes)).toBeNull();
    expect(locateChip(c, t.inst.changes)?.card.id).toBe(t.cards.changes);
    expect(chipHolding(c, "workspace.changes" as ItemId, SINGLETON_KEY, FOLLOW)?.card.id).toBe(t.cards.changes);
    expect(chipHolding(c, "workspace.changes" as ItemId, null, FOLLOW)).toBeNull();
    expect(collapseCard(c, "ghost", 1)).toBe(c);
  });

  it("restore: back between its old neighbours; a column that went is made again at its old place (same id)", () => {
    const t = tools();
    const c = collapseCard(t.layout, t.cards.changes, 200);
    const back = restoreCard(c, t.cards.changes, 210);
    expect(kinds(back)).toEqual([["workspace.files", "workspace.changes", "terminal.pty"]]);
    expect(back.chips).toBeUndefined();
    expect(back.open).toBe(true);
    // The whole column collapsed (bottom first, like 显示桌面): it comes back top first.
    let all = collapseCard(t.layout, t.cards.terminal, 300);
    all = collapseCard(all, t.cards.changes, 301);
    all = collapseCard(all, t.cards.files, 302);
    expect(all.pages).toEqual([]);
    expect(all.open).toBe(false);
    let again = restoreCard(all, t.cards.files, 400);
    again = restoreCard(again, t.cards.changes, 401);
    again = restoreCard(again, t.cards.terminal, 402);
    expect(again.pages.map((p) => p.id)).toEqual([t.page]);
    expect(kinds(again)).toEqual([["workspace.files", "workspace.changes", "terminal.pty"]]);
    expect(findCard(again, t.cards.terminal)!.card.tabs).toEqual([t.inst.t1, t.inst.t2]);
  });

  it("#7: back into a full column (3 panes) nothing goes to the tray — it opens on a new page of its Shelf", () => {
    const t = tools();
    const c = collapseCard(t.layout, t.cards.changes, 500);
    // A new pane fills the column again.
    const filled = open(c, "workspace.preview", FOLLOW, "p").layout;
    expect(filled.pages[0]!.cards).toHaveLength(3);
    const back = restoreCard(filled, t.cards.changes, 600);
    expect(back.chips).toBeUndefined();
    expect(back.pages[0]!.cards.map((x) => x.id)).toEqual(filled.pages[0]!.cards.map((x) => x.id));
    expect(back.pages).toHaveLength(2);
    expect(back.pages[1]!.cards.map((x) => x.id)).toEqual([t.cards.changes]);
    expect(back.pages[1]!.shelf).toBe(back.pages[0]!.shelf);
    // Its new page comes into view.
    expect(shelvesOf(back)[0]!.active).toBe(back.pages[1]!.id);
  });

  it("minSize (§24.12): its Shelf gone and no width for another — a page of the Shelf there instead; with the width, its Shelf again on its side", () => {
    const t = tools();
    const second = open(t.layout, "browser.tab", { kind: "host", hostId: "local" }, "b", "browser");
    let l = moveToNewColumn(second.layout, { instance: second.instanceId }, { edge: "left" }, 700);
    expect(shelvesOf(l).map((x) => x.side)).toEqual(["left", "right"]);
    const browserCard = locate(l, second.instanceId)!.card.id;
    l = collapseCard(l, browserCard, 701);
    expect(shelvesOf(l).map((x) => x.side)).toEqual(["right"]);
    const narrow = restoreCard(l, browserCard, 702, { roomForColumn: false });
    expect(shelvesOf(narrow).map((x) => x.side)).toEqual(["right"]);
    expect(shelfOfPage(narrow, locate(narrow, second.instanceId)!.page.id)!.side).toBe("right");
    const wide = restoreCard(l, browserCard, 702);
    expect(shelvesOf(wide).map((x) => x.side)).toEqual(["left", "right"]);
    expect(shelfOfPage(wide, locate(wide, second.instanceId)!.page.id)!.side).toBe("left");
  });

  it("closing a chip's tabs drops the chip; prepareForSave keeps chips (not their in-memory tabs)", () => {
    const t = tools();
    const c = collapseCard(t.layout, t.cards.changes, 800);
    expect(closeInstances(c, [t.inst.changes]).chips).toBeUndefined();
    const saved = prepareForSave(c, { persist: () => true });
    expect(saved.chips).toHaveLength(1);
    expect(prepareForSave(c, { persist: (kind) => kind !== "workspace.changes" }).chips).toBeUndefined();
  });

  it("joinInto: a pane / tab joins another pane as a tab whatever its kind; moveToNewColumn (the work area's edge) makes a Shelf there", () => {
    const t = tools();
    const joined = joinInto(t.layout, { card: t.cards.files }, t.cards.terminal, 900);
    expect(findCard(joined, t.cards.terminal)!.card.tabs).toEqual([t.inst.t1, t.inst.t2, t.inst.files]);
    expect(findCard(joined, t.cards.terminal)!.card.active).toBe(t.inst.files);
    expect(joinInto(t.layout, { card: t.cards.files }, t.cards.files, 1)).toBe(t.layout);
    const col = moveToNewColumn(t.layout, { instance: t.inst.t2 }, { edge: "left" }, 901);
    expect(kinds(col)).toEqual([["workspace.files", "workspace.changes", "terminal.pty"], ["terminal.pty"]]);
    expect(shelfOfPage(col, locate(col, t.inst.t2)!.page.id)!.side).toBe("left");
    expect(moveToNewColumn(col, { instance: t.inst.t1 }, { edge: "left" }, 902)).toBe(col); // that side has a Shelf
  });

  it("place() (§24.12): a vanished override page is a new page of the right Shelf — a page needs no width (roomForColumn is moot)", () => {
    const t = tools();
    const req = { kind: "browser.tab" as ItemId, binding: { kind: "host", hostId: "local" } as SideBinding, key: "b", transient: false, activePage: t.layout.activePage, columnOpen: true };
    const spec = placeSpec({ home: "browser" });
    const withOverride = { ...t.layout, overrides: { "browser.tab": { page: "p999", groups: ["browser"], at: 1 } } };
    const shelf = shelvesOf(t.layout)[0]!.id;
    expect(place(withOverride, req, spec)).toMatchObject({ page: { new: { shelf } } });
    expect(place(withOverride, { ...req, roomForColumn: false }, spec)).toMatchObject({ page: { new: { shelf } } });
  });
});

// ── the tray, keys, Esc, frame ──────────────────────────────────────────────────────────────────

describe("the tray (≤ 8 chips, the oldest closes first unless closing it would end something)", () => {
  it("overflowChips: oldest closable ones beyond the limit", () => {
    const entries = Array.from({ length: 10 }, (_, i) => ({ key: `k${i}`, at: i, closable: i !== 0 }));
    expect(overflowChips(entries, MAX_CHIPS)).toEqual(["k1", "k2"]);
    expect(overflowChips(entries.slice(0, 8), MAX_CHIPS)).toEqual([]);
    expect(overflowChips([...entries].reverse(), MAX_CHIPS)).toEqual(["k1", "k2"]);
    expect(overflowChips(entries.map((e) => ({ ...e, closable: false })), MAX_CHIPS)).toEqual([]);
    expect(MAX_STORED_CHIPS).toBeGreaterThanOrEqual(MAX_CHIPS);
  });
});

describe("Ctrl+Alt+arrows: the pane in that direction", () => {
  // Two conversation columns and a tool column with two panes.
  const boxes = [
    { id: "w:a", left: 0, top: 0, width: 400, height: 800 },
    { id: "w:b", left: 400, top: 0, width: 400, height: 800 },
    { id: "t:1", left: 808, top: 0, width: 300, height: 400 },
    { id: "t:2", left: 808, top: 408, width: 300, height: 392 },
  ];
  it("picks the pane straight ahead, the nearest first; none past the edge; the first without a focus", () => {
    expect(paneInDirection(boxes, "w:a", "right")).toBe("w:b");
    expect(paneInDirection(boxes, "w:b", "right")).toBe("t:1");
    expect(paneInDirection(boxes, "t:1", "down")).toBe("t:2");
    expect(paneInDirection(boxes, "t:2", "up")).toBe("t:1");
    expect(paneInDirection(boxes, "t:2", "left")).toBe("w:b");
    expect(paneInDirection(boxes, "w:a", "left")).toBeNull();
    expect(paneInDirection(boxes, "w:a", "up")).toBeNull();
    expect(paneInDirection(boxes, null, "right")).toBe("w:a");
  });
});

describe("pane keys", () => {
  const ev = (over: Partial<KeyboardEvent>) => ({ key: "", code: "", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...over }) as KeyboardEvent;
  it("routes Ctrl/⌘+W, T, Shift+M, Shift+D, Alt+arrows; nothing without the modifier", async () => {
    const { paneKeyAction } = await import("../src/renderer/src/lib/paneKeys");
    expect(paneKeyAction(ev({ code: "KeyW", key: "w", ctrlKey: true }))).toBe("closeTab");
    // ⌘ is the command key on macOS only (lib/keybindings Mod); elsewhere it is the Windows / Super key.
    expect(paneKeyAction(ev({ code: "KeyW", key: "w", metaKey: true }))).toBeNull();
    const { setKeybindingPlatform } = await import("../src/renderer/src/lib/keybindings");
    setKeybindingPlatform("mac");
    expect(paneKeyAction(ev({ code: "KeyW", key: "w", metaKey: true }))).toBe("closeTab");
    expect(paneKeyAction(ev({ code: "KeyW", key: "w", ctrlKey: true }))).toBeNull();
    setKeybindingPlatform(null);
    expect(paneKeyAction(ev({ code: "KeyT", key: "t", ctrlKey: true }))).toBe("newTab");
    expect(paneKeyAction(ev({ code: "KeyM", key: "M", ctrlKey: true, shiftKey: true }))).toBe("maximize");
    expect(paneKeyAction(ev({ code: "KeyD", key: "D", ctrlKey: true, shiftKey: true }))).toBe("desktop");
    expect(paneKeyAction(ev({ key: "ArrowLeft", ctrlKey: true, altKey: true }))).toBe("focusLeft");
    expect(paneKeyAction(ev({ key: "ArrowDown", ctrlKey: true, altKey: true }))).toBe("focusDown");
    expect(paneKeyAction(ev({ code: "KeyW", key: "w" }))).toBeNull();
    expect(paneKeyAction(ev({ code: "KeyW", key: "W", ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(paneKeyAction(ev({ code: "KeyB", key: "b", ctrlKey: true, altKey: true }))).toBeNull(); // Ctrl+Alt+B stays the tool area's
    expect(paneKeyAction(ev({ key: "ArrowLeft", altKey: true }))).toBeNull(); // Alt+← = back
  });

  it("a focused terminal lets Ctrl+Shift+D / M and Ctrl+Alt+arrows out; Ctrl+W / Ctrl+T stay the shell's", () => {
    expect(passThroughKey(ev({ code: "KeyD", key: "D", ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(passThroughKey(ev({ code: "KeyM", key: "M", ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(passThroughKey(ev({ key: "ArrowRight", code: "ArrowRight", ctrlKey: true, altKey: true }))).toBe(true);
    expect(passThroughKey(ev({ code: "KeyW", key: "w", ctrlKey: true }))).toBe(false);
    expect(passThroughKey(ev({ code: "KeyT", key: "t", ctrlKey: true }))).toBe(false);
  });

  it("Esc: a maximised pane is restored first — before the reference card, the drawer or the conversation", () => {
    const esc = (over: Partial<EscChainInput>): EscChainInput => ({ modifiers: false, repeat: false, composing: false, overlay: false, handled: false, peek: false, mode: false, drawer: false, editable: false, inSide: false, ...over });
    expect(escChainStep(esc({ mode: true, peek: true }))).toBe("restore");
    expect(escChainStep(esc({ mode: true, editable: true }))).toBe("restore");
    expect(escChainStep(esc({ mode: true, drawer: true }))).toBe("restore");
    expect(escChainStep(esc({ mode: true, overlay: true }))).toBe("overlay");
  });
});

describe("minSize in the frame (two conversations beside two tool columns no longer crowd)", () => {
  const input = { stored: 760, open: true, pages: 0, laneWhenHidden: "hide" as const, pageBar: "tabs" as const, mode: "push" as const, layered: null };
  it("one of each: today's minimums; two conversations + two tool columns that do not fit at their minimums: the drawer", () => {
    expect(frameMins(1, 1, CONVERSATION_MIN_W, 280)).toEqual({ conversation: 360, side: 260 });
    expect(frameMins(2, 2, CONVERSATION_MIN_W, 280)).toEqual({ conversation: 800, side: 576 });
    // 1330 px of work area (a 1600 px window): before, the conversations got 570 px for two (285 each).
    const crowded = sideFrame({ ...input, areaWidth: 1330, mins: frameMins(2, 2, CONVERSATION_MIN_W, 280) });
    expect(crowded.kind).toBe("drawer");
    // Wide enough: side by side, the conversations keep ≥ 400 px each.
    const wide = sideFrame({ ...input, areaWidth: 1500, mins: frameMins(2, 2, CONVERSATION_MIN_W, 280) });
    expect(wide.kind).toBe("flow");
    expect(1500 - wide.width).toBeGreaterThanOrEqual(800);
    // One conversation, two tool columns: unchanged from step 3.
    expect(sideFrame({ ...input, areaWidth: 1330, mins: frameMins(1, 2, CONVERSATION_MIN_W, 280) }).kind).toBe("flow");
  });
});

// ── persistence ─────────────────────────────────────────────────────────────────────────────────

describe("chips are stored with the layout (both areas); maximise is not", () => {
  let storage: Map<string, string>;
  beforeEach(() => {
    vi.resetModules();
    storage = new Map();
    vi.stubGlobal("localStorage", { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v), removeItem: (k: string) => void storage.delete(k) });
  });

  it("the tool area's chips: toolPartOf → JSON → toolRawOf → sanitizeLayout (card, way back, instances)", () => {
    const t = tools();
    const c = collapseCard(t.layout, t.cards.terminal, 1000);
    const part = roundTrip(toolPartOf(c));
    expect(part.chips).toEqual([`t-${t.cards.terminal}`]);
    const back = sanitizeLayout(toolRawOf(part), "local");
    expect(back.chips).toHaveLength(1);
    expect(back.chips![0]).toMatchObject({ card: { id: t.cards.terminal, tabs: [t.inst.t1, t.inst.t2] }, page: { id: t.page, index: 0 }, above: t.cards.changes, below: null, at: 1000 });
    expect(back.instances[t.inst.t1]).toBeDefined();
    // It comes back from the stored copy like from the live one.
    expect(kinds(restoreCard(back, t.cards.terminal, 1001))).toEqual(kinds(t.layout));
  });

  it("split / join keep each area's chips apart; the work area's chips restore; a stored layout validates", () => {
    const work = collapseConversation(openBeside(base(), B, 1), MAIN_PANE, 2);
    const side = collapseCard(tools().layout, tools().cards.files, 3);
    const joined = roundTrip(joinLayout({ ...work, max: work.focus }, toolPartOf(side)));
    expect(validateLayout(joined)).not.toBeNull();
    expect(joined.max).toBeNull();
    expect(joined.chips).toEqual([MAIN_PANE, `t-${side.chips![0]!.card.id}`]);
    const parts = splitLayout(joined);
    expect(parts.work.chips).toEqual([MAIN_PANE]);
    expect(parts.tools!.chips).toEqual([`t-${side.chips![0]!.card.id}`]);
    const restored = restoreLayout(joined)!;
    expect(restored.chips).toEqual([MAIN_PANE]);
    expect(restored.panes[MAIN_PANE]!.home).toMatchObject({ right: work.focus });
    expect(agents(restoreConversation(restored, MAIN_PANE, 4))).toEqual(["a1", "b2"]);
  });

  it("lib/paneFile: writeWork / writeTools keep each other's chips; readScope gives both back", async () => {
    const file = await import("../src/renderer/src/lib/paneFile");
    const t = tools();
    file.writeTools("host:local", collapseCard(t.layout, t.cards.changes, 5));
    file.writeWork("host:local", collapseConversation(openBeside(base(), B, 1), MAIN_PANE, 6));
    const both = file.readScope("host:local");
    expect(both.work!.chips).toEqual([MAIN_PANE]);
    expect(both.tools!.chips).toEqual([`t-${t.cards.changes}`]);
    const side = sanitizeLayout(toolRawOf(both.tools!), "local");
    expect(side.chips![0]!.card.id).toBe(t.cards.changes);
  });

  it("restoreLayout refuses chips that are not one agent's conversation", () => {
    const work = collapseConversation(openBeside(base(), B, 1), MAIN_PANE, 2);
    const bad = roundTrip(work);
    bad.instances[MAIN_PANE]!.binding = { kind: "agent", hostId: "local", sessionId: null };
    expect(restoreLayout(bad)).toBeNull();
    expect(focusedConversation(restoreLayout(roundTrip(work))!)).toBe(work.focus);
  });
});

// ── the coordinator (lib/paneActions: both stores) ─────────────────────────────────────────────────

// The first test imports the stores afresh (vi.resetModules): slow under a full parallel run.
describe("pane actions across both areas (显示桌面, the tray cap, maximise)", { timeout: 20_000 }, () => {
  beforeEach(() => {
    vi.resetModules();
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v), removeItem: (k: string) => void storage.delete(k) });
  });

  async function stores() {
    const app = await import("../src/renderer/src/store");
    const panes = await import("../src/renderer/src/lib/paneStore");
    const side = await import("../src/renderer/src/lib/sideLayoutStore");
    const actions = await import("../src/renderer/src/lib/paneActions");
    // Selecting a pane's agent opens it in the store: recorded here (no daemon in this test).
    const opened: string[] = [];
    app.useApp.setState({ openAgent: async (id: string) => void opened.push(id), selectedId: "b2", selectedHost: "local" } as never);
    panes.usePanes.setState({ layout: openBeside(base(), B, 10), scope: "host:local", restore: null });
    side.useSide.setState({ layout: { ...tools().layout, open: true } });
    return { app, panes, side, actions, opened };
  }

  it("collapse / restore a tool pane; × on a (stored) conversation chip; maximise is one pane at a time and Esc-able", async () => {
    const { panes, side, actions } = await stores();
    const t = side.useSide.getState().layout;
    const files = t.pages[0]!.cards[0]!.id;
    let now = 5000;
    const clockSpy = vi.spyOn(Date, "now").mockImplementation(() => (now += 10));
    // #7: a tool pane's 「—」 no longer makes a chip (collapsePane does nothing for it); a stored one still restores.
    actions.collapsePane({ area: "tools", id: files });
    expect(side.useSide.getState().layout.chips).toBeUndefined();
    side.useSide.setState({ layout: collapseCard(side.useSide.getState().layout, files, (now += 10)) });
    expect(side.useSide.getState().layout.chips!.map((c) => c.card.id)).toEqual([files]);
    // §24.13: a conversation's 「—」 closes its pane (lib/workspaces closeWorkspace) — no conversation chips are
    // made any more; one still in a layout (lib level, e.g. before the v5 migration ran) shows and closes.
    panes.usePanes.setState({ layout: collapseConversation(panes.usePanes.getState().layout, MAIN_PANE, (now += 10)) });
    expect(panes.usePanes.getState().layout.chips).toEqual([MAIN_PANE]);
    const entries = actions.trayEntries(panes.usePanes.getState().layout, side.useSide.getState().layout);
    expect(entries.map((e) => e.key)).toEqual([`t:${files}`, `w:${MAIN_PANE}`]);
    clockSpy.mockRestore();
    actions.restoreChip({ area: "tools", id: files });
    expect(side.useSide.getState().layout.chips).toBeUndefined();
    expect(side.useSide.getState().layout.pages[0]!.cards[0]!.id).toBe(files);
    actions.closeChipPane({ area: "work", id: MAIN_PANE });
    expect(panes.usePanes.getState().layout.chips).toEqual([]);
    // Maximise: a conversation pane, then a tool pane (the first one ends), then Esc's restore.
    const conv = panes.usePanes.getState().layout.focus!;
    actions.toggleExclusive({ area: "work", id: conv });
    expect(panes.usePanes.getState().layout.max).toBe(conv);
    expect(actions.anyMaximized()).toBe(true);
    expect(side.sideLayersActive()).toBe(true);
    actions.toggleExclusive({ area: "tools", id: files });
    expect(panes.usePanes.getState().layout.max).toBeNull();
    expect(side.useSide.getState().mode).toEqual({ kind: "maximised", card: files });
    expect(actions.restoreMaximized()).toBe(true);
    expect(actions.anyMaximized()).toBe(false);
    expect(actions.restoreMaximized()).toBe(false);
  });

  it("显示桌面: the tool panes to the tray, the conversations off screen (no conversation chips, §24.13); again: the layout before, the same focus", async () => {
    const { app, panes, side, actions, opened } = await stores();
    const before = panes.usePanes.getState().layout;
    const toolCards = side.useSide.getState().layout.pages[0]!.cards.map((c) => c.id);
    const shown = actions.panesOnScreen();
    expect(shown.filter((r) => r.area === "work").map((r) => r.id)).toEqual(conversationPanes(before));
    actions.showDesktop();
    const desk = panes.usePanes.getState().layout;
    expect(agents(desk)).toEqual([null]);
    // §24.13: the conversations are not chips any more; the work area before is kept to put back.
    expect(desk.chips).toEqual([]);
    expect(actions.useDesktop.getState().work).toBe(before);
    expect(app.useApp.getState().selectedId).toBeNull();
    expect(actions.useDesktop.getState().snapshot).toHaveLength(shown.length);
    expect(actions.panesOnScreen().filter((r) => r.area === "work")).toEqual([]);
    actions.showDesktop();
    const back = panes.usePanes.getState().layout;
    expect(agents(back)).toEqual(["a1", "b2"]);
    expect(back.focus).toBe(before.focus);
    expect(back.chips).toEqual([]);
    expect(opened.at(-1)).toBe("b2");
    // The tool panes too (when they were on screen: here no agent sees its follow panes without a registry — at least none was lost).
    const after = side.useSide.getState().layout;
    expect([...after.pages.flatMap((p) => p.cards.map((c) => c.id)), ...(after.chips ?? []).map((c) => c.card.id)].sort()).toEqual([...toolCards].sort());
    expect(actions.useDesktop.getState().snapshot).toBeNull();
  });

  it(`the tray keeps ≤ ${MAX_CHIPS}: beyond, the oldest chip closes`, async () => {
    const { panes, actions } = await stores();
    let l = panes.usePanes.getState().layout;
    for (let i = 0; i < MAX_CHIPS + 2; i++) l = replaceToChip(l, MAIN_PANE, { hostId: "local", sessionId: `x${i}` }, 100 + i);
    panes.usePanes.setState({ layout: l });
    expect(l.chips).toHaveLength(MAX_CHIPS + 2);
    actions.trimChips();
    const trimmed = panes.usePanes.getState().layout;
    expect(trimmed.chips).toHaveLength(MAX_CHIPS);
    // The two oldest went: a1 and x0.
    expect(chipAgents(trimmed)).not.toContain("a1");
    expect(chipAgents(trimmed)).not.toContain("x0");
    expect(chipAgents(trimmed)).toContain("x8");
  });
});
