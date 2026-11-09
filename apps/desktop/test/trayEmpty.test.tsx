// @vitest-environment jsdom
// The empty tray (owner 2026-10-21: "I have never seen the tray, even with 托盘常驻 on" — with nothing pinned
// and no tool pane collapsed no tray was drawn at all). With a pin list (the `pane.desktop` item has a Dock)
// the tray is there even when empty: 托盘常驻 = its band with 「＋ 固定」 and a muted hint (horizontal) / just
// the ＋ (vertical); off = its handle, which reveals the empty tray. 「＋ 固定」 opens the pin list keeper's
// picker (lib/trayPins pickerEntries; home: the desktop's picker, with Project 视图 page pins where the host
// keeps them) anchored to the tray. No pin list (its module off): only collapsed tool panes make a tray, and
// the 托盘常驻 setting row says so.
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
type Entry = { label: string; disabled?: boolean; submenu?: Entry[]; onSelect(): void };
const menus: { el: HTMLElement; entries: Entry[] }[] = [];
vi.mock("../src/renderer/src/lib/trayMenu", () => ({ openTrayMenu: (el: HTMLElement, entries: never) => menus.push({ el, entries }) }));
let layer: unknown = null;
vi.mock("../src/renderer/src/lib/paneDesk", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useDesktopLayer: () => layer,
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { DesktopStage, TrayFrame } = await import("../src/renderer/src/components/ChipTray");
const { TraySettingRows } = await import("../src/renderer/src/components/TraySettings");
const { hideTray, useTray } = await import("../src/renderer/src/lib/trayStore");
const { TRAY_BAND_PX, TRAY_HANDLE_PX, trayPlacement } = await import("../src/renderer/src/lib/trayModel");
const { DEFAULT_TRAY_PREFS, setTrayPrefs, useTrayPrefs } = await import("../src/renderer/src/lib/trayPrefs");
const { setTrayPins } = await import("../src/renderer/src/lib/trayPins");
const { registerPagePin } = await import("../src/renderer/src/lib/pagePins");
const { pickerMenu } = await import("../src/renderer/src/modules/home/Tiles");
const { useApp } = await import("../src/renderer/src/store");
type TrayPins = import("../src/renderer/src/lib/trayPins").TrayPins;
type HomePin = import("../src/shared/home").HomePin;

/** A pin list keeper with nothing pinned (useDockCount 0) — like `home` on a fresh machine. */
const emptyEntry = {
  moduleId: "fake",
  mode: "show",
  missing: [],
  item: {
    id: "fake.desktop",
    Desktop: () => h("div", { "data-fake-desk": "" }),
    useShowWhenEmpty: () => true,
    useDockCount: () => 0,
    Dock: () => h("span", { "data-fake-dock": "" }),
  },
} as never;
/** A `pane.desktop` item without a Dock (a layer that keeps no pin list). */
const noDockEntry = { moduleId: "fake", mode: "show", missing: [], item: { id: "fake.plain", Desktop: () => h("div") } } as never;

const nothing = { fullWindow: false, framed: false, sessionId: null as string | null, page: false, firstRun: false, desktopShown: false };
const panes = { ...nothing, sessionId: "eva" };

let root: ReturnType<typeof createRoot> | null = null;
let host: HTMLDivElement;
function render(input: typeof nothing, entry: unknown = emptyEntry) {
  act(() => root!.render(h(TrayFrame, {}, h("div", { "data-fake-row": "" }, h(DesktopStage, { entry: entry as never, input, hostId: "local", children: () => h("div", { "data-fake-work": "" }) })))));
}
const q = (sel: string) => host.querySelector<HTMLElement>(sel);

const pinned: string[] = [];
function keeper(): TrayPins {
  return {
    isPinned: () => false,
    pin: async () => true,
    unpin: async () => true,
    pickerEntries: async () => [{ label: "home.picker.agents", submenu: [{ label: "Eva", onSelect: () => void pinned.push("eva") }], onSelect: () => {} }],
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  hideTray();
  localStorage.clear();
  useTrayPrefs.setState({ ...DEFAULT_TRAY_PREFS });
  menus.length = 0;
  pinned.length = 0;
  layer = emptyEntry;
  setTrayPins(keeper());
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  setTrayPins(null);
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("the rule: a pin list makes a tray even when empty", () => {
  const base = { items: 0, fullWindow: false, persistent: true, desktopOn: false, revealed: false };
  it("canPin: docked with 托盘常驻, the handle without it (revealed: over the panes); a full-window page: none", () => {
    expect(trayPlacement({ ...base, canPin: true })).toBe("docked");
    expect(trayPlacement({ ...base, canPin: true, persistent: false })).toBe("handle");
    expect(trayPlacement({ ...base, canPin: true, persistent: false, revealed: true })).toBe("overlay");
    expect(trayPlacement({ ...base, canPin: true, persistent: false, desktopOn: true })).toBe("docked");
    expect(trayPlacement({ ...base, canPin: true, fullWindow: true })).toBe("none");
  });
  it("no pin list and nothing collapsed: no tray (as before)", () => {
    expect(trayPlacement(base)).toBe("none");
    expect(trayPlacement({ ...base, canPin: false })).toBe("none");
  });
});

describe("托盘常驻 on, nothing pinned: the band is there", () => {
  it("panes in front: docked at the bottom with 「＋ 固定」 and the muted hint; no Dock drawn", () => {
    render(panes);
    const band = q("[data-tray-band]")!;
    expect(band.dataset.trayBand).toBe("docked");
    expect(band.style.height).toBe(`${TRAY_BAND_PX}px`);
    expect(q("[data-tray-frame]")!.dataset.trayAt).toBe("bottom");
    const pin = q("[data-tray-pin]")!;
    expect(pin.tagName).toBe("BUTTON");
    expect(pin.textContent).toBe("pane.tray.pin");
    expect(pin.getAttribute("aria-haspopup")).toBe("menu");
    expect(q("[data-tray-hint]")!.textContent).toBe("pane.tray.emptyHint");
    expect(q("[data-fake-dock]")).toBeNull();
  });

  it("the desktop on screen: the same empty band", () => {
    render(nothing);
    expect(q("[data-pane-tray]")!.dataset.paneTray).toBe("docked");
    expect(q("[data-tray-pin]")).not.toBeNull();
  });

  it("docked left / right: just the ＋ (no label, no hint line), the hint in the tray's ⓘ (040 §2.1)", () => {
    setTrayPrefs({ edge: "left" });
    render(panes);
    expect(q("[data-tray-band]")!.style.width).toBe(`${TRAY_BAND_PX}px`);
    const pin = q("[data-tray-pin]")!;
    expect(pin.textContent).toBe("");
    expect(pin.dataset.tip).toBe("pane.tray.pinTitle");
    expect(q("[data-info-mark]")!.dataset.tip).toContain("pane.tray.emptyHint");
    expect(pin.getAttribute("aria-label")).toBe("pane.tray.pinTitle");
    expect(q("[data-tray-hint]")).toBeNull();
  });

  it("「＋ 固定」 opens the keeper's picker anchored to the tray; choosing an entry pins it", async () => {
    render(panes);
    const pin = q("[data-tray-pin]")!;
    await act(async () => pin.click());
    expect(menus).toHaveLength(1);
    expect(menus[0]!.el).toBe(pin);
    const agents = menus[0]!.entries.find((e) => e.label === "home.picker.agents")!;
    act(() => agents.submenu![0]!.onSelect());
    expect(pinned).toEqual(["eva"]);
  });

  it("Ctrl+J puts the focus on 「＋ 固定」", () => {
    render(panes);
    act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "j", code: "KeyJ", ctrlKey: true, bubbles: true })));
    expect(document.activeElement?.hasAttribute("data-tray-pin")).toBe(true);
  });

  it("no keeper registered yet: the hint shows, no ＋ (nothing to open)", () => {
    setTrayPins(null);
    render(panes);
    expect(q("[data-tray-band]")).not.toBeNull();
    expect(q("[data-tray-pin]")).toBeNull();
    expect(q("[data-tray-hint]")).not.toBeNull();
  });
});

describe("托盘常驻 off, nothing pinned: the handle shows anyway", () => {
  beforeEach(() => setTrayPrefs({ persistent: false }));

  it("panes in front: the handle in its thin band; a click reveals the empty tray with 「＋ 固定」", () => {
    render(panes);
    expect(q("[data-tray-handle]")).not.toBeNull();
    expect(q("[data-tray-band]")!.style.height).toBe(`${TRAY_HANDLE_PX}px`);
    act(() => q("[data-tray-handle]")!.click());
    expect(useTray.getState().revealed).toBe(true);
    expect(q("[data-pane-tray]")!.dataset.paneTray).toBe("overlay");
    expect(q("[data-tray-pin]")).not.toBeNull();
  });
});

describe("the tray frame's settings menu", () => {
  it.each([
    ["background", "[data-pane-tray]", true],
    ["grip", "[data-tray-grip]", true],
    ["handle", "[data-tray-handle]", false],
  ] as const)("%s opens tray settings or the usual all-settings entry", (_name, selector, persistent) => {
    setTrayPrefs({ persistent });
    render(panes);
    const openSettings = vi.spyOn(useApp.getState(), "openSettings").mockImplementation(() => {});
    try {
      const target = q(selector)!;
      act(() => void target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 42, clientY: 73 })));
      // The grip handles its own event: the background must not open a second menu.
      expect(menus).toHaveLength(1);
      expect(menus[0]!.el).toBe(target);
      // …then 「使用小指南」 (lib/panelGuides) after a separator.
      const [tray, all, sep, guide] = menus[0]!.entries.slice(-4);
      expect(sep as unknown).toBe("separator");
      expect(guide!.label).toBeTruthy();
      expect(tray!.label).toBeTruthy();
      expect(all!.label).toBe("settings.panel.menu.all");
      act(() => tray!.onSelect());
      expect(openSettings).toHaveBeenLastCalledWith("tray", undefined);
      act(() => all!.onSelect());
      expect(openSettings).toHaveBeenLastCalledWith();
      expect(openSettings).toHaveBeenCalledTimes(2);
    } finally {
      openSettings.mockRestore();
    }
  });
});

describe("no pin list (the desktop layer's module off)", () => {
  it("no `pane.desktop` item, or one without a Dock, and nothing collapsed: no tray, with or without 托盘常驻", () => {
    render(panes, null);
    expect(q("[data-tray-band]")).toBeNull();
    render(panes, noDockEntry);
    expect(q("[data-tray-band]")).toBeNull();
    act(() => setTrayPrefs({ persistent: false }));
    expect(q("[data-tray-band]")).toBeNull();
  });

  it("the 托盘常驻 row says why (and does not with a pin list)", () => {
    act(() => root!.render(h(TraySettingRows)));
    expect(q("[data-tray-no-pins]")).toBeNull();
    layer = null;
    act(() => root!.render(h(TraySettingRows, { key: "again" })));
    expect(q("[data-tray-no-pins]")!.textContent).toBe("pane.tray.noPinList");
    layer = noDockEntry;
    act(() => root!.render(h(TraySettingRows, { key: "third" })));
    expect(q("[data-tray-no-pins]")).not.toBeNull();
  });
});

describe("the picker (home: desktop tile and empty tray share it)", () => {
  const state = (features: string[]) =>
    useApp.setState({
      hosts: null,
      daemon: { kind: "connected" } as never,
      features: new Set(features),
      featuresKnown: true,
      services: [{ slug: "grafana", displayName: "Grafana" }] as never,
      sidebar: { active: [{ cutexSessionId: "s-eva", displayName: "Eva" }], retired: [], projects: { projects: [] } } as never,
    });

  it("services, agents, artifacts; Project 视图 page pins only where the home host keeps page pins", async () => {
    const off = registerPagePin({ id: "project-view", titleKey: "project-view.title", usePin: () => ({ name: "", icon: () => null, needs: 0, dim: false }), open: () => true, candidates: () => [{ hostId: "local", arg: "p1", title: "Apollo" }] });
    const added: HomePin[] = [];
    const target = { isPinned: (p: HomePin) => p.key === "grafana", add: (p: HomePin) => void added.push(p) };
    const t = (k: string) => k;
    try {
      state(["user-home"]);
      let entries = (await pickerMenu(target, t as never)) as Entry[];
      expect(entries.map((e) => e.label)).toEqual(["home.picker.services", "home.picker.agents", "home.picker.artifacts"]);
      // Already pinned: shown, disabled.
      expect(entries[0]!.submenu![0]!.disabled).toBe(true);
      // Agents: the shared searchable picker (every agent, grouped by project), not a capped submenu.
      const agents = (entries[1] as unknown as { flyout: { props: { options: { value: string; label: string }[]; onPick(value: string): void } } }).flyout.props;
      const eva = agents.options.find((o) => o.label === "Eva")!;
      agents.onPick(eva.value);
      expect(added).toEqual([{ hostId: "local", kind: "agent", key: "s-eva", title: "Eva" }]);

      state(["user-home", "user-home-page-pins"]);
      entries = (await pickerMenu(target, t as never)) as Entry[];
      const pages = entries.find((e) => e.label === "project-view.title")!;
      expect(pages.submenu!.map((e) => e.label)).toEqual(["Apollo"]);
      pages.submenu![0]!.onSelect();
      expect(added.at(-1)).toEqual({ hostId: "local", kind: "page", key: "project-view:p1", title: "Apollo" });
    } finally {
      off();
    }
  });
});

describe("perf audit 2026-10-23 #28: the Dock is not drawn again when only the frame is", () => {
  it("TrayFrame re-rendering (its room follows the cards on every resize step) leaves the Dock's items alone", () => {
    let docks = 0;
    const counting = { ...(emptyEntry as { item: object }), item: { ...(emptyEntry as { item: object }).item, useDockCount: () => 2, Dock: () => (docks++, h("span", { "data-fake-dock": "" })) } };
    layer = counting;
    render(panes, counting);
    expect(q("[data-fake-dock]")).not.toBeNull();
    const before = docks;
    for (let i = 0; i < 5; i++) render(panes, counting);
    expect(docks).toBe(before);
  });
});
