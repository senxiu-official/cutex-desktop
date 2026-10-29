// @vitest-environment jsdom
// Multi-window P3 (docs/desktop-modules.md §24.17): per-window stores and selection (lib/windowScope), the one-copy rule
// (lib/windowRoute routeFor / agentPlaces), a drop on another window by screen position (lib/appWindowSet), the
// per-desk sidebar (lib/windowSidebar) and per-window persistence keys (lib/paneStore paneScopeOf, lib/paneFile).
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { create } from "zustand";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ bridge: {}, api: {}, apiFor: () => ({}), cleanIpcMessage: (m: string) => m }));

import { DeskContext } from "../src/renderer/src/lib/deskContext";
import {
  currentWindow,
  inWindow,
  keepSelection,
  MAIN_WINDOW,
  noteShownIn,
  resetWindowsForTest,
  selectionAware,
  shownInActiveWindow,
  useActiveWindow,
  useWindowSelection,
  windowStore,
  withSelection,
} from "../src/renderer/src/lib/windowScope";
import { appWindowAt } from "../src/renderer/src/lib/appWindowSet";
import { convScopeOf, scopeHost } from "../src/renderer/src/lib/paneFile";
import { parseDeskSidebars } from "../src/renderer/src/lib/windowSidebar";
import { addConversationChip, defaultLayout, openBeside, type PaneLayout } from "../src/renderer/src/lib/paneLayout";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const D = "d000000000001";
const E = "d000000000002";

afterEach(() => resetWindowsForTest());

describe("window stores (lib/windowScope)", () => {
  it("one instance per window: getState / setState act on the active window, inWindow names another", () => {
    const store = windowStore(() => create<{ n: number }>(() => ({ n: 0 })));
    store.setState({ n: 1 });
    expect(store.of(MAIN_WINDOW).getState().n).toBe(1);
    inWindow(D, () => store.setState({ n: 5 }));
    expect(store.of(D).getState().n).toBe(5);
    expect(store.getState().n).toBe(1);
    useActiveWindow.setState({ key: D });
    expect(store.getState().n).toBe(5);
    expect(inWindow(MAIN_WINDOW, () => store.getState().n)).toBe(1);
    expect(store.windows().sort()).toEqual([D, MAIN_WINDOW].sort());
  });

  it("subscribe hears every window, now and later, and runs in the window that changed; a dropped desk goes quiet", () => {
    const store = windowStore(() => create<{ n: number }>(() => ({ n: 0 })));
    const heard: string[] = [];
    const off = store.subscribe((s) => heard.push(`${currentWindow()}:${s.n}:${store.getState().n}`));
    store.setState({ n: 1 });
    inWindow(E, () => store.setState({ n: 2 }));
    // The listener reads the changed window's state through the facade (it runs in that window).
    expect(heard).toEqual(["main:1:1", `${E}:2:2`]);
    store.drop(E);
    store.of(E).setState({ n: 3 });
    expect(heard).toHaveLength(3);
    store.drop(MAIN_WINDOW);
    expect(store.windows()).toContain(MAIN_WINDOW);
    off();
    store.setState({ n: 9 });
    expect(heard).toHaveLength(3);
  });

  it("the hook picks the window the component is drawn in", () => {
    const store = windowStore(() => create<{ n: number }>(() => ({ n: 0 })));
    store.of(MAIN_WINDOW).setState({ n: 1 });
    store.of(D).setState({ n: 2 });
    const seen: number[] = [];
    function Probe() {
      seen.push(store((s) => s.n));
      return null;
    }
    const el = document.createElement("div");
    const root = createRoot(el);
    act(() => root.render(h("div", null, h(Probe), h(DeskContext.Provider, { value: D }, h(Probe)))));
    expect(seen).toEqual([1, 2]);
    act(() => root.unmount());
  });
});

describe("per-window selection (lib/windowScope selectionAware)", () => {
  it("an inactive window sees its kept selection; the active one the store's; overlays stay referentially stable", () => {
    const app = selectionAware(create(() => ({ selectedId: "a" as string | null, selectedHost: "local" as string | null, view: { kind: "conversation" } as unknown, other: 1 })));
    keepSelection(D, { selectedId: "b", selectedHost: "local", view: { kind: "conversation" } });
    const seen: string[] = [];
    function Probe({ tag }: { tag: string }) {
      seen.push(`${tag}:${app((s) => s.selectedId)}`);
      return null;
    }
    const el = document.createElement("div");
    const root = createRoot(el);
    act(() => root.render(h("div", null, h(Probe, { tag: "main" }), h(DeskContext.Provider, { value: D }, h(Probe, { tag: "desk" })))));
    expect(seen).toEqual(["main:a", "desk:b"]);
    // The desk becomes the active window: it reads the store, the main window its kept selection.
    seen.length = 0;
    keepSelection(MAIN_WINDOW, { selectedId: "a", selectedHost: "local", view: { kind: "conversation" } });
    act(() => {
      useActiveWindow.setState({ key: D });
      useWindowSelection.setState({ active: D });
      app.setState({ selectedId: "b" });
    });
    expect(seen.slice(-2).sort()).toEqual(["desk:b", "main:a"]);
    act(() => root.unmount());
    const s = app.getState();
    const sel = useWindowSelection.getState().byWindow[MAIN_WINDOW]!;
    expect(withSelection(s, sel)).toBe(withSelection(s, sel));
    expect(withSelection(s, sel).other).toBe(1);
  });

  it("「在看」 counts a view shown in the active window only (a view no window noted counts as before)", () => {
    expect(shownInActiveWindow("local\nx")).toBe(true);
    noteShownIn(D, "local\nx", true);
    expect(shownInActiveWindow("local\nx")).toBe(false);
    useActiveWindow.setState({ key: D });
    expect(shownInActiveWindow("local\nx")).toBe(true);
    noteShownIn(D, "local\nx", false);
    useActiveWindow.setState({ key: MAIN_WINDOW });
    expect(shownInActiveWindow("local\nx")).toBe(true);
  });
});

describe("one copy per agent (lib/windowRoute)", () => {
  const one = (sessionId: string): PaneLayout => defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId });

  it("finds an agent's columns and chips in every window; shown elsewhere → jump, nowhere → here (its chips elsewhere go)", async () => {
    const { agentPlaces, routeFor } = await import("../src/renderer/src/lib/windowRoute");
    const main = openBeside(one("a"), { hostId: "local", sessionId: "b" }, 1, { room: true });
    const desk = addConversationChip(one("c"), { hostId: "local", sessionId: "a2" }, 2);
    const layouts: Record<string, PaneLayout> = { [MAIN_WINDOW]: main, [D]: desk };
    const places = (id: string) => agentPlaces("local", id, (k) => layouts[k]!, [MAIN_WINDOW, D]);
    expect(places("b")).toEqual([{ window: MAIN_WINDOW, paneId: expect.any(String), kind: "column" }]);
    expect(places("a2")).toEqual([{ window: D, paneId: expect.any(String), kind: "chip" }]);
    expect(places("zzz")).toEqual([]);
    // Shown in the main window's column, asked in the desk: jump there.
    expect(routeFor(places("b"), D).jump).toMatchObject({ window: MAIN_WINDOW, kind: "column" });
    // Shown here: no jump.
    expect(routeFor(places("b"), MAIN_WINDOW)).toEqual({ jump: null, dropChips: [] });
    // Only a chip in the desk's tray, asked in the main window: it opens here and the desk's chip goes.
    expect(routeFor(places("a2"), MAIN_WINDOW)).toEqual({ jump: null, dropChips: [{ window: D, paneId: expect.any(String), kind: "chip" }] });
    expect(routeFor([], MAIN_WINDOW)).toEqual({ jump: null, dropChips: [] });
  });

  it("a drag released over another app window finds it by screen position (not the window it started in)", () => {
    const w = (left: number, top: number) => ({ screenLeft: left, screenTop: top, outerWidth: 800, outerHeight: 600 });
    const main = w(0, 0);
    const desk = w(1920, 0);
    expect(appWindowAt([main, desk], 2000, 100, main)).toBe(desk);
    expect(appWindowAt([main, desk], 100, 100, main)).toBeNull();
    expect(appWindowAt([main, desk], 100, 100, desk)).toBe(main);
    expect(appWindowAt([main, desk], 5000, 100, main)).toBeNull();
  });

  it("overlapping windows: the one the owner used last wins (desks open 32 px apart; dual-screen run 2026-10-28)", async () => {
    const { byRecency } = await import("../src/renderer/src/lib/appWindowSet");
    const { activateWindow } = await import("../src/renderer/src/lib/windowRoute");
    const { recentWindows } = await import("../src/renderer/src/lib/windowScope");
    const w = (key: string, left: number, top: number) => ({ key, screenLeft: left, screenTop: top, outerWidth: 1040, outerHeight: 760 });
    const main = w(MAIN_WINDOW, 0, 0);
    const d2 = w(D, 2560, 0);
    const d3 = w(E, 2592, 32);
    const all = [main, d2, d3];
    // Never used: the given order (the older desk first, as before).
    expect(appWindowAt(byRecency(all, (x) => x.key, recentWindows()), 3000, 400, main)).toBe(d2);
    // The owner was in desk 3 last (opened later, so on top): a drop over both lands in desk 3.
    activateWindow(D);
    activateWindow(E);
    activateWindow(MAIN_WINDOW);
    expect(recentWindows()).toEqual([MAIN_WINDOW, E, D]);
    expect(appWindowAt(byRecency(all, (x) => x.key, recentWindows()), 3000, 400, main)).toBe(d3);
    // Only desk 2 under the point: desk 2, whatever the order.
    expect(appWindowAt(byRecency(all, (x) => x.key, recentWindows()), 2570, 10, main)).toBe(d2);
    // Unknown windows keep their order after the used ones.
    expect(byRecency([d2, d3, main], (x) => x.key, [E]).map((x) => x.key)).toEqual([E, D, MAIN_WINDOW]);
  });
});

describe("「在看」 across app windows (lib/appFocus appLookWindow)", () => {
  it("the look trigger hears focus in a desk window (one opened later too) and stops when removed", async () => {
    const { appLookWindow } = await import("../src/renderer/src/lib/appFocus");
    const { useDesks } = await import("../src/renderer/src/lib/deskStore");
    const look = appLookWindow()!;
    const heard: string[] = [];
    const listener = () => void heard.push("focus");
    look.addEventListener("focus", listener);
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const win = frame.contentWindow!;
    useDesks.setState({ desks: [{ deskId: D, handle: { deskId: D, win, root: frame.contentDocument!.body, dispose: () => {} }, content: { kind: "probe" } }] });
    win.dispatchEvent(new (win as typeof window).FocusEvent("focus"));
    window.dispatchEvent(new FocusEvent("focus"));
    expect(heard).toEqual(["focus", "focus"]);
    look.removeEventListener("focus", listener);
    win.dispatchEvent(new (win as typeof window).FocusEvent("focus"));
    expect(heard).toHaveLength(2);
    expect(typeof look.document.hasFocus()).toBe("boolean");
    useDesks.setState({ desks: [], focused: null });
    frame.remove();
  });
});

describe("per-window keys", () => {
  it("a desk's layout scope names its desk; its host and its conversation Shelves' scope are the host's", async () => {
    const { paneScopeOf } = await import("../src/renderer/src/lib/paneStore");
    expect(paneScopeOf("local")).toBe("host:local");
    expect(paneScopeOf("ssh-t", D)).toBe(`host:ssh-t/desk:${D}`);
    expect(scopeHost(`host:ssh-t/desk:${D}`)).toBe("ssh-t");
    expect(scopeHost("host:ssh-t")).toBe("ssh-t");
    expect(convScopeOf(`host:ssh-t/desk:${D}`)).toBe("host:ssh-t");
    expect(convScopeOf("host:local")).toBe("host:local");
  });

  it("a desk's sidebar (collapse, width) is read defensively per desk id", () => {
    expect(parseDeskSidebars("nope")).toEqual({});
    expect(parseDeskSidebars(JSON.stringify({ [D]: { rail: true, width: 300 }, "../x": { rail: true }, [E]: { rail: "yes", width: 5 } }))).toEqual({ [D]: { rail: true, width: 300 }, [E]: {} });
  });
});
