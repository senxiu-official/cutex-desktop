// @vitest-environment jsdom
// The desk as the drop target of a tray avatar (owner 2026-10-24, modules/home/deskDrop; the tray's side is in
// trayDesktopIcons.test.tsx): while it shows, the spot under the pointer is the icon's box on the unit grid, the drop
// adds the icon there (the box stored in the band, 撤销 takes the icon away), the dashed hint is drawn in that box,
// and an icon's menu says 从桌面移除, which leaves the tray's pin alone.
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
const i18n = vi.hoisted(() => ({ t: (key: string, v?: Record<string, unknown>) => (v?.name ? `${key}:${v.name}` : key), locale: "zh-CN" }));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({ ...(await importOriginal<object>()), useI18n: () => i18n }));
const slot = vi.hoisted(() => ({ kinds: [] as unknown[] }));
vi.mock("../src/renderer/src/modules/react", async (importOriginal) => ({ ...(await importOriginal<object>()), useSlot: () => slot.kinds }));
const home = vi.hoisted(() => {
  const state = { doc: {} as Record<string, unknown>, listeners: new Set<() => void>() };
  const update = async (edit: (d: unknown) => unknown) => {
    state.doc = edit(state.doc) as Record<string, unknown>;
    for (const l of state.listeners) l();
    return true;
  };
  return { state, update, source: () => ({ hostId: "local", entry: { doc: state.doc }, update }) };
});
vi.mock("../src/renderer/src/modules/home/hooks", async (importOriginal) => {
  const react = await import("react");
  return {
    ...(await importOriginal<object>()),
    useHomeSource: () => {
      const [, bump] = react.useState(0);
      react.useEffect(() => {
        const l = () => bump((n) => n + 1);
        home.state.listeners.add(l);
        return () => void home.state.listeners.delete(l);
      }, []);
      return home.source();
    },
  };
});
// The tile kind's 从桌面移除 writes through the home store of the source host.
vi.mock("../src/renderer/src/modules/home/store", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  homeStore: () => ({ update: (_host: string, edit: (d: unknown) => unknown) => home.update(edit) }),
}));
const menus = vi.hoisted(() => ({ last: [] as unknown[] }));
vi.mock("../src/renderer/src/lib/contextMenu", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  contextMenu: (build: () => unknown[]) => () => void (menus.last = build()),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import type { HomeDoc, HomePin } from "../src/shared/home";
import type { DesktopWidgetItem } from "../src/renderer/src/modules/widgetTypes";
import { deskIconsOf, pinId, pinsOf } from "../src/renderer/src/modules/home/model";
import { deskDropTarget, useDeskDropHint } from "../src/renderer/src/modules/home/deskDrop";
import { HOME_WIDGETS, TILE_WIDGET, tileInstanceId } from "../src/renderer/src/modules/home/widgets";
import { PITCH } from "../src/renderer/src/modules/home/deskCells";
import { undoShelfToast, useShelfToast } from "../src/renderer/src/lib/shelves";

const { DeskSurface } = await import("../src/renderer/src/modules/home/DeskSurface");

const agent = (key: string): HomePin => ({ hostId: "local", kind: "agent", key, title: key.toUpperCase() });
const doc = () => home.state.doc as HomeDoc;
const keysOf = (pins: readonly HomePin[]) => pins.map((p) => p.key);

let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1300 });
  const tile = HOME_WIDGETS.find((k) => k.id === TILE_WIDGET)!;
  slot.kinds = [{ moduleId: "home", mode: "show", missing: [], waiting: false, item: { ...tile, Widget: () => null } as DesktopWidgetItem }];
  home.state.doc = { pins: [agent("e")], deskIcons: [] };
  useShelfToast.setState({ toast: null });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(h(DeskSurface)));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
  useDeskDropHint.setState({ hint: null });
});

const overDesk = () => {
  const area = host.querySelector(".desk-area")!;
  document.elementsFromPoint = (() => [area]) as typeof document.elementsFromPoint;
};

describe("the desk takes a tray avatar", () => {
  it("the spot under the pointer is the icon's box (centred on the pointer, on whole units); not over the desk: none", () => {
    overDesk();
    // (jsdom: the grid's box is at 0, 0.)
    expect(deskDropTarget()!.spot(agent("m"), 6.5 * PITCH, 4.5 * PITCH)).toEqual({ cells: { x: 6, y: 4, w: 2, h: 2 }, already: false });
    // Off the left / top edge: clamped into the grid.
    expect(deskDropTarget()!.spot(agent("m"), 0, 0)!.cells).toMatchObject({ x: 0, y: 0 });
    document.elementsFromPoint = (() => [document.body]) as typeof document.elementsFromPoint;
    expect(deskDropTarget()!.spot(agent("m"), 400, 300)).toBeNull();
  });

  it("the drop adds the icon in that box (the tray's pins stay); 撤销 takes the icon away", async () => {
    overDesk();
    const target = deskDropTarget()!;
    const spot = target.spot(agent("m"), 6.5 * PITCH, 4.5 * PITCH)!;
    await act(async () => target.drop(agent("m"), spot, "M"));
    expect(keysOf(deskIconsOf(doc()))).toEqual(["m"]);
    expect(keysOf(pinsOf(doc()))).toEqual(["e"]);
    const tile = host.querySelector<HTMLElement>(`[data-desk-widget="${CSS.escape(tileInstanceId(agent("m")))}"]`)!;
    expect(tile.style.left).toBe(`${6 * PITCH}px`);
    expect(tile.style.top).toBe(`${4 * PITCH}px`);
    expect(useShelfToast.getState().toast?.text).toBe("home.desk.placed:M");
    await act(async () => undoShelfToast());
    expect(deskIconsOf(doc())).toEqual([]);
  });

  it("an icon already there moves to the spot (no second icon)", async () => {
    home.state.doc = { pins: [], deskIcons: [agent("m")] };
    act(() => root.render(h(DeskSurface)));
    overDesk();
    const target = deskDropTarget()!;
    const spot = target.spot(agent("m"), 10.5 * PITCH, 2.5 * PITCH)!;
    expect(spot.already).toBe(true);
    await act(async () => target.drop(agent("m"), spot, "M"));
    expect(keysOf(deskIconsOf(doc()))).toEqual(["m"]);
    expect(host.querySelector<HTMLElement>(`[data-desk-widget="${CSS.escape(tileInstanceId(agent("m")))}"]`)!.style.left).toBe(`${10 * PITCH}px`);
  });

  it("the drag's hint is drawn in the box, 「放到桌面」 above it", () => {
    act(() => useDeskDropHint.setState({ hint: { cells: { x: 2, y: 1, w: 2, h: 2 }, text: "放到桌面" } }));
    const hint = host.querySelector<HTMLElement>("[data-desk-drop-hint]")!;
    expect(hint.style.left).toBe(`${2 * PITCH}px`);
    expect(hint.textContent).toBe("放到桌面");
    act(() => useDeskDropHint.setState({ hint: null }));
    expect(host.querySelector("[data-desk-drop-hint]")).toBeNull();
  });

  it("an icon's menu: 从桌面移除, which leaves the tray's pin", async () => {
    home.state.doc = { pins: [agent("e")], deskIcons: [agent("e")] };
    act(() => root.render(h(DeskSurface)));
    const tile = host.querySelector<HTMLElement>(`[data-desk-widget="${CSS.escape(tileInstanceId(agent("e")))}"]`)!;
    act(() => tile.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })));
    const remove = (menus.last as { label?: string; onSelect?: () => void }[]).find((m) => m && m.label === "home.desk.remove")!;
    expect(remove).toBeTruthy();
    await act(async () => remove.onSelect!());
    expect(deskIconsOf(doc())).toEqual([]);
    expect(pinsOf(doc()).map(pinId)).toEqual([pinId(agent("e"))]);
  });

  it("withdraws as the drop target when it goes", () => {
    expect(deskDropTarget()).not.toBeNull();
    act(() => root.unmount());
    expect(deskDropTarget()).toBeNull();
    root = createRoot(host);
  });
});
