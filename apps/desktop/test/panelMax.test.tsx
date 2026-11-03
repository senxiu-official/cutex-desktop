// @vitest-environment jsdom
// Maximise / full screen of every panel kind (docs/desktop-modules.md §24.16; owner 2026-10-21 「面板没有最大化 /
// 全屏吗？」): a conversation column, a whole Shelf and a pane in a Shelf take the rest of the work row — the same
// workspace's other Shelves fold to their rails, the conversations beside a Shelf / pane to a strip of avatars,
// the other workspace to its rail — and a second toggle / Esc puts back exactly the layout before (nothing of it
// was changed). Full screen: the same plus the chrome (sidebar → rail, the tray auto-hidden, the window bar
// revealed at the top edge, the Settings Shelf away); Esc goes back to the state before (a maximised panel stays
// maximised), after the inner layers. F11 / Ctrl/⌘+Shift+F; a focused terminal keeps F11 alone.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Every API call resolves to null (a focus change opens an agent: subscribe / unsubscribe / bootstrap).
vi.mock("../src/renderer/src/modules/app", () => ({ appModules: () => ({ snapshot: () => [] }) }));
vi.mock("../src/renderer/src/bridge", () => {
  const api = new Proxy({}, { get: (_t, m) => (m === "then" ? undefined : () => Promise.resolve(null)) });
  return { api, apiFor: () => api, bridge: { api, apiFor: () => api, on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m };
});
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
}));
const ctx = { hostId: "local", sessionId: "eva", workspaceKey: null, available: () => true };
vi.mock("../src/renderer/src/lib/sideComponents", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSideView: () => ctx,
  sideViewNow: () => ctx,
  useSideRegistry: () => new Map(),
  sideRegistry: () => new Map(),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import type { SessionResource } from "@cutex-desktop/protocol";
import type { SideBinding } from "../src/renderer/src/modules/slots";
import type { ItemId } from "../src/renderer/src/modules/types";
import { addShelf, applyOpen, collapseShelf, columnsOnScreen, emptyLayout, place, placeSpec, shelvesOf, SINGLETON_KEY, type SideLayout } from "../src/renderer/src/lib/sideLayout";
import { conversationPanes, defaultLayout, focusPane, openBeside, toggleMaximized } from "../src/renderer/src/lib/paneLayout";
import { usePanes } from "../src/renderer/src/lib/paneStore";
import { restorePaneMaximised, setMode, useSide } from "../src/renderer/src/lib/sideLayoutStore";
import { escChainStep } from "../src/renderer/src/lib/escChain";
import { paneKeyAction } from "../src/renderer/src/lib/paneKeys";
import { setKeybindingPlatform } from "../src/renderer/src/lib/keybindings";
import { passThroughKey } from "../src/renderer/src/modules/terminal/terminalState";
import { useApp } from "../src/renderer/src/store";
import * as appearance from "../src/renderer/src/lib/appearanceModel";
import { setAppearance } from "../src/renderer/src/lib/appearance";
import { fullscreenHolds, restoredState, sameTarget } from "../src/renderer/src/lib/panelFull";
import { useSidebarRail } from "../src/renderer/src/lib/workspaces";

const { SideWorkArea } = await import("../src/renderer/src/components/side/SideArea");
const { WindowBarFrame, FullscreenHint } = await import("../src/renderer/src/components/PanelFullscreen");
const full = await import("../src/renderer/src/lib/panelFull");
const actions = await import("../src/renderer/src/lib/paneActions");
const { toggleShelfMode, toggleMode } = await import("../src/renderer/src/lib/sideActions");

let clock = 100;
const host: SideBinding = { kind: "host", hostId: "local" };
function withBrowser(l: SideLayout = emptyLayout()): SideLayout {
  const input = { kind: "browser.tab" as ItemId, binding: host, key: SINGLETON_KEY, state: { url: "https://example.com" } as never, v: 1, pinned: false };
  const decision = place(l, { ...input, transient: false, activePage: l.activePage, columnOpen: l.open }, placeSpec({ home: "browser" }));
  return applyOpen(l, decision, input, ++clock, { reveal: true, home: "browser" }).layout;
}
/** The browser page in the right Shelf, a launcher page in a left Shelf. */
function twoShelves(): SideLayout {
  const l = addShelf(withBrowser(), "left").layout;
  return { ...l, open: true };
}
const session = (id: string, name: string) => ({ cutexSessionId: id, displayName: name, avatar: null, native: { threadId: null }, runtime: { status: "online" }, cwd: "" }) as unknown as SessionResource;

let root: Root;
let container: HTMLElement;
const q = (sel: string) => container.querySelector<HTMLElement>(sel);
const all = (sel: string) => [...container.querySelectorAll<HTMLElement>(sel)];

function onePane() {
  const work = defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "eva" });
  usePanes.setState({ layout: work });
  return conversationPanes(work);
}
/** eva (left) | alden (right); `focused` has the focus. */
/** A conversation maximised over two workspaces (as a stored / full-screen layout has it; 独占 there = strips, docs/design/002). */
function maxPane(id: string) {
  usePanes.setState({ layout: toggleMaximized(usePanes.getState().layout, id) });
}

function twoPanes(focused: 0 | 1) {
  let work = defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "eva" });
  work = openBeside(work, { hostId: "local", sessionId: "alden" }, 1);
  const panes = conversationPanes(work);
  work = focusPane(work, panes[focused]!, 2);
  usePanes.setState({ layout: work });
  return panes;
}

/** The work area as PaneHost draws it: `covered` = a conversation is maximised; the child stands for the conversations. */
function render() {
  const max = usePanes.getState().layout.max;
  const panes = conversationPanes(usePanes.getState().layout);
  const split = panes.length === 2 && !max ? { focused: 0 } : null;
  act(() => root.render(h(SideWorkArea, { side: true, covered: !!max, split, single: null, children: h("i", { "data-fake-conversations": "" }) })));
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute("data-side-work") ? 1600 : 0;
  });
  localStorage.clear();
  full.resetPanelFull();
  useApp.setState({ selectedId: "eva", selectedHost: null, hosts: null, sidebar: { active: [session("eva", "Eva"), session("alden", "Alden")], retired: [], hostRows: {}, projects: null } as never });
  useSide.setState({ scope: "host:local", layout: { ...withBrowser(), open: true }, mode: null, narrow: false, liveWidth: {}, focusedCard: null });
  setAppearance({ ...appearance.DEFAULT_APPEARANCE }, false);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  full.resetPanelFull();
});

describe("最大化 a conversation column (the rest of the work row)", () => {
  it("one workspace: its expanded Shelf folds to its rail — a view only, the stored Shelf stays expanded; toggling again puts it back", () => {
    const [main] = onePane();
    render();
    expect(q('[data-side-box][data-side-frame="flow"]')).not.toBeNull();
    const before = useSide.getState().layout;
    actions.toggleExclusive({ area: "work", id: main! });
    expect(usePanes.getState().layout.max).toBe(main);
    render();
    expect(q("[data-side-work]")!.dataset.panelMax).toBe("conversation");
    // The Shelf's live box is hidden (its panes stay mounted), its rail stands in the row, folded.
    expect(q("[data-side-box]")!.hidden).toBe(true);
    const rail = q('[data-panel-folded][data-shelf-box="right"]')!;
    expect(rail.querySelector("[data-shelf-rail-collapsed]")).not.toBeNull();
    expect(useSide.getState().layout).toBe(before);
    expect(shelvesOf(useSide.getState().layout).every((s) => !s.collapsed)).toBe(true);
    // No other workspace: no strip for it.
    expect(q("[data-ws-strip]")).toBeNull();
    actions.toggleExclusive({ area: "work", id: main! });
    render();
    expect(q("[data-panel-folded]")).toBeNull();
    expect(q("[data-side-work]")!.dataset.panelMax).toBeUndefined();
    expect(q('[data-side-box][data-side-frame="flow"]')!.hidden).toBe(false);
    expect(useSide.getState().layout).toBe(before);
  });

  it("two workspaces: the other one shows as its rail with its avatar (even with an empty Shelf), on its side; a click on it focuses it and the layout comes back", () => {
    const stop = actions.startPaneActions();
    const panes = twoPanes(1);
    maxPane(panes[1]!);
    render();
    const strip = q("[data-ws-strip]")!;
    expect(strip).not.toBeNull();
    expect(strip.dataset.wsShelf).toBe(panes[0]);
    expect(strip.dataset.wsRailAt).toBe("left");
    expect(strip.style.order).toBe("0");
    expect(strip.querySelector('[data-shelf-owner="eva"]')).not.toBeNull();
    // The maximised conversation is the right one: the strip of the left one sits at the left.
    act(() => (strip.querySelector("[data-shelf-owner] button") as HTMLButtonElement).click());
    expect(usePanes.getState().layout.focus).toBe(panes[0]);
    expect(usePanes.getState().layout.max).toBeNull();
    stop();
  });

  it("独占 with two workspaces (lib/paneActions toggleExclusive): the other folds to its strip, again = back", async () => {
    const { useStrips, stripPanes } = await import("../src/renderer/src/lib/convStrips");
    const panes = twoPanes(0);
    actions.toggleExclusive({ area: "work", id: panes[0]! });
    expect(usePanes.getState().layout.max).toBeNull();
    expect(stripPanes(usePanes.getState().layout, useStrips.getState().strips)).toEqual([panes[1]]);
    actions.toggleExclusive({ area: "work", id: panes[0]! });
    expect(stripPanes(usePanes.getState().layout, useStrips.getState().strips)).toEqual([]);
  });

  it("the left workspace maximised: the other's rail at the right", () => {
    const panes = twoPanes(0);
    maxPane(panes[0]!);
    render();
    expect(q("[data-ws-strip]")!.dataset.wsRailAt).toBe("right");
    expect(q("[data-ws-strip]")!.style.order).toBe("6");
  });
});

describe("最大化 a Shelf / a pane in a Shelf", () => {
  it("a whole Shelf (its ⋯ / a double-click on its rail): it takes the row; the conversations become a strip of avatars, still mounted; the other Shelf its rail", () => {
    onePane();
    useSide.setState({ layout: twoShelves() });
    const right = shelvesOf(useSide.getState().layout).find((s) => s.side === "right")!;
    const before = useSide.getState().layout;
    toggleShelfMode("maximised", right.id);
    expect(useSide.getState().mode).toEqual({ kind: "maximised", card: null, shelf: right.id });
    render();
    expect(q("[data-side-work]")!.dataset.panelMax).toBe("shelf");
    const box = q("[data-panel-maxed]")!;
    expect(box.dataset.sideFrame).toBe("maximised");
    expect(box.querySelector(`[data-shelf="${right.id}"]`)).not.toBeNull();
    // The conversations stay mounted under the strip.
    const card = q("[data-conv-folded]")!;
    expect(card.querySelector("[data-fake-conversations]")).not.toBeNull();
    expect((card.querySelector("[data-fake-conversations]")!.parentElement as HTMLElement).hidden).toBe(true);
    expect(card.querySelector('[data-conv-strip] [data-shelf-owner="eva"]')).not.toBeNull();
    // The left Shelf folds to its rail, left of the strip; the maximised one right of it.
    const left = q('[data-panel-folded][data-shelf-box="left"]')!;
    expect(left.querySelector("[data-shelf-rail-collapsed]")).not.toBeNull();
    expect(Number(left.style.order)).toBeLessThan(Number(card.style.order));
    expect(Number(card.style.order)).toBeLessThan(Number(box.style.order));
    toggleShelfMode("maximised", right.id);
    expect(useSide.getState().mode).toBeNull();
    expect(useSide.getState().layout).toBe(before);
  });

  it("a collapsed Shelf can be maximised too (its page in view), without expanding it in the layout", () => {
    const l = withBrowser();
    const shelf = shelvesOf(l)[0]!;
    useSide.setState({ layout: { ...collapseShelf(l, shelf.id), open: true } });
    const before = useSide.getState().layout;
    toggleShelfMode("maximised", shelf.id);
    expect(columnsOnScreen(useSide.getState().layout, ctx, useSide.getState().mode)).toHaveLength(1);
    onePane();
    render();
    expect(q("[data-panel-maxed]")).not.toBeNull();
    expect(useSide.getState().layout).toBe(before);
  });

  it("a pane (its ⤢): the same, with the strip; the conversation strip's avatar puts everything back", () => {
    onePane();
    useSide.setState({ layout: twoShelves() });
    const card = useSide.getState().layout.pages.find((p) => p.cards.length)!.cards[0]!.id;
    actions.toggleExclusive({ area: "tools", id: card });
    render();
    expect(q("[data-side-work]")!.dataset.panelMax).toBe("pane");
    act(() => (q("[data-conv-strip] [data-shelf-owner] button") as HTMLButtonElement).click());
    expect(useSide.getState().mode).toBeNull();
    render();
    expect(q("[data-conv-folded]")).toBeNull();
    expect(q("[data-fake-conversations]")!.parentElement!.hidden).toBe(false);
  });

  it("a click on a folded rail's button first puts the row back", () => {
    const [main] = onePane();
    actions.toggleExclusive({ area: "work", id: main! });
    render();
    const button = q('[data-panel-folded] [data-shelf-rail-collapsed] button[data-shelf-page]')!;
    act(() => button.click());
    expect(usePanes.getState().layout.max).toBeNull();
  });
});

describe("全屏 (lib/panelFull)", () => {
  it("pure: the same target, whether it still holds, what exiting puts back", () => {
    expect(sameTarget({ area: "work", id: "a" }, { area: "work", id: "a" })).toBe(true);
    expect(sameTarget({ area: "tools", card: null, shelf: "s1" }, { area: "tools", card: null })).toBe(false);
    expect(fullscreenHolds({ area: "work", id: "a" }, null, "a")).toBe(true);
    expect(fullscreenHolds({ area: "work", id: "a" }, null, "b")).toBe(false);
    expect(fullscreenHolds({ area: "tools", card: "c" }, { kind: "fullscreen", card: "c" }, null)).toBe(true);
    expect(fullscreenHolds({ area: "tools", card: "c" }, { kind: "maximised", card: "c" }, null)).toBe(false);
    expect(restoredState({ max: "gone", mode: { kind: "maximised", card: "c" } }, ["a"], () => true)).toEqual({ max: null, mode: { kind: "maximised", card: "c" } });
    expect(restoredState({ max: "a", mode: { kind: "maximised", card: "x" } }, ["a"], () => false)).toEqual({ max: "a", mode: null });
    expect(restoredState(null, [], () => true)).toEqual({ max: null, mode: null });
  });

  it("a conversation: maximised under it; Esc goes back to exactly before (nothing maximised), F11 the same", () => {
    const stop = actions.startPaneActions();
    const [main] = onePane();
    expect(full.enterFullscreen({ area: "work", id: main! })).toBe(true);
    expect(full.fullscreenOn()).toBe(true);
    expect(usePanes.getState().layout.max).toBe(main);
    expect(restorePaneMaximised()).toBe(true);
    expect(full.fullscreenOn()).toBe(false);
    expect(usePanes.getState().layout.max).toBeNull();
    actions.toggleFullscreenPanel({ area: "work", id: main! });
    expect(full.fullscreenOn()).toBe(true);
    actions.toggleFullscreenPanel();
    expect(full.fullscreenOn()).toBe(false);
    stop();
  });

  it("from a maximised panel: Esc order is full screen → maximised → normal", () => {
    const stop = actions.startPaneActions();
    const panes = twoPanes(0);
    maxPane(panes[0]!);
    full.enterFullscreen({ area: "work", id: panes[0]! });
    expect(full.usePanelFull.getState().before).toEqual({ max: panes[0], mode: null });
    restorePaneMaximised();
    expect(full.fullscreenOn()).toBe(false);
    expect(usePanes.getState().layout.max).toBe(panes[0]);
    restorePaneMaximised();
    expect(usePanes.getState().layout.max).toBeNull();
    expect(restorePaneMaximised()).toBe(false);
    stop();
  });

  it("a pane: full screen over its maximised state and back; a Shelf; the tool mode set elsewhere is adopted", () => {
    const stop = actions.startPaneActions();
    onePane();
    useSide.setState({ layout: twoShelves() });
    const card = useSide.getState().layout.pages.find((p) => p.cards.length)!.cards[0]!.id;
    toggleMode("maximised", card);
    toggleMode("fullscreen", card);
    expect(useSide.getState().mode).toEqual({ kind: "fullscreen", card, shelf: null });
    toggleMode("fullscreen", card);
    expect(useSide.getState().mode).toEqual({ kind: "maximised", card });
    setMode(null);
    const right = shelvesOf(useSide.getState().layout).find((s) => s.side === "right")!;
    toggleShelfMode("fullscreen", right.id);
    expect(full.usePanelFull.getState().target).toEqual({ area: "tools", card: null, shelf: right.id });
    render();
    expect(q("[data-panel-maxed]")!.dataset.sideFrame).toBe("fullscreen");
    restorePaneMaximised();
    expect(useSide.getState().mode).toBeNull();
    // A module / the reference card's ⛶ sets the mode directly: adopted (Esc ends it).
    setMode({ kind: "fullscreen", card });
    expect(full.usePanelFull.getState().target).toEqual({ area: "tools", card, shelf: null });
    restorePaneMaximised();
    expect(useSide.getState().mode).toBeNull();
    expect(full.fullscreenOn()).toBe(false);
    stop();
  });

  it("ends by itself when its panel is no longer maximised (another agent focused): the state before is not forced back", () => {
    const stop = actions.startPaneActions();
    const panes = twoPanes(0);
    full.enterFullscreen({ area: "work", id: panes[0]! });
    act(() => void usePanes.setState({ layout: focusPane(usePanes.getState().layout, panes[1]!, 99) }));
    expect(usePanes.getState().layout.max).toBeNull();
    expect(full.fullscreenOn()).toBe(false);
    stop();
  });

  it("放大 / Ctrl+Shift+M in full screen: back to normal", () => {
    const stop = actions.startPaneActions();
    const [main] = onePane();
    full.enterFullscreen({ area: "work", id: main! });
    actions.toggleExclusive({ area: "work", id: main! });
    expect(full.fullscreenOn()).toBe(false);
    expect(usePanes.getState().layout.max).toBeNull();
    stop();
  });

  it("Esc: the inner layers first (a popup, a component that used the key), then full screen / maximise", () => {
    const base = { modifiers: false, repeat: false, composing: false, overlay: false, handled: false, peek: false, mode: true, drawer: false, editable: false, inSide: false };
    expect(escChainStep({ ...base, overlay: true })).toBe("overlay");
    expect(escChainStep({ ...base, handled: true })).toBe("handled");
    expect(escChainStep(base)).toBe("restore");
    expect(escChainStep({ ...base, editable: true, settings: true })).toBe("restore");
  });

  it("keys: F11 / Ctrl+Shift+F / ⌘+Shift+F; a focused terminal lets Ctrl+Shift+F and Shift+F11 through and keeps F11 alone", () => {
    const key = (k: Partial<KeyboardEvent>) => ({ key: "", code: "", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...k }) as KeyboardEvent;
    expect(paneKeyAction(key({ key: "F11", code: "F11" }))).toBe("fullscreen");
    expect(paneKeyAction(key({ key: "F", code: "KeyF", ctrlKey: true, shiftKey: true }))).toBe("fullscreen");
    // ⌘ is macOS's command key (lib/keybindings Mod); elsewhere it is the Windows / Super key.
    setKeybindingPlatform("mac");
    expect(paneKeyAction(key({ key: "F", code: "KeyF", metaKey: true, shiftKey: true }))).toBe("fullscreen");
    setKeybindingPlatform(null);
    expect(paneKeyAction(key({ key: "f", code: "KeyF", ctrlKey: true }))).toBeNull();
    expect(paneKeyAction(key({ key: "F11", code: "F11", ctrlKey: true }))).toBeNull();
    expect(passThroughKey(key({ key: "F", code: "KeyF", ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(passThroughKey(key({ key: "F11", code: "F11", shiftKey: true }))).toBe(true);
    expect(passThroughKey(key({ key: "F11", code: "F11" }))).toBe(false);
    expect(passThroughKey(key({ key: "f", code: "KeyF", ctrlKey: true }))).toBe(false);
  });
});

describe("全屏: the window's chrome", () => {
  function Rail() {
    return h("i", { "data-rail": useSidebarRail(false, 256) ? "rail" : "full" });
  }

  it("the sidebar shows as its rail (without changing the owner's setting); back afterwards", () => {
    const [main] = onePane();
    act(() => root.render(h(Rail)));
    expect(q("[data-rail]")!.dataset.rail).toBe("full");
    act(() => void full.enterFullscreen({ area: "work", id: main! }));
    expect(q("[data-rail]")!.dataset.rail).toBe("rail");
    act(() => void full.exitFullscreen());
    expect(q("[data-rail]")!.dataset.rail).toBe("full");
  });

  it("the window bar leaves the layout and is revealed at the top edge; the 「退出全屏 Esc」 hint shows once per entry, briefly", () => {
    vi.useFakeTimers();
    const [main] = onePane();
    act(() => root.render(h("div", null, h(WindowBarFrame, null, h("header", { "data-fake-bar": "" })), h(FullscreenHint))));
    expect(q("[data-window-bar-frame]")).toBeNull();
    expect(q("[data-fake-bar]")!.parentElement!.className).toBe("contents");
    expect(q("[data-fullscreen-hint]")).toBeNull();
    act(() => void full.enterFullscreen({ area: "work", id: main! }));
    expect(q("[data-window-bar-frame]")!.dataset.windowBarFrame).toBe("hidden");
    expect(q("[data-fullscreen-hint]")!.textContent).toContain("panel.exitFullscreenShort");
    const Over = (globalThis as { PointerEvent?: typeof MouseEvent }).PointerEvent ?? MouseEvent;
    act(() => q("[data-window-bar-edge]")!.dispatchEvent(new Over("pointerover", { bubbles: true })));
    expect(q("[data-window-bar-frame]")!.dataset.windowBarFrame).toBe("revealed");
    expect(q("[data-window-bar-edge]")).toBeNull();
    act(() => void vi.advanceTimersByTime(2500));
    expect(q("[data-fullscreen-hint]")).toBeNull();
    act(() => void full.exitFullscreen());
    expect(q("[data-window-bar-frame]")).toBeNull();
    vi.useRealTimers();
  });

  it("the tray auto-hides (its handle stays) even with 托盘常驻 on; back afterwards", async () => {
    const { DesktopStage, TrayFrame } = await import("../src/renderer/src/components/ChipTray");
    const { DEFAULT_TRAY_PREFS, useTrayPrefs } = await import("../src/renderer/src/lib/trayPrefs");
    useTrayPrefs.setState({ ...DEFAULT_TRAY_PREFS, persistent: true });
    const entry = {
      moduleId: "fake",
      mode: "show",
      missing: [],
      item: { id: "fake.desktop", Desktop: () => null, useShowWhenEmpty: () => true, useDockCount: () => 2, Dock: () => h("span", { "data-fake-dock": "" }) },
    } as never;
    const input = { fullWindow: false, framed: false, sessionId: "eva", page: false, firstRun: false, desktopShown: false };
    const draw = () => act(() => root.render(h(TrayFrame, null, h(DesktopStage, { entry, input, hostId: "local", children: () => h("i") }))));
    const [main] = onePane();
    draw();
    expect(q("[data-tray-band]")!.dataset.trayBand).toBe("docked");
    act(() => void full.enterFullscreen({ area: "work", id: main! }));
    draw();
    expect(q("[data-tray-band]")!.dataset.trayBand).toBe("handle");
    act(() => void full.exitFullscreen());
    draw();
    expect(q("[data-tray-band]")!.dataset.trayBand).toBe("docked");
    expect(useTrayPrefs.getState().persistent).toBe(true);
  });

  it("not stored: nothing of it is in the pane file", () => {
    const [main] = onePane();
    full.enterFullscreen({ area: "work", id: main! });
    const stored = localStorage.getItem("cutex-desktop.panes") ?? "";
    expect(stored.includes('"max":"')).toBe(false);
    expect(stored.includes("fullscreen")).toBe(false);
  });
});

describe("the Shelf Rail's avatar (design 009, owner 2026-10-22)", () => {
  it("a click folds the Shelf to its rail and expands it again; right-click opens the Shelf's menu (no browser menu)", async () => {
    const { shelvesOf, findShelf } = await import("../src/renderer/src/lib/sideLayout");
    onePane();
    render();
    const shelf = shelvesOf(useSide.getState().layout).find((x) => !x.collapsed)!;
    const avatar = () => q(`[data-shelf-avatar="${shelf.id}"]`)!;
    expect(avatar()).not.toBeNull();
    expect(avatar().getAttribute("aria-expanded")).toBe("true");
    act(() => avatar().click());
    expect(findShelf(useSide.getState().layout, shelf.id)!.collapsed).toBe(true);
    render();
    expect(avatar().getAttribute("aria-expanded")).toBe("false");
    act(() => avatar().click());
    expect(findShelf(useSide.getState().layout, shelf.id)!.collapsed).toBeFalsy();
    render();
    const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 });
    act(() => void avatar().dispatchEvent(ev));
    expect(ev.defaultPrevented).toBe(true);
  });

  it("its menu: 收起 · 移到另一边 · 最大化 · 关闭 Shelf · ⚙ 设置…, every layout row with a foretell; 打开它的会话 only when that conversation is off screen", async () => {
    const { shelvesOf } = await import("../src/renderer/src/lib/sideLayout");
    const { shelfAvatarMenu } = await import("../src/renderer/src/lib/shelfAvatar");
    onePane();
    render();
    const shelf = shelvesOf(useSide.getState().layout).find((x) => !x.collapsed)!;
    const rows = (owner: Parameters<typeof shelfAvatarMenu>[1]) => shelfAvatarMenu(shelf.id, owner).filter((e): e is Exclude<typeof e, "separator" | false | null | undefined | "" | 0> => !!e && e !== "separator");
    const mine = rows({ hostId: "local", sessionId: "eva", name: "Eva" });
    const labels = mine.map((e) => e.label);
    expect(labels.length).toBeGreaterThanOrEqual(4);
    expect(labels.some((l) => /Nobody/.test(l))).toBe(false);
    for (const e of mine.filter((x) => x.label !== mine.at(-1)!.label)) expect(typeof e.foretell).toBe("function");
    const off = rows({ hostId: "local", sessionId: "nobody", name: "Nobody" });
    expect(off.length).toBe(mine.length + 1);
    expect(off.some((e) => /Nobody/.test(e.label) && typeof e.foretell === "function")).toBe(true);
  });
});

describe("显示桌面 (owner 2026-10-22): only the desktop", () => {
  it("the Shelves are not folded (their layout untouched) and the work area draws no Shelf and no Shelf Rail while it shows", () => {
    const stop = actions.startPaneActions();
    onePane();
    setAppearance({ shelfRailAlways: true });
    const before = useSide.getState().layout;
    actions.showDesktop();
    expect(useSide.getState().layout).toBe(before);
    // PaneHost draws the work area with `side` off while the desktop shows.
    act(() => root.render(h(SideWorkArea, { side: false, covered: false, split: null, desk: true, single: null, children: h("i") })));
    expect(q("[data-shelf-box], [data-side-box], [data-shelf-rail], [data-shelf-rail-empty]")).toBeNull();
    // Nothing of the Shelves to put back: 恢复 is the work area alone.
    expect(actions.useDesktop.getState().shelves).toBeNull();
    // The second press puts it back (the hidden Shelves' panes do not count as "on screen" then).
    actions.showDesktop();
    expect(actions.useDesktop.getState().snapshot).toBeNull();
    expect(conversationPanes(usePanes.getState().layout).length).toBe(1);
    expect(useSide.getState().layout).toBe(before);
    stop();
  });
});
