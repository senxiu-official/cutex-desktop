// @vitest-environment jsdom
// The work area's bottom layer and the tray, rendered (components/ChipTray DesktopStage + TrayFrame; canvas
// principles §7, contract 1.20; owner 2026-10-21): the desktop layer's box stays mounted behind the panes
// (covered: inert, its content not drawn — the window's background, test/deskGaps.test.tsx, shows through).
// The tray is a panel in its own band at an edge of the work area: 托盘常驻 (default) = the strip is always
// there and the work row gets the rest (nothing overlaps a pane); off = a small handle while panes cover
// the desktop, which a rest on it / a click / Ctrl+J reveal over the panes, Esc or a click on an item hides.
// It docks at the bottom, top, left or right (vertical on the sides), by its grip (drop zones) or its menu,
// remembered on this machine.
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
const menus: { entries: { label: string; submenu?: { label: string; onSelect(): void }[]; onSelect(): void }[] }[] = [];
vi.mock("../src/renderer/src/lib/trayMenu", () => ({ openTrayMenu: (_el: unknown, entries: never) => menus.push({ entries }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { DesktopStage, TrayFrame } = await import("../src/renderer/src/components/ChipTray");
const { hideTray, useTray, useTrayDrag } = await import("../src/renderer/src/lib/trayStore");
const { TRAY_BAND_PX, TRAY_EDGE_DWELL_MS, TRAY_HANDLE_PX } = await import("../src/renderer/src/lib/trayModel");
const { DEFAULT_TRAY_PREFS, reloadTrayPrefs, setTrayPrefs, TRAY_PREFS_KEY, useTrayPrefs } = await import("../src/renderer/src/lib/trayPrefs");

const used = vi.fn();
const entry = {
  moduleId: "fake",
  mode: "show",
  missing: [],
  item: {
    id: "fake.desktop",
    Desktop: ({ reason, tray }: { reason: string; tray?: boolean }) => h("div", { "data-fake-desk": reason, "data-fake-tray": tray ? "1" : "0" }),
    useShowWhenEmpty: () => true,
    useDockCount: () => 2,
    Dock: ({ placement, onUsed }: { placement: string; onUsed(): void }) =>
      h(
        "span",
        { "data-fake-dock": placement },
        ["a", "b"].map((k) => h("button", { key: k, "data-tray-item": "", "data-fake-item": k, onClick: () => (used(k), onUsed()) }, k)),
      ),
  },
} as never;

const nothing = { fullWindow: false, framed: false, sessionId: null as string | null, page: false, firstRun: false, desktopShown: false };

let root: ReturnType<typeof createRoot> | null = null;
let host: HTMLDivElement;
function render(input: typeof nothing, hidden = false) {
  act(() =>
    root!.render(
      h(TrayFrame, { hidden }, h("div", { "data-fake-row": "" }, h(DesktopStage, { entry, input, hostId: "local", children: (reason: string | null) => h("div", { "data-fake-work": reason ?? "panes" }) }))),
    ),
  );
}
const q = (sel: string) => host.querySelector<HTMLElement>(sel);
const panes = { ...nothing, sessionId: "eva" };

beforeEach(() => {
  vi.useFakeTimers();
  hideTray();
  localStorage.clear();
  useTrayPrefs.setState({ ...DEFAULT_TRAY_PREFS });
  used.mockClear();
  menus.length = 0;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("DesktopStage", () => {
  it("nothing in front: the desktop shows, no empty pane is drawn over it; the tray is in its band, not over the content", () => {
    render(nothing);
    expect(q("[data-pane-desktop]")!.dataset.paneDesktop).toBe("empty");
    expect(q("[data-pane-desktop]")!.hasAttribute("inert")).toBe(false);
    // 托盘常驻 at the bottom (#36): the tray card floats over the desktop's bottom — its content keeps clear (tray).
    expect(q("[data-fake-desk]")!.dataset.fakeTray).toBe("1");
    expect(q("[data-fake-work]")!.dataset.fakeWork).toBe("empty");
    expect(q("[data-pane-tray]")!.dataset.paneTray).toBe("docked");
    expect(q("[data-fake-dock]")!.dataset.fakeDock).toBe("desktop");
    expect(q("[data-pane-desk-stage]")!.contains(q("[data-pane-tray]"))).toBe(false);
    expect(q("[data-pane-desk-stage]")!.hasAttribute("data-desk-on")).toBe(true);
  });

  it("a pane in front: the layer's box stays mounted, covered and inert, its content not drawn", () => {
    render(panes);
    const layer = q("[data-pane-desktop]")!;
    expect(layer.dataset.paneDesktop).toBe("covered");
    expect(layer.hasAttribute("inert")).toBe(true);
    expect(layer.getAttribute("aria-hidden")).toBe("true");
    expect(q("[data-fake-desk]")).toBeNull();
    expect(q("[data-fake-work]")!.dataset.fakeWork).toBe("panes");
  });

  it("the layer's box is the same whether it shows, is covered, or the tray is revealed over it", () => {
    setTrayPrefs({ persistent: false });
    render(nothing);
    const shown = q("[data-pane-desktop]")!.className;
    render(panes);
    const coveredClass = q("[data-pane-desktop]")!.className;
    act(() => q("[data-tray-handle]")!.click());
    expect(q("[data-pane-tray]")!.dataset.paneTray).toBe("overlay");
    expect(q("[data-pane-desktop]")!.className).toBe(coveredClass);
    expect(coveredClass).toBe(shown);
    expect(shown).toContain("absolute inset-0");
  });

  it("a full-window page or the Settings Shelf maximised: no layer / no tray", () => {
    render({ ...nothing, fullWindow: true });
    expect(q("[data-pane-desktop]")).toBeNull();
    expect(q("[data-tray-band]")).toBeNull();
    render(panes, true);
    expect(q("[data-tray-band]")).toBeNull();
  });
});

describe("托盘常驻 (default on): a strip in its own band, the panes shrink by it", () => {
  it("follows a card resize and an animated move before the callback returns (no stale tray frame)", () => {
    let left = 100;
    const rect = (x: number, y: number, width: number, height: number) => ({ left: x, top: y, right: x + width, bottom: y + height, x, y, width, height, toJSON() {} }) as DOMRect;
    const bounds = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute("data-conv-card") ? rect(left, 20, 600, 720) : rect(0, 0, 1000, 800);
    });
    const observers: { cb: ResizeObserverCallback; els: Set<Element> }[] = [];
    vi.stubGlobal("ResizeObserver", class {
      rec: (typeof observers)[number];
      constructor(cb: ResizeObserverCallback) { this.rec = { cb, els: new Set() }; observers.push(this.rec); }
      observe(el: Element) { this.rec.els.add(el); }
      unobserve(el: Element) { this.rec.els.delete(el); }
      disconnect() { this.rec.els.clear(); }
    });
    const frames = new Map<number, FrameRequestCallback>();
    let seq = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => (frames.set(++seq, cb), seq));
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    try {
      act(() => root!.render(h(TrayFrame, null,
        h("section", { "data-conv-card": "" }),
        h(DesktopStage, { entry, input: panes, hostId: "local", children: () => null }),
      )));
      const tray = q('[data-tray-band="room"]')!;
      expect(tray.style.left).toBe("100px");
      left = 140;
      act(() => {
        const card = q("[data-conv-card]")!;
        for (const o of observers) if (o.els.has(card)) o.cb([{ target: card } as unknown as ResizeObserverEntry], {} as ResizeObserver);
        expect(tray.style.left).toBe("140px");
      });
      left = 180;
      act(() => {
        for (const [id, cb] of [...frames]) { frames.delete(id); cb(16); }
        expect(tray.style.left).toBe("180px");
      });
    } finally {
      act(() => root?.unmount());
      root = null;
      bounds.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("panes in front: the dock stays docked in a band beside the work row (not inside it, not over it)", () => {
    render(panes);
    const frame = q("[data-tray-frame]")!;
    const band = q("[data-tray-band]")!;
    const row = q("[data-fake-row]")!;
    expect(band.dataset.trayBand).toBe("docked");
    expect(q("[data-pane-tray]")!.dataset.paneTray).toBe("docked");
    expect(q("[data-tray-handle]")).toBeNull();
    // Siblings in a flex column: the band takes its height from the frame, the work row gets the rest.
    expect(band.parentElement).toBe(frame);
    expect(row.parentElement).toBe(frame);
    expect(row.contains(band)).toBe(false);
    expect(frame.className).toContain("flex-col");
    expect(band.style.height).toBe(`${TRAY_BAND_PX}px`);
    expect(band.className).toContain("tray-band");
  });

  it("Ctrl+J puts the focus in it (nothing to reveal)", () => {
    render(panes);
    act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "j", code: "KeyJ", ctrlKey: true, bubbles: true })));
    expect(useTray.getState().revealed).toBe(false);
    expect(document.activeElement?.getAttribute("data-fake-item")).toBe("a");
  });

  it("the work row keeps its place in the tree when the tray moves or hides (the panes are not remounted)", () => {
    render(panes);
    const row = q("[data-fake-row]")!;
    act(() => setTrayPrefs({ edge: "left" }));
    act(() => setTrayPrefs({ edge: "top" }));
    act(() => setTrayPrefs({ persistent: false }));
    expect(q("[data-fake-row]")).toBe(row);
  });
});

describe("auto-hide (托盘常驻 off): a clickable handle", () => {
  beforeEach(() => setTrayPrefs({ persistent: false }));

  it("panes in front: a pill handle in a thin band (a button, labelled), no dock", () => {
    render(panes);
    const handle = q("[data-tray-handle]")!;
    expect(handle.tagName).toBe("BUTTON");
    expect(handle.getAttribute("aria-label")).toBe("pane.tray.reveal");
    expect(handle.querySelector(".pane-tray-pill")).not.toBeNull();
    expect(q("[data-tray-band]")!.style.height).toBe(`${TRAY_HANDLE_PX}px`);
    expect(q("[data-pane-tray]")).toBeNull();
  });

  it("a click on the handle reveals the dock over the panes with the focus in it; Esc hides it", () => {
    render(panes);
    act(() => q("[data-tray-handle]")!.click());
    expect(q("[data-pane-tray]")!.dataset.paneTray).toBe("overlay");
    // The band does not grow: the panes do not move.
    expect(q("[data-tray-band]")!.style.height).toBe(`${TRAY_HANDLE_PX}px`);
    act(() => vi.advanceTimersByTime(20));
    expect(document.activeElement?.getAttribute("data-fake-item")).toBe("a");
    act(() => q('[data-fake-item="a"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(q("[data-pane-tray]")).toBeNull();
    expect(q("[data-tray-handle]")).not.toBeNull();
  });

  it("resting on the handle reveals it after a short dwell; a click on an item opens it and hides the tray", () => {
    render(panes);
    act(() => q("[data-tray-handle]")!.dispatchEvent(new MouseEvent("pointerover", { bubbles: true })));
    act(() => vi.advanceTimersByTime(TRAY_EDGE_DWELL_MS + 5));
    expect(useTray.getState().revealed).toBe(true);
    expect(q("[data-fake-dock]")!.dataset.fakeDock).toBe("overlay");
    act(() => q('[data-fake-item="b"]')!.click());
    expect(used).toHaveBeenCalledWith("b");
    expect(useTray.getState().revealed).toBe(false);
    expect(q("[data-pane-tray]")).toBeNull();
  });

  it("Ctrl+J reveals it; the desktop coming back ends the reveal (docked in its band again)", () => {
    render(panes);
    act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "j", code: "KeyJ", ctrlKey: true, bubbles: true })));
    expect(q("[data-pane-tray]")!.dataset.paneTray).toBe("overlay");
    render(nothing);
    expect(useTray.getState().revealed).toBe(false);
    expect(q("[data-pane-tray]")!.dataset.paneTray).toBe("docked");
  });

  it("the handle's right-click menu can turn 托盘常驻 back on", () => {
    render(panes);
    act(() => void q("[data-tray-handle]")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    const persistent = menus.at(-1)!.entries.find((e) => e.label === "pane.tray.persistent")!;
    act(() => void persistent.onSelect());
    expect(useTrayPrefs.getState().persistent).toBe(true);
    expect(q("[data-pane-tray]")!.dataset.paneTray).toBe("docked");
  });
});

describe("docked at an edge", () => {
  it("left / right: vertical, beside the work row (a flex row), width = the band; ↑ / ↓ move between items", () => {
    act(() => setTrayPrefs({ edge: "right" }));
    render(panes);
    const frame = q("[data-tray-frame]")!;
    expect(frame.dataset.trayAt).toBe("right");
    expect(frame.className).toContain("flex-row");
    expect(q("[data-tray-band]")!.style.width).toBe(`${TRAY_BAND_PX}px`);
    const dock = q("[data-pane-tray]")!;
    expect(dock.getAttribute("aria-orientation")).toBe("vertical");
    expect(dock.hasAttribute("data-vertical")).toBe(true);
    act(() => q('[data-fake-item="a"]')!.focus());
    act(() => void q('[data-fake-item="a"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    expect(document.activeElement?.getAttribute("data-fake-item")).toBe("b");
    act(() => setTrayPrefs({ edge: "top" }));
    expect(frame.className).toContain("flex-col");
    expect(q("[data-pane-tray]")!.getAttribute("aria-orientation")).toBe("horizontal");
  });

  it("停靠在… in its menu (the grip's click or the dock's background) docks it there", () => {
    render(panes);
    act(() => q("[data-tray-grip]")!.click());
    const dockAt = menus.at(-1)!.entries.find((e) => e.label === "pane.tray.dockAt")!;
    expect(dockAt.submenu!.map((e) => e.label)).toEqual(["pane.tray.edge.bottom", "pane.tray.edge.top", "pane.tray.edge.left", "pane.tray.edge.right"]);
    act(() => void dockAt.submenu![2]!.onSelect());
    expect(q("[data-tray-frame]")!.dataset.trayAt).toBe("left");
    act(() => void q("[data-pane-tray]")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    act(() => void menus.at(-1)!.entries[0]!.submenu![0]!.onSelect());
    expect(q("[data-tray-frame]")!.dataset.trayAt).toBe("bottom");
  });

  it("dragging the grip: the four edges light up as drop zones, the nearest one is the target; let go = docked there", () => {
    render(panes);
    const frame = q("[data-tray-frame]")!;
    frame.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1600, bottom: 1000, width: 1600, height: 1000, x: 0, y: 0, toJSON: () => ({}) });
    const grip = q("[data-tray-grip]")!;
    act(() => void grip.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 800, clientY: 980 })));
    act(() => void window.dispatchEvent(new MouseEvent("pointermove", { clientX: 1580, clientY: 500 })));
    expect(useTrayDrag.getState().target).toBe("right");
    expect([...host.querySelectorAll("[data-tray-zone]")].map((z) => (z as HTMLElement).dataset.trayZone)).toEqual(["bottom", "top", "left", "right"]);
    expect(q("[data-tray-zone][data-on]")!.dataset.trayZone).toBe("right");
    act(() => void window.dispatchEvent(new MouseEvent("pointerup", {})));
    expect(q("[data-tray-drop]")).toBeNull();
    expect(useTrayPrefs.getState().edge).toBe("right");
    expect(frame.dataset.trayAt).toBe("right");
    // The click that ends a drag opens no menu.
    act(() => grip.click());
    expect(menus.length).toBe(0);
  });

  it("Esc cancels a drag: the tray stays where it was", () => {
    render(panes);
    const grip = q("[data-tray-grip]")!;
    q("[data-tray-frame]")!.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1600, bottom: 1000, width: 1600, height: 1000, x: 0, y: 0, toJSON: () => ({}) });
    act(() => void grip.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 800, clientY: 980 })));
    act(() => void window.dispatchEvent(new MouseEvent("pointermove", { clientX: 20, clientY: 500 })));
    expect(q("[data-tray-zone][data-on]")!.dataset.trayZone).toBe("left");
    act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(q("[data-tray-drop]")).toBeNull();
    expect(useTrayPrefs.getState().edge).toBe("bottom");
  });
});

describe("remembered on this machine", () => {
  it("the edge and 托盘常驻 are stored locally and read back", () => {
    setTrayPrefs({ edge: "top", persistent: false });
    expect(JSON.parse(localStorage.getItem(TRAY_PREFS_KEY)!)).toEqual({ edge: "top", persistent: false, allowThreeColumns: false, twoRows: false });
    useTrayPrefs.setState({ ...DEFAULT_TRAY_PREFS });
    reloadTrayPrefs();
    expect(useTrayPrefs.getState()).toEqual({ persistent: false, edge: "top", allowThreeColumns: false, twoRows: false });
    localStorage.setItem(TRAY_PREFS_KEY, "not json");
    reloadTrayPrefs();
    expect(useTrayPrefs.getState()).toEqual(DEFAULT_TRAY_PREFS);
  });
});
