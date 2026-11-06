// @vitest-environment jsdom
// The tray's divider pin (owner 2026-10-24 「图钉 + 拖动」, section 4 of .claude/previews/preview-tray-notes-badges.html
// v2): no pushpin on each pinned item any more — ONE pushpin stuck into the divider after the pinned group, out of
// the icon row (owner 2026-10-24: up, on the line's left near its top, no slot of its own);
// dragging a 最近 entry across the divider pins it where it lands, dragging a pinned one onto 最近 unpins it; both offer
// 撤销. With nothing pinned, a drag of a 最近 entry shows an empty pinned slot (with the pushpin) to drop on.
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
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import type { HomePin } from "../src/shared/home";
import { pinId } from "../src/renderer/src/modules/home/model";
import { trayDragLocal, useTrayDragFrom, useTrayDropMarks } from "../src/renderer/src/modules/home/trayReorder";
import { useWorkspaceSets } from "../src/renderer/src/lib/workspaceSets";
import { undoShelfToast, useShelfToast } from "../src/renderer/src/lib/shelves";

const { HomeDock } = await import("../src/renderer/src/modules/home/Dock");

const agent = (key: string): HomePin => ({ hostId: "local", kind: "agent", key, title: key.toUpperCase() });
const row = (key: string) => ({ hostId: "local", key, id: key, name: key.toUpperCase(), session: { cutexSessionId: key, displayName: key.toUpperCase(), note: null } });
const order = () => ((home.state.doc.pins ?? []) as HomePin[]).map((p) => p.key);
const rect = (left: number, width = 40) => ({ left, top: 0, width, height: 40, right: left + width, bottom: 40, x: left, y: 0, toJSON() {} }) as DOMRect;
const place = (el: Element, left: number, width = 40) => {
  (el as HTMLElement).getBoundingClientRect = () => rect(left, width);
  (el as HTMLElement).getClientRects = () => [rect(left, width)] as unknown as DOMRectList;
};

let root: Root;
let host: HTMLDivElement;
const render = () => act(() => root.render(h(HomeDock, { placement: "desktop", onUsed: () => {} } as never)));
beforeEach(() => {
  rows.list = ["e", "x", "m"].map(row);
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
  useTrayDragFrom.setState({ from: null });
});

const item = (name: string) => [...host.querySelectorAll<HTMLElement>("[data-tray-item]")].find((el) => el.getAttribute("aria-label")?.startsWith(name))!;
const entry = (key: string) => [...host.querySelectorAll<HTMLElement>("[data-tray-entry]")].find((el) => el.dataset.trayEntry === pinId(agent(key)))!;
const group = (key: string) => host.querySelector<HTMLElement>(`[data-tray-group="${key}"]`);

/** A drag of `source` that ends over `target` (elementsFromPoint answers `target` everywhere). */
async function dragOnto(source: HTMLElement, target: () => Element) {
  document.elementsFromPoint = (() => [target()]) as typeof document.elementsFromPoint;
  await act(async () => void source.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 100, clientY: 20 })));
  await act(async () => void window.dispatchEvent(new PointerEvent("pointermove", { clientX: 6, clientY: 20 })));
  // The drag started (the Dock may have drawn a drop slot): the pointer moves on.
  await act(async () => void window.dispatchEvent(new PointerEvent("pointermove", { clientX: 5, clientY: 20 })));
  const during = { slot: !!host.querySelector("[data-tray-drop-slot]"), marks: useTrayDropMarks.getState() };
  await act(async () => void window.dispatchEvent(new PointerEvent("pointerup", { clientX: 5, clientY: 20 })));
  return during;
}

describe("one pushpin on the divider", () => {
  it("pinned items carry no pin of their own; one pushpin is stuck into the divider after them, no slot of its own", () => {
    expect(host.querySelector("[data-tray-pinmark], .tray-pinmark")).toBeNull();
    for (const slot of host.querySelectorAll(".tray-slot")) expect(slot.querySelector(".tray-pushpin")).toBeNull();
    const pins = host.querySelectorAll("[data-tray-pin-edge]");
    expect(pins).toHaveLength(1);
    const pin = pins[0] as HTMLElement;
    expect(pin.querySelector(".tray-pushpin")).not.toBeNull();
    expect(pin.dataset.tip).toBe("tray.pin.tip");
    expect(pin.tagName).not.toBe("BUTTON");
    // Inside the divider (positioned on it), not a flow item of the row.
    const sep = pin.parentElement!;
    expect(sep.classList.contains("tray-sep")).toBe(true);
    expect(sep.hasAttribute("data-tray-sep-pinned")).toBe(true);
    expect(sep.previousElementSibling).toBeNull();
    expect(sep.nextElementSibling?.getAttribute("data-tray-group")).toBe("recent");
    expect(host.querySelectorAll(".tray-sep:not([data-tray-sep-pinned]) [data-tray-pin-edge]")).toHaveLength(0);
  });

  it("nothing pinned: no pushpin (until a drag needs it)", () => {
    home.state.doc = { pins: [] };
    render();
    expect(host.querySelector("[data-tray-pin-edge]")).toBeNull();
  });
});

describe("drag across the divider", () => {
  it("a 最近 entry dropped on a pinned one is pinned before it; 撤销 takes the pin away", async () => {
    place(entry("e"), 0);
    place(entry("x"), 44);
    const during = await dragOnto(item("M"), () => entry("e"));
    expect(during.marks.line).not.toBeNull();
    expect(during.marks.tip).toBe("Pin here");
    expect(order()).toEqual(["m", "e", "x"]);
    expect(useShelfToast.getState().toast?.text).toBe("tray.pinned:M");
    expect(group("pinned")!.querySelectorAll("[data-tray-entry]")).toHaveLength(3);
    await act(async () => undoShelfToast());
    expect(order()).toEqual(["e", "x"]);
  });

  it("dropped on the divider's pushpin: pinned at the end of the pinned group", async () => {
    place(entry("e"), 0);
    place(entry("x"), 44);
    await dragOnto(item("M"), () => host.querySelector("[data-tray-pin-edge]")!);
    expect(order()).toEqual(["e", "x", "m"]);
  });

  it("a pinned entry dropped on 最近 is unpinned (the group takes it whole); 撤销 pins it back where it was", async () => {
    place(group("recent")!, 120, 60);
    const during = await dragOnto(item("E"), () => group("recent")!.querySelector(".tray-slot")!);
    expect(during.marks.accept?.text).toBe("Unpin");
    expect(order()).toEqual(["x"]);
    expect(useShelfToast.getState().toast?.text).toBe("home.dock.unpinned:E");
    // It stays in the tray, under 最近.
    expect(item("E").closest("[data-tray-group]")?.getAttribute("data-tray-group")).toBe("recent");
    await act(async () => undoShelfToast());
    expect(order()).toEqual(["e", "x"]);
  });

  it("the apps still refuse; a release there changes nothing", async () => {
    home.state.doc = { pins: [agent("e"), { hostId: "local", kind: "url", key: "https://example.com/", title: "Board" }] };
    render();
    place(group("apps")!, 200, 40);
    const during = await dragOnto(item("E"), () => group("apps")!.querySelector(".tray-slot")!);
    expect(during.marks.refuse?.text).toMatch(/Apps/);
    expect(order()).toEqual(["e", "https://example.com/"]);
  });

  it("nothing pinned yet: dragging a 最近 entry shows an empty pinned slot with the pushpin; dropping there pins it", async () => {
    home.state.doc = { pins: [] };
    render();
    const during = await dragOnto(item("M"), () => {
      const slot = host.querySelector('[data-tray-group="pinned"][data-tray-drop-slot]');
      if (slot) place(slot, 0);
      return slot ?? document.body;
    });
    expect(during.slot).toBe(true);
    expect(during.marks.tip).toBe("Pin here");
    expect(order()).toEqual(["m"]);
    // The slot goes with the drag.
    expect(host.querySelector("[data-tray-drop-slot]")).toBeNull();
  });
});

describe("trayDragLocal (pure-ish)", () => {
  it("a 最近 entry over 最近 is left to the workspace drag", () => {
    document.body.innerHTML = `<div data-pane-tray><span data-tray-group="recent"><span class="tray-slot"></span></span></div>`;
    document.elementsFromPoint = (() => [document.querySelector(".tray-slot")!]) as typeof document.elementsFromPoint;
    const pin = vi.fn();
    const local = trayDragLocal({ id: "m", from: "recent", pin });
    expect(local.over(1, 1)).toBeNull();
    local.drop();
    expect(pin).not.toHaveBeenCalled();
    local.end();
  });
});
