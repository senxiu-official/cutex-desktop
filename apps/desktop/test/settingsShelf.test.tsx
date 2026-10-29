// @vitest-environment jsdom
// The Settings Shelf (owner 2026-10-21; docs/desktop-modules.md §24.14): one global Shelf beside the real UI
// — open / close / toggle (Ctrl+, and the footer ⚙), deep links to a section, moving it to the other side,
// maximising it (the wide nav = the old full-window Settings), its width, no drops into it, the live edit
// (在主界面调整) started from its page, Esc after the inner layers, and module settings pages in it.
// Owner 2026-10-21: left by default between the sidebar card and the work area (a slot in PaneHost), stored
// layouts move there once; then "a normal width, the settings rail merged into it": one card with the
// category nav as its left column (names, folds to icons by the owner or when really narrow), default 760,
// min 640, smaller stored widths raised once.
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
}));

const fx = vi.hoisted(() => ({ items: {} as Record<string, unknown[]> }));
vi.mock("../src/renderer/src/modules/react", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSlot: (slot: string) => fx.items[slot] ?? [],
}));

// 「全部主机」 reads module prefs from the module host (not started here): not under test.
vi.mock("../src/renderer/src/lib/settingsAllHosts", () => ({ useSettingsAllHosts: () => ({ on: false, offered: null, set() {} }) }));
vi.mock("../src/renderer/src/lib/settingsSearchView", async (original) => ({
  ...(await original<object>()),
  useSettingsSearchIndex: () => [{ page: "sidebar", pageOrder: 0, pageTitle: { current: "Sidebar", other: "侧栏" }, anchor: null, sectionTitle: null, keywords: [], disabled: null }],
}));

const { SettingsShelf, SettingsShelfSlot } = await import("../src/renderer/src/components/SettingsShelf");
const shelfLib = await import("../src/renderer/src/lib/settingsShelf");
const { useSettingsShelf, resetSettingsShelfForTest, settingsShelfWidth, SETTINGS_SHELF_MIN_W, SETTINGS_SHELF_ROW_KEEP, SETTINGS_SHELF_DEFAULT_W, SETTINGS_NAV_ICONS_W, SETTINGS_NAV_NAMED_W } = shelfLib;
const { useApp } = await import("../src/renderer/src/store");
const { toggleSettingsFromNav } = await import("../src/renderer/src/lib/openSettings");
const { escChainStep } = await import("../src/renderer/src/lib/escChain");
const { runEscChain } = await import("../src/renderer/src/lib/escLayers");
const { sideLayersActive } = await import("../src/renderer/src/lib/sideLayoutStore");
const sideDnd = await import("../src/renderer/src/lib/sideDnd");
const ws = await import("../src/renderer/src/lib/workspaces");
const glideLib = await import("../src/renderer/src/lib/columnGlide");
const sideResize = await import("../src/renderer/src/lib/sideResize");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const Icon = () => h("svg");
const page = (moduleId: string, id: string, pageId: string, group: string, order: number, body: string) => ({
  moduleId,
  mode: "show",
  missing: [],
  waiting: false,
  item: { id, page: pageId, group, order, icon: Icon, titleKey: `${id}.title`, source: "local", Page: () => h("section", { id: `settings-${pageId}-card`, "data-probe": pageId }, body) },
});

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  fx.items = {
    "settings.page": [page("shell", "shell.general", "general", "app", 100, "通用的卡片"), page("shell", "shell.sidebar", "sidebar", "app", 250, "左侧栏的卡片"), page("fake-module", "fake.tools", "fake", "tools", 100, "模块贡献的页")],
    "main.page": [{ moduleId: "shell", mode: "show", item: { id: "shell.settings", Page: () => null, useTitle: (p: { tab?: string }) => [{ text: "settings.title" }, { text: `page:${p.tab}` }] } }],
    "customize.region": [{ moduleId: "shell", mode: "show", item: { id: "shell.sidebar", region: "sidebar", titleKey: "customize.sidebar.title", settingsPage: "sidebar", side: "right" } }],
  };
  resetSettingsShelfForTest();
  useApp.setState({ view: { kind: "conversation" }, customize: null, settingsFocus: null });
  container = document.createElement("div");
  // The work row the Shelf sits in (App): its width bounds the Shelf's.
  Object.defineProperty(container, "clientWidth", { configurable: true, value: 1400 });
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(h(SettingsShelf)));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const shelf = () => container.querySelector<HTMLElement>("[data-settings-shelf]");
const s = () => useSettingsShelf.getState();

describe("open / close / toggle", () => {
  it("is closed until opened; openSettings opens it beside the view, which stays", () => {
    expect(shelf()).toBeNull();
    act(() => useApp.getState().openSettings("sidebar"));
    expect(shelf()).not.toBeNull();
    expect(useApp.getState().view).toEqual({ kind: "conversation" });
    expect(shelf()!.dataset.settingsSide).toBe("left");
    expect(container.querySelector("[data-probe]")?.textContent).toBe("左侧栏的卡片");
    expect(container.querySelector("[data-settings-crumbs]")?.textContent).toContain("page:sidebar");
    // × closes it.
    act(() => container.querySelector<HTMLButtonElement>("[data-settings-close]")!.click());
    expect(shelf()).toBeNull();
  });

  it("Ctrl+, / the footer ⚙ toggle it (toggleSettingsFromNav)", () => {
    act(() => toggleSettingsFromNav());
    expect(s()).toMatchObject({ open: true, params: { tab: "general" } });
    act(() => toggleSettingsFromNav());
    expect(s().open).toBe(false);
    expect(shelf()).toBeNull();
  });

  it("the rail's categories switch the page; folded, their names are the tooltips; a module's page renders in it", () => {
    act(() => useApp.getState().openSettings("general"));
    act(() => shelfLib.setSettingsRailLabels(false));
    const buttons = [...container.querySelectorAll<HTMLButtonElement>("[data-settings-rail] [data-settings-category]")];
    expect(buttons.map((b) => b.title)).toEqual(["shell.general.title", "shell.sidebar.title", "fake.tools.title"]);
    expect(buttons[0]!.getAttribute("aria-current")).toBe("page");
    act(() => buttons[2]!.click());
    expect(s().params).toEqual({ tab: "fake" });
    expect(container.querySelector("[data-probe]")?.textContent).toBe("模块贡献的页");
  });
});

describe("deep links", () => {
  it("search selection exits the results and mounts the destination, including the current category", () => {
    act(() => useApp.getState().openSettings("general"));
    const search = container.querySelector<HTMLInputElement>("[data-settings-search]")!;
    const query = () => act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "Sidebar");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const scroll = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = () => {};
    try {
      query();
      expect(container.querySelector("#settings-search-results")).not.toBeNull();
      act(() => container.querySelector<HTMLElement>('#settings-search-results [role="option"]')!.click());
      expect(s().params.tab).toBe("sidebar");
      expect(search.value).toBe("");
      expect(container.querySelector("#settings-search-results")).toBeNull();
      expect(container.querySelector("[data-probe=sidebar]")?.textContent).toBe("左侧栏的卡片");
      query();
      act(() => search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
      expect(container.querySelector("#settings-search-results")).toBeNull();
      expect(container.querySelector("[data-probe=sidebar]")).not.toBeNull();
    } finally { HTMLElement.prototype.scrollIntoView = scroll; }
  });

  it("openSettings(page, { anchor }) opens the Shelf on that page with the card to scroll to", () => {
    act(() => useApp.getState().openSettings("sidebar", { anchor: "projects" }));
    expect(s()).toMatchObject({ open: true, params: { tab: "sidebar" } });
    expect(useApp.getState().settingsFocus).toEqual({ anchor: "projects" });
    expect(container.querySelector("[data-probe]")?.getAttribute("data-probe")).toBe("sidebar");
    // An open Shelf switches page in place.
    act(() => useApp.getState().openSettings("fake" as never));
    expect(container.querySelectorAll("[data-settings-shelf]").length).toBe(1);
    expect(container.querySelector("[data-probe]")?.getAttribute("data-probe")).toBe("fake");
  });
});

describe("side, width, maximise", () => {
  it("moves to the other side (CSS order, not remounted) and remembers it", () => {
    act(() => useApp.getState().openSettings("general"));
    const before = shelf();
    // No docked sidebar (no slot): left of the work row.
    expect(before!.style.order).toBe("-1");
    act(() => container.querySelector<HTMLButtonElement>("[data-settings-move]")!.click());
    expect(s().side).toBe("right");
    expect(shelf()).toBe(before);
    expect(shelf()!.dataset.settingsSide).toBe("right");
    expect(shelf()!.style.order).toBe("1");
    expect(JSON.parse(localStorage.getItem("cutex-desktop.settingsShelf")!)).toMatchObject({ v: 3, side: "right" });
    act(() => container.querySelector<HTMLButtonElement>("[data-settings-move]")!.click());
    expect(s().side).toBe("left");
  });

  it("is dragged wider at its inner edge; the row keeps room for a conversation", () => {
    act(() => useApp.getState().openSettings("general"));
    const handle = container.querySelector<HTMLElement>("[data-settings-resize]")!;
    act(() => handle.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 800 })));
    act(() => handle.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 900 })));
    act(() => handle.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: 900 })));
    // Left side: dragging right widens it.
    expect(s().width).toBe(SETTINGS_SHELF_DEFAULT_W + 100);
    // Never dragged under the minimum.
    act(() => handle.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 800 })));
    act(() => handle.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: 300 })));
    expect(s().width).toBe(SETTINGS_SHELF_MIN_W);
    act(() => handle.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(s().width).toBe(SETTINGS_SHELF_DEFAULT_W);
  });

  it("arrow keys are a short drag (宽度规则 1 / 3): live in a drag session, never more than the work row can give, stored once the keys rest", () => {
    vi.useFakeTimers();
    const sessions: boolean[] = [];
    const off = glideLib.onResizeDrag((active) => sessions.push(active));
    try {
      act(() => useApp.getState().openSettings("general"));
      const handle = container.querySelector<HTMLElement>("[data-settings-resize]")!;
      // The work row beside it can give 10 px (its column above the minimum, the free desktop).
      sideResize.setRowHooks({ shelfMax: () => null, shelfReset() {}, give: () => 10 });
      act(() => void handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
      expect(shelf()!.style.width).toBe(`${SETTINGS_SHELF_DEFAULT_W + 10 + 8}px`);
      expect(s().width).toBe(SETTINGS_SHELF_DEFAULT_W);
      expect(sessions).toEqual([true]);
      act(() => void vi.advanceTimersByTime(glideLib.KEY_RESIZE_MS + 10));
      expect(s().width).toBe(SETTINGS_SHELF_DEFAULT_W + 10);
      expect(sessions).toEqual([true, false]);
      // Narrower needs nothing from the row.
      act(() => void handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
      act(() => void vi.advanceTimersByTime(glideLib.KEY_RESIZE_MS + 10));
      expect(s().width).toBe(SETTINGS_SHELF_DEFAULT_W + 10 - 24);
    } finally {
      off();
      sideResize.setRowHooks(null);
      glideLib.resetColumnGlide();
      vi.useRealTimers();
    }
  });

  it("a normal width: 760 by default (nav 200 + page 560), at least 640; the row keeps 420 for a conversation", () => {
    expect(SETTINGS_SHELF_DEFAULT_W).toBe(760);
    expect(SETTINGS_SHELF_MIN_W).toBe(640);
    expect(SETTINGS_NAV_NAMED_W).toBe(200);
    expect(settingsShelfWidth(SETTINGS_SHELF_DEFAULT_W, 1400)).toBe(760);
    expect(settingsShelfWidth(5000, 1400)).toBe(1400 - SETTINGS_SHELF_ROW_KEEP);
    expect(settingsShelfWidth(100, 1400)).toBe(SETTINGS_SHELF_MIN_W);
    // A row too small for both (1000 − 420 = 580 < 640): the card keeps its minimum, the conversation gets
    // the rest (its own narrow rules); not maximised behind the owner's back.
    expect(settingsShelfWidth(760, 1000)).toBe(SETTINGS_SHELF_MIN_W);
    // Never wider than the row itself.
    expect(settingsShelfWidth(760, 500)).toBe(500);
    act(() => useApp.getState().openSettings("general"));
    expect(shelf()!.style.width).toBe(`${SETTINGS_SHELF_DEFAULT_W + 8}px`);
    expect(s().maximized).toBe(false);
  });

  it("maximises over the work row: the wide nav with the group names, as the old full-window Settings", () => {
    act(() => useApp.getState().openSettings("general"));
    expect(container.querySelector('[data-settings-rail="wide"]')).toBeNull();
    act(() => container.querySelector<HTMLButtonElement>("[data-settings-maximize]")!.click());
    expect(s().maximized).toBe(true);
    expect(shelf()!.hasAttribute("data-settings-max")).toBe(true);
    const nav = container.querySelector('[data-settings-rail="wide"]')!;
    expect(nav.textContent).toContain("settings.group.app");
    expect(nav.textContent).toContain("shell.sidebar.title");
    // It covers the conversation: Esc anywhere closes it, the conversation's Esc stands back.
    expect(sideLayersActive()).toBe(true);
    act(() => container.querySelector<HTMLButtonElement>("[data-settings-maximize]")!.click());
    expect(s().maximized).toBe(false);
    expect(sideLayersActive()).toBe(false);
  });
});

describe("no drops into it", () => {
  it("neither the pane drag (lib/sideDnd) nor the workspace drag (lib/workspaces) finds a target over it — not even the work row's edge band", () => {
    act(() => useApp.getState().openSettings("general"));
    const inside = container.querySelector<HTMLElement>("[data-settings-card]")!;
    // The work row (data-side-work) ends right where the Settings Shelf starts.
    const work = document.createElement("div");
    work.setAttribute("data-side-work", "");
    document.body.appendChild(work);
    vi.spyOn(work, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 800, height: 700, right: 800, bottom: 700, x: 0, y: 0, toJSON() {} } as DOMRect);
    Object.defineProperty(document, "elementsFromPoint", { configurable: true, value: () => [inside] });
    try {
      expect(sideDnd.probe(805, 300, null)).toEqual({ at: "none" });
      expect(ws.probe(805, 300)).toBeNull();
    } finally {
      work.remove();
      delete (document as { elementsFromPoint?: unknown }).elementsFromPoint;
    }
  });
});

describe("live edit from Settings (在主界面调整)", () => {
  it("the page header's button puts the region into edit state while the Shelf stays open; again = 完成调整 finishes", async () => {
    // The real Settings page shows 在主界面调整 on a page with a customize.region.
    act(() => useApp.getState().openSettings("sidebar"));
    const button = () => [...container.querySelectorAll<HTMLButtonElement>("button")].find((b) => /customize\.(openInMain|finish)/.test(b.textContent ?? ""));
    expect(button()?.textContent).toContain("customize.openInMain");
    act(() => button()!.click());
    expect(useApp.getState().customize).toMatchObject({ region: "sidebar", page: "sidebar", back: { open: true } });
    expect(s()).toMatchObject({ open: true, params: { tab: "sidebar" } });
    expect(shelf()).not.toBeNull();
    expect(button()?.textContent).toContain("customize.finish");
    act(() => button()!.click());
    expect(useApp.getState().customize).toBeNull();
    // Opened from Settings: Settings stays.
    expect(s().open).toBe(true);
  });

  it("from maximised Settings: beside the region while editing, maximised again when done", () => {
    act(() => useApp.getState().openSettings("sidebar"));
    act(() => shelfLib.setSettingsShelfMaximized(true));
    act(() => useApp.getState().openCustomize("sidebar", "sidebar"));
    expect(shelf()!.hasAttribute("data-settings-max")).toBe(false);
    act(() => useApp.getState().closeCustomize());
    expect(shelf()!.hasAttribute("data-settings-max")).toBe(true);
  });
});

describe("Esc", () => {
  const esc = (over: Record<string, boolean>) => ({ modifiers: false, repeat: false, composing: false, overlay: false, handled: false, peek: false, mode: false, drawer: false, editable: false, inSide: false, ...over });

  it("the chain: a live edit finishes first, then the Settings Shelf closes — after popups, handlers, a maximised pane and the drawer; not while typing", () => {
    expect(escChainStep(esc({ settings: true }))).toBe("close-settings");
    expect(escChainStep(esc({ settings: true, editing: true }))).toBe("finish-edit");
    expect(escChainStep(esc({ editing: true }))).toBe("finish-edit");
    expect(escChainStep(esc({ settings: true, editable: true, inSide: true }))).toBe("side");
    expect(escChainStep(esc({ settings: true, overlay: true }))).toBe("overlay");
    expect(escChainStep(esc({ settings: true, handled: true }))).toBe("handled");
    expect(escChainStep(esc({ settings: true, mode: true }))).toBe("restore");
    expect(escChainStep(esc({ settings: true, drawer: true }))).toBe("close-drawer");
    expect(escChainStep(esc({ settings: true, shelf: true }))).toBe("collapse-shelf");
  });

  it("Esc with the focus in the Settings Shelf closes it; during a live edit it finishes the edit first", () => {
    act(() => useApp.getState().openSettings("sidebar"));
    const key = () => new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    // Opening puts the focus into the Shelf.
    expect(shelf()!.contains(document.activeElement)).toBe(true);
    act(() => useApp.getState().openCustomize("sidebar", "sidebar"));
    let e = key();
    shelf()!.dispatchEvent(e);
    act(() => void runEscChain(e, false));
    expect(useApp.getState().customize).toBeNull();
    expect(s().open).toBe(true);
    e = key();
    shelf()!.dispatchEvent(e);
    act(() => void runEscChain(e, false));
    expect(e.defaultPrevented).toBe(true);
    expect(s().open).toBe(false);
  });
});

describe("the category nav merged into the card (owner 2026-10-21)", () => {
  const nav = () => container.querySelector<HTMLElement>("[data-settings-rail]")!;
  const card = () => container.querySelector<HTMLElement>("[data-settings-card]")!;

  it("the card clips (overflow-clip) rather than hides: a focus inside can never scroll the whole row up out of it", () => {
    act(() => useApp.getState().openSettings("general"));
    expect(card().className.split(" ")).toContain("overflow-clip");
    expect(card().className.split(" ")).not.toContain("overflow-hidden");
  });

  it("is the card's left column (one card, no rail card of its own): search on top, icon + name rows, a line between the groups", () => {
    act(() => useApp.getState().openSettings("general"));
    expect(card().contains(nav())).toBe(true);
    // The header stays above it: 设置 › page, search, ⇄, ⤢, ×.
    const head = card().querySelector("[data-settings-head]")!;
    expect(head.compareDocumentPosition(nav()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const sel of ["[data-settings-crumbs]", "[data-settings-search]", "[data-settings-move]", "[data-settings-maximize]", "[data-settings-close]"]) expect(head.querySelector(sel)).not.toBeNull();
    // The nav before the page in the same row.
    expect(nav().compareDocumentPosition(card().querySelector("[data-probe]")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelectorAll(".shelf-rail-card").length).toBe(0);
    expect(container.querySelectorAll(".shell-card").length).toBe(1);
    expect(nav().dataset.settingsRail).toBe("named");
    const rows = [...nav().querySelectorAll<HTMLButtonElement>("[data-settings-category]")];
    expect(rows.map((b) => b.textContent)).toEqual(["shell.general.title", "shell.sidebar.title", "fake.tools.title"]);
    expect(rows[0]!.getAttribute("aria-current")).toBe("page");
    // Three groups (app; 面板 — 侧栏 is a panel page, design 006 v1; tools): a line before each, the search on top.
    expect(nav().querySelectorAll("[data-settings-rail-sep]").length).toBe(3);
    expect(nav().firstElementChild!.firstElementChild!.hasAttribute("data-settings-search-button")).toBe(true);
    expect(nav().querySelector("[data-settings-search-button]")!.textContent).toBe("shell.settingsSearch.placeholder");
    expect(nav().style.width).toBe(`${SETTINGS_NAV_NAMED_W}px`);
    // The nav's search focuses the header's field.
    act(() => nav().querySelector<HTMLButtonElement>("[data-settings-search-button]")!.click());
    expect(document.activeElement).toBe(container.querySelector("[data-settings-search]"));
    // Moved to the right the nav stays the card's left column.
    act(() => shelfLib.moveSettingsShelf("right"));
    expect(card().contains(nav())).toBe(true);
    expect(nav().style.width).toBe(`${SETTINGS_NAV_NAMED_W}px`);
  });

  it("folds to icons inside the card (names in the tooltips) and back; remembered; the card keeps its width", () => {
    act(() => useApp.getState().openSettings("general"));
    const toggle = () => container.querySelector<HTMLButtonElement>("[data-settings-rail-names]")!;
    expect(toggle().getAttribute("aria-pressed")).toBe("true");
    act(() => toggle().click());
    expect(nav().dataset.settingsRail).toBe("");
    expect(card().contains(nav())).toBe(true);
    expect(nav().style.width).toBe(`${SETTINGS_NAV_ICONS_W}px`);
    expect(nav().querySelector<HTMLButtonElement>("[data-settings-category]")!.textContent).toBe("");
    expect(shelf()!.style.width).toBe(`${SETTINGS_SHELF_DEFAULT_W + 8}px`);
    expect(JSON.parse(localStorage.getItem("cutex-desktop.settingsShelf")!)).toMatchObject({ railLabels: false });
    act(() => toggle().click());
    expect(nav().dataset.settingsRail).toBe("named");
    expect(s().railLabels).toBe(true);
  });

  it("folds by itself only when the card is really narrow (< 560 px: a window too small for the minimum); pure rule", () => {
    const layout = shelfLib.settingsShelfLayout;
    expect(shelfLib.SETTINGS_NAV_FOLD_UNDER).toBe(560);
    expect(layout(760, 1400, true)).toEqual({ card: 760, nav: SETTINGS_NAV_NAMED_W, named: true });
    // At the minimum the names stay.
    expect(layout(640, 1400, true)).toEqual({ card: 640, nav: SETTINGS_NAV_NAMED_W, named: true });
    expect(layout(760, 900, true)).toEqual({ card: 640, nav: SETTINGS_NAV_NAMED_W, named: true });
    // A row narrower than that: the card takes the row, icons only.
    expect(layout(760, 500, true)).toEqual({ card: 500, nav: SETTINGS_NAV_ICONS_W, named: false });
    expect(layout(900, 2000, false)).toEqual({ card: 900, nav: SETTINGS_NAV_ICONS_W, named: false });
    Object.defineProperty(container, "clientWidth", { configurable: true, value: 500 });
    act(() => useApp.getState().openSettings("general"));
    expect(nav().dataset.settingsRail).toBe("");
    const toggle = container.querySelector<HTMLButtonElement>("[data-settings-rail-names]")!;
    expect(toggle.disabled).toBe(true);
    expect(toggle.title).toBe("settingsShelf.railTooNarrow");
  });

  it("maximised: the wide nav with the group names outside the card (the old full-window look), back inside when restored", () => {
    act(() => useApp.getState().openSettings("general"));
    act(() => shelfLib.setSettingsShelfMaximized(true));
    const wide = container.querySelector<HTMLElement>('[data-settings-rail="wide"]')!;
    expect(card().contains(wide)).toBe(false);
    expect(container.querySelectorAll("[data-settings-rail]").length).toBe(1);
    act(() => shelfLib.setSettingsShelfMaximized(false));
    expect(card().contains(nav())).toBe(true);
    expect(container.querySelector('[data-settings-rail="wide"]')).toBeNull();
  });
});

describe("the left place: between the sidebar card and the work area (owner 2026-10-21)", () => {
  /** The App row: the pane host (sidebar card, the slot, the work area) and the Settings Shelf's anchor. */
  const renderRow = (docked = true) =>
    act(() =>
      root.render(
        h("div", { id: "row" }, h("div", { "data-pane-host": "" }, docked && h("aside", { className: "sidebar-card", id: "sidebar" }), docked && h(SettingsShelfSlot), h("div", { "data-pane-stage": "" })), h(SettingsShelf)),
      ),
    );

  it("left by default, right after the sidebar card; moving / maximising / undocking moves the same element", () => {
    renderRow();
    act(() => useApp.getState().openSettings("general"));
    const el = shelf()!;
    const slot = container.querySelector("[data-settings-slot]")!;
    expect(slot.contains(el)).toBe(true);
    expect(slot.previousElementSibling!.id).toBe("sidebar");
    expect(el.hasAttribute("data-settings-in-slot")).toBe(true);
    // In the pane host's own row: no CSS order (the sidebar card stays first), the seam to the work area inside the box.
    expect(el.style.order).toBe("");
    expect(el.style.width).toBe(`${SETTINGS_SHELF_DEFAULT_W + 8}px`);
    // 移到右边: at the App's anchor, after the pane host; not remounted.
    act(() => shelfLib.moveSettingsShelf("right"));
    expect(shelf()).toBe(el);
    expect(container.querySelector("[data-settings-anchor]")!.contains(el)).toBe(true);
    expect(el.style.order).toBe("1");
    act(() => shelfLib.moveSettingsShelf("left"));
    expect(slot.contains(shelf())).toBe(true);
    // Maximised: over the whole row (outside the pane host's inert wrapper), then back.
    const card = container.querySelector("[data-settings-card]");
    act(() => shelfLib.setSettingsShelfMaximized(true));
    expect(container.querySelector("[data-settings-anchor]")!.contains(shelf())).toBe(true);
    expect(container.querySelector("[data-settings-card]")).toBe(card);
    act(() => shelfLib.setSettingsShelfMaximized(false));
    expect(slot.contains(shelf())).toBe(true);
    expect(container.querySelector("[data-settings-card]")).toBe(card);
    // No docked sidebar: left of the work row at the anchor.
    renderRow(false);
    expect(container.querySelector("[data-settings-anchor]")!.contains(shelf())).toBe(true);
    expect(shelf()!.style.order).toBe("-1");
    expect(container.querySelector("[data-settings-card]")).toBe(card);
  });
});

describe("stored layouts: to the left once, small widths raised once", () => {
  it("parse: no version = before the left default → left (all of them: an explicit right can't be told); v2 / v3 keep the choice", () => {
    const parse = shelfLib.parseSettingsShelfLayout;
    expect(parse({})).toEqual({ layout: { side: "left", width: SETTINGS_SHELF_DEFAULT_W, maximized: false, railLabels: true }, migrated: false });
    expect(parse({ side: "right", width: 640 })).toMatchObject({ layout: { side: "left", width: 640 }, migrated: true });
    expect(parse({ side: "left", maximized: true })).toMatchObject({ layout: { side: "left", maximized: true }, migrated: true });
    expect(parse({ v: 2, side: "right", width: 700, railLabels: false })).toEqual({ layout: { side: "right", width: 700, maximized: false, railLabels: false }, migrated: true });
    expect(parse({ v: 3, side: "right", width: 900, railLabels: false })).toEqual({ layout: { side: "right", width: 900, maximized: false, railLabels: false }, migrated: false });
    expect(parse(null).layout.side).toBe("left");
  });

  it("parse: a width stored before v3 (the page card alone, old default 600) under the new minimum → the new default, once", () => {
    const parse = shelfLib.parseSettingsShelfLayout;
    expect(parse({ v: 2, side: "left", width: 600 })).toMatchObject({ layout: { width: SETTINGS_SHELF_DEFAULT_W }, migrated: true });
    expect(parse({ v: 2, width: 380 })).toMatchObject({ layout: { width: SETTINGS_SHELF_DEFAULT_W }, migrated: true });
    expect(parse({ width: 500 })).toMatchObject({ layout: { width: SETTINGS_SHELF_DEFAULT_W }, migrated: true });
    // Already wide enough: kept.
    expect(parse({ v: 2, width: 820 })).toMatchObject({ layout: { width: 820 }, migrated: true });
    // A v3 width is never stored under the minimum; if it were, it is clamped (no second raise).
    expect(parse({ v: 3, width: 500 })).toMatchObject({ layout: { width: SETTINGS_SHELF_MIN_W }, migrated: false });
  });

  it("loading writes the move back, so a later 移到右边 stays", async () => {
    localStorage.setItem("cutex-desktop.settingsShelf", JSON.stringify({ side: "right", width: 640, maximized: false }));
    vi.resetModules();
    const fresh = await import("../src/renderer/src/lib/settingsShelf");
    expect(fresh.useSettingsShelf.getState()).toMatchObject({ side: "left", width: 640 });
    expect(JSON.parse(localStorage.getItem("cutex-desktop.settingsShelf")!)).toMatchObject({ v: 3, side: "left", width: 640 });
    fresh.moveSettingsShelf("right");
    vi.resetModules();
    const again = await import("../src/renderer/src/lib/settingsShelf");
    expect(again.useSettingsShelf.getState().side).toBe("right");
  });

  it("loading raises a small v2 width once and writes it back; a later narrower drag stays (down to the minimum)", async () => {
    localStorage.setItem("cutex-desktop.settingsShelf", JSON.stringify({ v: 2, side: "right", width: 600, maximized: false, railLabels: true }));
    vi.resetModules();
    const fresh = await import("../src/renderer/src/lib/settingsShelf");
    expect(fresh.useSettingsShelf.getState()).toMatchObject({ side: "right", width: 760 });
    expect(JSON.parse(localStorage.getItem("cutex-desktop.settingsShelf")!)).toMatchObject({ v: 3, side: "right", width: 760 });
    fresh.setSettingsShelfWidth(650);
    vi.resetModules();
    const again = await import("../src/renderer/src/lib/settingsShelf");
    expect(again.useSettingsShelf.getState().width).toBe(650);
  });
});
