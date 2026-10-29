// @vitest-environment jsdom
// Owner 2026-10-23 (fix/0.2-rail-hidden-page): A — an open bound to agent X goes into X's own Shelf (on screen: there;
// else its stored Shelf, shown when X is opened), never the focused conversation's, where it would not show; the owner
// hears of it (a 「去看看」 notice). B — a one-time repair on Shelf load moves tabs bound to another agent (non-shared
// pages) to that agent's Shelf, same ids, idempotent, logged. C — a page that keeps its layout (owner-made, shared)
// draws a pane with nothing for this agent as an empty slot of the same size; auto pages are as before.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TOOL = "test.tool";
const AGENT_TOOL = "test.agentTool";
const HELD = "test.held";
const WS = "test.ws";
const pass = { parseParams: (p: unknown) => p ?? {}, init: (p: unknown) => p, icon: () => null, Body: () => null, useTab: () => ({ title: "t" }), titleKey: "side.column" };
const SIDE = [
  { mode: "show", moduleId: "test", item: { ...pass, id: TOOL, instances: "multi", defaultBinding: "follow", placement: { home: "chat" }, launcher: { params: () => ({}) } } },
  { mode: "show", moduleId: "test", item: { ...pass, id: AGENT_TOOL, instances: "multi", defaultBinding: "agent", placement: { home: "chat" }, dedupeKey: (p: { k?: string }) => p.k ?? null, launcher: { params: () => ({}) } } },
  { mode: "show", moduleId: "test", item: { ...pass, id: HELD, instances: "multi", defaultBinding: "agent", placement: { home: "browser" }, keepAlive: "hidden" } },
  { mode: "show", moduleId: "test", item: { ...pass, id: WS, instances: "multi", defaultBinding: "workspace", placement: { home: "chat" }, launcher: { params: () => ({}) } } },
];
const NONE: never[] = [];
vi.mock("../src/renderer/src/modules/app", () => ({
  appModules: () => ({ subscribe: () => () => {}, snapshot: (slot: string) => (slot === "side.component" ? SIDE : NONE), statuses: () => new Map(), modules: [] }),
}));

import type { SessionResource } from "@cutex-desktop/protocol";
import type { SideBinding } from "../src/renderer/src/modules/slots";
import type { ItemId } from "../src/renderer/src/modules/types";
import { adoptInstance, applyOpen, emptyLayout, place, placeSpec, shownCards, takeStrays, visibleCards, type SideInstance, type SideLayout } from "../src/renderer/src/lib/sideLayout";
import { conversationPanes, defaultLayout, focusPane, openBeside } from "../src/renderer/src/lib/paneLayout";
import { usePanes } from "../src/renderer/src/lib/paneStore";
import { instanceOwner, liveConversation, peekConvShelf, rememberedInstances, resetConvShelves, startSideStore, switchConversation, syncPeers, useSide } from "../src/renderer/src/lib/sideLayoutStore";
import { renumber } from "../src/renderer/src/lib/convShelves";
import { writeConvShelf } from "../src/renderer/src/lib/paneFile";
import { sideOpen, sideOpenHeld } from "../src/renderer/src/lib/sideServices";
import { useShelfToast } from "../src/renderer/src/lib/shelves";
import { useSideKeep, resetSideHolds } from "../src/renderer/src/lib/sideKeep";
import { emptySlots } from "../src/renderer/src/lib/hiddenPage";
import { useApp } from "../src/renderer/src/store";
// Static, not `await import` in the render test: the first load of the side components' graph was billed to that test
// and timed out (5 s) under the full suite's load. No vi.resetModules() here, so it is the same instance either way.
import { SidePageView } from "../src/renderer/src/components/side/SidePageView";
import { sideRegistry } from "../src/renderer/src/lib/sideComponents";

let clock = 100;
const follow: SideBinding = { kind: "follow", hostId: "local" };
const agent = (sessionId: string): SideBinding => ({ kind: "agent", hostId: "local", sessionId });
function withKind(l: SideLayout, kind: string, binding: SideBinding, state: Record<string, unknown> = { n: clock }, page?: string): SideLayout {
  const input = { kind: kind as ItemId, binding, key: null, state: state as never, v: 1, pinned: true };
  const decision = place(l, { ...input, transient: false, page, activePage: l.activePage, columnOpen: l.open }, placeSpec({ home: "chat" }));
  return applyOpen(l, decision, input, ++clock, { reveal: true, home: "chat" }).layout;
}
const session = (id: string, name: string) => ({ cutexSessionId: id, displayName: name, avatar: null, native: { threadId: null }, runtime: { status: "online" }, cwd: "" }) as unknown as SessionResource;
const opened = (r: { status: string; instanceId?: string }) => (r.status === "opened" ? r.instanceId! : null);
const live = () => useSide.getState().layout;
const kept = (l: SideLayout): SideLayout => ({ ...l, pages: l.pages.map((p) => ({ ...p, kept: true })) });

let stop: () => void = () => {};
beforeEach(() => {
  localStorage.clear();
  resetConvShelves();
  resetSideHolds();
  useShelfToast.setState({ toast: null });
  useApp.setState({
    selectedId: "eva",
    selectedHost: null,
    hosts: { active: "local", scope: { kind: "host", id: "local" }, hosts: [{ id: "local", conn: { epoch: "e1" } }], groups: [] },
    sidebar: { active: [session("eva", "Eva"), session("alden", "Alden"), session("bob", "Bob")], retired: [], hostRows: {}, projects: null } as never,
    openAgent: async (id: string) => void useApp.setState({ selectedId: id }),
    select: async (id: string) => void useApp.setState({ selectedId: id }),
  } as never);
  useSide.setState({ scope: "host:local", layout: withKind(emptyLayout(), TOOL, follow), mode: null, narrow: false, liveWidth: {}, tabInfo: {}, focusedCard: null, revealed: {}, flash: null });
  usePanes.setState({ layout: defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "eva" }) });
  switchConversation("local|eva");
  stop = startSideStore(() => () => {});
});
afterEach(() => {
  stop();
  vi.restoreAllMocks();
});

describe("adoptInstance (pure)", () => {
  const inst = (kind: string, binding: SideBinding): SideInstance => ({ kind: kind as ItemId, binding, key: null, state: {} as never, v: 1, pinned: true, lastActiveAt: 0 });
  it("joins the first own pane of its kind as a background tab; same id", () => {
    const base = withKind(emptyLayout(), AGENT_TOOL, agent("alden"));
    const [first] = Object.keys(base.instances);
    const { layout, pageId } = adoptInstance(base, "i900", inst(AGENT_TOOL, agent("alden")), 5, { seq: 900 });
    const card = layout.pages.find((p) => p.id === pageId)!.cards[0]!;
    expect(card.tabs).toEqual([first, "i900"]);
    expect(card.active).toBe(first);
    expect(layout.seq).toBeGreaterThanOrEqual(900);
  });
  it("no pane of its kind (or only on a shared page): a page of its own", () => {
    let base = withKind(emptyLayout(), AGENT_TOOL, agent("alden"));
    base = { ...base, pages: base.pages.map((p) => ({ ...p, shared: true })) };
    const { layout, pageId } = adoptInstance(base, "i900", inst(AGENT_TOOL, agent("alden")), 5, { seq: 900 });
    expect(layout.pages).toHaveLength(2);
    expect(layout.pages.find((p) => p.id === pageId)!.shared).toBeFalsy();
    expect(layout.pages.find((p) => p.id === pageId)!.cards[0]!.tabs).toEqual(["i900"]);
  });
  it("into an empty layout: a Shelf with that page in view", () => {
    const { layout, pageId } = adoptInstance(emptyLayout(), "i9", inst(TOOL, follow), 5);
    expect(layout.shelves![0]!.active).toBe(pageId);
    expect(layout.activePage).toBe(pageId);
  });
});

describe("A: an agent's open goes to its own Shelf", () => {
  it("agent not on screen: into its stored Shelf (not the focused one); shown when that agent is opened; a notice", () => {
    const before = Object.keys(live().instances);
    const id = opened(sideOpen(AGENT_TOOL as ItemId, {}, { binding: agent("alden"), background: true }));
    expect(id).not.toBeNull();
    expect(Object.keys(live().instances)).toEqual(before);
    expect(instanceOwner(id!)).toBeUndefined();
    expect(peekConvShelf("local|alden")!.instances[id!]).toBeTruthy();
    // Unique across the scope's conversations: the live counter moved past it.
    expect(live().seq).toBeGreaterThanOrEqual(Number(id!.slice(1)));
    const toast = useShelfToast.getState().toast!;
    expect(toast.text).toContain("Alden");
    expect(toast.action).toBeTruthy();
    switchConversation("local|alden");
    expect(live().instances[id!]).toBeTruthy();
    const ctx = { hostId: "local", sessionId: "alden", workspaceKey: null, available: () => true };
    expect(live().pages.some((p) => visibleCards(live(), p, ctx).some((c) => c.tabs.includes(id!)))).toBe(true);
  });

  it("the same item again: the same tab (dedupe), no second notice within a minute", () => {
    const a = opened(sideOpen(AGENT_TOOL as ItemId, { k: "x" }, { binding: agent("alden") }));
    useShelfToast.setState({ toast: null });
    const b = opened(sideOpen(AGENT_TOOL as ItemId, { k: "x" }, { binding: agent("alden") }));
    expect(b).toBe(a);
    expect(useShelfToast.getState().toast).toBeNull();
  });

  it("the focused agent's own open stays in the live Shelf", () => {
    const id = opened(sideOpen(AGENT_TOOL as ItemId, {}, { binding: agent("eva") }));
    expect(instanceOwner(id!)).toBeNull();
  });

  it("agent on screen (the other workspace): into its live Shelf; the focus stays", () => {
    let work = defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "eva" });
    work = openBeside(work, { hostId: "local", sessionId: "alden" }, 1);
    work = focusPane(work, conversationPanes(work)[0]!, 2);
    usePanes.setState({ layout: work });
    syncPeers();
    const id = opened(sideOpen(AGENT_TOOL as ItemId, {}, { binding: agent("alden") }));
    expect(instanceOwner(id!)).toBe("local|alden");
    expect(liveConversation()).toBe("local|eva");
  });

  it("a held open (an agent's browser): held and mounted while its Shelf is not on screen", () => {
    const r = sideOpenHeld(HELD as ItemId, {}, { binding: agent("alden") });
    expect(r.status).toBe("opened");
    const id = (r as { instanceId: string }).instanceId;
    expect(Object.values(useSideKeep.getState().holds).some((x) => x.id === id)).toBe(true);
    expect(rememberedInstances()[id]).toBeTruthy();
    expect(live().instances[id]).toBeUndefined();
  });
});

describe("B: repair on Shelf load", () => {
  function bobWithStrays(): { tool: string; stray: string } {
    let own = withKind(emptyLayout(), TOOL, follow);
    own = withKind(own, AGENT_TOOL, agent("alden"), { url: "x" });
    own = renumber(own, 700).layout;
    const [tool, stray] = Object.keys(own.instances);
    writeConvShelf("host:local", "local|bob", own, { open: true }, null);
    return { tool: tool!, stray: stray! };
  }

  it("tabs bound to another agent move to that agent's Shelf, same ids; logged; idempotent", () => {
    const { tool, stray } = bobWithStrays();
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    switchConversation("local|bob");
    expect(live().instances[tool]).toBeTruthy();
    expect(live().instances[stray]).toBeUndefined();
    expect(peekConvShelf("local|alden")!.instances[stray]).toBeTruthy();
    expect(info).toHaveBeenCalledTimes(1);
    expect(String(info.mock.calls[0]![0])).toContain("moved 1 tab");
    // Again (away and back, and alden's own load): nothing more to move.
    switchConversation("local|eva");
    switchConversation("local|bob");
    switchConversation("local|alden");
    expect(info).toHaveBeenCalledTimes(1);
    expect(live().instances[stray]).toBeTruthy();
  });

  it("takeStrays leaves shared pages and own / non-agent tabs alone", () => {
    let own = withKind(emptyLayout(), TOOL, follow);
    own = withKind(own, AGENT_TOOL, agent("bob"));
    own = withKind(own, AGENT_TOOL, agent("alden"));
    expect(takeStrays(own, "local", "bob").strays).toHaveLength(1);
    const shared = { ...own, pages: own.pages.map((p) => ({ ...p, shared: true })) };
    expect(takeStrays(shared, "local", "bob").strays).toHaveLength(0);
    const fixed = takeStrays(own, "local", "bob").own;
    expect(takeStrays(fixed, "local", "bob").strays).toHaveLength(0);
  });
});

describe("C: empty slots in place", () => {
  const ctx = { hostId: "local", sessionId: "eva", workspaceKey: "ws-a", available: () => true };
  // A page with a pane of this workspace's and one of another workspace's (legitimately not shown here).
  function twoPanes(): SideLayout {
    let l = withKind(emptyLayout(), TOOL, follow);
    const page = l.pages[0]!.id;
    l = withKind(l, WS, { kind: "workspace", hostId: "local", key: "ws-b" }, {}, page);
    return l;
  }

  it("an owner-made or shared page keeps every pane (an empty slot for this agent); an auto page shows only its own", () => {
    const l = twoPanes();
    expect(l.pages[0]!.cards).toHaveLength(2);
    expect(visibleCards(l, l.pages[0]!, ctx)).toHaveLength(1);
    expect(shownCards(l, l.pages[0]!, ctx)).toHaveLength(1);
    const k = kept(l);
    expect(shownCards(k, k.pages[0]!, ctx)).toHaveLength(2);
    expect(emptySlots(k, k.pages[0]!, ctx).map((c) => c.kind)).toEqual([WS]);
    const s = { ...l, pages: l.pages.map((p) => ({ ...p, shared: true })) };
    expect(shownCards(s, s.pages[0]!, ctx)).toHaveLength(2);
  });

  it("renders: the slot keeps its place, offers 打开… (into this page) and 看 X 的", async () => {
    // A shared page with Bob's pane: legitimately not Eva's.
    let l = withKind(emptyLayout(), TOOL, follow);
    l = withKind(l, AGENT_TOOL, agent("bob"), {}, l.pages[0]!.id);
    const k = { ...l, pages: l.pages.map((p) => ({ ...p, shared: true })) };
    useSide.setState({ layout: k });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const page = k.pages[0]!;
    await act(async () => {
      root.render(h(SidePageView, { page, cards: shownCards(k, page, ctx), registry: sideRegistry(), ctx, edge: null, currentWidth: () => 400, target: null }));
    });
    const slots = container.querySelectorAll("[data-side-empty-slot]");
    expect(slots).toHaveLength(1);
    expect(slots[0]!.getAttribute("data-side-empty-slot")).toBe(AGENT_TOOL);
    expect(container.querySelector("[data-side-empty-owner]")!.getAttribute("data-side-empty-owner")).toBe("bob");
    // Its position: the second pane, after the gap (the layout is kept).
    const cards = [...container.querySelectorAll("[data-side-card]")].map((e) => e.getAttribute("data-side-card"));
    expect(cards).toEqual(page.cards.map((c) => c.id));
    const open = container.querySelector<HTMLButtonElement>("[data-side-empty-open]")!;
    expect(open).toBeTruthy();
    await act(async () => open.click());
    const after = useSide.getState().layout.pages.find((p) => p.id === page.id)!;
    // Eva's own, as a tab of that pane: the slot is a pane again.
    expect(after.cards).toHaveLength(2);
    expect(after.cards[1]!.tabs).toHaveLength(2);
    expect(visibleCards(useSide.getState().layout, after, ctx)).toHaveLength(2);
    await act(async () => root.unmount());
    container.remove();
  });
});
