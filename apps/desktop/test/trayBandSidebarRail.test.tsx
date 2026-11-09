// @vitest-environment jsdom
// The tray docked at the left / right edge (owner 2026-10-21, components/ChipTray TrayFrame) takes a band of the
// window beside the work row: TRAY_BAND_PX docked, TRAY_HANDLE_PX as the auto-hide handle. The work row measures
// itself (lib/workspaceRow gets the row's own width), but the sidebar's automatic rail with two workspaces
// (lib/workspaces sidebarAutoRail) decided on the window's width: with the tray at a side the sidebar stayed
// expanded for TRAY_BAND_PX px too long and the two conversation columns got less than their budget. Now
// TrayFrame publishes its side band (setTrayBandWidth) and the decision subtracts it.
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/modules/react", async (importOriginal) => ({ ...(await importOriginal<object>()), useSlot: () => [] }));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
}));
vi.mock("../src/renderer/src/lib/sideComponents", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSideView: () => ({ hostId: "local", sessionId: "eva", projectId: null }),
  useSideRegistry: () => ({}),
}));
vi.mock("../src/renderer/src/lib/trayMenu", () => ({ openTrayMenu: () => {} }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { DesktopStage, TrayFrame } = await import("../src/renderer/src/components/ChipTray");
const { hideTray } = await import("../src/renderer/src/lib/trayStore");
const { TRAY_BAND_PX, TRAY_HANDLE_PX } = await import("../src/renderer/src/lib/trayModel");
const { DEFAULT_TRAY_PREFS, setTrayPrefs, useTrayPrefs } = await import("../src/renderer/src/lib/trayPrefs");
const { sidebarAutoRail, sidebarDragMax, setTrayBandWidth, useWsUi, WS_CONVERSATION_MIN_W, WS_SHELF_TIGHT } = await import("../src/renderer/src/lib/workspaces");
const { workspaceRow } = await import("../src/renderer/src/lib/workspaceRow");
const { CARD_GAP, COLLAPSED_SHELF_WIDTH } = await import("../src/renderer/src/lib/sideLayout");
const { CONVERSATION_MIN_W } = await import("../src/renderer/src/lib/paneLayout");
const { FOLD_HYSTERESIS } = await import("../src/renderer/src/lib/foldHysteresis");

describe("sidebarAutoRail counts the tray's band at the left / right edge", () => {
  it("the sidebar's drag stops at the widest that keeps it expanded beside two workspaces (past it the release railed it: fuzz 2026-10-23)", () => {
    for (const [windowWidth, tray] of [[1600, 0], [2200, 0], [1600, TRAY_BAND_PX]] as const) {
      const max = sidebarDragMax({ workspaces: 2, windowWidth, tray });
      expect(sidebarAutoRail({ workspaces: 2, windowWidth, sidebarWidth: max, tray })).toBe(false);
      expect(sidebarAutoRail({ workspaces: 2, windowWidth, sidebarWidth: max + 1, tray })).toBe(true);
    }
    expect(sidebarDragMax({ workspaces: 1, windowWidth: 1600 })).toBe(Number.POSITIVE_INFINITY);
  });

  it("the threshold moves by exactly the band", () => {
    const threshold = (tray: number) => {
      for (let w = 4000; w > 0; w--) if (sidebarAutoRail({ workspaces: 2, windowWidth: w, sidebarWidth: 256, tray })) return w + 1;
      return 0;
    };
    const none = threshold(0);
    expect(none).toBeGreaterThan(0);
    expect(threshold(TRAY_BAND_PX)).toBe(none + TRAY_BAND_PX);
    expect(threshold(TRAY_HANDLE_PX)).toBe(none + TRAY_HANDLE_PX);
    // The hysteresis is kept on top of the band.
    expect(sidebarAutoRail({ workspaces: 2, windowWidth: none + TRAY_BAND_PX + FOLD_HYSTERESIS - 1, sidebarWidth: 256, tray: TRAY_BAND_PX, was: true })).toBe(true);
    expect(sidebarAutoRail({ workspaces: 2, windowWidth: none + TRAY_BAND_PX + FOLD_HYSTERESIS, sidebarWidth: 256, tray: TRAY_BAND_PX, was: true })).toBe(false);
    // One workspace: never automatic, tray or not.
    expect(sidebarAutoRail({ workspaces: 1, windowWidth: 300, sidebarWidth: 256, tray: TRAY_BAND_PX })).toBe(false);
  });

  it("sweep: whenever the sidebar stays expanded, the row the tray leaves holds both columns at their budget beside a tight Shelf, and nothing passes the window", () => {
    let checked = 0;
    let expanded = 0;
    for (let window = 900; window <= 2600; window += 7)
      for (const tray of [0, TRAY_HANDLE_PX, TRAY_BAND_PX])
        for (const sidebarWidth of [200, 256, 340])
          for (const was of [false, true]) {
            const railed = sidebarAutoRail({ workspaces: 2, windowWidth: window, sidebarWidth, tray, was });
            const sidebarBox = railed ? COLLAPSED_SHELF_WIDTH : sidebarWidth + CARD_GAP;
            // The row's own width: the window less the tray's band and the sidebar's box.
            const area = window - tray - sidebarBox;
            const row = workspaceRow({
              area,
              mode: "fill",
              placement: "outer",
              split: 0.5,
              workspaces: [
                { want: null, min: WS_CONVERSATION_MIN_W, rail: false, shelves: [{ id: "a", side: "left", width: WS_SHELF_TIGHT.min, collapsed: false }] },
                { want: null, min: WS_CONVERSATION_MIN_W, rail: false, shelves: [{ id: "b", side: "right", width: WS_SHELF_TIGHT.min, collapsed: true }] },
              ],
            });
            const span = row.workspaces.reduce((n, w) => n + (w.width ?? 0) + w.shelves.reduce((m, x) => m + x.box, 0), 0) + CARD_GAP;
            const ctx = JSON.stringify({ window, tray, sidebarWidth, was, railed, area, row });
            // Nothing overlaps the tray: sidebar + row + band never exceed the window.
            if (sidebarBox + span + tray > window) throw new Error(`past the window: ${ctx}`);
            if (!railed) {
              expanded++;
              // The sidebar is expanded only while the tight Shelf stays expanded and both columns keep the budget.
              if (row.workspaces[0]!.shelves[0]!.forced) throw new Error(`Shelf forced to its rail beside an expanded sidebar: ${ctx}`);
              for (const w of row.workspaces) if ((w.width ?? 0) < CONVERSATION_MIN_W) throw new Error(`column under its budget beside an expanded sidebar: ${ctx}`);
            }
            checked++;
          }
    expect(checked).toBeGreaterThan(4000);
    expect(expanded).toBeGreaterThan(1000);
  });
});

// ── TrayFrame publishes its side band ──

const entry = {
  moduleId: "fake",
  mode: "show",
  missing: [],
  item: {
    id: "fake.desktop",
    Desktop: () => h("div", { "data-fake-desk": "" }),
    useShowWhenEmpty: () => true,
    useDockCount: () => 2,
    Dock: () => h("span", { "data-fake-dock": "" }, h("button", { "data-tray-item": "" }, "a")),
  },
} as never;
const panes = { fullWindow: false, framed: false, sessionId: "eva" as string | null, page: false, firstRun: false, desktopShown: false };

let root: ReturnType<typeof createRoot> | null = null;
let host: HTMLDivElement;
function render(input = panes, hidden = false) {
  act(() => root!.render(h(TrayFrame, { hidden }, h(DesktopStage, { entry, input, hostId: "local", children: () => h("div", { "data-fake-work": "" }) }))));
}
const band = () => useWsUi.getState().tray ?? 0;

describe("TrayFrame: the band beside the row reaches the sidebar's decision", () => {
  beforeEach(() => {
    hideTray();
    localStorage.clear();
    useTrayPrefs.setState({ ...DEFAULT_TRAY_PREFS });
    setTrayBandWidth(0);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
  });

  it("docked left / right = the band; top / bottom = 0; the handle's band when auto-hiding; gone when hidden or unmounted", () => {
    act(() => setTrayPrefs({ edge: "left" }));
    render();
    expect(host.querySelector<HTMLElement>("[data-tray-band]")!.style.width).toBe(`${TRAY_BAND_PX}px`);
    expect(band()).toBe(TRAY_BAND_PX);
    act(() => setTrayPrefs({ edge: "right" }));
    expect(band()).toBe(TRAY_BAND_PX);
    act(() => setTrayPrefs({ edge: "bottom" }));
    expect(band()).toBe(0);
    act(() => setTrayPrefs({ edge: "top" }));
    expect(band()).toBe(0);
    act(() => setTrayPrefs({ edge: "right", persistent: false }));
    expect(band()).toBe(TRAY_HANDLE_PX);
    render(panes, true);
    expect(band()).toBe(0);
    render();
    expect(band()).toBe(TRAY_HANDLE_PX);
    act(() => root!.unmount());
    root = null;
    expect(band()).toBe(0);
  });
});
