// @vitest-environment jsdom
// The tray's pins are not the desktop's icons (owner 2026-10-24: 「托盘里钉住的头像都显示在桌面上？我不想这样；桌面模式下可以
// 把托盘里的头像拖到桌面上变成图标」): a tray avatar — pinned or 最近 — dragged over the desktop while it shows offers
// 「放到桌面」 with a dashed box where its icon goes, and the release puts the icon there (modules/home/deskDrop);
// 放到桌面 on the avatar's menu is the keyboard way. The desk's own surface is tested in deskDrop.test.tsx.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
const i18n = vi.hoisted(() => ({ t: (key: string, v?: Record<string, unknown>) => (v?.name ? `${key}:${v.name}` : key), locale: "zh-CN" }));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({ ...(await importOriginal<object>()), useI18n: () => i18n }));
const home = vi.hoisted(() => {
  const state = { doc: { pins: [] as unknown[] } as Record<string, unknown>, listeners: new Set<() => void>() };
  return {
    state,
    source: () => ({
      hostId: "local",
      entry: { doc: state.doc },
      update: async (edit: (d: unknown) => unknown) => {
        state.doc = edit(state.doc) as Record<string, unknown>;
        for (const l of state.listeners) l();
        return true;
      },
    }),
  };
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
const rows = vi.hoisted(() => ({ list: [] as unknown[] }));
vi.mock("../src/renderer/src/lib/scopedSidebarView", () => ({
  useScopedSidebar: () => ({ model: { groups: [], chats: [] }, scope: { focus: "local" } }),
  useScopedAttention: () => ({ rows: rows.list, signals: new Map(), needs: new Map() }),
}));
vi.mock("../src/renderer/src/lib/trayPins", async (importOriginal) => ({ ...(await importOriginal<object>()), trayPinSupported: () => true }));
const menus = vi.hoisted(() => ({ last: [] as { label?: string; disabled?: boolean; onSelect?: () => void }[] }));
vi.mock("../src/renderer/src/lib/trayMenu", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  openTrayMenu: (_el: unknown, entries: never[]) => void (menus.last = entries),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import type { HomeDoc, HomePin } from "../src/shared/home";
import { deskIconsOf, pinId, pinsOf } from "../src/renderer/src/modules/home/model";
import { trayDragLocal, useTrayDragFrom } from "../src/renderer/src/modules/home/trayReorder";
import { setDeskDropTarget, useDeskDropHint, type DeskDropTarget, type DeskSpot } from "../src/renderer/src/modules/home/deskDrop";
import { useWorkspaceSets } from "../src/renderer/src/lib/workspaceSets";
import { undoShelfToast, useShelfToast } from "../src/renderer/src/lib/shelves";

const { HomeDock } = await import("../src/renderer/src/modules/home/Dock");

const agent = (key: string): HomePin => ({ hostId: "local", kind: "agent", key, title: key.toUpperCase() });
const row = (key: string) => ({ hostId: "local", key, id: key, name: key.toUpperCase(), session: { cutexSessionId: key, displayName: key.toUpperCase(), note: null } });
const keysOf = (pins: readonly HomePin[]) => pins.map((p) => p.key);
const doc = () => home.state.doc as HomeDoc;

/** A desk that takes every pointer: the spot is fixed, the drops are recorded. */
function fakeDesk(spot: DeskSpot | null = { cells: { x: 3, y: 1, w: 2, h: 2 }, already: false }) {
  const drops: { pin: HomePin; spot: DeskSpot; name: string }[] = [];
  const target: DeskDropTarget = { spot: () => spot, drop: (pin, s, name) => void drops.push({ pin, spot: s, name }) };
  const off = setDeskDropTarget(target);
  return { drops, off };
}

let root: Root;
let host: HTMLDivElement;
const render = () => act(() => root.render(h(HomeDock, { placement: "desktop", onUsed: () => {} } as never)));
beforeEach(() => {
  rows.list = ["e", "x", "m"].map(row);
  // A document from before the split: no desktop icon list yet (the desktop shows the pins).
  home.state.doc = { pins: [agent("e"), agent("x")] };
  useWorkspaceSets.setState({ sets: [{ id: "set-m", members: [{ hostId: "local", sessionId: "m" }], at: 1 }] });
  useShelfToast.setState({ toast: null });
  host = document.createElement("div");
  host.setAttribute("data-pane-tray", "docked");
  document.body.appendChild(host);
  root = createRoot(host);
  render();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  useTrayDragFrom.setState({ from: null });
  useDeskDropHint.setState({ hint: null });
});

const item = (name: string) => [...host.querySelectorAll<HTMLElement>("[data-tray-item]")].find((el) => el.getAttribute("aria-label")?.startsWith(name))!;
const menuOf = (name: string) => {
  act(() => item(name).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 1, clientY: 1 })));
  return menus.last;
};

/** A drag of `source` released over the desktop (`elementsFromPoint` answers a desk element everywhere). */
async function dragToDesk(source: HTMLElement) {
  const desk = document.createElement("div");
  desk.setAttribute("data-fake-desk", "");
  document.body.appendChild(desk);
  document.elementsFromPoint = (() => [desk]) as typeof document.elementsFromPoint;
  await act(async () => void source.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 100, clientY: 20 })));
  await act(async () => void window.dispatchEvent(new PointerEvent("pointermove", { clientX: 400, clientY: 300 })));
  await act(async () => void window.dispatchEvent(new PointerEvent("pointermove", { clientX: 401, clientY: 300 })));
  const hint = useDeskDropHint.getState().hint;
  await act(async () => void window.dispatchEvent(new PointerEvent("pointerup", { clientX: 401, clientY: 300 })));
  return { hint };
}

describe("dragging a tray avatar onto the desktop", () => {
  it("a pinned avatar: the dashed 「放到桌面」 box while over the desk; the release hands its pin to the desk; the tray is unchanged", async () => {
    const desk = fakeDesk();
    const { hint } = await dragToDesk(item("E"));
    expect(hint).toEqual({ cells: { x: 3, y: 1, w: 2, h: 2 }, text: "Put on desktop" });
    expect(desk.drops).toHaveLength(1);
    expect(pinId(desk.drops[0]!.pin)).toBe(pinId(agent("e")));
    expect(desk.drops[0]!.name).toBe("E");
    // The hint goes with the drag; the tray's pins stay.
    expect(useDeskDropHint.getState().hint).toBeNull();
    expect(keysOf(pinsOf(doc()))).toEqual(["e", "x"]);
    desk.off();
  });

  it("a 最近 avatar too (its own agent pin), without pinning it in the tray", async () => {
    const desk = fakeDesk();
    await dragToDesk(item("M"));
    expect(desk.drops.map((d) => pinId(d.pin))).toEqual([pinId({ hostId: "local", kind: "agent", key: "m" })]);
    expect(keysOf(pinsOf(doc()))).toEqual(["e", "x"]);
    desk.off();
  });

  it("no desktop showing (no drop target): nothing of the desk's", async () => {
    const { hint } = await dragToDesk(item("E"));
    expect(hint).toBeNull();
    expect(doc().deskIcons).toBeUndefined();
  });
});

describe("放到桌面 on the avatar's menu (the keyboard way)", () => {
  it("puts its icon on the desktop (the pins are copied in first, once); 撤销 takes it away; the tray is unchanged", async () => {
    // Before the split the pinned avatars show on the desktop: already there.
    const onE = menuOf("E").find((m) => m.label === "home.desk.onDesk");
    expect(onE?.disabled).toBe(true);
    const put = menuOf("M").find((m) => m.label === "home.desk.drop")!;
    expect(put.disabled).toBe(false);
    await act(async () => put.onSelect!());
    expect(keysOf(deskIconsOf(doc()))).toEqual(["e", "x", "m"]);
    expect(keysOf(pinsOf(doc()))).toEqual(["e", "x"]);
    expect(useShelfToast.getState().toast?.text).toBe("home.desk.placed:M");
    await act(async () => undoShelfToast());
    expect(keysOf(deskIconsOf(doc()))).toEqual(["e", "x"]);
  });

  it("unpinning in the tray afterwards leaves the icon on the desktop", () => {
    act(() => menuOf("E").find((m) => m.label === "home.unpin")!.onSelect!());
    expect(keysOf(pinsOf(doc()))).toEqual(["x"]);
    expect(keysOf(deskIconsOf(doc()))).toEqual(["e", "x"]);
  });
});

describe("trayDragLocal over the desk (pure-ish)", () => {
  const pin = agent("e");
  const deskEl = () => {
    document.body.innerHTML = `<div data-fake-desk></div>`;
    document.elementsFromPoint = (() => [document.querySelector("[data-fake-desk]")!]) as typeof document.elementsFromPoint;
  };

  it("takes the drop with 「放到桌面」 and the hint; the drop goes to the desk; end clears the hint", () => {
    deskEl();
    const desk = fakeDesk();
    const local = trayDragLocal({ id: pinId(pin), from: "pinned", move: vi.fn(), desk: { pin, name: "E" } });
    expect(local.over(400, 300)).toEqual({ take: "drop", action: "Put on desktop" });
    expect(useDeskDropHint.getState().hint?.cells).toEqual({ x: 3, y: 1, w: 2, h: 2 });
    local.drop();
    expect(desk.drops).toHaveLength(1);
    local.end();
    expect(useDeskDropHint.getState().hint).toBeNull();
    desk.off();
  });

  it("not over the desk (the desk answers no spot) or no icon to place: left to the workspace drag", () => {
    deskEl();
    const away = fakeDesk(null);
    expect(trayDragLocal({ id: "e", from: "pinned", desk: { pin, name: "E" } }).over(400, 300)).toBeNull();
    away.off();
    const desk = fakeDesk();
    expect(trayDragLocal({ id: "e", from: "pinned" }).over(400, 300)).toBeNull();
    desk.off();
  });

  it("the desk's left / right edge bands still open it beside (the workspace drag)", () => {
    deskEl();
    const work = document.createElement("div");
    work.setAttribute("data-side-work", "");
    work.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 600, right: 1000, bottom: 600, x: 0, y: 0, toJSON() {} }) as DOMRect;
    document.body.appendChild(work);
    const desk = fakeDesk();
    const local = trayDragLocal({ id: "e", from: "pinned", desk: { pin, name: "E" } });
    expect(local.over(10, 300)).toBeNull();
    expect(local.over(500, 300)?.action).toBe("Put on desktop");
    local.end();
    desk.off();
  });
});
