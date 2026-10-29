// Workspaces (docs/desktop-modules.md §24.13; canvas principles §7, owner 2026-10-21): a Shelf per conversation
// (restored on switch, a new one from the default layout), shared pages (one instance, in every conversation's
// Shelf), the v4 → v5 migration (the global Shelf becomes the default layout AND the focused conversation's;
// conversation chips go), side-by-side geometry (lib/workspaceRow — test/workspaceRow.test.ts —, the sidebar's automatic rail),
// the drop rules (dropOutcome per target), ⌘K modes (agents only have side by side; rows as workspace refs),
// 「—」 = close the pane, openBeside without chips.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SideBinding } from "../src/renderer/src/modules/slots";
import type { ItemId } from "../src/renderer/src/modules/types";
import { applyOpen, emptyLayout, findPage, locate, moveToNewPage, place, placeSpec, setPageShared, shelvesOf, SINGLETON_KEY, collapseShelf, type SideLayout } from "../src/renderer/src/lib/sideLayout";
import { convKey, fromTemplate, maxSeq, mergeShared, metaOf, parseConvKey, renumber, sharedPages, splitShared } from "../src/renderer/src/lib/convShelves";
import { bindPane, closePaneOverlay, conversationPanes, defaultLayout, emptyWork, focusPane, joinLayout, openBeside, paneBinding, toolPartOf, MAIN_PANE, CONVERSATION_MIN_W } from "../src/renderer/src/lib/paneLayout";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));

let clock = 100;
type Binding = SideBinding;
/** Opens a component instance the way services.side.open does (place → applyOpen). */
function open(l: SideLayout, kind: string, binding: Binding, home: string, key: string | null = SINGLETON_KEY): { layout: SideLayout; id: string } {
  const input = { kind: kind as ItemId, binding, key, state: { k: kind } as never, v: 1, pinned: false };
  const decision = place(l, { ...input, transient: false, activePage: l.activePage, columnOpen: l.open }, placeSpec({ home }));
  const applied = applyOpen(l, decision, input, ++clock, { reveal: true, home });
  return { layout: applied.layout, id: applied.instanceId };
}
const follow: Binding = { kind: "follow", hostId: "local" };
const agentA: Binding = { kind: "agent", hostId: "local", sessionId: "A" };
const host: Binding = { kind: "host", hostId: "local" };
/** The instance on a page of its own (a new page of its Shelf), that page in view. */
function ownPage(l: SideLayout, id: string): { layout: SideLayout; page: string } {
  const next = moveToNewPage(l, { instance: id }, shelvesOf(l)[0]!.id, ++clock);
  return { layout: next, page: locate(next, id)!.page.id };
}

describe("convShelves (pure)", () => {
  it("conversation keys: host + session (the same id on two hosts is two agents)", () => {
    expect(convKey("local", "a1")).toBe("local|a1");
    expect(convKey("host-b", "a1")).not.toBe(convKey("local", "a1"));
    expect(parseConvKey("host-b|a1")).toEqual({ hostId: "host-b", sessionId: "a1" });
    expect(parseConvKey("nope")).toBeNull();
  });

  it("splitShared / mergeShared: the shared pages leave with their instances and come back where they were; the view comes back from meta", () => {
    let l = open(emptyLayout(), "workspace.files", follow, "files").layout;
    const own = locate(l, Object.keys(l.instances)[0]!)!.page.id;
    const book = open(l, "browser.tab", host, "browser", "k1");
    const moved = ownPage(book.layout, book.id);
    l = moved.layout;
    const sharedPage = moved.page;
    // the browser on a page of its own: mark it shared, it is in view
    l = setPageShared(l, sharedPage, true);
    expect(sharedPages(l).map((p) => p.id)).toEqual([sharedPage]);
    expect(l.activePage).toBe(sharedPage);
    const split = splitShared(l);
    expect(split.own.pages.map((p) => p.id)).toEqual([own]);
    expect(split.own.instances[book.id]).toBeUndefined();
    expect(split.shared.pages.map((p) => p.id)).toEqual([sharedPage]);
    expect(split.shared.instances[book.id]?.kind).toBe("browser.tab");
    const back = mergeShared(split.own, split.shared, split.meta);
    expect(back.pages.map((p) => p.id).sort()).toEqual([own, sharedPage].sort());
    expect(back.activePage).toBe(sharedPage);
    expect(shelvesOf(back).find((x) => x.active === sharedPage)).toBeTruthy();
    expect(Object.keys(back.instances).sort()).toEqual(Object.keys(l.instances).sort());
    expect(back.seq).toBeGreaterThanOrEqual(maxSeq(l));
  });

  it("mergeShared into another conversation's Shelf: its own pages and view stay, the shared page joins its Shelf (a clash of ids is renumbered)", () => {
    const a = open(emptyLayout(), "browser.tab", host, "browser", "k1");
    const shared = splitShared(setPageShared(a.layout, a.layout.pages[0]!.id, true)).shared;
    // B made with the same counter (a hand-made / older layout): its ids clash with the shared ones
    const b = open(emptyLayout(), "workspace.files", follow, "files").layout;
    const bMeta = metaOf(b);
    const merged = mergeShared(b, shared, bMeta);
    expect(merged.pages).toHaveLength(2);
    expect(new Set(merged.pages.map((p) => p.id)).size).toBe(2);
    expect(merged.activePage).toBe(b.activePage);
    expect(sharedPages(merged)).toHaveLength(1);
    const sharedInst = sharedPages(merged)[0]!.cards[0]!.tabs[0]!;
    expect(merged.instances[sharedInst]?.kind).toBe("browser.tab");
    // one Shelf (the right one) holds both
    expect(shelvesOf(merged)).toHaveLength(1);
  });

  it("collapsed / page in view per conversation come back from meta", () => {
    let l = open(emptyLayout(), "workspace.files", follow, "files").layout;
    l = collapseShelf(l, shelvesOf(l)[0]!.id);
    const m = metaOf(l);
    expect(Object.values(m.collapsed!)).toEqual([true]);
    const expanded = { ...l, shelves: shelvesOf(l).map((x) => ({ ...x, collapsed: undefined })) } as SideLayout;
    expect(shelvesOf(mergeShared(expanded, emptyLayout(), m))[0]!.collapsed).toBe(true);
  });

  it("renumber: every id new from seq on; cards, Shelves' pages in view, the focused page and overrides follow", () => {
    let l = open(emptyLayout(), "workspace.files", follow, "files").layout;
    l = { ...l, overrides: { "workspace.files": { page: l.pages[0]!.id, groups: ["files"], at: 1 } } };
    const { layout: r, map } = renumber(l, 50);
    expect(r.pages[0]!.id).toBe(map.get(l.pages[0]!.id));
    expect(Number(r.pages[0]!.id.slice(1))).toBeGreaterThan(50);
    expect(r.activePage).toBe(r.pages[0]!.id);
    expect(shelvesOf(r)[0]!.active).toBe(r.pages[0]!.id);
    expect(r.overrides["workspace.files"]!.page).toBe(r.pages[0]!.id);
    expect(Object.keys(r.instances)).toEqual(r.pages[0]!.cards[0]!.tabs);
    expect(r.seq).toBe(50 + map.size);
  });

  it("fromTemplate: a new conversation copies the default layout's own pages with the panes that follow the focus only, new ids", () => {
    let t = open(emptyLayout(), "workspace.files", follow, "files").layout;
    const chat = open(t, "side-chat.chat", agentA, "chat");
    t = chat.layout;
    const tab = open(t, "browser.tab", host, "browser", "k2");
    const moved = ownPage(tab.layout, tab.id);
    t = setPageShared(moved.layout, moved.page, true);
    const copy = fromTemplate(t, 200);
    const kinds = Object.values(copy.instances).map((i) => i.kind);
    expect(kinds).toEqual(["workspace.files"]);
    expect(copy.pages.every((p) => !p.shared)).toBe(true);
    expect(Object.keys(copy.instances).every((id) => Number(id.slice(1)) > 200)).toBe(true);
    expect(copy.open).toBe(t.open);
    expect(fromTemplate(null, 7)).toMatchObject({ pages: [], open: false, seq: 7 });
  });
});

// The first test of each block imports the stores afresh (vi.resetModules): slow under a full parallel run.
describe("a Shelf per conversation (lib/sideLayoutStore)", { timeout: 20_000 }, () => {
  let storage: Map<string, string>;
  beforeEach(() => {
    vi.resetModules();
    storage = new Map();
    vi.stubGlobal("localStorage", { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v), removeItem: (k: string) => void storage.delete(k) });
    if (typeof window === "undefined") vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
  });

  async function start(selected: string | null) {
    const { useApp } = await import("../src/renderer/src/store");
    const side = await import("../src/renderer/src/lib/sideLayoutStore");
    useApp.setState({ selectedId: selected, selectedHost: "local" });
    const stop = side.startSideStore(() => () => {});
    const openHere = (kind: string, binding: Binding, home: string, key: string | null = SINGLETON_KEY) => {
      let id = "";
      side.updateLayout((l) => {
        const r = open(l, kind, binding, home, key);
        id = r.id;
        return r.layout;
      });
      return id;
    };
    return { useApp, side, stop, openHere };
  }

  it("each conversation's Shelf comes back on switch (pages, panes, page in view, collapsed); a new one starts from the default layout", async () => {
    const { useApp, side, stop, openHere } = await start("A");
    try {
      const files = openHere("workspace.files", follow, "files");
      const chat = openHere("side-chat.chat", { kind: "agent", hostId: "local", sessionId: "A" }, "chat");
      const aPages = side.useSide.getState().layout.pages.map((p) => p.id);
      const aActive = side.useSide.getState().layout.activePage;
      expect(side.liveConversation()).toBe("local|A");
      useApp.setState({ selectedId: "B" });
      expect(side.liveConversation()).toBe("local|B");
      // B never had a Shelf and no default layout is stored: empty
      expect(side.useSide.getState().layout.pages).toEqual([]);
      const term = openHere("terminal.pty", follow, "terminal", null);
      side.updateLayout((l) => collapseShelf(l, shelvesOf(l)[0]!.id));
      useApp.setState({ selectedId: "A" });
      const a = side.useSide.getState().layout;
      expect(a.pages.map((p) => p.id)).toEqual(aPages);
      expect(a.activePage).toBe(aActive);
      expect(a.instances[files]?.kind).toBe("workspace.files");
      expect(a.instances[chat]?.kind).toBe("side-chat.chat");
      expect(a.instances[term]).toBeUndefined();
      expect(shelvesOf(a)[0]!.collapsed).toBeUndefined();
      useApp.setState({ selectedId: "B" });
      const b = side.useSide.getState().layout;
      expect(b.instances[term]?.kind).toBe("terminal.pty");
      expect(shelvesOf(b)[0]!.collapsed).toBe(true);
      // ids never clash across conversations (one counter)
      expect(Object.keys(b.instances).some((id) => a.instances[id])).toBe(false);
      // stored per conversation (file v5)
      side.flushSideSave();
      const file = JSON.parse(storage.get("cutex-desktop.panes")!);
      expect(file.v).toBe(5);
      expect(Object.keys(file.convShelves["host:local"].conv).sort()).toEqual(["local|A", "local|B"]);
    } finally {
      stop();
    }
  });

  it("no agent focused (the desktop): the Shelf stays as it is; the first agent with no Shelf of its own takes it", async () => {
    const { useApp, side, stop, openHere } = await start(null);
    try {
      expect(side.liveConversation()).toBeNull();
      const files = openHere("workspace.files", follow, "files");
      useApp.setState({ selectedId: "C" });
      expect(side.liveConversation()).toBe("local|C");
      expect(side.useSide.getState().layout.instances[files]?.kind).toBe("workspace.files");
      useApp.setState({ selectedId: null });
      expect(side.liveConversation()).toBe("local|C");
      expect(side.useSide.getState().layout.instances[files]).toBeTruthy();
    } finally {
      stop();
    }
  });

  it("a shared page is in every conversation's Shelf — one instance that moves with the focus; unsharing makes it the focused one's own", async () => {
    const { useApp, side, stop, openHere } = await start("A");
    try {
      openHere("workspace.files", follow, "files");
      const book = openHere("browser.tab", host, "browser", "k1");
      side.updateLayout((l) => ownPage(l, book).layout);
      const page = locate(side.useSide.getState().layout, book)!.page.id;
      side.updateLayout((l) => setPageShared(l, page, true));
      useApp.setState({ selectedId: "B" });
      let b = side.useSide.getState().layout;
      expect(findPage(b, page)?.shared).toBe(true);
      expect(b.instances[book]?.kind).toBe("browser.tab");
      expect(b.pages).toHaveLength(1);
      // the other conversation's own Shelf (not live) has no copy of it
      expect(side.peekConvShelf("local|A")!.instances[book]).toBeUndefined();
      // B opens its own page; back on A: the shared page plus A's own page, B's not
      const term = openHere("terminal.pty", follow, "terminal", null);
      useApp.setState({ selectedId: "A" });
      const a = side.useSide.getState().layout;
      expect(a.instances[book]?.kind).toBe("browser.tab");
      expect(a.instances[term]).toBeUndefined();
      expect(a.pages).toHaveLength(2);
      // unshare on A: B no longer has it
      side.updateLayout((l) => setPageShared(l, page, false));
      useApp.setState({ selectedId: "B" });
      b = side.useSide.getState().layout;
      expect(b.instances[book]).toBeUndefined();
      expect(b.instances[term]?.kind).toBe("terminal.pty");
    } finally {
      stop();
    }
  });

  it("migration v4 → v5: the global Shelf becomes the default layout and the focused conversation's own; conversation chips go; nothing is lost", async () => {
    let tools = open(emptyLayout(), "workspace.files", follow, "files").layout;
    const book = open(tools, "browser.tab", host, "browser", "k1");
    tools = book.layout;
    // the work area: a1 focused beside b2, plus a conversation chip
    let work = defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "a1" });
    work = openBeside(work, { hostId: "local", sessionId: "b2" }, 5, { focus: false });
    work = { ...work, chips: ["c9"], panes: { ...work.panes, c9: { tabs: ["c9"], active: "c9", at: 1, home: { at: 1 } } }, instances: { ...work.instances, c9: { kind: "core.conversation", binding: { kind: "agent", hostId: "local", sessionId: "z" }, params: {}, state: null } } };
    work = focusPane(work, MAIN_PANE, 6);
    storage.set("cutex-desktop.panes", JSON.stringify({ v: 4, layouts: { "host:local": joinLayout(work, toolPartOf(tools)) }, singleShelf: false }));
    const { useApp, side, stop } = await start(null);
    try {
      const file = JSON.parse(storage.get("cutex-desktop.panes")!);
      expect(file.v).toBe(5);
      expect(file.layouts["host:local"].chips).toEqual([]);
      expect(Object.keys(file.convShelves["host:local"].conv)).toEqual(["local|a1"]);
      expect(file.convShelves["host:local"].template).toBeTruthy();
      // the focused conversation's Shelf is the old global one, as it was (loaded at start)
      expect(side.liveConversation()).toBe("local|a1");
      expect(Object.keys(side.useSide.getState().layout.instances).sort()).toEqual(Object.keys(tools.instances).sort());
      // another conversation gets a copy of the default layout (the panes that follow the focus)
      useApp.setState({ selectedId: "a1" });
      useApp.setState({ selectedId: "b2" });
      const b = side.useSide.getState().layout;
      expect(Object.values(b.instances).map((i) => i.kind)).toEqual(["workspace.files"]);
      expect(b.instances[book.id]).toBeUndefined();
      useApp.setState({ selectedId: "a1" });
      expect(side.useSide.getState().layout.instances[book.id]?.kind).toBe("browser.tab");
    } finally {
      stop();
    }
  });
});

describe("workspaces (lib/workspaces)", { timeout: 20_000 }, () => {
  beforeEach(() => vi.resetModules());

  it("drop outcomes per target: Shelf = project, edge = side by side, conversation = replace; services into the Shelf, never the edge", async () => {
    const { dropOutcome } = await import("../src/renderer/src/lib/workspaces");
    const one = { panes: [{ paneId: "main", hostId: "local", sessionId: "A" }], focused: "main" };
    const two = { panes: [{ paneId: "main", hostId: "local", sessionId: "A" }, { paneId: "c2", hostId: "local", sessionId: "B" }], focused: "main" };
    const agent = (key: string) => ({ kind: "agent" as const, hostId: "local", key });
    const svc = { kind: "service" as const, hostId: "local", key: "tingshu" };
    expect(dropOutcome(agent("T"), { kind: "shelf", paneId: "main" }, one)).toEqual({ kind: "project", paneId: "main" });
    expect(dropOutcome(agent("A"), { kind: "shelf", paneId: "main" }, one)).toEqual({ kind: "refuse", reason: "own-shelf" });
    expect(dropOutcome(agent("T"), { kind: "edge", side: "right" }, one)).toEqual({ kind: "beside", side: "right", replaces: null });
    expect(dropOutcome(agent("A"), { kind: "edge", side: "left" }, one)).toMatchObject({ kind: "refuse", reason: "on-screen" });
    expect(dropOutcome(agent("T"), { kind: "edge", side: "left" }, two)).toEqual({ kind: "beside", side: "left", replaces: "main" });
    expect(dropOutcome(agent("B"), { kind: "edge", side: "right" }, two)).toMatchObject({ kind: "refuse", reason: "on-screen", focus: "c2" });
    expect(dropOutcome(agent("T"), { kind: "conversation", paneId: "c2" }, two)).toEqual({ kind: "replace", paneId: "c2" });
    expect(dropOutcome(agent("B"), { kind: "conversation", paneId: "c2" }, two)).toEqual({ kind: "refuse", reason: "same" });
    expect(dropOutcome(agent("B"), { kind: "conversation", paneId: "main" }, two)).toEqual({ kind: "refuse", reason: "shown-other", focus: "c2" });
    expect(dropOutcome(agent("B"), { kind: "shelf", paneId: "main" }, two)).toEqual({ kind: "project", paneId: "main" });
    expect(dropOutcome(svc, { kind: "edge", side: "right" }, one)).toEqual({ kind: "refuse", reason: "edge-not-agent" });
    expect(dropOutcome(svc, { kind: "shelf", paneId: "c2" }, two)).toEqual({ kind: "into-shelf", paneId: "c2" });
    expect(dropOutcome(svc, { kind: "conversation", paneId: "main" }, two)).toEqual({ kind: "into-shelf", paneId: "main" });
    // a workspace showing nothing (the desktop) takes the agent
    const empty = { panes: [{ paneId: "main", hostId: "local", sessionId: null }], focused: "main" };
    expect(dropOutcome(agent("T"), { kind: "shelf", paneId: "main" }, empty)).toEqual({ kind: "replace", paneId: "main" });
    // the same session id on another host is another agent
    expect(dropOutcome({ kind: "agent", hostId: "host-b", key: "A" }, { kind: "conversation", paneId: "main" }, one)).toEqual({ kind: "replace", paneId: "main" });
  });

  it("labels say what a drop does (投影到 X 的 Shelf / 并排打开 / 替换 / refused)", async () => {
    const { outcomeText } = await import("../src/renderer/src/lib/workspaces");
    const screen = { panes: [{ paneId: "main", hostId: "local", sessionId: "A" }], focused: "main" };
    const ref = { kind: "agent" as const, hostId: "local", key: "T", title: "ui-tester" };
    expect(outcomeText(ref, { kind: "project", paneId: "main" }, screen)).toMatchObject({ tone: "project", label: expect.stringContaining("Shelf") });
    expect(outcomeText(ref, { kind: "beside", side: "right", replaces: null }, screen).tone).toBe("beside");
    expect(outcomeText(ref, { kind: "replace", paneId: "main" }, screen).tone).toBe("replace");
    expect(outcomeText(ref, { kind: "refuse", reason: "own-shelf" }, screen).tone).toBe("refuse");
    expect(outcomeText(ref, null, screen).tone).toBeNull();
  });

  it("drop sentences are the 动作预告 ones (docs/design/008): 放进 X 的 Shelf / 并排打开 / 替换 X（它会留在托盘里）; an empty workspace = blue", async () => {
    const { outcomeText } = await import("../src/renderer/src/lib/workspaces");
    const screen = { panes: [{ paneId: "main", hostId: "local", sessionId: "A" }], focused: "main" };
    const ref = { kind: "service" as const, hostId: "local", key: "listen", title: "听书" };
    expect(outcomeText(ref, { kind: "into-shelf", paneId: "main" }, screen).label).toMatch(/放进|Into/);
    expect(outcomeText(ref, { kind: "beside", side: "right", replaces: null }, screen).label).toMatch(/并排打开|side by side/);
    const agent = { kind: "agent" as const, hostId: "local", key: "T", title: "ui-tester" };
    expect(outcomeText(agent, { kind: "replace", paneId: "main" }, screen).label).toMatch(/托盘|tray/);
    const empty = { panes: [{ paneId: "main", hostId: "local", sessionId: null }], focused: "main" };
    expect(outcomeText(agent, { kind: "replace", paneId: "main" }, empty).tone).toBe("project");
  });

  it("side by side (lib/workspaceRow, 铺满窗口): the focused Shelf at its own width while both columns keep their minimum, else its rail; the other one is a rail", async () => {
    const { workspaceRow, expandedBox } = await import("../src/renderer/src/lib/workspaceRow");
    const { WS_CONVERSATION_MIN_W } = await import("../src/renderer/src/lib/workspaces");
    const { COLLAPSED_SHELF_WIDTH } = await import("../src/renderer/src/lib/sideLayout");
    const ws = (collapsed: boolean) => [
      { want: null, min: WS_CONVERSATION_MIN_W, rail: false, shelves: [{ id: "s1", side: "right" as const, width: 340, collapsed }] },
      { want: null, min: WS_CONVERSATION_MIN_W, rail: true, shelves: [] },
    ];
    const roomy = workspaceRow({ area: 2000, mode: "fill", placement: "right", workspaces: ws(false) });
    expect(roomy.workspaces[0]!.shelves[0]).toMatchObject({ expanded: true, box: expandedBox(340), forced: false });
    expect(roomy.workspaces.map((w) => w.width)).toEqual([null, null]);
    expect(roomy.centred).toBe(false);
    // Too narrow for both columns at their minimum beside it: its rail (not stored as collapsed).
    expect(workspaceRow({ area: 800, mode: "fill", placement: "right", workspaces: ws(false) }).workspaces[0]!.shelves[0]).toMatchObject({ expanded: false, forced: true, box: COLLAPSED_SHELF_WIDTH });
    // Collapsed stays collapsed.
    expect(workspaceRow({ area: 2000, mode: "fill", placement: "right", workspaces: ws(true) }).workspaces[0]!.shelves[0]).toMatchObject({ expanded: false, forced: false });
  });

  it("the sidebar drops to its rail when two workspaces do not fit beside it (never for one)", async () => {
    const { sidebarAutoRail } = await import("../src/renderer/src/lib/workspaces");
    expect(sidebarAutoRail({ workspaces: 1, windowWidth: 900, sidebarWidth: 256 })).toBe(false);
    expect(sidebarAutoRail({ workspaces: 2, windowWidth: 1280, sidebarWidth: 256 })).toBe(true);
    expect(sidebarAutoRail({ workspaces: 2, windowWidth: 2560, sidebarWidth: 256 })).toBe(false);
  });

  it("⌘K: ↵ = replace, Ctrl/⌘+↵ = side by side for agents; services / artifacts beside = another Shelf / a new Shelf page; pages only with two workspaces; rows drag as workspace refs", async () => {
    const { hasBeside, planOpen, workspaceRefOf } = await import("../src/renderer/src/modules/quick-switch/model");
    const agent = { kind: "agent" as const, hostId: "local", sessionId: "a1" };
    const one = { workspaces: 1, otherHostId: null };
    const two = { workspaces: 2, otherHostId: "local" };
    expect(hasBeside(agent)).toBe(true);
    expect(hasBeside({ kind: "service", hostId: "local", slug: "s" }, one)).toBe(true);
    expect(hasBeside({ kind: "artifact", hostId: "local", ref: "r", name: "n" }, two)).toBe(true);
    expect(hasBeside({ kind: "page", page: "x.page" as ItemId }, one)).toBe(false);
    expect(hasBeside({ kind: "page", page: "x.page" as ItemId }, two)).toBe(true);
    expect(planOpen({ kind: "service", hostId: "local", slug: "s" }, true, () => true)).toMatchObject({ via: "workspace", mode: "beside" });
    expect(planOpen(agent, false, () => true)).toMatchObject({ via: "panes", kind: "core.conversation", beside: false });
    expect(planOpen(agent, true, () => true)).toMatchObject({ via: "panes", kind: "core.conversation", beside: true });
    expect(workspaceRefOf({ target: agent, title: "Alpha" })).toEqual({ kind: "agent", hostId: "local", key: "a1", title: "Alpha" });
    expect(workspaceRefOf({ target: { kind: "service", hostId: "local", slug: "tingshu" }, title: "听书" })).toEqual({ kind: "service", hostId: "local", key: "tingshu", title: "听书" });
    expect(workspaceRefOf({ target: { kind: "shelfPage", shelfId: "s1", pageId: "p1" }, title: "x" })).toBeNull();
  });
});

describe("openRef beside for services / artifacts / pages (lib/workspaces)", { timeout: 20_000 }, () => {
  let storage: Map<string, string>;
  beforeEach(() => {
    vi.resetModules();
    storage = new Map();
    vi.stubGlobal("localStorage", { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v), removeItem: (k: string) => void storage.delete(k) });
    if (typeof window === "undefined") vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {}, innerWidth: 1600 });
  });

  /** The stores with one or two workspaces (A focused; B the other), refsOpen opening a browser tab keyed by the ref. */
  async function start(workspaces: 1 | 2) {
    const focused: string[] = [];
    const opened: string[] = [];
    vi.doMock("../src/renderer/src/lib/refServices", () => ({
      refsOpen: async (ref: { key: string }) => {
        if (ref.key === "out-of-view") return { status: "unavailable", reason: "host-offline" };
        if (ref.key === "switching") return { status: "stale" };
        opened.push(ref.key);
        const side = await import("../src/renderer/src/lib/sideLayoutStore");
        side.updateLayout((l) => open(l, "browser.tab", host, "browser", ref.key).layout);
        return { status: "opened", where: "card" };
      },
    }));
    vi.doMock("../src/renderer/src/lib/paneStore", async (orig) => ({ ...(await orig<object>()), focusConversationPane: (id: string) => void focused.push(id) }));
    const { useApp } = await import("../src/renderer/src/store");
    const side = await import("../src/renderer/src/lib/sideLayoutStore");
    const { usePanes } = await import("../src/renderer/src/lib/paneStore");
    const ws = await import("../src/renderer/src/lib/workspaces");
    useApp.setState({ selectedId: "A", selectedHost: "local" });
    let layout = defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "A" });
    if (workspaces === 2) layout = focusPane(openBeside(layout, { hostId: "local", sessionId: "B" }, ++clock, { noChip: true, room: true }), MAIN_PANE, ++clock);
    usePanes.setState({ layout });
    const stop = side.startSideStore(() => () => {});
    return { useApp, side, ws, stop, focused, opened, panes: conversationPanes(layout) };
  }

  it("the target: two workspaces = the other one's Shelf; one = a new page of the focused one's Shelf (pure)", async () => {
    const { besideShelfTarget } = await import("../src/renderer/src/lib/workspaces");
    const two = { panes: [{ paneId: "main", hostId: "local", sessionId: "A" }, { paneId: "c2", hostId: "local", sessionId: "B" }], focused: "main" };
    expect(besideShelfTarget(two)).toEqual({ kind: "other", paneId: "c2" });
    expect(besideShelfTarget({ ...two, focused: "c2" })).toEqual({ kind: "other", paneId: "main" });
    expect(besideShelfTarget(two, "c2")).toEqual({ kind: "other", paneId: "main" });
    expect(besideShelfTarget({ panes: [two.panes[0]!], focused: "main" })).toEqual({ kind: "new-page", paneId: "main" });
  });

  it("one workspace: a service opens on a new page of the Shelf (not a tab beside the open one); the kind's remembered page is unchanged", async () => {
    const { side, ws, stop, opened } = await start(1);
    try {
      expect(await ws.openRef({ kind: "service", hostId: "local", key: "first" }, "replace")).toBe(true);
      const l1 = side.useSide.getState().layout;
      const page1 = l1.activePage;
      const overrides = l1.overrides;
      expect(await ws.openRef({ kind: "service", hostId: "local", key: "second" }, "beside")).toBe(true);
      expect(opened).toEqual(["first", "second"]);
      const l2 = side.useSide.getState().layout;
      const second = Object.keys(l2.instances).find((id) => l2.instances[id]!.key === "second")!;
      const first = Object.keys(l2.instances).find((id) => l2.instances[id]!.key === "first")!;
      const at = locate(l2, second)!;
      expect(at.page.id).not.toBe(page1);
      expect(at.page.shelf).toBe(findPage(l2, page1)!.shelf);
      expect(at.page.cards).toHaveLength(1);
      expect(l2.activePage).toBe(at.page.id);
      expect(locate(l2, first)!.page.id).toBe(page1);
      expect(l2.overrides).toEqual(overrides);
      // replace (↵) still adds a tab where the kind goes
      await ws.openRef({ kind: "service", hostId: "local", key: "third" }, "replace");
      const l3 = side.useSide.getState().layout;
      const third = Object.keys(l3.instances).find((id) => l3.instances[id]!.key === "third")!;
      expect(locate(l3, third)!.page.id).toBe(page1);
    } finally {
      stop();
    }
  });

  it("a refused open says why (openRefWhy: the refs reason; stale as such; null = opened), openRef stays a boolean", async () => {
    const { ws, stop } = await start(1);
    try {
      expect(await ws.openRefWhy({ kind: "service", hostId: "local", key: "out-of-view" }, "replace")).toBe("host-offline");
      expect(await ws.openRefWhy({ kind: "service", hostId: "local", key: "out-of-view" }, "beside")).toBe("host-offline");
      expect(await ws.openRefWhy({ kind: "service", hostId: "local", key: "switching" }, "replace")).toBe("stale");
      expect(await ws.openRef({ kind: "service", hostId: "local", key: "out-of-view" }, "replace")).toBe(false);
      expect(await ws.openRefWhy({ kind: "page", hostId: "", key: "not a page id" }, "replace")).toBe("bad-ref");
      expect(await ws.openRefWhy({ kind: "service", hostId: "local", key: "fine" }, "replace")).toBeNull();
    } finally {
      stop();
    }
  });

  it("two workspaces: into the other workspace's Shelf (focused there first; no new page); a page item opens in the other workspace with its params", async () => {
    const { useApp, side, ws, stop, focused, opened, panes } = await start(2);
    try {
      expect(panes).toHaveLength(2);
      expect(await ws.openRef({ kind: "artifact", hostId: "local", key: "af@latest" }, "beside")).toBe(true);
      expect(focused).toEqual([panes[1]]);
      expect(opened).toEqual(["af@latest"]);
      const openPage = vi.spyOn(useApp.getState(), "openPage").mockImplementation(() => {});
      useApp.setState({ openPage });
      expect(await ws.openRef({ kind: "page", hostId: "", key: "services.page" }, "beside", { pageParams: { tab: "x" } })).toBe(true);
      expect(focused).toEqual([panes[1], panes[1]]);
      expect(openPage).toHaveBeenCalledWith("services.page", { tab: "x" });
    } finally {
      stop();
    }
  });
});

describe("panes without conversation chips (lib/paneLayout)", () => {
  const base = () => defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "a1" });
  it("openBeside with two workspaces (`noChip`): the other one shows the agent, nothing goes to the tray", () => {
    const two = openBeside(base(), { hostId: "local", sessionId: "b2" }, 1);
    const three = openBeside(two, { hostId: "local", sessionId: "c3" }, 2, { noChip: true });
    expect(three.chips).toEqual([]);
    expect(conversationPanes(three).map((id) => paneBinding(three, id)!.sessionId)).toEqual(["c3", "b2"]);
    // without noChip (old callers): LRU to a chip, as before
    expect(openBeside(two, { hostId: "local", sessionId: "c3" }, 2).chips).toHaveLength(1);
  });

  it("显示桌面 without chips: one empty conversation pane left (emptyWork)", () => {
    const two = openBeside(base(), { hostId: "local", sessionId: "b2" }, 1);
    const desk = emptyWork(two);
    expect(conversationPanes(desk)).toHaveLength(1);
    expect(paneBinding(desk, desk.focus!)!.sessionId).toBeNull();
    expect(desk.chips).toEqual([]);
    expect(emptyWork(bindPane(closePaneOverlay(base(), MAIN_PANE), MAIN_PANE, "local", null)).chips).toEqual([]);
  });
});
