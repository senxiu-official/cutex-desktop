// 在主界面调整 (docs/research/rfc-in-place-settings-20261018.md, lead decisions 2026-10-18): where the
// panel goes (beside the sidebar at any width, no drawer; not over the composer), the
// store / services.ui.customize open-close rules, and the entries (right-click menus, shell slot).
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));

const { CUSTOMIZE_GAP, CUSTOMIZE_PANEL_MIN_H, CUSTOMIZE_PANEL_MIN_W, CUSTOMIZE_PANEL_W, noteCustomizeOpener, placeCustomizePanel, takeCustomizeOpener } = await import("../src/renderer/src/lib/customize");
const { useApp, SETTINGS_PAGE } = await import("../src/renderer/src/store");
const { services } = await import("../src/renderer/src/modules/app");
const { getUiPrefs, setUiPref } = await import("../src/renderer/src/lib/prefs");
const { sectionMenu } = await import("../src/renderer/src/lib/sectionMenus");
const { customizeSidebarItem } = await import("../src/renderer/src/lib/customizeMenu");
const shell = (await import("../src/renderer/src/modules/shell/index")).default;
const { SidebarSettingsCards } = await import("../src/renderer/src/components/settings/regions/SidebarSettings");
const { ComposerPage } = await import("../src/renderer/src/components/settings/AppSettings");
const { SidesPage } = await import("../src/renderer/src/components/settings/SidesSettings");
const { openSideColumn } = await import("../src/renderer/src/lib/sideActions");

const t = (key: string) => key;
// The main row of a 1200 × 800 window below the title bar; the sidebar 256 px; the timeline frame
// (above needs-you strip, dock, composer) ends at 640.
const row = { left: 0, top: 40, right: 1200, bottom: 800 };
const sidebar = { left: 0, top: 40, right: 256, bottom: 792 };
const stage = { left: 256, top: 40, right: 1192, bottom: 640 };

describe("placeCustomizePanel", () => {
  it("floats beside the sidebar at the top, down to the composer's top", () => {
    const composer = { left: 400, top: 700, right: 1100, bottom: 792 };
    expect(placeCustomizePanel({ row, region: sidebar, stage, composer })).toEqual({
      left: 256 + CUSTOMIZE_GAP,
      top: CUSTOMIZE_GAP,
      width: CUSTOMIZE_PANEL_W,
      maxHeight: 700 - 40 - 2 * CUSTOMIZE_GAP,
    });
  });

  it("without a composer (approval card, another page): the timeline's end, else the row's bottom", () => {
    expect(placeCustomizePanel({ row, region: sidebar, stage })).toMatchObject({ maxHeight: 640 - 40 - 2 * CUSTOMIZE_GAP });
    expect(placeCustomizePanel({ row, region: sidebar, stage: null })).toMatchObject({ maxHeight: 800 - 40 - 2 * CUSTOMIZE_GAP });
  });

  it("a tall composer leaving too little room: down to the row's bottom rather than a sliver", () => {
    const composer = { left: 400, top: 40 + CUSTOMIZE_PANEL_MIN_H, right: 1100, bottom: 792 };
    expect(placeCustomizePanel({ row, region: sidebar, stage, composer })).toMatchObject({ maxHeight: 800 - 40 - 2 * CUSTOMIZE_GAP });
  });

  it("follows the sidebar's width (dragged wider) and sits at the row's edge while it is hidden", () => {
    expect(placeCustomizePanel({ row, region: { ...sidebar, right: 400 }, stage })).toMatchObject({ left: 408 });
    expect(placeCustomizePanel({ row, region: null, stage: { ...stage, left: 8 } })).toMatchObject({ left: CUSTOMIZE_GAP });
  });

  it("narrow window: still beside the sidebar (it never covers the region), narrower, never a drawer", () => {
    const narrowRow = { ...row, right: 600 };
    expect(placeCustomizePanel({ row: narrowRow, region: sidebar, stage: { ...stage, right: 592 } })).toEqual({
      left: 264,
      top: CUSTOMIZE_GAP,
      width: 592 - CUSTOMIZE_GAP - 264,
      maxHeight: 640 - 40 - 2 * CUSTOMIZE_GAP,
    });
    expect(placeCustomizePanel({ row: { ...row, right: 400 }, region: sidebar, stage: { ...stage, right: 392 } }).width).toBe(CUSTOMIZE_PANEL_MIN_W);
  });
});

describe("placeCustomizePanel: the right side and the composer", () => {
  const side = { left: 880, top: 40, right: 1192, bottom: 792 };
  const narrowStage = { ...stage, right: 872 };
  const composer = { left: 400, top: 700, right: 1100, bottom: 792 };

  it("left of the right side, at the top, never over it", () => {
    expect(placeCustomizePanel({ side: "left", row, region: side, stage: narrowStage, composer })).toEqual({
      left: 880 - CUSTOMIZE_GAP - CUSTOMIZE_PANEL_W,
      top: CUSTOMIZE_GAP,
      width: CUSTOMIZE_PANEL_W,
      maxHeight: 700 - 40 - 2 * CUSTOMIZE_GAP,
    });
    // A closed column: against the conversation's right edge.
    expect(placeCustomizePanel({ side: "left", row, region: null, stage, composer })).toMatchObject({ left: 1192 - CUSTOMIZE_GAP - CUSTOMIZE_PANEL_W });
    // Little room: narrower, its right edge still left of the column.
    const tight = placeCustomizePanel({ side: "left", row, region: { ...side, left: 560 }, stage: { ...stage, right: 552 }, composer });
    expect(tight.width).toBe(560 - CUSTOMIZE_GAP - (256 + CUSTOMIZE_GAP));
    expect(tight.left + tight.width).toBe(560 - CUSTOMIZE_GAP);
  });

  it("above the composer: on its left edge, as wide as asked (or the composer), up to the top", () => {
    expect(placeCustomizePanel({ side: "above", width: 440, row, region: composer, stage, composer })).toEqual({
      left: 400,
      bottom: 800 - 700 + CUSTOMIZE_GAP,
      width: 440,
      maxHeight: 700 - 40 - 2 * CUSTOMIZE_GAP,
    });
    expect(placeCustomizePanel({ side: "above", width: 900, row, region: composer, stage, composer }).width).toBe(700);
    // The region is the input card; the status row above it (in the composer block) stays clear.
    const card = { left: 416, top: 730, right: 1084, bottom: 780 };
    expect(placeCustomizePanel({ side: "above", width: 440, row, region: card, stage, composer })).toEqual({ left: 416, bottom: 800 - 700 + CUSTOMIZE_GAP, width: 440, maxHeight: 700 - 40 - 2 * CUSTOMIZE_GAP });
    // No composer (no conversation open): at the top of the conversation.
    expect(placeCustomizePanel({ side: "above", width: 440, row, region: null, stage: null })).toMatchObject({ top: CUSTOMIZE_GAP, left: CUSTOMIZE_GAP });
  });
});

describe("opening and closing", () => {
  it("services.ui.customize opens the region's panel; the same entry again closes it", () => {
    useApp.getState().closeCustomize();
    services.ui.customize("sidebar");
    expect(useApp.getState().customize).toEqual({ region: "sidebar" });
    services.ui.customize("sidebar");
    expect(useApp.getState().customize).toBeNull();
  });

  it("one panel at a time: another region replaces it", () => {
    services.ui.customize("sidebar");
    services.ui.customize("composer");
    expect(useApp.getState().customize).toEqual({ region: "composer" });
    useApp.getState().closeCustomize();
    expect(useApp.getState().customize).toBeNull();
  });

  it("from Settings: closes Settings first; opening Settings closes the panel", () => {
    services.ui.openSettings("sidebar");
    services.ui.customize("sidebar");
    expect(useApp.getState().view).toEqual({ kind: "conversation" });
    expect(useApp.getState().customize).toEqual({ region: "sidebar" });
    services.ui.openSettings("sidebar");
    expect(useApp.getState().view).toEqual({ kind: "page", page: SETTINGS_PAGE, params: { tab: "sidebar" } });
    expect(useApp.getState().customize).toBeNull();
  });

  it("shows a hidden sidebar; closing the panel leaves it shown", () => {
    setUiPref("sidebarOpen", false);
    services.ui.customize("sidebar");
    expect(getUiPrefs().sidebarOpen).toBe(true);
    services.ui.customize("sidebar");
    expect(useApp.getState().customize).toBeNull();
    expect(getUiPrefs().sidebarOpen).toBe(true);
  });

  it("remembers the entry for the focus once, only while it is in the document", () => {
    const entry = { focus() {}, isConnected: true } as unknown as HTMLElement;
    noteCustomizeOpener(entry);
    expect(takeCustomizeOpener()).toBe(entry);
    expect(takeCustomizeOpener()).toBeNull();
    noteCustomizeOpener({ focus() {}, isConnected: false } as unknown as HTMLElement);
    expect(takeCustomizeOpener()).toBeNull();
    noteCustomizeOpener(null);
    expect(takeCustomizeOpener()).toBeNull();
  });
});

describe("entries", () => {
  it("the section header menu ends with 调整左侧栏…, which opens the panel", () => {
    useApp.getState().closeCustomize();
    const items = sectionMenu({ id: "s1", name: "S", collapsed: false, members: [] } as never, ["s1"], t as never).filter(Boolean);
    const last = items.at(-1) as { label: string; onSelect(): void };
    expect(items.at(-2)).toBe("separator");
    expect(last.label).toBe("customize.sidebar.menu");
    last.onSelect();
    expect(useApp.getState().customize).toEqual({ region: "sidebar" });
    useApp.getState().closeCustomize();
  });

  it("the sidebar's empty-area menu item is the same action", () => {
    const item = customizeSidebarItem(t as never);
    expect(item.label).toBe("customize.sidebar.menu");
    item.onSelect();
    expect(useApp.getState().customize).toEqual({ region: "sidebar" });
    useApp.getState().closeCustomize();
  });

  it("the shell contributes 左侧栏, 输入区 and 右侧栏与留白, each with its settings page's own content", () => {
    expect(shell.contributes?.["customize.region"]).toEqual([
      expect.objectContaining({ id: "shell.sidebar", region: "sidebar", titleKey: "customize.sidebar.title", settingsPage: "sidebar", side: "right", Panel: SidebarSettingsCards }),
      expect.objectContaining({ id: "shell.composer", region: "composer", titleKey: "customize.composer.title", settingsPage: "composer", side: "above", Panel: ComposerPage }),
      expect.objectContaining({ id: "shell.sides", region: "sides", titleKey: "customize.sides.title", settingsPage: "sides", side: "left", Panel: SidesPage, reveal: openSideColumn }),
    ]);
  });
});
