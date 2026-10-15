// The right side's pure layout model (lib/sideLayout.ts; docs/desktop-modules.md §18; RFC
// right-panel-rfc-20261009 §4.3–§4.4, test list §8.4): place(), the reducers, visibility, heights,
// persistence. Layouts are plain JSON, so every case builds one by opening components in order.
import { describe, expect, it } from "vitest";
import type { SideBinding, SidePlacement } from "../src/renderer/src/modules/slots";
import type { ItemId } from "../src/renderer/src/modules/types";
import {
  applyOpen,
  cardHeights,
  closeIfEmptied,
  closeInstances,
  CARD_GAP,
  CARD_HEADER,
  DEFAULT_ORDER,
  dragGap,
  dropDeletedAgents,
  dropEmptyPage,
  dropViews,
  emptyLayout,
  equalizeCards,
  findCard,
  findPage,
  hasContentFor,
  instanceVisible,
  isNarrow,
  lanePages,
  locate,
  MAX_CARDS,
  MAX_INSTANCES,
  MAX_OVERRIDES,
  MAX_PAGES,
  MAX_VIEWS,
  mergePages,
  MIN_CARD_HEIGHT,
  moveCard,
  moveInstance,
  movePage,
  newCardIndex,
  NO_AGENT,
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
  restoreView,
  sanitizeLayout,
  saveView,
  setCardSizes,
  setCollapsed,
  shownTab,
  sideWidth,
  SINGLETON_KEY,
  splitInstance,
  STATE_LIMIT,
  switchAgentView,
  switchPage,
  visibleCards,
  type PlaceSpec,
  type SideLayout,
  type SidePlaceDecision,
  type SideViewContext,
} from "../src/renderer/src/lib/sideLayout";

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

/** S0 of §4.4: one page「工作区」with files / changes / status / terminal [t1, t2]; column open. */
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

function assertNeverMixed(layout: SideLayout) {
  for (const page of layout.pages) for (const card of page.cards) for (const id of card.tabs) expect(layout.instances[id]!.kind).toBe(card.kind);
}

function sizesSum(layout: SideLayout) {
  return layout.pages.map((p) => p.cards.reduce((a, c) => a + c.size, 0));
}

// ── S0 ─────────────────────────────────────────────────────────────────────────────────────────

describe("S0 (declared order, one page)", () => {
  it("builds the workspace page in declared order; the terminal card holds two tabs", () => {
    const { layout, t1, t2 } = s0();
    expect(layout.pages).toHaveLength(1);
    expect(layout.pages[0]!.groups).toEqual(["workspace"]);
    expect(kinds(layout)).toEqual(["workspace.files", "workspace.changes", "status:jobs.tasks", "terminal.pty"]);
    expect(cardOf(layout, t1).tabs).toEqual([t1, t2]);
    expect(cardOf(layout, t1).active).toBe(t2);
    expect(layout.open).toBe(true);
    expect(layout.activePage).toBe(layout.pages[0]!.id);
    sizesSum(layout).forEach((s) => expect(s).toBeCloseTo(1));
    assertNeverMixed(layout);
  });
});

// ── §4.4 scenarios ─────────────────────────────────────────────────────────────────────────────

describe("§4.4 scenarios", () => {
  it("1: a file link → a preview card under 改动 (order 300); the next unpinned preview replaces it in place", () => {
    const { layout } = s0();
    const a = open(layout, "workspace.preview", { key: "a.ts", transient: true });
    expect(a.decision).toMatchObject({ op: "insert", via: "rule", card: { new: { index: 2 } } });
    expect(kinds(a.layout)).toEqual(["workspace.files", "workspace.changes", "workspace.preview", "status:jobs.tasks", "terminal.pty"]);
    const b = open(a.layout, "workspace.preview", { key: "b.ts", transient: true });
    expect(b.decision).toEqual({ op: "replace", instance: a.id });
    expect(b.id).not.toBe(a.id);
    expect(b.layout.instances[a.id]).toBeUndefined();
    expect(cardOf(b.layout, b.id).tabs).toEqual([b.id]);
    expect(b.layout.instances[b.id]!.key).toBe("b.ts");
  });

  it("2: 改动 → b.ts opens a diff card (order 400); c.ts is a new tab of the same card", () => {
    const { layout } = s0();
    const p = open(layout, "workspace.preview", { key: "a.ts", transient: true });
    const b = open(p.layout, "diff.view", { key: "git:b.ts" });
    expect(b.decision).toMatchObject({ op: "insert", via: "rule" });
    expect(kinds(b.layout)).toEqual(["workspace.files", "workspace.changes", "workspace.preview", "diff.view", "status:jobs.tasks", "terminal.pty"]);
    const c = open(b.layout, "diff.view", { key: "git:c.ts" });
    expect(cardOf(c.layout, c.id).id).toBe(cardOf(b.layout, b.id).id);
    expect(cardOf(c.layout, c.id).tabs).toEqual([b.id, c.id]);
  });

  it("3: 查看变更 (turn diff) joins the git diff card", () => {
    const { layout } = s0();
    const git = open(layout, "diff.view", { key: "git:a.ts" });
    const turn = open(git.layout, "diff.view", { key: "turn:t9:a.ts" });
    expect(cardOf(turn.layout, turn.id).tabs).toEqual([git.id, turn.id]);
  });

  it("4: ＋ in the terminal card (explicit page) adds a tab after the active one", () => {
    const { layout, t1, t2 } = s0();
    const page = layout.pages[0]!.id;
    const t3 = open(layout, "terminal.pty", { binding: ws("w1"), key: "t3", page });
    expect(t3.decision).toMatchObject({ via: "explicit", card: { id: cardOf(layout, t1).id } });
    expect(cardOf(t3.layout, t3.id).tabs).toEqual([t1, t2, t3.id]);
    // after the ACTIVE tab, not at the end
    const l2 = applyOpen(t3.layout, { op: "activate", instance: t1 }, { kind: "terminal.pty", binding: ws("w1"), key: "t1", state: null, v: 1, pinned: false }, ++clock, { reveal: true }).layout;
    const t4 = open(l2, "terminal.pty", { binding: ws("w1"), key: "t4", page });
    expect(cardOf(t4.layout, t4.id).tabs).toEqual([t1, t4.id, t2, t3.id]);
  });

  it("5: a browser tab (no matching page) → new page [browser], appended and switched to", () => {
    const { layout } = s0();
    const docs = open(layout, "browser.tab", { key: "service:docs" });
    expect(docs.decision).toMatchObject({ via: "otherwise", page: { new: { groups: ["browser"], index: 1 } } });
    expect(docs.layout.pages.map((p) => p.groups)).toEqual([["workspace"], ["browser"]]);
    expect(docs.layout.activePage).toBe(docs.layout.pages[1]!.id);
  });

  it("6: a system event opens nothing (badges are pill-side; see sidePills.test.ts)", () => {
    const { layout } = s0();
    expect(layout.pages).toHaveLength(1);
  });

  it("7: side chat per agent: new page [chat]; again for A = activate; B = another tab of the same card", () => {
    const { layout } = s0();
    const a = open(layout, "side-chat.chat");
    expect(a.layout.pages.map((p) => p.groups[0])).toEqual(["workspace", "chat"]);
    const again = open(a.layout, "side-chat.chat");
    expect(again.decision).toEqual({ op: "activate", instance: a.id });
    const b = open(a.layout, "side-chat.chat", { binding: agent("B") });
    expect(b.decision).toMatchObject({ op: "insert", card: { id: cardOf(a.layout, a.id).id } });
    expect(cardOf(b.layout, b.id).tabs).toEqual([a.id, b.id]);
    // only A's tab is visible while A is selected
    const card = cardOf(b.layout, b.id);
    expect(shownTab(b.layout, card, ctx({ sessionId: "A" }))).toBe(a.id);
    expect(shownTab(b.layout, card, ctx({ sessionId: "B" }))).toBe(b.id);
  });

  it("8: switching to agent C hides the chat page (D27′: nothing of C's on it); the follow page stays", () => {
    const { layout } = s0();
    const a = open(layout, "side-chat.chat");
    const b = open(a.layout, "side-chat.chat", { binding: agent("B") });
    const chat = findPage(b.layout, pageOf(b.layout, a.id))!;
    const c = ctx({ sessionId: "C" });
    expect(pageVisibility(b.layout, chat, c)).toBe("hidden");
    expect(lanePages(b.layout, c).map((p) => p.id)).toEqual([layout.pages[0]!.id]);
    expect(visibleCards(b.layout, chat, c)).toEqual([]);
  });

  it("9: files moved to a new page [user:P]; closed (the page goes) and reopened → a new page with that group; the override follows", () => {
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
    // next time: the page is there → used directly
    const changes = again.layout.pages[0]!.cards[0]!.tabs[0]!;
    expect(again.layout.instances[changes]!.kind).toBe("workspace.changes");
  });

  it("10: merging the chat page into the workspace page unites groups and re-points overrides; later chats land there", () => {
    const { layout } = s0();
    const a = open(layout, "side-chat.chat");
    const chatPage = pageOf(a.layout, a.id);
    const workPage = a.layout.pages[0]!.id;
    const withOv = { ...a.layout, overrides: { "side-chat.chat": { page: chatPage, groups: ["chat"], at: 1 } } };
    const merged = mergePages(withOv, chatPage, workPage);
    expect(merged.pages).toHaveLength(1);
    expect(merged.pages[0]!.groups).toEqual(["workspace", "chat"]);
    expect(kinds(merged).at(-1)).toBe("side-chat.chat");
    expect(merged.overrides["side-chat.chat"]).toMatchObject({ page: workPage, groups: ["workspace", "chat"] });
    sizesSum(merged).forEach((s) => expect(s).toBeCloseTo(1));
    const d = open({ ...merged, overrides: {} }, "side-chat.chat", { binding: agent("D") });
    expect(pageOf(d.layout, d.id)).toBe(workPage);
  });

  it("11: a full page (6 cards) → a new page with the page's groups; never into another kind's card", () => {
    let l = s0().layout;
    l = open(l, "workspace.preview", { key: "a.ts" }).layout;
    l = open(l, "diff.view", { key: "git:a.ts" }).layout;
    expect(l.pages[0]!.cards).toHaveLength(MAX_CARDS);
    const wt = open(l, "workspace.worktrees");
    expect(wt.decision).toMatchObject({ via: "limit", page: { new: { groups: ["workspace"] } } });
    expect(wt.layout.pages).toHaveLength(2);
    expect(kinds(wt.layout, 1)).toEqual(["workspace.worktrees"]);
    assertNeverMixed(wt.layout);
  });

  it("12: a reference card (turn.peek) falls back to the page in view at order 150; the next one replaces it", () => {
    const { layout } = s0();
    const peek = open(layout, "turn.peek", { key: "turn:local:A:36", transient: true });
    expect(peek.decision).toMatchObject({ via: "rule", page: { id: layout.activePage } });
    expect(kinds(peek.layout)).toEqual(["workspace.files", "turn.peek", "workspace.changes", "status:jobs.tasks", "terminal.pty"]);
    const next = open(peek.layout, "turn.peek", { key: "turn:local:A:40", transient: true });
    expect(next.decision).toEqual({ op: "replace", instance: peek.id });
    // the column closed: "active" does not match → otherwise new page [reference]
    const closed = open({ ...layout, open: false }, "turn.peek", { key: "turn:local:A:36", transient: true });
    expect(closed.decision).toMatchObject({ via: "otherwise", page: { new: { groups: ["reference"] } } });
  });

  it("13: reset clears overrides / names / order / sizes, replays by lastActiveAt, closes nothing; deterministic", () => {
    const base = s0();
    let l = base.layout;
    const chat = open(l, "side-chat.chat");
    l = chat.layout;
    l = moveCard(l, cardOf(l, base.files).id, { newPage: true }, ++clock, orderOf);
    l = mergePages(l, pageOf(l, chat.id), l.pages[0]!.id);
    l = renamePage(l, l.pages[0]!.id, "Mine");
    l = setCardSizes(l, l.pages[0]!.id, { [l.pages[0]!.cards[0]!.id]: 5 });
    l = movePage(l, l.pages[1]!.id, -1);
    const before = Object.keys(l.instances).sort();
    const r1 = resetLayout(l, specOf, 99);
    const r2 = resetLayout(l, specOf, 99);
    expect(r1).toEqual(r2);
    expect(r1.overrides).toEqual({});
    expect(Object.keys(r1.instances).sort()).toEqual(before);
    expect(r1.pages.map((p) => p.groups)).toEqual([["workspace"], ["chat"]]);
    expect(r1.pages.every((p) => p.name === undefined)).toBe(true);
    expect(kinds(r1)).toEqual(["workspace.files", "workspace.changes", "status:jobs.tasks", "terminal.pty"]);
    expect(cardOf(r1, base.t1).tabs).toEqual([base.t1, base.t2]);
    expect(r1.instances[base.t1]!.lastActiveAt).toBe(l.instances[base.t1]!.lastActiveAt);
    sizesSum(r1).forEach((s) => expect(s).toBeCloseTo(1));
    // the open state is kept
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
    const { layout, t1, t2 } = s0();
    const at = ++clock;
    const out = applyOpen(layout, { op: "activate", instance: t1 }, { kind: "terminal.pty", binding: ws("w1"), key: "t1", state: { x: 1 }, v: 2, pinned: false }, at, { reveal: false });
    expect(out.reused).toBe(true);
    expect(out.layout.instances[t1]).toMatchObject({ state: { x: 1 }, v: 2, lastActiveAt: at });
    expect(cardOf(out.layout, t1).active).toBe(t1);
    expect(cardOf(layout, t2).active).toBe(t2); // input untouched
  });

  it("a pinned preview is not replaced: the next transient one is a new tab; pin: true opens pinned", () => {
    const { layout } = s0();
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

describe("place: page choice", () => {
  it("override: its page → a page with one of its groups → a new page with its groups", () => {
    const { layout } = s0();
    const b = open(layout, "browser.tab", { key: "u1" });
    const workPage = layout.pages[0]!.id;
    const browserPage = pageOf(b.layout, b.id);
    const ov = (page: string, groups: string[]) => ({ ...b.layout, overrides: { "workspace.preview": { page, groups, at: 1 } } });
    expect(decide(ov(browserPage, ["x"]), "workspace.preview", { key: "a" })).toMatchObject({ via: "override", page: { id: browserPage } });
    expect(decide(ov("p999", ["browser"]), "workspace.preview", { key: "a" })).toMatchObject({ via: "override", page: { id: browserPage } });
    expect(decide(ov("p999", ["workspace", "browser"]), "workspace.preview", { key: "a" })).toMatchObject({ via: "override", page: { id: workPage } });
    expect(decide(ov("p999", ["user:p999"]), "workspace.preview", { key: "a" })).toMatchObject({ via: "override", page: { new: { groups: ["user:p999"] } } });
  });

  it("an explicit page wins over overrides and rules; an unknown explicit page is ignored", () => {
    const { layout } = s0();
    const b = open(layout, "browser.tab", { key: "u1" });
    const browserPage = pageOf(b.layout, b.id);
    const l = { ...b.layout, overrides: { "workspace.preview": { page: layout.pages[0]!.id, groups: ["workspace"], at: 1 } } };
    expect(decide(l, "workspace.preview", { key: "a", page: browserPage })).toMatchObject({ via: "explicit", page: { id: browserPage } });
    expect(decide(l, "workspace.preview", { key: "a", page: "p404" })).toMatchObject({ via: "override" });
  });

  it("prefer is tried in order: diff.view goes to the page containing 改动, not the first workspace page", () => {
    let l = emptyLayout();
    l = open(l, "workspace.files").layout; // P1 [workspace] (files only)
    const ch = open(l, "workspace.changes", { page: undefined });
    l = moveCard(ch.layout, cardOf(ch.layout, ch.id).id, { newPage: true }, ++clock, orderOf); // changes on its own page
    const changesPage = pageOf(l, ch.id);
    l = { ...l, overrides: {} };
    expect(decide(l, "diff.view", { key: "git:a" })).toMatchObject({ via: "rule", page: { id: changesPage } });
    // no changes card anywhere → second candidate (group workspace)
    const noChanges = closeInstances(l, [ch.id]);
    expect(decide(noChanges, "diff.view", { key: "git:a" })).toMatchObject({ via: "rule", page: { id: noChanges.pages[0]!.id } });
  });

  it("otherwise: new-page (default) vs active-page (new page when none is in view)", () => {
    const { layout } = s0();
    expect(decide(layout, "browser.tab", { key: "x" })).toMatchObject({ via: "otherwise", page: { new: { groups: ["browser"] } } });
    expect(decide(layout, "notes.note", { key: "n1" })).toMatchObject({ via: "otherwise", page: { id: layout.activePage } });
    expect(decide(emptyLayout(), "notes.note", { key: "n1" })).toMatchObject({ via: "otherwise", page: { new: { groups: ["notes"] } } });
  });

  it("at 9 pages a new page is refused: the page in view, else the last page (via limit)", () => {
    const l = pagesLayout(MAX_PAGES, 1);
    l.activePage = l.pages[2]!.id;
    expect(decide(l, "side-chat.chat")).toMatchObject({ via: "limit", page: { id: l.pages[2]!.id } });
    const noActive = { ...l, activePage: null };
    expect(decide(noActive, "side-chat.chat")).toMatchObject({ via: "limit", page: { id: l.pages[MAX_PAGES - 1]!.id } });
    // an override's new page is refused the same way
    const ov = { ...l, overrides: { "side-chat.chat": { page: "p404", groups: ["user:p404"], at: 1 } } };
    expect(decide(ov, "side-chat.chat")).toMatchObject({ via: "limit", page: { id: l.pages[2]!.id } });
  });
});

/** n pages (groups g0…), each with `cards` subagent-thread cards of one tab (built as JSON). */
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

describe("place: card choice and full pages", () => {
  it("a new card goes after the last card whose order ≤ its order — also after the user reordered", () => {
    const cards = (ks: ItemId[]) => ks.map((kind, k) => ({ id: `c${k}`, kind, tabs: [`i${k}`], active: `i${k}`, size: 1, collapsed: false }));
    expect(newCardIndex(cards(["workspace.files", "workspace.changes"]), 300, orderOf)).toBe(2);
    expect(newCardIndex(cards(["workspace.files", "workspace.changes"]), 150, orderOf)).toBe(1);
    expect(newCardIndex(cards(["workspace.files", "workspace.changes"]), 50, orderOf)).toBe(0);
    // reordered: changes above files → a 150 card goes after files (the last ≤ 150), i.e. at the bottom
    expect(newCardIndex(cards(["workspace.changes", "workspace.files"]), 150, orderOf)).toBe(2);
    const { layout } = s0();
    const up = moveCard(layout, layout.pages[0]!.cards[3]!.id, { delta: -1 }, ++clock, orderOf);
    expect(kinds(up)).toEqual(["workspace.files", "workspace.changes", "terminal.pty", "status:jobs.tasks"]);
    const p = open(up, "workspace.preview", { key: "a" });
    expect(kinds(p.layout)).toEqual(["workspace.files", "workspace.changes", "workspace.preview", "terminal.pty", "status:jobs.tasks"]);
  });

  it("two same-kind cards on the page: the tab goes to the one used most recently", () => {
    const { layout, t1, t2 } = s0();
    const split = splitInstance(layout, t2, ++clock);
    const c1 = cardOf(split, t1).id;
    const c2 = cardOf(split, t2).id;
    expect(c1).not.toBe(c2);
    expect(decide(split, "terminal.pty", { binding: ws("w1"), key: "t3" })).toMatchObject({ card: { id: c2 } });
    const used = applyOpen(split, { op: "activate", instance: t1 }, { kind: "terminal.pty", binding: ws("w1"), key: "t1", state: null, v: 1, pinned: false }, ++clock, { reveal: false }).layout;
    expect(decide(used, "terminal.pty", { binding: ws("w1"), key: "t3" })).toMatchObject({ card: { id: c1 } });
  });

  it("full page step 1: another page with a shared group takes it (same-kind card → tab; else a new card)", () => {
    let l = s0().layout;
    l = open(l, "workspace.preview", { key: "a.ts" }).layout;
    l = open(l, "diff.view", { key: "git:a.ts" }).layout; // P1 full
    const wt = open(l, "workspace.worktrees"); // → P2 [workspace]
    l = wt.layout;
    l = switchPage(l, l.pages[0]!.id);
    const sub = open(l, "subagents.thread", { key: "th1" });
    expect(sub.decision).toMatchObject({ via: "limit", page: { id: l.pages[1]!.id }, card: { new: {} } });
    expect(kinds(sub.layout, 1)).toEqual(["subagents.thread", "workspace.worktrees"]);
    const sub2 = open(switchPage(sub.layout, sub.layout.pages[0]!.id), "subagents.thread", { key: "th2" });
    // prefer finds P1 first (group workspace); it is full → P2 (same group) has a subagents card → a tab there
    expect(sub2.decision).toMatchObject({ via: "limit", page: { id: l.pages[1]!.id }, card: { id: cardOf(sub.layout, sub.id).id } });
    expect(cardOf(sub2.layout, sub2.id).id).toBe(cardOf(sub.layout, sub.id).id);
  });

  it("full page step 2: no page shares a group → a new page with the full page's groups", () => {
    const l = pagesLayout(2, MAX_CARDS);
    const d = decide(l, "notes.note", { key: "n" }); // otherwise active-page → page 1 (full)
    expect(d).toMatchObject({ via: "limit", page: { new: { groups: ["g0"], index: 2 } } });
  });

  it("full page step 3: 9 pages and all full → the page anyway, beyond the soft cap, expanded; never mixed", () => {
    const l = pagesLayout(MAX_PAGES, MAX_CARDS);
    const wt = open(l, "notes.note", { key: "n" });
    expect(wt.decision).toMatchObject({ via: "limit", page: { id: l.pages[0]!.id }, card: { new: { collapsed: false } } });
    expect(wt.layout.pages[0]!.cards).toHaveLength(MAX_CARDS + 1);
    expect(wt.layout.pages).toHaveLength(MAX_PAGES);
    assertNeverMixed(wt.layout);
    // a same-kind card on the full page is still used (a tab, not a card)
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
    expect(JSON.stringify(layout)).toBe(snapshot);
  });

  it("moving a tab to a new page: user group, override, the old card keeps the other tabs", () => {
    const { layout, t1, t2 } = s0();
    const out = moveInstance(layout, t1, { newPage: true }, ++clock, orderOf);
    const page = findPage(out, pageOf(out, t1))!;
    expect(page.groups).toEqual([`user:${page.id}`]);
    expect(cardOf(out, t2).tabs).toEqual([t2]);
    expect(out.overrides["terminal.pty"]!.page).toBe(page.id);
    expect(out.activePage).toBe(page.id);
    // moving to an existing page joins its same-kind card
    const back = moveInstance(out, t1, { page: out.pages[0]!.id }, ++clock, orderOf);
    expect(cardOf(back, t1).tabs.sort()).toEqual([t1, t2].sort());
    expect(back.pages).toHaveLength(1); // the emptied page is gone
  });

  it("split: the tab becomes its own same-kind card right below; no override; a single tab cannot split", () => {
    const { layout, t1, t2, files } = s0();
    const out = splitInstance(layout, t1, ++clock);
    const idx = locate(out, t1)!.cardIndex;
    expect(locate(out, t2)!.cardIndex).toBe(idx - 1);
    expect(out.overrides).toEqual({});
    expect(splitInstance(layout, files, ++clock)).toBe(layout);
    assertNeverMixed(out);
  });

  it("moveCard into a page with a same-kind card merges the tabs; up / down reorder; a 1-card page cannot go to a new page", () => {
    const { layout, files } = s0();
    const own = moveCard(layout, cardOf(layout, files).id, { newPage: true }, ++clock, orderOf);
    expect(moveCard(own, cardOf(own, files).id, { newPage: true }, ++clock, orderOf)).toBe(own);
    const top = moveCard(layout, cardOf(layout, files).id, { delta: -1 }, ++clock, orderOf);
    expect(top).toBe(layout);
    const down = moveCard(layout, cardOf(layout, files).id, { delta: 1 }, ++clock, orderOf);
    expect(kinds(down)).toEqual(["workspace.changes", "workspace.files", "status:jobs.tasks", "terminal.pty"]);
  });

  it("restore default forgets the override and re-places by the rules", () => {
    const { layout, files } = s0();
    const moved = moveCard(layout, cardOf(layout, files).id, { newPage: true }, ++clock, orderOf);
    expect(moved.pages).toHaveLength(2);
    const back = restoreDefault(moved, files, specOf, ++clock);
    expect(back.overrides["workspace.files"]).toBeUndefined();
    expect(back.pages).toHaveLength(1);
    expect(kinds(back)).toEqual(["workspace.files", "workspace.changes", "status:jobs.tasks", "terminal.pty"]);
    expect(back.instances[files]).toEqual(moved.instances[files]);
  });

  it("restore a kind's default (settings): override gone, its instances back; nothing placed = just the override", () => {
    const { layout, files } = s0();
    const moved = moveCard(layout, cardOf(layout, files).id, { newPage: true }, ++clock, orderOf);
    const back = restoreKindDefault(moved, "workspace.files", specOf, ++clock);
    expect(back.overrides["workspace.files"]).toBeUndefined();
    expect(kinds(back)).toEqual(["workspace.files", "workspace.changes", "status:jobs.tasks", "terminal.pty"]);
    const closed = closeInstances(moved, [files]);
    expect(closed.overrides["workspace.files"]).toBeDefined();
    const forgot = restoreKindDefault(closed, "workspace.files", specOf, ++clock);
    expect(forgot.overrides["workspace.files"]).toBeUndefined();
    expect(forgot.pages).toEqual(closed.pages);
    expect(restoreKindDefault(layout, "workspace.files", specOf, ++clock).overrides).toEqual(layout.overrides);
  });

  it("closing the last instance of a page drops the page (neighbour in view); the last page closes the column", () => {
    const { layout } = s0();
    const b = open(layout, "browser.tab", { key: "u" });
    const closed = closeInstances(b.layout, [b.id]);
    expect(closed.pages).toHaveLength(1);
    expect(closed.activePage).toBe(layout.pages[0]!.id);
    const all = closeInstances(closed, Object.keys(closed.instances));
    expect(all.pages).toEqual([]);
    expect(all.open).toBe(false);
    expect(all.activePage).toBeNull();
    expect(all.seq).toBe(closed.seq); // ids are never reused
  });

  it("closing the active tab activates its neighbour", () => {
    const { layout, t1, t2 } = s0();
    const out = closeInstances(layout, [t2]);
    expect(cardOf(out, t1).active).toBe(t1);
  });

  it("a launcher page: in view while empty, takes the first component's group, dropped when left empty", () => {
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
    // only one launcher at a time; refused at 9 pages
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
    expect(eq.pages[0]!.cards.map((c) => c.size)).toEqual([0.25, 0.25, 0.25, 0.25]);
  });

  it("a share puts the new card at that share; the others shrink in proportion", () => {
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

  it("dormant (module off) or another host's: the page leaves the lane", () => {
    const { layout } = s0();
    const b = open(layout, "browser.tab", { key: "u" });
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
    const other = open(layout, "browser.tab", { binding: host("workstation"), key: "u" });
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
    expect(pageName(layout.pages[0]!, name, "New page")).toBe("files · changes +2");
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

  it("sanitize drops bad parts, never throws, keeps seq above every id, drops orphans and mixed tabs", () => {
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
    expect(l.pages[0]!.cards).toEqual([{ id: "c2", kind: "workspace.files", tabs: ["i3"], active: "i3", size: 1, collapsed: false }]);
    expect(Object.keys(l.instances)).toEqual(["i3"]);
    expect(l.overrides).toEqual({ "workspace.files": { page: "p1", groups: ["workspace"], at: 3 } });
    // C's page is gone: closed (not an empty column opened on purpose); D's launcher column stays open
    expect(l.views).toEqual({ A: { open: true, page: "p1", at: 4 }, C: { open: false, page: null, at: 2 }, D: { open: true, page: null, at: 0 } });
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

// ── Per-agent views (owner 2026-10-11, RFC §13 D27′) ──────────────────────────────────────────

describe("per-agent views", () => {
  const bctx = (sessionId: string | null, workspaceKey: string | null = "w1") => ({ hostId: "local", sessionId, workspaceKey });

  /** A: a side chat (agent-bound) on its own page; nothing follow / host / workspace-bound. */
  function chatOfA() {
    const a = open(emptyLayout(), "side-chat.chat");
    return { layout: saveView(a.layout, "A", ++clock), chat: a.id, page: pageOf(a.layout, a.id) };
  }

  it("switching restores each agent's view: A open on its page → B closed with nothing of A's → A restored", () => {
    const { layout, page } = chatOfA();
    expect(layout.open).toBe(true);
    const onB = switchAgentView(layout, "A", "B", bctx("B"), ++clock);
    expect(onB.open).toBe(false);
    expect(lanePages(onB, ctx({ sessionId: "B" }))).toEqual([]);
    expect(onB.views!.A).toMatchObject({ open: true, page });
    expect(onB.views!.B).toMatchObject({ open: false });
    const back = switchAgentView(onB, "B", "A", bctx("A"), ++clock);
    expect(back.open).toBe(true);
    expect(back.activePage).toBe(page);
  });

  it("the page in view is per agent", () => {
    let l = open(emptyLayout(), "workspace.files").layout; // follow: every agent sees it
    const filesPage = l.activePage!;
    const br = open(l, "browser.tab", { key: "u" }); // host-bound
    l = saveView(br.layout, "A", ++clock);
    const browserPage = pageOf(l, br.id);
    expect(l.activePage).toBe(browserPage);
    l = switchAgentView(l, "A", "B", bctx("B"), ++clock);
    expect(l.open).toBe(false); // a new agent starts closed
    l = saveView(switchPage(l, filesPage), "B", ++clock);
    expect(l).toMatchObject({ open: true, activePage: filesPage });
    l = switchAgentView(l, "B", "A", bctx("A"), ++clock);
    expect(l).toMatchObject({ open: true, activePage: browserPage });
    l = switchAgentView(l, "A", "B", bctx("B"), ++clock);
    expect(l).toMatchObject({ open: true, activePage: filesPage });
  });

  it("host- and workspace-bound pages show for every agent they apply to", () => {
    const br = open(emptyLayout(), "browser.tab", { key: "u" });
    const t = open(br.layout, "terminal.pty", { binding: ws("w1"), key: "t" });
    const l = t.layout;
    expect(lanePages(l, ctx({ sessionId: "B", workspaceKey: "w9" })).map((p) => p.id)).toEqual([pageOf(l, br.id)]);
    expect(lanePages(l, ctx({ sessionId: "C", workspaceKey: "w1" })).map((p) => p.id)).toEqual(l.pages.map((p) => p.id));
    expect(lanePages(l, ctx({ sessionId: null, workspaceKey: null })).map((p) => p.id)).toEqual([pageOf(l, br.id)]);
    // an agent whose stored view was open on the terminal page, now in another workspace: the browser page
    const v = { ...l, views: { C: { open: true, page: pageOf(l, t.id), at: 1 } } };
    expect(restoreView(v, "C", bctx("C", "w9"))).toMatchObject({ open: true, activePage: pageOf(l, br.id) });
  });

  it("an agent whose content is gone restores closed; a column opened empty on purpose stays open", () => {
    const { layout, chat } = chatOfA();
    const onB = switchAgentView(layout, "A", "B", bctx("B"), ++clock);
    const closed = closeInstances(onB, [chat]); // e.g. dropped elsewhere
    expect(restoreView(closed, "A", bctx("A"))).toMatchObject({ open: false });
    const launcher = { ...emptyLayout(), views: { A: { open: true, page: null, at: 1 } } };
    expect(restoreView(launcher, "A", bctx("A"))).toMatchObject({ open: true, activePage: null });
  });

  it("closing the agent's last content closes its column, even when other agents' pages remain", () => {
    const { layout } = chatOfA();
    const b = open(layout, "side-chat.chat", { binding: agent("B") });
    const onA = { ...b.layout, activePage: pageOf(b.layout, b.id) };
    const aId = Object.keys(onA.instances).find((id) => onA.instances[id]!.binding.kind === "agent" && (onA.instances[id]!.binding as { sessionId: string }).sessionId === "A")!;
    const next = closeInstances(onA, [aId]);
    expect(next.open).toBe(true); // B's page keeps the layout's pages
    expect(hasContentFor(next, bctx("A"))).toBe(false);
    expect(closeIfEmptied(onA, next, bctx("A")).open).toBe(false);
    // a launcher page opened on purpose with nothing else stays open
    const empty = { ...emptyLayout(), views: {} };
    const opened = openLauncherPage(empty).layout;
    expect(closeIfEmptied(empty, opened, bctx("A")).open).toBe(true);
  });

  it("a launcher page is the agent's own: other agents do not see it; it is dropped on switch", () => {
    const { layout } = chatOfA();
    const withLauncher = openLauncherPage(layout).layout;
    const launcherId = withLauncher.activePage!;
    expect(lanePages(withLauncher, ctx()).map((p) => p.id)).toContain(launcherId);
    expect(lanePages({ ...withLauncher, activePage: layout.activePage }, ctx()).map((p) => p.id)).not.toContain(launcherId);
    const onB = switchAgentView(withLauncher, "A", "B", bctx("B"), ++clock);
    expect(findPage(onB, launcherId)).toBeNull();
    expect(onB.views!.A).toMatchObject({ open: true, page: null });
  });

  it("no agent selected (NO_AGENT) has its own view; views of deleted agents are pruned and the count is capped", () => {
    const { layout } = chatOfA();
    const none = switchAgentView(layout, "A", NO_AGENT, bctx(null, null), ++clock);
    expect(none.open).toBe(false);
    const pruned = dropViews(none, (id) => id !== "A");
    expect(Object.keys(pruned.views!)).toEqual([NO_AGENT]);
    let l: SideLayout = emptyLayout();
    for (let k = 0; k < MAX_VIEWS + 5; k++) l = saveView(l, `s${k}`, k);
    expect(Object.keys(l.views!)).toHaveLength(MAX_VIEWS);
    expect(l.views!.s0).toBeUndefined();
    expect(l.views![`s${MAX_VIEWS + 4}`]).toBeDefined();
  });

  it("saveView leaves an unchanged view alone (same object)", () => {
    const { layout } = chatOfA();
    expect(saveView(layout, "A", ++clock)).toBe(layout);
  });
});
