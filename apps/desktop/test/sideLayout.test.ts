// The tool area's pure layout model (lib/sideLayout.ts; docs/desktop-modules.md §24, §18; RFC
// right-panel-rfc-20261009 §4.3–§4.4, test list §8.4): place(), the reducers, visibility, heights,
// persistence. Layouts are plain JSON, so every case builds one by opening components in order.
// v1.17 port (§24): a page is a tool COLUMN (≤ MAX_PAGES = 2, all on screen), a card a PANE (≤ 3 per
// column, ≤ MAX_TOOL_PANES = 4 in all, then tabs of the bottom pane), and there are no per-agent views.
// Each RFC scenario keeps its number; what it now expects (and why) is said in its title.
import { describe, expect, it } from "vitest";
import type { SideBinding, SidePlacement } from "../src/renderer/src/modules/slots";
import type { ItemId } from "../src/renderer/src/modules/types";
import {
  applyOpen,
  cardHeights,
  cardHolds,
  closeIfEmptied,
  closeInstances,
  CARD_GAP,
  CARD_HEADER,
  columnsOnScreen,
  DEFAULT_ORDER,
  dragGap,
  dropDeletedAgents,
  dropEmptyPage,
  emptyLayout,
  equalizeCards,
  findCard,
  findPage,
  fitLayout,
  foldPages,
  hasContentFor,
  instanceVisible,
  isNarrow,
  lanePages,
  locate,
  MAX_CARDS,
  MAX_INSTANCES,
  MAX_OVERRIDES,
  MAX_PAGES,
  MIN_CARD_HEIGHT,
  mergePages,
  moveCard,
  moveInstance,
  movePage,
  newCardIndex,
  openLauncherPage,
  pageInView,
  pageName,
  pageVisibility,
  pinInstance,
  place,
  placeSpec,
  prepareForSave,
  renamePage,
  resetLayout,
  resolveBinding,
  restoreDefault,
  restoreInstances,
  restoreKindDefault,
  sanitizeLayout,
  setCardSizes,
  setCollapsed,
  shownPages,
  shownTab,
  sideWidth,
  SINGLETON_KEY,
  splitInstance,
  STATE_LIMIT,
  switchPage,
  toolAreaShown,
  visibleCards,
  type PlaceSpec,
  type SideLayout,
  type SidePlaceDecision,
  type SideViewContext,
} from "../src/renderer/src/lib/sideLayout";
import { MAX_TOOL_PANES } from "../src/renderer/src/lib/paneLayout";

// ── Fixtures: the §4.4 default declarations ────────────────────────────────────────────────────

const DECL: Record<string, SidePlacement> = {
  "workspace.files": { home: "workspace", order: 100 },
  "workspace.changes": { home: "workspace", order: 200 },
  "workspace.preview": { home: "workspace", order: 300 },
  "diff.view": { home: "workspace", prefer: [{ containing: "workspace.changes" }, { group: "workspace" }], order: 400 },
  "subagents.thread": { home: "workspace", order: 450 },
  "status:jobs.tasks": { home: "workspace", order: 600 },
  "workspace.worktrees": { home: "workspace", order: 700 },
  "terminal.pty": { home: "workspace", order: 800, share: 0.35 },
  "approvals.pending": { home: "workspace", order: 50 },
  "browser.tab": { home: "browser" },
  "side-chat.chat": { home: "chat" },
  "turn.peek": { home: "reference", prefer: [{ containing: "turn.peek" }, "active"], order: 150 },
  "notes.note": { home: "notes", otherwise: "active-page" },
};
const SPECS: Record<string, PlaceSpec> = Object.fromEntries(Object.entries(DECL).map(([k, v]) => [k, placeSpec(v)]));
const specOf = (kind: string): PlaceSpec | null => SPECS[kind] ?? null;
const orderOf = (kind: string): number => SPECS[kind]?.order ?? DEFAULT_ORDER;

// v1.5: every binding has its host, `follow` too (the selected agent while it is on that host).
const FOLLOW: SideBinding = { kind: "follow", hostId: "local" };
const agent = (sessionId: string, hostId = "local"): SideBinding => ({ kind: "agent", hostId, sessionId });
const ws = (key: string, hostId = "local"): SideBinding => ({ kind: "workspace", hostId, key });
const host = (hostId = "local"): SideBinding => ({ kind: "host", hostId });

/** Default bindings / keys of the fixtures (what services.side.open fills in). */
const DEFAULT_BINDING: Record<string, () => SideBinding> = {
  "workspace.files": () => FOLLOW,
  "workspace.changes": () => FOLLOW,
  "status:jobs.tasks": () => FOLLOW,
  "workspace.worktrees": () => FOLLOW,
  "browser.tab": () => host(),
  "approvals.pending": () => host(),
  "turn.peek": () => host(),
};

let clock = 1000;

interface OpenOpts {
  binding?: SideBinding;
  key?: string | null;
  transient?: boolean;
  page?: string;
  pin?: boolean;
  reveal?: boolean;
  state?: SideLayout["instances"][string]["state"];
}

function decide(layout: SideLayout, kind: ItemId, o: OpenOpts = {}): SidePlaceDecision {
  const binding = o.binding ?? DEFAULT_BINDING[kind]?.() ?? agent("A");
  const key = o.key === undefined ? SINGLETON_KEY : o.key;
  return place(layout, { kind, binding, key, transient: !!o.transient && !o.pin, page: o.page, activePage: layout.activePage, columnOpen: layout.open }, SPECS[kind]!, orderOf);
}

function open(layout: SideLayout, kind: ItemId, o: OpenOpts = {}): { layout: SideLayout; id: string; decision: SidePlaceDecision } {
  const binding = o.binding ?? DEFAULT_BINDING[kind]?.() ?? agent("A");
  const key = o.key === undefined ? SINGLETON_KEY : o.key;
  const decision = decide(layout, kind, o);
  const applied = applyOpen(layout, decision, { kind, binding, key, state: o.state ?? null, v: 1, pinned: !!o.pin }, ++clock, { reveal: o.reveal ?? true, home: SPECS[kind]!.home });
  return { layout: applied.layout, id: applied.instanceId, decision };
}

const kinds = (layout: SideLayout, pageIndex = 0) => layout.pages[pageIndex]!.cards.map((c) => c.kind);
const pageOf = (layout: SideLayout, id: string) => locate(layout, id)!.page.id;
const cardOf = (layout: SideLayout, id: string) => locate(layout, id)!.card;

function ctx(over: Partial<SideViewContext> = {}): SideViewContext {
  return { hostId: "local", sessionId: "A", workspaceKey: "w1", available: () => true, ...over };
}

/**
 * S0 of §4.4, v1.17: one tool column「工作区」with files / changes / terminal [t1, t2] — three panes, the
 * column is full — and the status category as a tab of the bottom pane (§24: down to 3 rows, then tabs).
 */
function s0() {
  let l = emptyLayout();
  const files = open(l, "workspace.files");
  l = files.layout;
  const changes = open(l, "workspace.changes");
  l = changes.layout;
  const t1 = open(l, "terminal.pty", { binding: ws("w1"), key: "t1" });
  l = t1.layout;
  const t2 = open(l, "terminal.pty", { binding: ws("w1"), key: "t2" });
  l = t2.layout;
  const jobs = open(l, "status:jobs.tasks");
  l = jobs.layout;
  return { layout: l, files: files.id, changes: changes.id, t1: t1.id, t2: t2.id, jobs: jobs.id };
}

/** S1: a column with room — files / changes (two panes). */
function s1() {
  let l = emptyLayout();
  const files = open(l, "workspace.files");
  l = files.layout;
  const changes = open(l, "workspace.changes");
  l = changes.layout;
  return { layout: l, files: files.id, changes: changes.id };
}

/** `kind` opened into a new (launcher) column of its own: the second tool column. */
function inNewColumn(layout: SideLayout, kind: ItemId, o: OpenOpts = {}) {
  const made = openLauncherPage(layout);
  return open(made.layout, kind, { ...o, page: made.pageId! });
}

/** Every pane holds tabs of its own kind (no full column took another kind's tab). */
function assertNeverMixed(layout: SideLayout) {
  for (const page of layout.pages) for (const card of page.cards) for (const id of card.tabs) expect(layout.instances[id]!.kind).toBe(card.kind);
}

/** The limits of §24: ≤ MAX_PAGES columns, ≤ 3 panes each, ≤ MAX_TOOL_PANES in all. */
function assertLimits(layout: SideLayout) {
  expect(layout.pages.length).toBeLessThanOrEqual(MAX_PAGES);
  for (const page of layout.pages) expect(page.cards.length).toBeLessThanOrEqual(MAX_CARDS);
  expect(layout.pages.reduce((n, p) => n + p.cards.length, 0)).toBeLessThanOrEqual(MAX_TOOL_PANES);
}

function sizesSum(layout: SideLayout) {
  return layout.pages.map((p) => p.cards.reduce((a, c) => a + c.size, 0));
}

// ── S0 ─────────────────────────────────────────────────────────────────────────────────────────

describe("S0 (declared order, one column)", () => {
  it("builds the workspace column in declared order, three panes; the terminal pane holds two tabs, then the status tab (column full)", () => {
    const { layout, t1, t2, jobs } = s0();
    expect(layout.pages).toHaveLength(1);
    expect(layout.pages[0]!.groups).toEqual(["workspace"]);
    expect(kinds(layout)).toEqual(["workspace.files", "workspace.changes", "terminal.pty"]);
    expect(cardOf(layout, t1).tabs).toEqual([t1, t2, jobs]);
    expect(cardOf(layout, jobs).active).toBe(jobs);
    expect(layout.open).toBe(true);
    expect(layout.activePage).toBe(layout.pages[0]!.id);
    sizesSum(layout).forEach((s) => expect(s).toBeCloseTo(1));
    assertLimits(layout);
  });

  it("S1: down to 3 rows first — a column with room gets a new pane at its declared order", () => {
    const { layout } = s1();
    const t = open(layout, "terminal.pty", { binding: ws("w1"), key: "t1" });
    expect(t.decision).toMatchObject({ op: "insert", card: { new: { index: 2 } } });
    expect(kinds(t.layout)).toEqual(["workspace.files", "workspace.changes", "terminal.pty"]);
    assertNeverMixed(t.layout);
  });
});

// ── §4.4 scenarios ─────────────────────────────────────────────────────────────────────────────

describe("§4.4 scenarios (v1.17: one column, ≤ 3 panes, then tabs)", () => {
  it("1: a file link → a preview pane under 改动 (order 300) while there is room; full column → a tab of the bottom pane; the next unpinned preview replaces it in place", () => {
    const room = open(s1().layout, "workspace.preview", { key: "a.ts", transient: true });
    expect(room.decision).toMatchObject({ op: "insert", via: "rule", card: { new: { index: 2 } } });
    expect(kinds(room.layout)).toEqual(["workspace.files", "workspace.changes", "workspace.preview"]);
    const { layout, t1 } = s0();
    const a = open(layout, "workspace.preview", { key: "a.ts", transient: true });
    expect(a.decision).toMatchObject({ op: "insert", via: "limit", card: { id: cardOf(layout, t1).id } });
    expect(kinds(a.layout)).toEqual(["workspace.files", "workspace.changes", "terminal.pty"]);
    const b = open(a.layout, "workspace.preview", { key: "b.ts", transient: true });
    expect(b.decision).toEqual({ op: "replace", instance: a.id });
    expect(b.id).not.toBe(a.id);
    expect(b.layout.instances[a.id]).toBeUndefined();
    expect(cardOf(b.layout, b.id).tabs).toContain(b.id);
    expect(b.layout.instances[b.id]!.key).toBe("b.ts");
    assertLimits(b.layout);
  });

  it("2: 改动 → b.ts opens a diff (order 400): the column is full after the preview → a tab of its bottom pane; c.ts joins that same pane", () => {
    const { layout } = s1();
    const p = open(layout, "workspace.preview", { key: "a.ts", transient: true });
    const b = open(p.layout, "diff.view", { key: "git:b.ts" });
    expect(b.decision).toMatchObject({ op: "insert", via: "limit", card: { id: cardOf(p.layout, p.id).id } });
    expect(kinds(b.layout)).toEqual(["workspace.files", "workspace.changes", "workspace.preview"]);
    const c = open(b.layout, "diff.view", { key: "git:c.ts" });
    expect(cardOf(c.layout, c.id).id).toBe(cardOf(b.layout, b.id).id);
    expect(cardOf(c.layout, c.id).tabs).toEqual([p.id, b.id, c.id]);
    expect(cardHolds(c.layout, cardOf(c.layout, c.id), "diff.view")).toBe(true);
  });

  it("3: 查看变更 (turn diff) joins the pane holding the git diff", () => {
    const { layout } = s0();
    const git = open(layout, "diff.view", { key: "git:a.ts" });
    const turn = open(git.layout, "diff.view", { key: "turn:t9:a.ts" });
    expect(cardOf(turn.layout, turn.id).id).toBe(cardOf(git.layout, git.id).id);
    expect(cardOf(turn.layout, turn.id).tabs.slice(-2)).toEqual([git.id, turn.id]);
  });

  it("4: ＋ in the terminal pane (explicit column) adds a tab after the active one", () => {
    const { layout, t1, t2, jobs } = s0();
    const page = layout.pages[0]!.id;
    const t3 = open(layout, "terminal.pty", { binding: ws("w1"), key: "t3", page });
    expect(t3.decision).toMatchObject({ via: "explicit", card: { id: cardOf(layout, t1).id } });
    expect(cardOf(t3.layout, t3.id).tabs).toEqual([t1, t2, jobs, t3.id]);
    // after the ACTIVE tab, not at the end
    const l2 = applyOpen(t3.layout, { op: "activate", instance: t1 }, { kind: "terminal.pty", binding: ws("w1"), key: "t1", state: null, v: 1, pinned: false }, ++clock, { reveal: true }).layout;
    const t4 = open(l2, "terminal.pty", { binding: ws("w1"), key: "t4", page });
    expect(cardOf(t4.layout, t4.id).tabs).toEqual([t1, t4.id, t2, jobs, t3.id]);
  });

  it("5: a browser tab (no column of its group) → the right-most column (§24: no new column of its own); full → a tab there", () => {
    const { layout } = s0();
    const docs = open(layout, "browser.tab", { key: "service:docs" });
    expect(docs.decision).toMatchObject({ page: { id: layout.pages[0]!.id } });
    expect(docs.layout.pages.map((p) => p.groups)).toEqual([["workspace"]]);
    const roomy = open(s1().layout, "browser.tab", { key: "service:docs" });
    expect(roomy.decision).toMatchObject({ via: "otherwise", page: { id: roomy.layout.pages[0]!.id }, card: { new: {} } });
    // the right-most of two columns
    const two = inNewColumn(s1().layout, "side-chat.chat");
    const right = open(two.layout, "browser.tab", { key: "service:docs" });
    expect(right.decision).toMatchObject({ via: "otherwise", page: { id: two.layout.pages[1]!.id } });
  });

  it("6: a system event opens nothing (badges are pill-side; see sidePills.test.ts)", () => {
    const { layout } = s0();
    expect(layout.pages).toHaveLength(1);
  });

  it("7: side chat per agent: into the column (a tab of its bottom pane when full); again for A = activate; B = another tab of the same pane", () => {
    const { layout } = s0();
    const a = open(layout, "side-chat.chat");
    expect(a.layout.pages).toHaveLength(1);
    const again = open(a.layout, "side-chat.chat");
    expect(again.decision).toEqual({ op: "activate", instance: a.id });
    const b = open(a.layout, "side-chat.chat", { binding: agent("B") });
    expect(b.decision).toMatchObject({ op: "insert", card: { id: cardOf(a.layout, a.id).id } });
    expect(cardOf(b.layout, b.id).tabs.slice(-2)).toEqual([a.id, b.id]);
    // only A's tab is visible while A is selected
    const card = cardOf(b.layout, b.id);
    expect(shownTab(b.layout, card, ctx({ sessionId: "A" }))).toBe(a.id);
    expect(shownTab(b.layout, card, ctx({ sessionId: "B" }))).toBe(b.id);
  });

  it("8: focusing agent C hides a column with nothing of C's (one layout for every agent, §24); the follow column stays", () => {
    const { layout } = s0();
    const a = inNewColumn(layout, "side-chat.chat");
    const b = open(a.layout, "side-chat.chat", { binding: agent("B") });
    const chat = findPage(b.layout, pageOf(b.layout, a.id))!;
    expect(pageOf(b.layout, b.id)).toBe(chat.id);
    const c = ctx({ sessionId: "C" });
    expect(pageVisibility(b.layout, chat, c)).toBe("hidden");
    expect(lanePages(b.layout, c).map((p) => p.id)).toEqual([layout.pages[0]!.id]);
    expect(visibleCards(b.layout, chat, c)).toEqual([]);
    // for A both columns are on screen, side by side
    expect(shownPages(b.layout, ctx({ sessionId: "A" })).map((p) => p.id)).toEqual(b.layout.pages.map((p) => p.id));
  });

  it("9: files moved to a new column [user:P]; closed (the column goes) and reopened → a new column with that group; the override follows", () => {
    const { layout, files } = s0();
    const card = cardOf(layout, files).id;
    const moved = moveCard(layout, card, { newPage: true }, ++clock, orderOf);
    const p4 = pageOf(moved, files);
    expect(findPage(moved, p4)!.groups).toEqual([`user:${p4}`]);
    expect(moved.overrides["workspace.files"]).toMatchObject({ page: p4, groups: [`user:${p4}`] });
    expect(moved.activePage).toBe(p4);
    const closed = closeInstances(moved, [files]);
    expect(findPage(closed, p4)).toBeNull();
    const again = open(closed, "workspace.files");
    expect(again.decision).toMatchObject({ via: "override", page: { new: { groups: [`user:${p4}`] } } });
    const p5 = pageOf(again.layout, again.id);
    expect(p5).not.toBe(p4);
    expect(again.layout.overrides["workspace.files"]!.page).toBe(p5);
    const changes = again.layout.pages[0]!.cards[0]!.tabs[0]!;
    expect(again.layout.instances[changes]!.kind).toBe("workspace.changes");
  });

  it("10: merging the chat column into the workspace column unites groups and re-points overrides; later chats land there", () => {
    const first = open(emptyLayout(), "workspace.files");
    const a = inNewColumn(first.layout, "side-chat.chat");
    const chatPage = pageOf(a.layout, a.id);
    const workPage = a.layout.pages[0]!.id;
    expect(findPage(a.layout, chatPage)!.groups).toEqual(["chat"]);
    const withOv = { ...a.layout, overrides: { "side-chat.chat": { page: chatPage, groups: ["chat"], at: 1 } } };
    const merged = mergePages(withOv, chatPage, workPage);
    expect(merged.pages).toHaveLength(1);
    expect(merged.pages[0]!.groups).toEqual(["workspace", "chat"]);
    expect(kinds(merged).at(-1)).toBe("side-chat.chat");
    expect(merged.overrides["side-chat.chat"]).toMatchObject({ page: workPage, groups: ["workspace", "chat"] });
    sizesSum(merged).forEach((s) => expect(s).toBeCloseTo(1));
    const d = open({ ...merged, overrides: {} }, "side-chat.chat", { binding: agent("D") });
    expect(pageOf(d.layout, d.id)).toBe(workPage);
    // merging a full column into another: the panes beyond 3 become tabs of the third
    const full = inNewColumn(s0().layout, "side-chat.chat");
    const into = mergePages(full.layout, full.layout.pages[1]!.id, full.layout.pages[0]!.id);
    assertLimits(into);
    expect(cardOf(into, full.id).id).toBe(into.pages[0]!.cards[2]!.id);
  });

  it("11: a full column (3 panes) → a tab of its bottom pane (mixed kinds; an empty column gets a new pane first); never more than MAX_TOOL_PANES in all", () => {
    const { layout, t1 } = s0();
    const wt = open(layout, "workspace.worktrees");
    expect(wt.decision).toMatchObject({ via: "limit", page: { id: layout.pages[0]!.id }, card: { id: cardOf(layout, t1).id } });
    expect(wt.layout.pages).toHaveLength(1);
    assertLimits(wt.layout);
    // an empty (launcher) column next to it takes it as a new pane
    const launcher = openLauncherPage(layout);
    const wt1 = open({ ...launcher.layout, activePage: layout.pages[0]!.id }, "workspace.worktrees");
    expect(wt1.decision).toMatchObject({ via: "limit", page: { id: launcher.pageId }, card: { new: {} } });
    // 3 + 1 panes = MAX_TOOL_PANES: no room anywhere, the next kind is a tab of the column it goes to
    const two = inNewColumn(layout, "side-chat.chat");
    expect(two.layout.pages.reduce((n, p) => n + p.cards.length, 0)).toBe(MAX_TOOL_PANES);
    const wt2 = open({ ...two.layout, activePage: two.layout.pages[0]!.id }, "workspace.worktrees");
    expect(wt2.decision).toMatchObject({ via: "limit", page: { id: two.layout.pages[0]!.id }, card: { id: cardOf(layout, t1).id } });
    // (its group's column first: the workspace column, full → its bottom pane)
    const sub = open(two.layout, "subagents.thread", { key: "th1" });
    expect(sub.decision).toMatchObject({ op: "insert", page: { id: layout.pages[0]!.id }, card: { id: cardOf(layout, t1).id } });
    assertLimits(sub.layout);
  });

  it("12: a reference card (turn.peek) falls back to the focused column at order 150 (full: a tab); the next one replaces it; column hidden → the right-most column", () => {
    const { layout, t1 } = s0();
    const peek = open(layout, "turn.peek", { key: "turn:local:A:36", transient: true });
    expect(peek.decision).toMatchObject({ page: { id: layout.activePage }, card: { id: cardOf(layout, t1).id } });
    const next = open(peek.layout, "turn.peek", { key: "turn:local:A:40", transient: true });
    expect(next.decision).toEqual({ op: "replace", instance: peek.id });
    const roomy = open(s1().layout, "turn.peek", { key: "turn:local:A:36", transient: true });
    expect(kinds(roomy.layout)).toEqual(["workspace.files", "turn.peek", "workspace.changes"]);
    // the column hidden: "active" does not match → otherwise the right-most column (no new column)
    const closed = open({ ...layout, open: false }, "turn.peek", { key: "turn:local:A:36", transient: true });
    expect(closed.decision).toMatchObject({ via: "limit", page: { id: layout.pages[0]!.id } });
    expect(open(emptyLayout(), "turn.peek", { key: "k", transient: true }).decision).toMatchObject({ via: "otherwise", page: { new: { groups: ["reference"] } } });
  });

  it("13: reset clears overrides / names / order / sizes, replays by lastActiveAt, closes nothing; deterministic", () => {
    const base = s0();
    let l = base.layout;
    const chat = open(l, "side-chat.chat");
    l = chat.layout;
    l = moveCard(l, cardOf(l, base.files).id, { newPage: true }, ++clock, orderOf);
    l = mergePages(l, l.pages[1]!.id, l.pages[0]!.id);
    l = renamePage(l, l.pages[0]!.id, "Mine");
    l = setCardSizes(l, l.pages[0]!.id, { [l.pages[0]!.cards[0]!.id]: 5 });
    l = moveCard(l, cardOf(l, base.changes).id, { newPage: true }, ++clock, orderOf);
    l = movePage(l, l.pages[1]!.id, -1);
    const before = Object.keys(l.instances).sort();
    const r1 = resetLayout(l, specOf, 99);
    const r2 = resetLayout(l, specOf, 99);
    expect(r1).toEqual(r2);
    expect(r1.overrides).toEqual({});
    expect(Object.keys(r1.instances).sort()).toEqual(before);
    expect(r1.pages.map((p) => p.groups)).toEqual([["workspace"]]);
    expect(r1.pages.every((p) => p.name === undefined)).toBe(true);
    expect(kinds(r1)).toEqual(["workspace.files", "workspace.changes", "terminal.pty"]);
    expect(cardOf(r1, base.t1).tabs.slice(0, 2)).toEqual([base.t1, base.t2]);
    expect(r1.instances[base.t1]!.lastActiveAt).toBe(l.instances[base.t1]!.lastActiveAt);
    sizesSum(r1).forEach((s) => expect(s).toBeCloseTo(1));
    assertLimits(r1);
    expect(r1.open).toBe(true);
  });
});

// ── place(): reuse, transient, overrides, prefer, limits ──────────────────────────────────────

describe("place: reuse and transient", () => {
  it("a singleton is reused per binding; a keyed instance per key; key null is never reused", () => {
    const { layout, files } = s0();
    expect(decide(layout, "workspace.files")).toEqual({ op: "activate", instance: files });
    const p = open(layout, "workspace.preview", { key: "a.ts" });
    expect(decide(p.layout, "workspace.preview", { key: "a.ts" })).toEqual({ op: "activate", instance: p.id });
    expect(decide(p.layout, "workspace.preview", { key: "a.ts", binding: agent("B") })).toMatchObject({ op: "insert" });
    const n1 = open(layout, "workspace.preview", { key: null });
    expect(decide(n1.layout, "workspace.preview", { key: null })).toMatchObject({ op: "insert" });
  });

  it("activate updates the state (init result), keeps pinned, touches lastActiveAt, makes it the active tab", () => {
    const { layout, t1, jobs } = s0();
    const at = ++clock;
    const out = applyOpen(layout, { op: "activate", instance: t1 }, { kind: "terminal.pty", binding: ws("w1"), key: "t1", state: { x: 1 }, v: 2, pinned: false }, at, { reveal: false });
    expect(out.reused).toBe(true);
    expect(out.layout.instances[t1]).toMatchObject({ state: { x: 1 }, v: 2, lastActiveAt: at });
    expect(cardOf(out.layout, t1).active).toBe(t1);
    expect(cardOf(layout, t1).active).toBe(jobs); // input untouched
  });

  it("a pinned preview is not replaced: the next transient one is a new tab; pin: true opens pinned", () => {
    const { layout } = s1();
    const a = open(layout, "workspace.preview", { key: "a.ts", transient: true });
    const pinned = pinInstance(a.layout, a.id);
    const b = open(pinned, "workspace.preview", { key: "b.ts", transient: true });
    expect(b.decision).toMatchObject({ op: "insert", card: { id: cardOf(pinned, a.id).id } });
    expect(cardOf(b.layout, b.id).tabs).toEqual([a.id, b.id]);
    const c = open(b.layout, "workspace.preview", { key: "c.ts", transient: true });
    expect(c.decision).toEqual({ op: "replace", instance: b.id });
    const d = open(c.layout, "workspace.preview", { key: "d.ts", transient: true, pin: true });
    expect(d.decision).toMatchObject({ op: "insert" });
    expect(d.layout.instances[d.id]!.pinned).toBe(true);
  });

  it("transient replace is per binding (agent B's preview does not replace A's)", () => {
    const { layout } = s0();
    const a = open(layout, "workspace.preview", { key: "a.ts", transient: true });
    const b = open(a.layout, "workspace.preview", { key: "b.ts", transient: true, binding: agent("B") });
    expect(b.decision).toMatchObject({ op: "insert" });
    expect(Object.keys(b.layout.instances)).toContain(a.id);
  });

  it("an instance record without a card (not placed) is never reused", () => {
    const l: SideLayout = { ...emptyLayout(), instances: { i9: { kind: "workspace.files", binding: FOLLOW, key: SINGLETON_KEY, state: null, v: 1, pinned: false, lastActiveAt: 0 } }, seq: 9 };
    expect(decide(l, "workspace.files")).toMatchObject({ op: "insert" });
  });
});

describe("place: column choice", () => {
  it("override: its column → a column with one of its groups → a new column with its groups", () => {
    const { layout } = s1();
    const b = inNewColumn(layout, "browser.tab", { key: "u1" });
    const workPage = layout.pages[0]!.id;
    const browserPage = pageOf(b.layout, b.id);
    const ov = (page: string, groups: string[]) => ({ ...b.layout, overrides: { "workspace.preview": { page, groups, at: 1 } } });
    expect(decide(ov(browserPage, ["x"]), "workspace.preview", { key: "a" })).toMatchObject({ via: "override", page: { id: browserPage } });
    expect(decide(ov("p999", ["browser"]), "workspace.preview", { key: "a" })).toMatchObject({ via: "override", page: { id: browserPage } });
    expect(decide(ov("p999", ["workspace", "browser"]), "workspace.preview", { key: "a" })).toMatchObject({ via: "override", page: { id: workPage } });
    // a new column is refused at MAX_PAGES: the right-most column
    expect(decide(ov("p999", ["user:p999"]), "workspace.preview", { key: "a" })).toMatchObject({ via: "limit", page: { id: browserPage } });
    expect(decide({ ...layout, overrides: { "workspace.preview": { page: "p999", groups: ["user:p999"], at: 1 } } }, "workspace.preview", { key: "a" })).toMatchObject({ via: "override", page: { new: { groups: ["user:p999"] } } });
  });

  it("an explicit column wins over overrides and rules; an unknown explicit column is ignored", () => {
    const { layout } = s1();
    const b = inNewColumn(layout, "browser.tab", { key: "u1" });
    const browserPage = pageOf(b.layout, b.id);
    const l = { ...b.layout, overrides: { "workspace.preview": { page: layout.pages[0]!.id, groups: ["workspace"], at: 1 } } };
    expect(decide(l, "workspace.preview", { key: "a", page: browserPage })).toMatchObject({ via: "explicit", page: { id: browserPage } });
    expect(decide(l, "workspace.preview", { key: "a", page: "p404" })).toMatchObject({ via: "override" });
  });

  it("prefer is tried in order: diff.view goes to the column containing 改动, not the first workspace column", () => {
    let l = emptyLayout();
    l = open(l, "workspace.files").layout;
    const ch = open(l, "workspace.changes", { page: undefined });
    l = moveCard(ch.layout, cardOf(ch.layout, ch.id).id, { newPage: true }, ++clock, orderOf);
    const changesPage = pageOf(l, ch.id);
    l = { ...l, overrides: {} };
    expect(decide(l, "diff.view", { key: "git:a" })).toMatchObject({ via: "rule", page: { id: changesPage } });
    const noChanges = closeInstances(l, [ch.id]);
    expect(decide(noChanges, "diff.view", { key: "git:a" })).toMatchObject({ via: "rule", page: { id: noChanges.pages[0]!.id } });
  });

  it("otherwise: the right-most column (never a new one); active-page: the focused column; a new column only without any", () => {
    const { layout } = s1();
    expect(decide(layout, "browser.tab", { key: "x" })).toMatchObject({ via: "otherwise", page: { id: layout.pages[0]!.id } });
    expect(decide(layout, "notes.note", { key: "n1" })).toMatchObject({ via: "otherwise", page: { id: layout.activePage } });
    const two = inNewColumn(layout, "side-chat.chat");
    const focusedLeft = { ...two.layout, activePage: two.layout.pages[0]!.id };
    expect(decide(focusedLeft, "browser.tab", { key: "x" })).toMatchObject({ via: "otherwise", page: { id: two.layout.pages[1]!.id } });
    expect(decide(focusedLeft, "notes.note", { key: "n1" })).toMatchObject({ via: "otherwise", page: { id: two.layout.pages[0]!.id } });
    expect(decide(emptyLayout(), "notes.note", { key: "n1" })).toMatchObject({ via: "otherwise", page: { new: { groups: ["notes"] } } });
  });

  it(`at ${MAX_PAGES} columns a new column is refused: the right-most column (via limit)`, () => {
    const l = pagesLayout(MAX_PAGES, 1);
    const ov = { ...l, overrides: { "side-chat.chat": { page: "p404", groups: ["user:p404"], at: 1 } } };
    expect(decide(ov, "side-chat.chat")).toMatchObject({ via: "limit", page: { id: l.pages[MAX_PAGES - 1]!.id } });
    expect(openLauncherPage(l).pageId).toBeNull();
    expect(moveCard(l, l.pages[0]!.cards[0]!.id, { newPage: true }, ++clock, orderOf)).toBe(l);
  });
});

/** n columns (groups g0…), each with `cards` subagent-thread panes of one tab (built as JSON). */
function pagesLayout(n: number, cards: number): SideLayout {
  const l = emptyLayout();
  for (let p = 0; p < n; p++) {
    const page = { id: `p${++l.seq}`, groups: [`g${p}`], cards: [] as SideLayout["pages"][number]["cards"] };
    for (let c = 0; c < cards; c++) {
      const id = `i${++l.seq}`;
      l.instances[id] = { kind: "subagents.thread", binding: agent("A"), key: `${p}-${c}`, state: null, v: 1, pinned: false, lastActiveAt: l.seq };
      page.cards.push({ id: `c${++l.seq}`, kind: "subagents.thread", tabs: [id], active: id, size: 1 / cards, collapsed: false });
    }
    l.pages.push(page);
  }
  l.activePage = l.pages[0]?.id ?? null;
  l.open = n > 0;
  return l;
}

describe("place: pane choice and full columns", () => {
  it("a new pane goes after the last pane whose order ≤ its order — also after the user reordered", () => {
    const cards = (ks: ItemId[]) => ks.map((kind, k) => ({ id: `c${k}`, kind, tabs: [`i${k}`], active: `i${k}`, size: 1, collapsed: false }));
    expect(newCardIndex(cards(["workspace.files", "workspace.changes"]), 300, orderOf)).toBe(2);
    expect(newCardIndex(cards(["workspace.files", "workspace.changes"]), 150, orderOf)).toBe(1);
    expect(newCardIndex(cards(["workspace.files", "workspace.changes"]), 50, orderOf)).toBe(0);
    expect(newCardIndex(cards(["workspace.changes", "workspace.files"]), 150, orderOf)).toBe(2);
    const { layout } = s1();
    const up = moveCard(layout, layout.pages[0]!.cards[1]!.id, { delta: -1 }, ++clock, orderOf);
    expect(kinds(up)).toEqual(["workspace.changes", "workspace.files"]);
    const p = open(up, "turn.peek", { key: "a" });
    expect(kinds(p.layout)).toEqual(["workspace.changes", "workspace.files", "turn.peek"]);
  });

  it("two same-kind panes in the column: the tab goes to the one used most recently", () => {
    let l = open(emptyLayout(), "workspace.files").layout;
    const t1 = open(l, "terminal.pty", { binding: ws("w1"), key: "t1" });
    const t2 = open(t1.layout, "terminal.pty", { binding: ws("w1"), key: "t2" });
    l = t2.layout;
    const split = splitInstance(l, t2.id, ++clock);
    const c1 = cardOf(split, t1.id).id;
    const c2 = cardOf(split, t2.id).id;
    expect(c1).not.toBe(c2);
    expect(decide(split, "terminal.pty", { binding: ws("w1"), key: "t3" })).toMatchObject({ card: { id: c2 } });
    const used = applyOpen(split, { op: "activate", instance: t1.id }, { kind: "terminal.pty", binding: ws("w1"), key: "t1", state: null, v: 1, pinned: false }, ++clock, { reveal: false }).layout;
    expect(decide(used, "terminal.pty", { binding: ws("w1"), key: "t3" })).toMatchObject({ card: { id: c1 } });
  });

  it("full column step 1: another column's pane of the kind takes it as a tab", () => {
    const { layout } = s0();
    const sub = inNewColumn(layout, "subagents.thread", { key: "th1" });
    const l = { ...sub.layout, activePage: sub.layout.pages[0]!.id };
    const sub2 = open(l, "subagents.thread", { key: "th2" });
    expect(sub2.decision).toMatchObject({ via: "limit", page: { id: l.pages[1]!.id }, card: { id: cardOf(l, sub.id).id } });
  });

  it("full column step 2: another column with room (an empty launcher column; the panes in all are capped) → a new pane there", () => {
    const l = pagesLayout(1, MAX_CARDS);
    const made = openLauncherPage(l);
    const full = { ...made.layout, activePage: l.pages[0]!.id };
    const d = decide(full, "notes.note", { key: "n" }); // otherwise active-page → column 1 (full)
    expect(d).toMatchObject({ via: "limit", page: { id: made.pageId }, card: { new: {} } });
  });

  it("full column step 3: no room anywhere → a tab of the bottom pane (mixed kinds); a pane of the kind is still used first", () => {
    const l = pagesLayout(1, MAX_CARDS);
    const n = open(l, "notes.note", { key: "n" });
    expect(n.decision).toMatchObject({ via: "limit", page: { id: l.pages[0]!.id }, card: { id: l.pages[0]!.cards.at(-1)!.id } });
    expect(n.layout.pages[0]!.cards).toHaveLength(MAX_CARDS);
    expect(cardHolds(n.layout, n.layout.pages[0]!.cards.at(-1)!, "notes.note")).toBe(true);
    const sub = decide(l, "subagents.thread", { key: "new" });
    expect(sub).toMatchObject({ op: "insert", card: { id: l.pages[0]!.cards.at(-1)!.id } });
  });
});

// ── Reducers ───────────────────────────────────────────────────────────────────────────────────

describe("reducers", () => {
  it("never mutate their input", () => {
    const { layout, files, t1 } = s0();
    const snapshot = JSON.stringify(layout);
    moveCard(layout, cardOf(layout, files).id, { newPage: true }, 1, orderOf);
    moveInstance(layout, t1, { newPage: true }, 1, orderOf);
    splitInstance(layout, t1, 1);
    closeInstances(layout, [files]);
    resetLayout(layout, specOf, 1);
    restoreDefault(layout, files, specOf, 1);
    setCollapsed(layout, cardOf(layout, files).id, true);
    renamePage(layout, layout.pages[0]!.id, "x");
    equalizeCards(layout, layout.pages[0]!.id);
    openLauncherPage(layout);
    foldPages(layout, null);
    expect(JSON.stringify(layout)).toBe(snapshot);
  });

  it("moving a tab to a new column: user group, override, the old pane keeps the other tabs", () => {
    const { layout, t1, t2, jobs } = s0();
    const out = moveInstance(layout, t1, { newPage: true }, ++clock, orderOf);
    const page = findPage(out, pageOf(out, t1))!;
    expect(page.groups).toEqual([`user:${page.id}`]);
    expect(cardOf(out, t2).tabs).toEqual([t2, jobs]);
    expect(out.overrides["terminal.pty"]!.page).toBe(page.id);
    expect(out.activePage).toBe(page.id);
    const back = moveInstance(out, t1, { page: out.pages[0]!.id }, ++clock, orderOf);
    expect(cardOf(back, t1).tabs.sort()).toEqual([t1, t2, jobs].sort());
    expect(back.pages).toHaveLength(1);
  });

  it("split: the tab becomes its own pane of its kind right below while the column has room; no override; a single tab / a full column cannot split", () => {
    let l = open(emptyLayout(), "workspace.files").layout;
    const files = Object.keys(l.instances)[0]!;
    const t1 = open(l, "terminal.pty", { binding: ws("w1"), key: "t1" });
    const t2 = open(t1.layout, "terminal.pty", { binding: ws("w1"), key: "t2" });
    l = t2.layout;
    const out = splitInstance(l, t1.id, ++clock);
    expect(locate(out, t1.id)!.cardIndex).toBe(locate(out, t2.id)!.cardIndex + 1);
    expect(out.overrides).toEqual({});
    expect(splitInstance(l, files, ++clock)).toBe(l);
    assertNeverMixed(out);
    const full = s0();
    expect(splitInstance(full.layout, full.t1, ++clock)).toBe(full.layout);
  });

  it("moveCard into a column with a pane of its kind merges the tabs; up / down reorder; a 1-pane column cannot go to a new column", () => {
    const { layout, files } = s0();
    const own = moveCard(layout, cardOf(layout, files).id, { newPage: true }, ++clock, orderOf);
    expect(moveCard(own, cardOf(own, files).id, { newPage: true }, ++clock, orderOf)).toBe(own);
    const top = moveCard(layout, cardOf(layout, files).id, { delta: -1 }, ++clock, orderOf);
    expect(top).toBe(layout);
    const down = moveCard(layout, cardOf(layout, files).id, { delta: 1 }, ++clock, orderOf);
    expect(kinds(down)).toEqual(["workspace.changes", "workspace.files", "terminal.pty"]);
  });

  it("restore default forgets the override and re-places by the rules", () => {
    const { layout, files } = s0();
    const moved = moveCard(layout, cardOf(layout, files).id, { newPage: true }, ++clock, orderOf);
    expect(moved.pages).toHaveLength(2);
    const back = restoreDefault(moved, files, specOf, ++clock);
    expect(back.overrides["workspace.files"]).toBeUndefined();
    expect(back.pages).toHaveLength(1);
    expect(kinds(back)).toEqual(["workspace.files", "workspace.changes", "terminal.pty"]);
    expect(back.instances[files]).toEqual(moved.instances[files]);
  });

  it("restore a kind's default (settings): override gone, its instances back; nothing placed = just the override", () => {
    const { layout, files } = s0();
    const moved = moveCard(layout, cardOf(layout, files).id, { newPage: true }, ++clock, orderOf);
    const back = restoreKindDefault(moved, "workspace.files", specOf, ++clock);
    expect(back.overrides["workspace.files"]).toBeUndefined();
    expect(kinds(back)).toEqual(["workspace.files", "workspace.changes", "terminal.pty"]);
    const closed = closeInstances(moved, [files]);
    expect(closed.overrides["workspace.files"]).toBeDefined();
    const forgot = restoreKindDefault(closed, "workspace.files", specOf, ++clock);
    expect(forgot.overrides["workspace.files"]).toBeUndefined();
    expect(forgot.pages).toEqual(closed.pages);
    expect(restoreKindDefault(layout, "workspace.files", specOf, ++clock).overrides).toEqual(layout.overrides);
  });

  it("closing the last instance of a column drops the column (neighbour focused); the last column hides the tool area", () => {
    const { layout } = s0();
    const b = inNewColumn(layout, "browser.tab", { key: "u" });
    const closed = closeInstances(b.layout, [b.id]);
    expect(closed.pages).toHaveLength(1);
    expect(closed.activePage).toBe(layout.pages[0]!.id);
    const all = closeInstances(closed, Object.keys(closed.instances));
    expect(all.pages).toEqual([]);
    expect(all.open).toBe(false);
    expect(all.activePage).toBeNull();
    expect(all.seq).toBe(closed.seq);
  });

  it("closing the active tab activates its neighbour", () => {
    const { layout, t2, jobs } = s0();
    const out = closeInstances(layout, [jobs]);
    expect(cardOf(out, t2).active).toBe(t2);
  });

  it("a launcher column: focused while empty, takes the first component's group, dropped when left empty", () => {
    const { layout } = s0();
    const { layout: l, pageId } = openLauncherPage(layout);
    expect(l.activePage).toBe(pageId);
    expect(findPage(l, pageId)!.launcher).toBe(true);
    const left = switchPage(l, l.pages[0]!.id);
    expect(findPage(left, pageId)).toBeNull();
    const filled = open(l, "browser.tab", { key: "u", page: pageId! });
    expect(findPage(filled.layout, pageId)!.groups).toEqual(["browser"]);
    expect(findPage(filled.layout, pageId)!.launcher).toBeUndefined();
    expect(dropEmptyPage(l, pageId!).pages).toHaveLength(1);
    expect(openLauncherPage(l).pageId).toBe(pageId);
  });

  it("collapse / rename / sizes", () => {
    const { layout, files } = s0();
    const id = cardOf(layout, files).id;
    expect(findCard(setCollapsed(layout, id, true), id)!.card.collapsed).toBe(true);
    expect(setCollapsed(layout, id, false)).toBe(layout);
    const named = renamePage(layout, layout.pages[0]!.id, "  Work  ");
    expect(named.pages[0]!.name).toBe("Work");
    expect(renamePage(named, layout.pages[0]!.id, " ").pages[0]!.name).toBeUndefined();
    const sized = setCardSizes(layout, layout.pages[0]!.id, { [id]: 3 });
    sizesSum(sized).forEach((s) => expect(s).toBeCloseTo(1));
    expect(findCard(sized, id)!.card.size).toBeGreaterThan(0.5);
    const eq = equalizeCards(sized, layout.pages[0]!.id);
    eq.pages[0]!.cards.forEach((c) => expect(c.size).toBeCloseTo(1 / 3));
  });

  it("a share puts the new pane at that share; the others shrink in proportion", () => {
    let l = open(emptyLayout(), "workspace.files").layout;
    l = open(l, "terminal.pty", { binding: ws("w1"), key: "t1" }).layout;
    expect(l.pages[0]!.cards.map((c) => +c.size.toFixed(2))).toEqual([0.65, 0.35]);
  });

  it("dropDeletedAgents removes instances of deleted agents only (on that host)", () => {
    const { layout } = s0();
    const a = open(layout, "side-chat.chat");
    const b = open(a.layout, "side-chat.chat", { binding: agent("B") });
    const other = open(b.layout, "side-chat.chat", { binding: agent("B", "workstation") });
    const out = dropDeletedAgents(other.layout, "local", (id) => id === "A");
    expect(out.instances[a.id]).toBeDefined();
    expect(out.instances[b.id]).toBeUndefined();
    expect(out.instances[other.id]).toBeDefined();
  });

  it("the limits hold whatever the reducers do (fitLayout): > 3 panes in a column become tabs of the third", () => {
    const l = pagesLayout(1, 5);
    const fitted = fitLayout(l);
    assertLimits(fitted);
    expect(fitted.pages[0]!.cards[2]!.tabs).toHaveLength(3);
    expect(Object.keys(fitted.instances)).toHaveLength(5);
    expect(fitLayout(fitted)).toBe(fitted);
  });
});

// ── Visibility ─────────────────────────────────────────────────────────────────────────────────

describe("visibility (bindings, dormant, hidden)", () => {
  it("follow: any selected agent on its host; agent: only that one on that host; workspace: same workspace; host: that host", () => {
    const { layout, files, t1 } = s0();
    const a = open(layout, "side-chat.chat");
    const br = open(a.layout, "browser.tab", { key: "u" });
    const l = br.layout;
    const c = (o: Partial<SideViewContext>) => ctx(o);
    expect(instanceVisible(l, files, c({ sessionId: "Z" }))).toBe(true);
    expect(instanceVisible(l, files, c({ sessionId: null }))).toBe(false);
    expect(instanceVisible(l, files, c({ hostId: "workstation", sessionId: "Z" }))).toBe(false);
    expect(instanceVisible(l, a.id, c({ sessionId: "B" }))).toBe(false);
    expect(instanceVisible(l, a.id, c({ hostId: "workstation" }))).toBe(false);
    expect(instanceVisible(l, t1, c({ sessionId: "B", workspaceKey: "w1" }))).toBe(true);
    expect(instanceVisible(l, t1, c({ workspaceKey: "w2" }))).toBe(false);
    expect(instanceVisible(l, t1, c({ workspaceKey: null }))).toBe(false);
    expect(instanceVisible(l, br.id, c({ sessionId: null }))).toBe(true);
    expect(instanceVisible(l, br.id, c({ hostId: "workstation" }))).toBe(false);
  });

  it("resolveBinding: the agent / host a Body works on", () => {
    expect(resolveBinding({ kind: "follow", hostId: "h" }, { hostId: "h", sessionId: "s" })).toEqual({ hostId: "h", sessionId: "s" });
    // A follow of another host has no agent while this one is shown.
    expect(resolveBinding(FOLLOW, { hostId: "h", sessionId: "s" })).toEqual({ hostId: "local", sessionId: null });
    expect(resolveBinding(agent("B", "x"), { hostId: "h", sessionId: "s" })).toEqual({ hostId: "x", sessionId: "B" });
    expect(resolveBinding(ws("w", "h"), { hostId: "h", sessionId: "s" })).toEqual({ hostId: "h", sessionId: "s" });
    expect(resolveBinding(host("x"), { hostId: "h", sessionId: "s" })).toEqual({ hostId: "x", sessionId: null });
  });

  it("an agent without the component's feature does not see it (lacks)", () => {
    const { layout, files } = s0();
    expect(instanceVisible(layout, files, ctx({ lacks: (kind, s) => kind === "workspace.files" && s === "A" }))).toBe(false);
  });

  it("dormant (module off) or another host's: the column leaves the screen", () => {
    const { layout } = s0();
    const b = inNewColumn(layout, "browser.tab", { key: "u" });
    const browserPage = findPage(b.layout, pageOf(b.layout, b.id))!;
    const off = ctx({ available: (k) => k !== "browser.tab" });
    expect(pageVisibility(b.layout, browserPage, off)).toBe("hidden");
    expect(lanePages(b.layout, off).map((p) => p.id)).toEqual([layout.pages[0]!.id]);
    // the page in view is hidden → the first lane page is in view
    expect(pageInView(b.layout, off)!.id).toBe(layout.pages[0]!.id);
    expect(pageVisibility(b.layout, browserPage, ctx({ hostId: "workstation" }))).toBe("hidden");
    expect(pageVisibility(b.layout, browserPage, ctx())).toBe("shown");
  });

  it("the shown tab falls back to the most recent visible tab when the active one belongs to someone else", () => {
    const { layout } = s0();
    const a = open(layout, "side-chat.chat");
    const b = open(a.layout, "side-chat.chat", { binding: agent("B") });
    const a2 = open(b.layout, "workspace.preview", { key: "x" });
    const card = cardOf(b.layout, b.id);
    expect(card.active).toBe(b.id);
    expect(shownTab(a2.layout, card, ctx({ sessionId: "A" }))).toBe(a.id);
  });

  it("scopes are isolated: another host's bindings never show here", () => {
    const { layout } = s0();
    const other = inNewColumn(layout, "browser.tab", { binding: host("workstation"), key: "u" });
    const page = findPage(other.layout, pageOf(other.layout, other.id))!;
    expect(pageVisibility(other.layout, page, ctx())).toBe("hidden");
    expect(pageVisibility(other.layout, page, ctx({ hostId: "workstation" }))).toBe("shown");
  });
});

// ── Heights, widths, names ────────────────────────────────────────────────────────────────────

describe("geometry", () => {
  it("one card takes all; collapsed cards get the header; shares split the rest", () => {
    expect(cardHeights([{ size: 1, collapsed: true }], 500)).toEqual([{ folded: false, height: 500 }]);
    const h = cardHeights([{ size: 0.5, collapsed: false }, { size: 0.5, collapsed: true }, { size: 0.5, collapsed: false }], 600);
    expect(h[1]).toEqual({ folded: true, height: CARD_HEADER });
    const room = 600 - 2 * CARD_GAP - CARD_HEADER;
    expect(h[0]!.height).toBeCloseTo(room / 2);
    expect(h[2]!.height).toBeCloseTo(room / 2);
  });

  it("no room for the minimum heights: the bottom expanded cards fold first; one card always stays open", () => {
    const h = cardHeights([{ size: 1, collapsed: false }, { size: 1, collapsed: false }, { size: 1, collapsed: false }], 250);
    expect(h.map((b) => b.folded)).toEqual([false, true, true]);
    expect(h[0]!.height).toBe(250 - 2 * CARD_GAP - 2 * CARD_HEADER);
    // with a little more room only the bottom one folds
    expect(cardHeights([{ size: 1, collapsed: false }, { size: 1, collapsed: false }, { size: 1, collapsed: false }], 300).map((b) => b.folded)).toEqual([false, false, true]);
    const all = cardHeights([{ size: 1, collapsed: true }, { size: 1, collapsed: true }], 400);
    expect(all.map((b) => b.folded)).toEqual([false, true]);
    const h2 = cardHeights([{ size: 1, collapsed: false }, { size: 1, collapsed: false }], 2 * MIN_CARD_HEIGHT + CARD_GAP);
    expect(h2.every((b) => !b.folded && b.height >= MIN_CARD_HEIGHT)).toBe(true);
  });

  it("dragging a gap keeps the pair's total and each side's minimum", () => {
    expect(dragGap([0.5, 0.5], 0, 1, 100, 1000, 0.1)).toEqual([0.6, 0.4]);
    const clamped = dragGap([0.5, 0.5], 0, 1, 1000, 1000, 0.1);
    expect(clamped[0]).toBeCloseTo(0.9);
    expect(clamped[1]).toBeCloseTo(0.1);
  });

  it("narrow: below conversation + side minimums the side is a drawer; widths clamp", () => {
    expect(isNarrow(619)).toBe(true);
    expect(isNarrow(620)).toBe(false);
    expect(sideWidth(420, 1400, false)).toBe(420);
    expect(sideWidth(2000, 1000, false)).toBe(1000 - 360 - CARD_GAP);
    expect(sideWidth(100, 1000, false)).toBe(260);
    expect(sideWidth(420, 400, true)).toBe(352);
  });

  it("page names: the user's, else the first two distinct card names + n", () => {
    const { layout } = s0();
    const name = (c: { kind: string }) => c.kind.split(".").pop()!;
    expect(pageName(layout.pages[0]!, name, "New page")).toBe("files · changes +1");
    expect(pageName({ ...layout.pages[0]!, name: "Mine" }, name, "New page")).toBe("Mine");
    expect(pageName({ id: "p1", groups: [], cards: [] }, name, "New page")).toBe("New page");
  });
});

// ── Persistence ────────────────────────────────────────────────────────────────────────────────

describe("persistence", () => {
  const all = { persist: () => true };

  it("round trip: prepareForSave → JSON → sanitizeLayout keeps the layout", () => {
    const { layout } = s0();
    const saved = JSON.parse(JSON.stringify(prepareForSave(layout, all))) as unknown;
    expect(sanitizeLayout(saved)).toEqual(prepareForSave(layout, all));
  });

  it("sanitize drops bad parts, never throws, keeps seq above every id, drops orphans; keeps a full column's mixed tabs (§24); drops v1.16 per-agent views", () => {
    expect(sanitizeLayout(null)).toEqual(emptyLayout());
    expect(sanitizeLayout("x")).toEqual(emptyLayout());
    const raw = {
      open: true,
      seq: 2,
      activePage: "p404",
      pages: [
        { id: "p1", groups: ["workspace", 7, ""], cards: [{ id: "c2", kind: "workspace.files", tabs: ["i3", "i5", "i3"], active: "i9", size: -1 }, { id: "bad", kind: "x.y", tabs: ["i4"] }] },
        { id: "p1", groups: [], cards: [] },
        "junk",
      ],
      instances: {
        i3: { kind: "workspace.files", binding: { kind: "follow" }, key: "∅", state: { a: 1 }, v: 1, lastActiveAt: 5 },
        i4: { kind: "x.y", binding: { kind: "agent", hostId: "h" } },
        i5: { kind: "diff.view", binding: { kind: "follow" } },
        i8: { kind: "workspace.files", binding: { kind: "follow" } },
        __proto__: { kind: "a.b" },
        i9: { kind: "bad", binding: { kind: "follow" } },
      },
      overrides: { "workspace.files": { page: "p1", groups: ["workspace"], at: 3 }, nope: { page: "p1", groups: [] } },
      views: { A: { open: true, page: "p1", at: 4 }, B: { open: "x" }, C: { open: true, page: "p99", at: 2 }, D: { open: true, page: null } },
    };
    const l = sanitizeLayout(raw);
    expect(l.pages).toHaveLength(1);
    expect(l.pages[0]!.groups).toEqual(["workspace"]);
    expect(l.pages[0]!.cards).toEqual([{ id: "c2", kind: "workspace.files", tabs: ["i3", "i5"], active: "i3", size: 1, collapsed: false }]);
    expect(Object.keys(l.instances).sort()).toEqual(["i3", "i5"]);
    expect(l.overrides).toEqual({ "workspace.files": { page: "p1", groups: ["workspace"], at: 3 } });
    expect("views" in l).toBe(false);
    expect(l.activePage).toBe("p1");
    expect(l.open).toBe(true);
    expect(l.seq).toBeGreaterThanOrEqual(8); // i8 (a valid record, dropped as an orphan) still counts
    // A v1.4 follow (no host) belongs to the layout's host (one-way, v1.5).
    expect(l.instances.i3!.binding).toEqual({ kind: "follow", hostId: "local" });
    expect(sanitizeLayout(raw, "ssh-7a3f01c2").instances.i3!.binding).toEqual({ kind: "follow", hostId: "ssh-7a3f01c2" });
    expect(sanitizeLayout({ ...raw, instances: { i3: { kind: "workspace.files", binding: { kind: "follow", hostId: "ssh-b" } } } }).instances.i3!.binding).toEqual({ kind: "follow", hostId: "ssh-b" });
  });

  it("not saved: persist:false components, states over 4 KiB, launcher pages", () => {
    const { layout, files, t1 } = s0();
    const big = { ...layout, instances: { ...layout.instances, [files]: { ...layout.instances[files]!, state: "x".repeat(STATE_LIMIT + 1) } } };
    const saved = prepareForSave(openLauncherPage(big).layout, { persist: (k) => k !== "terminal.pty" });
    expect(saved.instances[files]).toBeUndefined();
    expect(saved.instances[t1]).toBeUndefined();
    // the terminal pane keeps its status tab: it is that kind's pane now (its home kind follows its tabs)
    expect(kinds(saved)).toEqual(["workspace.changes", "status:jobs.tasks"]);
    expect(saved.pages).toHaveLength(1);
    expect(saved.activePage).toBe(saved.pages[0]!.id);
    sizesSum(saved).forEach((s) => expect(s).toBeCloseTo(1));
  });

  it("over MAX_INSTANCES the oldest invisible instances go first", () => {
    let l = open(emptyLayout(), "workspace.preview", { key: "visible-old" }).layout;
    const visibleOld = Object.keys(l.instances)[0]!;
    for (let k = 0; k < MAX_INSTANCES + 5; k++) l = open(l, "workspace.preview", { key: `f${k}`, binding: agent("B") }).layout;
    const saved = prepareForSave(l, { persist: () => true, visible: (id) => l.instances[id]!.binding.kind === "agent" && (l.instances[id]!.binding as { sessionId: string }).sessionId === "A" });
    expect(Object.keys(saved.instances)).toHaveLength(MAX_INSTANCES);
    expect(saved.instances[visibleOld]).toBeDefined();
    const keys = Object.values(saved.instances).map((i) => i.key);
    expect(keys).not.toContain("f0");
    expect(keys).toContain(`f${MAX_INSTANCES + 4}`);
  });

  it("over MAX_OVERRIDES the oldest overrides go", () => {
    const overrides = Object.fromEntries(Array.from({ length: MAX_OVERRIDES + 3 }, (_, k) => [`m${k}.c`, { page: "p1", groups: [], at: k }]));
    const saved = prepareForSave({ ...emptyLayout(), overrides }, all);
    expect(Object.keys(saved.overrides)).toHaveLength(MAX_OVERRIDES);
    expect(saved.overrides["m0.c"]).toBeUndefined();
  });

  it("restore: unknown components stay dormant; restore → null drops the tab; a state is replaced", () => {
    const { layout, files, changes, jobs } = s0();
    const out = restoreInstances(layout, (inst, id) => {
      if (id === files) return null;
      if (id === changes) return { state: { restored: true }, v: 2 };
      return "keep";
    });
    expect(out.instances[files]).toBeUndefined();
    expect(out.instances[changes]).toMatchObject({ state: { restored: true }, v: 2 });
    expect(out.instances[jobs]).toEqual(layout.instances[jobs]);
    expect(restoreInstances(layout, () => "keep")).toBe(layout);
  });
});

// ── One layout for every agent (§24; replaces §18.5's per-agent views, RFC §13 D27′) ────────────

describe("one layout for every agent (v1.17: no per-agent views)", () => {
  const bctx = (sessionId: string | null, workspaceKey: string | null = "w1") => ({ hostId: "local", sessionId, workspaceKey });

  it("focusing B keeps the tool area as it is: a column with nothing of B's leaves the screen; A sees it again", () => {
    const files = open(emptyLayout(), "workspace.files");
    const chat = inNewColumn(files.layout, "side-chat.chat");
    const l = chat.layout;
    expect(l.open).toBe(true);
    expect(shownPages(l, ctx({ sessionId: "A" })).map((p) => p.id)).toEqual(l.pages.map((p) => p.id));
    expect(shownPages(l, ctx({ sessionId: "B" })).map((p) => p.id)).toEqual([l.pages[0]!.id]);
    expect(columnsOnScreen(l, ctx({ sessionId: "B" }), null).map((c) => c.page.id)).toEqual([l.pages[0]!.id]);
    expect(shownPages({ ...l, open: false }, ctx())).toEqual([]);
  });

  it("host- and workspace-bound columns show for every agent they apply to", () => {
    const br = open(emptyLayout(), "browser.tab", { key: "u" });
    const t = inNewColumn(br.layout, "terminal.pty", { binding: ws("w1"), key: "t" });
    const l = t.layout;
    expect(lanePages(l, ctx({ sessionId: "B", workspaceKey: "w9" })).map((p) => p.id)).toEqual([pageOf(l, br.id)]);
    expect(lanePages(l, ctx({ sessionId: "C", workspaceKey: "w1" })).map((p) => p.id)).toEqual(l.pages.map((p) => p.id));
    expect(lanePages(l, ctx({ sessionId: null, workspaceKey: null })).map((p) => p.id)).toEqual([pageOf(l, br.id)]);
  });

  it("the tool area shows with a column for this agent, or (open) with nothing placed at all — not when only others' content is left", () => {
    const a = open(emptyLayout(), "side-chat.chat");
    expect(toolAreaShown(a.layout, ctx({ sessionId: "A" }))).toBe(true);
    expect(toolAreaShown(a.layout, ctx({ sessionId: "B" }))).toBe(false);
    expect(toolAreaShown({ ...emptyLayout(), open: true }, ctx())).toBe(true);
    expect(toolAreaShown(emptyLayout(), ctx())).toBe(false);
  });

  it("closing the agent's last content hides the tool area, even when other agents' content remains", () => {
    const a = open(emptyLayout(), "side-chat.chat");
    const b = open(a.layout, "side-chat.chat", { binding: agent("B") });
    const next = closeInstances(b.layout, [a.id]);
    expect(next.open).toBe(true);
    expect(hasContentFor(next, bctx("A"))).toBe(false);
    expect(closeIfEmptied(b.layout, next, bctx("A")).open).toBe(false);
    const empty = emptyLayout();
    const opened = openLauncherPage(empty).layout;
    expect(closeIfEmptied(empty, opened, bctx("A")).open).toBe(true);
  });

  it("maximise / full screen on screen: a card = its column with that card; the focused column", () => {
    const { layout, files } = s0();
    const b = inNewColumn(layout, "browser.tab", { key: "u" });
    const l = b.layout;
    const card = cardOf(l, files).id;
    expect(columnsOnScreen(l, ctx(), { card })).toEqual([{ page: l.pages[0]!, only: card }]);
    expect(columnsOnScreen({ ...l, activePage: l.pages[1]!.id }, ctx(), { card: null })).toEqual([{ page: l.pages[1]!, only: null }]);
    expect(columnsOnScreen(l, ctx(), null)).toHaveLength(2);
  });
});

// ── v1.16 → v1.17: folding the pages into one column (§24 迁移) ─────────────────────────────────

describe("foldPages (the v1.16 right side as one tool column)", () => {
  it("keeps the given page; the other pages' cards join it as panes, tabs of their kind's pane, else tabs of its bottom pane; nothing is lost", () => {
    // v1.16 shape: a workspace page (files, changes), a browser page, a chat page; built as JSON.
    const l = emptyLayout();
    const inst = (kind: string, binding: SideBinding) => {
      const id = `i${++l.seq}`;
      l.instances[id] = { kind: kind as ItemId, binding, key: SINGLETON_KEY, state: { kind }, v: 1, pinned: false, lastActiveAt: l.seq };
      return id;
    };
    const card = (kind: string, tabs: string[]) => ({ id: `c${++l.seq}`, kind: kind as ItemId, tabs, active: tabs[0]!, size: 1, collapsed: false });
    const f = inst("workspace.files", FOLLOW);
    const ch = inst("workspace.changes", FOLLOW);
    const br = inst("browser.tab", host());
    const t = inst("terminal.pty", ws("w1"));
    const sc = inst("side-chat.chat", agent("A"));
    const sc2 = inst("side-chat.chat", agent("B"));
    l.pages = [
      { id: "p90", groups: ["workspace"], cards: [card("workspace.files", [f]), card("workspace.changes", [ch])] },
      { id: "p91", groups: ["browser"], cards: [card("browser.tab", [br]), card("terminal.pty", [t])] },
      { id: "p92", groups: ["chat"], cards: [card("side-chat.chat", [sc, sc2])] },
    ];
    l.activePage = "p92";
    l.open = true;
    l.overrides = { "browser.tab": { page: "p91", groups: ["browser"], at: 1 } };
    const out = foldPages(l, "p91");
    expect(out.pages.map((p) => p.id)).toEqual(["p91"]);
    expect(out.pages[0]!.groups).toEqual(["browser", "workspace", "chat"]);
    assertLimits(out);
    // browser, terminal + files (room for a third pane); changes and the chats: tabs of the bottom pane
    expect(kinds(out)).toEqual(["browser.tab", "terminal.pty", "workspace.files"]);
    expect(out.pages[0]!.cards[2]!.tabs).toEqual([f, ch, sc, sc2]);
    expect(Object.keys(out.instances).sort()).toEqual(Object.keys(l.instances).sort());
    for (const id of Object.keys(l.instances)) expect(out.instances[id]).toEqual(l.instances[id]);
    expect(out.overrides["browser.tab"]!.page).toBe("p91");
    expect(out.activePage).toBe("p91");
    // an unknown page: the active page is kept
    expect(foldPages(l, "p404").pages.map((p) => p.id)).toEqual(["p92"]);
    // sanitize keeps up to 9 pages for this (legacy), and folds a stored layout with more than MAX_PAGES columns
    expect(sanitizeLayout(JSON.parse(JSON.stringify(l)), "local", { legacy: true }).pages).toHaveLength(3);
    expect(sanitizeLayout(JSON.parse(JSON.stringify(l))).pages).toHaveLength(1);
  });
});
