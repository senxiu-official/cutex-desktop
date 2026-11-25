// @vitest-environment jsdom
// Review of fix/widget-placement-stale (P2): the stale-move prune (a move counts while its page is there) must see
// every page. A conversation's own Shelf is saved without the shared pages (splitShared); the other workspace's save
// (savePeerNow) used to drop a move onto a shared page as if that page were closed. After re-merging, it is still a move.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
}));

const TOOL = "test.tool";
const AGENT_TOOL = "test.agentTool";
const pass = { parseParams: (p: unknown) => p ?? {}, init: (p: unknown) => p, icon: () => null, Body: () => null, useTab: () => ({ title: "t" }), titleKey: "side.column" };
const SIDE = [
  { mode: "show", moduleId: "test", item: { ...pass, id: TOOL, instances: "multi", defaultBinding: "follow", placement: { home: "chat" }, launcher: { params: () => ({}) } } },
  { mode: "show", moduleId: "test", item: { ...pass, id: AGENT_TOOL, instances: "multi", defaultBinding: "agent", placement: { home: "chat" }, launcher: { params: () => ({}) } } },
];
const NONE: never[] = [];
vi.mock("../src/renderer/src/modules/app", () => ({
  appModules: () => ({ subscribe: () => () => {}, snapshot: (slot: string) => (slot === "side.component" ? SIDE : NONE), statuses: () => new Map(), modules: [] }),
}));

import type { SessionResource } from "@cutex-desktop/protocol";
import type { ItemId } from "../src/renderer/src/modules/types";
import { applyOpen, emptyLayout, movedTo, place, placeSpec, prepareForSave, type SideLayout } from "../src/renderer/src/lib/sideLayout";
import { conversationPanes, defaultLayout, focusPane, openBeside } from "../src/renderer/src/lib/paneLayout";
import { usePanes } from "../src/renderer/src/lib/paneStore";
import { flushSideSave, liveConversation, resetConvShelves, startSideStore, switchConversation, syncPeers, updatePeerView, useSide } from "../src/renderer/src/lib/sideLayoutStore";
import { mergeShared, splitShared } from "../src/renderer/src/lib/convShelves";
import { MAIN_WINDOW, useActiveWindow } from "../src/renderer/src/lib/windowScope";
import { readConvShelf, writeConvShelf } from "../src/renderer/src/lib/paneFile";
import { useApp } from "../src/renderer/src/store";

const SCOPE = "host:local";
const ALDEN = "local|alden";
const session = (id: string, name: string) => ({ cutexSessionId: id, displayName: name, avatar: null, native: { threadId: null }, runtime: { status: "online" }, cwd: "" }) as unknown as SessionResource;
/** A layout with one page holding TOOL, that page shared (every conversation shows it). */
function sharedLayout(): SideLayout {
  const input = { kind: TOOL as ItemId, binding: { kind: "follow" as const, hostId: "local" }, key: null, state: {} as never, v: 1, pinned: true };
  const l0 = emptyLayout();
  const l = applyOpen(l0, place(l0, { ...input, transient: false, activePage: null, columnOpen: false }, placeSpec({ home: "chat" })), input, 1, { reveal: true, home: "chat" }).layout;
  return { ...l, pages: l.pages.map((p) => ({ ...p, shared: true })) };
}

let stop: () => void = () => {};
beforeEach(() => {
  localStorage.clear();
  resetConvShelves();
  useApp.setState({
    selectedId: "eva",
    selectedHost: null,
    hosts: { active: "local", scope: { kind: "host", id: "local" }, hosts: [{ id: "local", conn: { epoch: "e1" } }], groups: [] },
    sidebar: { active: [session("eva", "Eva"), session("alden", "Alden")], retired: [], hostRows: {}, projects: null } as never,
    openAgent: async (id: string) => void useApp.setState({ selectedId: id }),
    select: async (id: string) => void useApp.setState({ selectedId: id }),
  } as never);
  useSide.setState({ scope: SCOPE, layout: sharedLayout(), mode: null, narrow: false, liveWidth: {}, tabInfo: {}, focusedCard: null, revealed: {}, flash: null });
  usePanes.setState({ layout: defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "eva" }) });
  switchConversation("local|eva");
  stop = startSideStore(() => () => {});
});
afterEach(() => {
  stop();
  vi.restoreAllMocks();
});

describe("a move onto a shared page", () => {
  it("pure: kept by a partial save that is told the shared pages; dropped by one that is not (the bug)", () => {
    const full = sharedLayout();
    const page = full.pages[0]!;
    const moved = { ...full, overrides: { [AGENT_TOOL]: { page: page.id, groups: page.groups, at: 1 } } };
    const { own, shared } = splitShared(moved);
    expect(own.pages.some((p) => p.id === page.id)).toBe(false);
    const persist = () => true;
    expect(prepareForSave(own, { persist }).overrides[AGENT_TOOL]).toBeUndefined();
    const saved = prepareForSave(own, { persist, otherPages: new Set([page.id]) });
    expect(movedTo(mergeShared(saved, shared), AGENT_TOOL)?.id).toBe(page.id);
  });

  it("the other workspace's save (savePeerNow) keeps it; re-merged with the shared pages it is still a move", () => {
    const page = useSide.getState().layout.pages.find((p) => p.shared)!;
    // Alden's own Shelf, stored: a move of AGENT_TOOL onto the shared page.
    writeConvShelf(SCOPE, ALDEN, { ...emptyLayout(), overrides: { [AGENT_TOOL]: { page: page.id, groups: page.groups, at: 1 } } }, {}, null);
    // Alden on screen as the other workspace: its own Shelf is live (a peer).
    let work = defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "eva" });
    work = openBeside(work, { hostId: "local", sessionId: "alden" }, 1);
    work = focusPane(work, conversationPanes(work)[0]!, 2);
    usePanes.setState({ layout: work });
    syncPeers();
    expect(liveConversation()).toBe("local|eva");
    expect(useSide.getState().peers[ALDEN]).toBeTruthy();
    // A change to Alden's live Shelf: its own Shelf is saved on its own (savePeerNow, without the shared pages).
    updatePeerView(ALDEN, (view) => ({ ...view, open: !view.open }));
    flushSideSave();
    const stored = readConvShelf(SCOPE, ALDEN);
    expect(stored.own?.overrides[AGENT_TOOL]?.page).toBe(page.id);
    const shared = splitShared(useSide.getState().layout).shared;
    expect(movedTo(mergeShared(stored.own!, shared), AGENT_TOOL)?.id).toBe(page.id);
  });
});

// Review of eaea6005a (P2): a scheduled peer save runs in the window that scheduled it (its scope and shared pages),
// not in the window active when the timer fires. Reviewer's boundary test.
it.each([false, true])("a scheduled peer save keeps its window's scope and shared pages; switch focus=%s", (switchFocus) => {
  const page = useSide.getState().layout.pages.find((p) => p.shared)!;
  writeConvShelf(SCOPE, ALDEN, { ...emptyLayout(), overrides: { [AGENT_TOOL]: { page: page.id, groups: page.groups, at: 1 } } }, {}, null);
  let work = defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "eva" });
  work = openBeside(work, { hostId: "local", sessionId: "alden" }, 1);
  work = focusPane(work, conversationPanes(work)[0]!, 2);
  usePanes.setState({ layout: work }); syncPeers(); flushSideSave();
  expect(useSide.getState().peers[ALDEN]).toBeTruthy();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    updatePeerView(ALDEN, (view) => ({ ...view, overrides: { ...view.overrides, [TOOL]: { page: page.id, groups: page.groups, at: 2 } } }));
    const other = "review-other"; const otherScope = `${SCOPE}/desk:${other}`;
    useSide.of(other).setState({ scope: otherScope, layout: emptyLayout(), peers: {} });
    if (switchFocus) useActiveWindow.setState({ key: other });
    vi.advanceTimersByTime(401);
    // This move was made in main, whose shared page still exists, so it must be saved there.
    expect(readConvShelf(SCOPE, ALDEN).own?.overrides[TOOL]?.page).toBe(page.id);
  } finally { useActiveWindow.setState({ key: MAIN_WINDOW }); vi.useRealTimers(); }
});
