// The desktop layer's visibility (contract 1.18 `pane.desktop`, docs/desktop-modules.md §25; lib/paneDesk
// desktopReason) and the sidebar 「桌面」 entry's action (lib/paneActions revealDesktop): no panes / every
// pane in the tray / 显示桌面 / the setting off.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { desktopReason, type DesktopInput } from "../src/renderer/src/lib/paneDesk";
import { collapseConversation, conversationPanes, defaultLayout, MAIN_PANE, openBeside, paneBinding, type PaneLayout } from "../src/renderer/src/lib/paneLayout";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));

const nothing: DesktopInput = { fullWindow: false, framed: false, sessionId: null, page: false, firstRun: false, desktopShown: false, showWhenEmpty: true, hasLayer: true };

describe("desktopReason", () => {
  it("no pane in front (no agent, or every pane in the tray — the empty pane stays): the desktop, when its setting is on", () => {
    expect(desktopReason(nothing)).toBe("empty");
    expect(desktopReason({ ...nothing, showWhenEmpty: false })).toBeNull();
  });

  it("显示桌面 (or the sidebar's 桌面): shown even with the setting off", () => {
    expect(desktopReason({ ...nothing, desktopShown: true })).toBe("desktop");
    expect(desktopReason({ ...nothing, desktopShown: true, showWhenEmpty: false })).toBe("desktop");
  });

  it("something in front, or nothing to draw: never", () => {
    for (const blocked of [{ sessionId: "eva" }, { page: true }, { framed: true }, { fullWindow: true }, { firstRun: true }, { hasLayer: false }] as Partial<DesktopInput>[]) {
      expect(desktopReason({ ...nothing, desktopShown: true, ...blocked }), JSON.stringify(blocked)).toBeNull();
      expect(desktopReason({ ...nothing, ...blocked }), JSON.stringify(blocked)).toBeNull();
    }
  });
});

describe("revealDesktop (the sidebar entry) and 显示桌面", () => {
  beforeEach(() => {
    vi.resetModules();
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v), removeItem: (k: string) => void storage.delete(k) });
  });

  const base = (sessionId: string | null) => defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId });
  const agents = (l: PaneLayout) => conversationPanes(l).map((id) => paneBinding(l, id)?.sessionId ?? null);

  async function stores(layout: PaneLayout, selectedId: string | null) {
    const app = await import("../src/renderer/src/store");
    const panes = await import("../src/renderer/src/lib/paneStore");
    const actions = await import("../src/renderer/src/lib/paneActions");
    app.useApp.setState({ openAgent: async () => {}, selectedId, selectedHost: "local" } as never);
    panes.usePanes.setState({ layout, scope: "host:local", restore: null });
    return { app, panes, actions };
  }

  it("panes on screen: they leave the screen (= 显示桌面; §24.13: conversations as a whole, no chips), the desktop is shown", async () => {
    const two = openBeside(base("a1"), { hostId: "local", sessionId: "b2" }, 10);
    const { panes, actions } = await stores(two, "b2");
    actions.revealDesktop();
    expect(agents(panes.usePanes.getState().layout)).toEqual([null]);
    expect(panes.usePanes.getState().layout.chips).toHaveLength(0);
    expect(actions.useDesktop.getState().snapshot).toHaveLength(2);
    expect(agents(actions.useDesktop.getState().work!)).toEqual(["a1", "b2"]);
    // Again with the desktop shown: the same entry puts both workspaces back as they were (like the title-bar button; audit #9).
    actions.revealDesktop();
    expect(agents(panes.usePanes.getState().layout)).toEqual(["a1", "b2"]);
    expect(actions.useDesktop.getState().snapshot).toBeNull();
  });

  it("nothing on screen (every pane already in the tray, the setting off): the desktop is marked as asked for", async () => {
    const collapsed = collapseConversation(base("a1"), MAIN_PANE, 5);
    const { actions } = await stores(collapsed, null);
    expect(actions.useDesktop.getState().snapshot).toBeNull();
    actions.revealDesktop();
    expect(actions.useDesktop.getState().snapshot).toEqual([]);
    // Nothing was put away: the entry again changes nothing (it only restores a real layout).
    actions.revealDesktop();
    expect(actions.useDesktop.getState().snapshot).toEqual([]);
    // The title-bar button then puts the newest chip back.
    actions.showDesktop();
    expect(actions.useDesktop.getState().snapshot).toBeNull();
  });

  it("Ctrl+W on the last conversation closes it to the desktop like the header × (never the OS window); an empty pane does nothing", async () => {
    const { app, actions } = await stores(base("a1"), "a1");
    expect(actions.closeFocusedTab()).toBe(true);
    // Same as the header ×: no agent focused, the desktop layer takes the pane (the agent keeps running).
    expect(app.useApp.getState().selectedId).toBeNull();
    const empty = await stores(base(null), null);
    expect(empty.actions.closeFocusedTab()).toBe(false);
  });

  it("the asked-for desktop ends once a conversation opens", async () => {
    vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
    const { panes, actions } = await stores(base(null), null);
    const stop = actions.startPaneActions();
    actions.revealDesktop();
    expect(actions.useDesktop.getState().snapshot).toEqual([]);
    panes.usePanes.setState({ layout: base("eva") });
    expect(actions.useDesktop.getState().snapshot).toBeNull();
    stop();
    vi.unstubAllGlobals();
  });
});
