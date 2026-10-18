// @vitest-environment jsdom
// The 在主界面调整 panel host (components/CustomizeHost): a non-modal dialog beside the sidebar, focus
// into it on open, Esc / × close it and the focus goes back to the entry; clicking elsewhere does not
// close it; 全部设置 → opens the settings page (the panel closes).
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
}));
const fx = vi.hoisted(() => ({ changed: 0 }));
vi.mock("../src/renderer/src/modules/react", async (importOriginal) => {
  const { createElement } = await import("react");
  const Panel = () => createElement("button", { type: "button", "data-probe": "", onClick: () => fx.changed++ }, "项目分组");
  return {
    ...(await importOriginal<object>()),
    useSlot: (slot: string) => (slot === "customize.region" ? [{ moduleId: "shell", mode: "show", item: { id: "shell.sidebar", region: "sidebar", titleKey: "customize.sidebar.title", settingsPage: "sidebar", side: "right", Panel } }] : []),
  };
});

const { CustomizeHost } = await import("../src/renderer/src/components/CustomizeHost");
const { noteCustomizeOpener } = await import("../src/renderer/src/lib/customize");
const { useApp, SETTINGS_PAGE } = await import("../src/renderer/src/store");

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

const dialog = () => container.querySelector<HTMLElement>('[role="dialog"]');
const open = () => {
  entry.focus();
  noteCustomizeOpener(entry);
  act(() => useApp.getState().openCustomize("sidebar"));
};

describe("CustomizeHost", () => {
  it("opens a non-modal dialog beside the sidebar with the focus in it", () => {
    expect(dialog()).toBeNull();
    open();
    const d = dialog()!;
    expect(d.getAttribute("aria-modal")).toBe("false");
    expect(d.style.left).toBe("264px");
    expect(d.style.top).toBe("8px");
    expect(document.getElementById(d.getAttribute("aria-labelledby")!)?.textContent).toBe("customize.sidebar.title");
    expect(document.activeElement).toBe(d);
  });

  it("marks the region (the faint outline) while open, and only then", () => {
    open();
    expect(aside.hasAttribute("data-customizing")).toBe(true);
    act(() => useApp.getState().closeCustomize());
    expect(aside.hasAttribute("data-customizing")).toBe(false);
  });

  it("Esc closes it and the focus goes back to the entry", () => {
    open();
    act(() => void dialog()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(useApp.getState().customize).toBeNull();
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(entry);
  });

  it("× closes it; without a remembered entry the focus goes to the region", () => {
    open();
    noteCustomizeOpener(null);
    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="common.close"]')!.click());
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(aside);
  });

  it("stays open while the main window is used, and its rows work", () => {
    open();
    act(() => entry.click());
    act(() => document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
    act(() => container.querySelector<HTMLButtonElement>("[data-probe]")!.click());
    expect(fx.changed).toBe(1);
    expect(dialog()).not.toBeNull();
  });

  it("全部设置 → opens the region's settings page and closes the panel", () => {
    open();
    const link = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("customize.allSettings"))!;
    act(() => link.click());
    expect(useApp.getState().view).toEqual({ kind: "page", page: SETTINGS_PAGE, params: { tab: "sidebar" } });
    expect(useApp.getState().customize).toBeNull();
    expect(dialog()).toBeNull();
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
