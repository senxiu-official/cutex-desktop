// @vitest-environment jsdom
// The 在主界面调整 edit state (components/CustomizeHost; owner 2026-10-21): no separate panel any more — the
// region is outlined and a small 完成 bar sits beside it while the Settings Shelf shows the region's page;
// 完成 finishes and the focus goes back to the entry; clicking elsewhere keeps the edit on.
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
}));
vi.mock("../src/renderer/src/modules/react", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSlot: (slot: string) => (slot === "customize.region" ? [{ moduleId: "shell", mode: "show", item: { id: "shell.sidebar", region: "sidebar", titleKey: "customize.sidebar.title", settingsPage: "sidebar", side: "right" } }] : []),
}));

const { CustomizeHost } = await import("../src/renderer/src/components/CustomizeHost");
const { noteCustomizeOpener } = await import("../src/renderer/src/lib/customize");
const { useApp } = await import("../src/renderer/src/store");
const { useSettingsShelf, resetSettingsShelfForTest } = await import("../src/renderer/src/lib/settingsShelf");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let aside: HTMLElement;
let entry: HTMLButtonElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  // jsdom has no layout: the main row is 1200 × 760, the sidebar 256 wide.
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const r = this === aside ? { left: 0, top: 40, right: 256, bottom: 800 } : this.classList.contains("inset-0") ? { left: 0, top: 40, right: 1200, bottom: 800 } : { left: 0, top: 0, right: 0, bottom: 0 };
    return { ...r, x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top, toJSON() {} } as DOMRect;
  });
  aside = document.createElement("aside");
  aside.dataset.customizeRegion = "sidebar";
  aside.tabIndex = -1;
  entry = document.createElement("button");
  entry.textContent = "project";
  aside.appendChild(entry);
  document.body.appendChild(aside);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  resetSettingsShelfForTest();
  act(() => root.render(h(CustomizeHost)));
  act(() => useApp.setState({ view: { kind: "conversation" }, customize: null }));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  aside.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const bar = () => container.querySelector<HTMLElement>("[data-customize-bar]");
const open = () => {
  entry.focus();
  noteCustomizeOpener(entry);
  act(() => useApp.getState().openCustomize("sidebar", "sidebar"));
};

describe("CustomizeHost", () => {
  it("puts the region into edit state: a 完成 bar beside the sidebar, the Settings Shelf on its page", () => {
    expect(bar()).toBeNull();
    open();
    const b = bar()!;
    expect(b.dataset.customizeBar).toBe("sidebar");
    expect(b.style.left).toBe("264px");
    expect(b.style.top).toBe("8px");
    expect(b.textContent).toContain("customize.sidebar.title");
    expect(useSettingsShelf.getState()).toMatchObject({ open: true, params: { tab: "sidebar" } });
    // No separate panel with the cards.
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("marks the region (the faint outline) while editing, and only then", () => {
    open();
    expect(aside.hasAttribute("data-customizing")).toBe(true);
    act(() => useApp.getState().closeCustomize());
    expect(aside.hasAttribute("data-customizing")).toBe(false);
  });

  it("完成 finishes: the bar goes, the Settings Shelf it opened closes, the focus goes back to the entry", () => {
    open();
    act(() => container.querySelector<HTMLButtonElement>("[data-customize-done]")!.click());
    expect(useApp.getState().customize).toBeNull();
    expect(bar()).toBeNull();
    expect(useSettingsShelf.getState().open).toBe(false);
    expect(document.activeElement).toBe(entry);
  });

  it("stays on while the main window is used", () => {
    open();
    act(() => entry.click());
    act(() => document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
    expect(bar()).not.toBeNull();
    expect(useApp.getState().customize).toMatchObject({ region: "sidebar" });
  });
});

describe("the shared sidebar cards", () => {
  it("mark the same rows modified on the settings page and in the compact panel; 恢复默认 resets", async () => {
    const { SidebarProjectsCard } = await import("../src/renderer/src/components/settings/regions/SidebarSettings");
    const { CompactSettings } = await import("../src/renderer/src/components/settings/Form");
    const { getUiPrefs, setUiPref } = await import("../src/renderer/src/lib/prefs");
    setUiPref("projectGrouping", "all");
    act(() => root.render(h("div", null, h("div", { id: "page" }, h(SidebarProjectsCard)), h("div", { id: "panel" }, h(CompactSettings, null, h(SidebarProjectsCard))))));
    const marked = (id: string) => container.querySelectorAll(`#${id} [data-modified]`).length;
    expect([marked("page"), marked("panel")]).toEqual([0, 0]);
    act(() => setUiPref("projectGrouping", "starred"));
    expect([marked("page"), marked("panel")]).toEqual([1, 1]);
    // Compact: the card anchor is a data attribute (no duplicate DOM id beside the settings page).
    expect(container.querySelector("#panel section")?.id).toBe("");
    expect(container.querySelector("#panel section")?.getAttribute("data-settings-anchor")).toBe("settings-projects");
    expect(container.querySelector("#page section")?.id).toBe("settings-projects");
    act(() => container.querySelector<HTMLButtonElement>('#panel [data-modified] button[aria-label="appearance.reset"]')!.click());
    expect(getUiPrefs().projectGrouping).toBe("all");
    expect([marked("page"), marked("panel")]).toEqual([0, 0]);
  });
});
