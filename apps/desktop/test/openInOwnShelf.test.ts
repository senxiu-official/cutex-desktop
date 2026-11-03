// @vitest-environment jsdom
// Design 012 (docs/design/017-open-in-own-shelf.md, checklist #8): an open from inside a pane lands in the Shelf
// that holds that pane — the other workspace's too — and only an open with no source pane uses the focused
// workspace's Shelf. A focus open gives the source's workspace the focus first; any other open leaves the focus,
// the selection and the focused Shelf's mode where they were. The browser's popups find their opener tab.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));

const TOOL = "test.tool";
const AGENT_TOOL = "test.agentTool";
const pass = { parseParams: (p: unknown) => p ?? {}, init: (p: unknown) => p, icon: () => null, Body: () => null, useTab: () => ({ title: "t" }), titleKey: "side.column" };
const SIDE = [
  { mode: "show", moduleId: "test", item: { ...pass, id: TOOL, instances: "multi", defaultBinding: "follow", placement: { home: "chat" } } },
  { mode: "show", moduleId: "test", item: { ...pass, id: AGENT_TOOL, instances: "multi", defaultBinding: "agent", placement: { home: "chat" } } },
  // Stands in for the browser module's tab (its state carries the tab key main knows it by).
  { mode: "show", moduleId: "test", item: { ...pass, id: "browser.tab", instances: "multi", defaultBinding: "host", placement: { home: "chat" }, init: (p: Record<string, unknown>) => ({ tabKey: "minted", ...p }) } },
];
const NONE: never[] = [];
vi.mock("../src/renderer/src/modules/app", () => ({
  appModules: () => ({ subscribe: () => () => {}, snapshot: (slot: string) => (slot === "side.component" ? SIDE : NONE), statuses: () => new Map(), modules: [] }),
}));

import type { SessionResource } from "@cutex-desktop/protocol";
import type { ItemId } from "../src/renderer/src/modules/types";
import { addShelfPage, applyOpen, emptyLayout, locate, place, placeSpec, setPageShared, shelvesOf, switchPage, type SideLayout } from "../src/renderer/src/lib/sideLayout";
import { conversationPanes, defaultLayout, focusPane, openBeside } from "../src/renderer/src/lib/paneLayout";
import { usePanes } from "../src/renderer/src/lib/paneStore";
import { instanceOwner, liveConversation, resetConvShelves, startSideStore, switchConversation, syncPeers, updatePeerView, useSide } from "../src/renderer/src/lib/sideLayoutStore";
import { renumber } from "../src/renderer/src/lib/convShelves";
import { writeConvShelf } from "../src/renderer/src/lib/paneFile";
import { planOpenTarget, sideOpenFrom } from "../src/renderer/src/lib/shelfTarget";
import { sideList, sideOpen, sideReveal } from "../src/renderer/src/lib/sideServices";
import { openPopupTab, pressBrowserTab, revealBrowserTab } from "../src/renderer/src/modules/browser/popupOpen";
import { focusPeer, installFramePress, pressInstance } from "../src/renderer/src/lib/shelfSource";
import { useRailNews } from "../src/renderer/src/lib/railNews";
import { useApp } from "../src/renderer/src/store";

let clock = 100;
function withTool(l: SideLayout = emptyLayout(), state: Record<string, unknown> = { n: clock }, kind = TOOL, page?: string): SideLayout {
  const input = { kind: kind as ItemId, binding: { kind: "follow" as const, hostId: "local" }, key: null, state: state as never, v: 1, pinned: true };
  const decision = place(l, { ...input, transient: false, page, activePage: l.activePage, columnOpen: l.open }, placeSpec({ home: "chat" }));
  return applyOpen(l, decision, input, ++clock, { reveal: true, home: "chat" }).layout;
}
const session = (id: string, name: string) => ({ cutexSessionId: id, displayName: name, avatar: null, native: { threadId: null }, runtime: { status: "online" }, cwd: "" }) as unknown as SessionResource;
const opened = (r: ReturnType<typeof sideOpen>) => (r.status === "opened" ? r.instanceId : null);

/**
 * alden's own Shelf (stored, ids clear of eva's): one tool, and a browser tab with tab key `alden-tab`. `folded`:
 * its Shelf folded to its rail.
 */
function aldenShelf(overrides: SideLayout["overrides"] = {}, folded = false): { tool: string; tab: string } {
  let own = withTool(emptyLayout());
  own = withTool(own, { url: "https://example.com/", tabKey: "alden-tab" }, "browser.tab");
  own = { ...renumber(own, 500).layout, overrides };
  if (folded) own = { ...own, shelves: shelvesOf(own).map((x) => ({ ...x, collapsed: true })) };
  const [tool, tab] = Object.keys(own.instances);
  // The browser's tabs are host-bound.
  own = { ...own, instances: { ...own.instances, [tab!]: { ...own.instances[tab!]!, binding: { kind: "host", hostId: "local" } } } };
  writeConvShelf("host:local", "local|alden", own, { open: true }, null);
  return { tool: tool!, tab: tab! };
}

/** Two workspaces: eva (left, focused) and alden (right), both Shelves live. */
function twoWorkspaces(): void {
  let work = defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "eva" });
  work = openBeside(work, { hostId: "local", sessionId: "alden" }, 1);
  work = focusPane(work, conversationPanes(work)[0]!, 2);
  usePanes.setState({ layout: work });
  useApp.setState({ selectedId: "eva" });
  switchConversation("local|eva");
  syncPeers();
}

let stop: () => void = () => {};
beforeEach(() => {
  localStorage.clear();
  resetConvShelves();
  useApp.setState({
    selectedId: "eva",
    selectedHost: null,
    hosts: null,
    sidebar: { active: [session("eva", "Eva"), session("alden", "Alden")], retired: [], hostRows: {}, projects: null } as never,
    openAgent: async (id: string) => void useApp.setState({ selectedId: id }),
  } as never);
  useSide.setState({ scope: "host:local", layout: withTool(), mode: null, narrow: false, liveWidth: {}, tabInfo: {}, focusedCard: null, revealed: {}, flash: null });
  usePanes.setState({ layout: defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "eva" }) });
  switchConversation("local|eva");
  stop = startSideStore(() => () => {});
});
afterEach(() => {
  stop();
  vi.restoreAllMocks();
});

describe("planOpenTarget (the rule)", () => {
  it("no source, a source in the focused Shelf, or a gone source → the focused Shelf", () => {
    expect(planOpenTarget(undefined, "local|eva")).toEqual({ kind: "focused" });
    expect(planOpenTarget(null, "local|eva")).toEqual({ kind: "focused" });
    expect(planOpenTarget("local|eva", "local|eva")).toEqual({ kind: "focused" });
  });
  it("a source in the other workspace's Shelf → that Shelf; only a focus open moves the focus there", () => {
    expect(planOpenTarget("local|alden", "local|eva")).toEqual({ kind: "in-source", key: "local|alden" });
    expect(planOpenTarget("local|alden", "local|eva", { focus: true })).toEqual({ kind: "focus-source", key: "local|alden" });
    expect(planOpenTarget("local|alden", "local|eva", { focus: true, background: true })).toEqual({ kind: "in-source", key: "local|alden" });
  });
});

describe("an open from a pane lands in that pane's Shelf", () => {
  it("from the other (unfocused) workspace's pane: in its Shelf; the focus, selection and focused Shelf's mode stay", () => {
    const { tool } = aldenShelf();
    twoWorkspaces();
    expect(instanceOwner(tool)).toBe("local|alden");
    const evaBefore = Object.keys(useSide.getState().layout.instances);
    const card = Object.values(useSide.getState().layout.pages)[0]!.cards[0]!.id;
    useSide.setState({ mode: { kind: "maximised", card }, focusedCard: card });
    const id = opened(sideOpenFrom({ instanceId: tool }, TOOL as ItemId, {}, {}));
    expect(id).not.toBeNull();
    expect(instanceOwner(id!)).toBe("local|alden");
    expect(useSide.getState().peers["local|alden"]!.own.instances[id!]).toBeTruthy();
    expect(Object.keys(useSide.getState().layout.instances)).toEqual(evaBefore);
    expect(liveConversation()).toBe("local|eva");
    expect(useApp.getState().selectedId).toBe("eva");
    expect(useSide.getState().mode).toEqual({ kind: "maximised", card });
    expect(useSide.getState().focusedCard).toBe(card);
    expect(instanceOwner(tool)).toBe("local|alden");
  });

  it("no source (window bar, shortcuts, ⌘K): the focused workspace's Shelf, even with the other one on screen", () => {
    aldenShelf();
    twoWorkspaces();
    const id = opened(sideOpenFrom(null, TOOL as ItemId, {}, {}));
    expect(instanceOwner(id!)).toBeNull();
    expect(liveConversation()).toBe("local|eva");
    // services.side.open itself is unchanged: the focused Shelf.
    expect(instanceOwner(opened(sideOpen(TOOL as ItemId, {}, {}))!)).toBeNull();
  });

  it("from a pane of the focused Shelf: the focused Shelf", () => {
    aldenShelf();
    twoWorkspaces();
    const evaTool = Object.keys(useSide.getState().layout.instances)[0]!;
    const id = opened(sideOpenFrom({ instanceId: evaTool }, TOOL as ItemId, {}, {}));
    expect(instanceOwner(id!)).toBeNull();
  });

  it("a focus open from the other workspace's pane gives that workspace the focus, then lands in its Shelf", () => {
    const { tool } = aldenShelf();
    twoWorkspaces();
    const id = opened(sideOpenFrom({ instanceId: tool }, TOOL as ItemId, {}, { focus: true }));
    expect(useApp.getState().selectedId).toBe("alden");
    expect(liveConversation()).toBe("local|alden");
    expect(instanceOwner(id!)).toBeNull();
    expect(useSide.getState().layout.instances[tool]).toBeTruthy();
  });

  it("with a shared page the kind is remembered on: still in the source's Shelf, on the source's page", () => {
    // eva's Shelf: a second page, shared (在所有对话中显示) — it joins alden's Shelf while that one is swapped in.
    // alden's Shelf remembers the kind on that page (moved there by hand while alden had the focus: its page
    // override, §18.7), so place() would put the open there — and it would follow the focus back out of alden's.
    let shared = "";
    let groups: string[] = [];
    useSide.setState((st) => {
      const made = addShelfPage(st.layout, shelvesOf(st.layout)[0]!.id);
      shared = made.pageId!;
      const l = setPageShared(switchPage(withTool(made.layout, { n: 0 }, TOOL, shared), shared), shared, true);
      groups = [...l.pages.find((p) => p.id === shared)!.groups];
      return { layout: l };
    });
    const { tool } = aldenShelf({ [TOOL]: { page: shared, groups, at: 1 } });
    twoWorkspaces();
    expect(useSide.getState().layout.pages.find((p) => p.id === shared)?.shared).toBe(true);
    const id = opened(sideOpenFrom({ instanceId: tool }, TOOL as ItemId, {}, {}));
    expect(instanceOwner(id!)).toBe("local|alden");
    const own = useSide.getState().peers["local|alden"]!.own;
    expect(locate(own, id!)!.page.id).toBe(locate(own, tool)!.page.id);
    expect(useSide.getState().layout.pages.find((p) => p.id === shared)!.cards.flatMap((c) => c.tabs)).not.toContain(id);
  });

  it("default bindings fill from the source Shelf's conversation, not the focused one", () => {
    const { tool } = aldenShelf();
    twoWorkspaces();
    const id = opened(sideOpenFrom({ instanceId: tool }, AGENT_TOOL as ItemId, {}, {}));
    const own = useSide.getState().peers["local|alden"]!.own;
    expect(own.instances[id!]!.binding).toEqual({ kind: "agent", hostId: "local", sessionId: "alden" });
    expect(locate(own, id!)!.page.id).not.toBe(locate(own, tool)!.page.id);
    expect(locate(own, id!)!.page.shelf).toBe(locate(own, tool)!.page.shelf);
  });

  it("a web page's popup opens its new tab in the opener tab's Shelf (not the focused one); unknown opener → focused", () => {
    const { tab } = aldenShelf();
    twoWorkspaces();
    const moduleOpen = vi.fn(sideOpen);
    const r = openPopupTab({ hostId: "local", tabKey: "alden-tab", pool: "owner", newTabUrl: "https://example.com/next" } as never, moduleOpen);
    expect(moduleOpen).not.toHaveBeenCalled();
    const id = r && opened(r);
    expect(id).not.toBeNull();
    expect(id).not.toBe(tab);
    expect(instanceOwner(id!)).toBe("local|alden");
    expect(liveConversation()).toBe("local|eva");
    // Opener gone: the module's own services.side.open (the focused Shelf).
    const lost = openPopupTab({ hostId: "local", tabKey: "nobody", pool: "owner", newTabUrl: "https://example.com/x" } as never, moduleOpen);
    expect(moduleOpen).toHaveBeenCalledTimes(1);
    expect(instanceOwner(opened(lost!)!)).toBeNull();
  });
});

/** An element standing for a pane's body content, inside instance `id`'s box (the instance layer's). */
function inInstance(id: string, tag: string): HTMLElement {
  const box = document.createElement("div");
  box.setAttribute("data-side-instance", id);
  const el = document.createElement(tag);
  el.tabIndex = 0;
  box.appendChild(el);
  document.body.appendChild(box);
  return el;
}

describe("a press inside a web page / frame counts as a press in its pane (lead's default, Q1)", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("pressInstance: the other workspace's pane → that workspace takes the focus and the pane's card is the focused one", () => {
    const { tool } = aldenShelf();
    twoWorkspaces();
    pressInstance(tool);
    expect(useApp.getState().selectedId).toBe("alden");
    expect(liveConversation()).toBe("local|alden");
    expect(useSide.getState().focusedCard).toBe(locate(useSide.getState().layout, tool)!.card.id);
    pressInstance("gone");
    expect(liveConversation()).toBe("local|alden");
  });

  it("main's `pressed` for a tab in the other workspace's Shelf focuses that workspace; an unknown tab changes nothing", () => {
    aldenShelf();
    twoWorkspaces();
    pressBrowserTab({ hostId: "local", tabKey: "nobody" });
    expect(liveConversation()).toBe("local|eva");
    pressBrowserTab({ hostId: "local", tabKey: "alden-tab" });
    expect(useApp.getState().selectedId).toBe("alden");
    expect(liveConversation()).toBe("local|alden");
  });

  it("a frame taking the focus (window blur, the frame active) presses its pane; a <webview> does not (main reports those)", async () => {
    const { tool, tab } = aldenShelf();
    twoWorkspaces();
    const off = installFramePress();
    try {
      const view = inInstance(tab, "webview");
      view.focus();
      window.dispatchEvent(new Event("blur"));
      expect(liveConversation()).toBe("local|eva");
      const frame = inInstance(tool, "iframe");
      frame.focus();
      expect(document.activeElement).toBe(frame);
      window.dispatchEvent(new Event("blur"));
      expect(liveConversation()).toBe("local|alden");
      // eva takes the focus some other way while alden's frame keeps it: the frame lets go, so the next press counts
      // (jsdom ignores blur() on a frame; Chrome does not).
      const blur = vi.spyOn(frame, "blur");
      focusPeer("local|eva");
      expect(liveConversation()).toBe("local|eva");
      await Promise.resolve();
      expect(blur).toHaveBeenCalled();
    } finally {
      off();
    }
  });

  it("the focus going from one frame straight into another (no window event) is caught while the focus is in a frame", () => {
    vi.useFakeTimers();
    const { tool } = aldenShelf();
    twoWorkspaces();
    const evaTool = Object.keys(useSide.getState().layout.instances)[0]!;
    const off = installFramePress();
    try {
      const mine = inInstance(evaTool, "iframe");
      mine.focus();
      window.dispatchEvent(new Event("blur"));
      expect(liveConversation()).toBe("local|eva");
      inInstance(tool, "iframe").focus();
      vi.advanceTimersByTime(250);
      expect(liveConversation()).toBe("local|alden");
    } finally {
      off();
      vi.useRealTimers();
    }
  });
});

describe("main's reveal finds the tab in either workspace's Shelf (lead's default, Q2)", () => {
  it("a tab in the other workspace's (folded) Shelf comes forward there; the focus and the focused Shelf stay", () => {
    const { tool, tab } = aldenShelf({}, true);
    twoWorkspaces();
    // The tool is the tab in front of their card; the browser tab is behind it.
    updatePeerView("local|alden", (l) => {
      const at = locate(l, tab)!;
      return { ...l, pages: l.pages.map((p) => ({ ...p, cards: p.cards.map((c) => (c.id === at.card.id ? { ...c, active: c.tabs.includes(tool) ? tool : c.active } : c)) })) };
    });
    const card = useSide.getState().layout.pages[0]!.cards[0]!.id;
    useSide.setState({ focusedCard: card });
    const r = revealBrowserTab({ hostId: "local", tabKey: "alden-tab" }, { list: sideList as never, reveal: sideReveal });
    expect(r).toMatchObject({ status: "revealed", instanceId: tab });
    const own = useSide.getState().peers["local|alden"]!.own;
    expect(locate(own, tab)!.card.active).toBe(tab);
    // The agent needs the page on screen: its Shelf unfolds.
    expect(shelvesOf(own).every((x) => !x.collapsed)).toBe(true);
    expect(liveConversation()).toBe("local|eva");
    expect(useApp.getState().selectedId).toBe("eva");
    expect(useSide.getState().focusedCard).toBe(card);
    expect(revealBrowserTab({ hostId: "local", tabKey: "nobody" }, { list: sideList as never, reveal: sideReveal })).toBeNull();
  });

  it("a tab in the focused Shelf: revealed there as before", () => {
    aldenShelf();
    twoWorkspaces();
    const tab = opened(sideOpen("browser.tab" as ItemId, { url: "https://example.com/e", tabKey: "eva-tab" }, { binding: { kind: "host", hostId: "local" } }))!;
    const reveal = vi.fn(sideReveal);
    const list = vi.fn(sideList);
    expect(revealBrowserTab({ hostId: "local", tabKey: "eva-tab" }, { list: list as never, reveal })).toMatchObject({ status: "revealed", instanceId: tab });
    // The module's own services, as before.
    expect(list).toHaveBeenCalledWith("browser.tab");
    expect(reveal).toHaveBeenCalledWith({ instanceId: tab });
  });
});

describe("an open into the unfocused workspace's folded Shelf keeps it folded (lead's default, Q3)", () => {
  it("the popup lands on the opener's page, the Shelf stays folded, the focused one stays open, the page's Rail button is marked until opened", () => {
    const { tab } = aldenShelf({}, true);
    twoWorkspaces();
    const evaShelves = shelvesOf(useSide.getState().layout).map((x) => ({ id: x.id, collapsed: !!x.collapsed }));
    const r = openPopupTab({ hostId: "local", tabKey: "alden-tab", pool: "owner", newTabUrl: "https://example.com/next" } as never, vi.fn(sideOpen));
    const id = opened(r!)!;
    const own = useSide.getState().peers["local|alden"]!.own;
    const page = locate(own, tab)!.page.id;
    expect(locate(own, id)!.page.id).toBe(page);
    expect(shelvesOf(own).every((x) => x.collapsed)).toBe(true);
    expect(shelvesOf(useSide.getState().layout).map((x) => ({ id: x.id, collapsed: !!x.collapsed }))).toEqual(evaShelves);
    expect(liveConversation()).toBe("local|eva");
    expect(useRailNews.getState().pages[page]).toBeDefined();
    // The owner opens that page (its Rail button): the mark goes.
    updatePeerView("local|alden", (l) => switchPage(l, page));
    expect(useRailNews.getState().pages[page]).toBeUndefined();
  });

  it("an open Shelf there: unchanged (it shows the new tab, no mark)", () => {
    const { tab } = aldenShelf();
    twoWorkspaces();
    const id = opened(sideOpenFrom({ instanceId: tab }, TOOL as ItemId, {}, {}))!;
    const own = useSide.getState().peers["local|alden"]!.own;
    expect(locate(own, id)).toBeTruthy();
    expect(useRailNews.getState().pages).toEqual({});
  });
});
