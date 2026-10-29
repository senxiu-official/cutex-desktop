// @vitest-environment jsdom
// Owner 2026-10-24 (option A of .claude/previews/preview-tray-pin-reorder.html): the tray's pinned agents move along
// their group — a drag with a blue insertion line (release = move, the home list's order), refused over 最近 / the
// apps (release cancels), 「… N」 unfolds after a 0.5 s rest; 左移 / 右移 and Alt+← / → one step (greyed / refused at
// the ends); every move offers 撤销. Drops on conversations / Shelves / edges stay the workspace drag's.
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
const menus = vi.hoisted(() => ({ last: [] as { label?: string; disabled?: boolean; onSelect?: () => void }[] }));
vi.mock("../src/renderer/src/lib/trayMenu", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  openTrayMenu: (_el: unknown, entries: never[]) => void (menus.last = entries),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import type { HomeDoc, HomePin } from "../src/shared/home";
import { pinId, withPinBefore, withPinMoved } from "../src/renderer/src/modules/home/model";
import { dropSpot, insertIndex, pinnedDragLocal, stepTarget, UNFOLD_MS, useTrayDropMarks } from "../src/renderer/src/modules/home/trayReorder";
import { startWorkspaceDrag, useWorkspaceDrag } from "../src/renderer/src/lib/workspaces";
import { undoShelfToast, useShelfToast } from "../src/renderer/src/lib/shelves";

const { HomeDock } = await import("../src/renderer/src/modules/home/Dock");

const agent = (key: string): HomePin => ({ hostId: "local", kind: "agent", key, title: key.toUpperCase() });
const app: HomePin = { hostId: "local", kind: "service", key: "svc" };
const order = (doc: Partial<HomeDoc>) => ((doc.pins ?? []) as HomePin[]).map((p) => p.key);
const box = (left: number, width = 36) => ({ left, top: 0, width, height: 36 });

describe("withPinBefore / stepTarget (pure)", () => {
  const doc = { pins: [agent("e"), agent("x"), agent("h"), app] } as unknown as HomeDoc;
  it("moves a pin before another, or to the end of its kind (agents stay before the apps)", () => {
    expect(order(withPinBefore(doc, pinId(agent("x")), pinId(agent("e"))))).toEqual(["x", "e", "h", "svc"]);
    expect(order(withPinBefore(doc, pinId(agent("e")), null))).toEqual(["x", "h", "e", "svc"]);
    expect(withPinBefore(doc, pinId(agent("x")), pinId(agent("h")))).toBe(doc); // already right before h
    expect(withPinBefore(doc, pinId(agent("x")), pinId(agent("x")))).toBe(doc);
  });
  it("one step left / right, nothing past the ends", () => {
    const ids = ["e", "x", "h"];
    expect(stepTarget(ids, "x", -1)).toBe("e");
    expect(stepTarget(ids, "x", 1)).toBeNull(); // after h = the end
    expect(stepTarget(ids, "e", 1)).toBe("h");
    expect(stepTarget(ids, "e", -1)).toBeUndefined();
    expect(stepTarget(ids, "h", 1)).toBeUndefined();
  });
  it("the insertion spot follows the pointer; past the drawn ones it goes before the first folded one", () => {
    expect(insertIndex([box(0), box(40), box(80)], 50, 10, false)).toBe(1);
    expect(insertIndex([box(0), box(40), box(80)], 120, 10, false)).toBe(3);
    const entries = [
      { id: "e", box: box(0) },
      { id: "x", box: box(40) },
      { id: "h", box: null }, // folded into 「… N」
    ];
    expect(dropSpot(entries, 10, 10, false)!.beforeId).toBe("e");
    expect(dropSpot(entries, 200, 10, false)!.beforeId).toBe("h");
    expect(dropSpot(entries.slice(0, 2), 200, 10, false)!.beforeId).toBeNull();
  });
  it("托盘两排: the row under the pointer counts, then x within it; past the first row the line stands after its last item", () => {
    const at = (left: number, top: number) => ({ left, top, width: 32, height: 40 });
    // row 1: a b c (top 0), row 2: d e (top 42)
    const boxes = [at(0, 0), at(40, 0), at(80, 0), at(0, 42), at(40, 42)];
    expect(insertIndex(boxes, 50, 60, false)).toBe(4); // row 2, past d
    expect(insertIndex(boxes, 10, 60, false)).toBe(3); // row 2, before d
    expect(insertIndex(boxes, 10, 10, false)).toBe(0);
    expect(insertIndex(boxes, 200, 10, false)).toBe(3); // past the first row
    expect(insertIndex(boxes, 200, 60, false)).toBe(5);
    expect(insertIndex(boxes, 50, 200, false)).toBe(4); // below the rows: the nearest
    const entries = ["a", "b", "c", "d", "e"].map((id, i) => ({ id, box: boxes[i]! }));
    const end1 = dropSpot(entries, 200, 10, false)!;
    expect(end1.beforeId).toBe("d");
    expect(end1.line).toEqual({ left: 112, top: 0, width: 3, height: 40 });
    const row2 = dropSpot(entries, 50, 60, false)!;
    expect(row2.beforeId).toBe("e");
    expect(row2.line.top).toBe(42);
  });
});

/** A tray in the DOM: pinned E X H, 最近 M, 「… 1」; elementsFromPoint answers by x. */
function trayDom() {
  document.body.innerHTML = `
    <div data-pane-tray="docked">
      <span data-tray-group="pinned">
        <span class="tray-slot" data-tray-entry="e"></span><span class="tray-slot" data-tray-entry="x"></span><span class="tray-slot" data-tray-entry="h"></span>
      </span>
      <span data-tray-group="recent"><span class="tray-slot"></span></span>
      <button data-tray-more aria-expanded="false"></button>
    </div>`;
  const at: Record<string, number> = { e: 0, x: 40, h: 80 };
  for (const el of document.querySelectorAll<HTMLElement>("[data-tray-entry]")) {
    const left = at[el.dataset.trayEntry!]!;
    el.getBoundingClientRect = () => ({ ...box(left), right: left + 36, bottom: 36, x: left, y: 0, toJSON() {} }) as DOMRect;
    el.getClientRects = () => [el.getBoundingClientRect()] as unknown as DOMRectList;
  }
  const recent = document.querySelector<HTMLElement>('[data-tray-group="recent"]')!;
  recent.getBoundingClientRect = () => ({ ...box(140, 60), right: 200, bottom: 36, x: 140, y: 0, toJSON() {} }) as DOMRect;
  const more = document.querySelector<HTMLButtonElement>("[data-tray-more]")!;
  more.addEventListener("click", () => more.setAttribute("aria-expanded", more.getAttribute("aria-expanded") === "true" ? "false" : "true"));
  const pinned = document.querySelector('[data-tray-group="pinned"]')!;
  document.elementsFromPoint = ((x: number) => {
    if (x < 130) return [[...document.querySelectorAll("[data-tray-entry]")].find((el) => x < at[(el as HTMLElement).dataset.trayEntry!]! + 40) ?? pinned];
    if (x < 220) return [recent.firstElementChild!];
    if (x < 260) return [more];
    return [document.body];
  }) as typeof document.elementsFromPoint;
  return { more };
}

describe("the drag's local target", () => {
  it("over the pinned group: a line and a drop before the entry under the pointer", () => {
    trayDom();
    const move = vi.fn();
    const local = pinnedDragLocal("x", move);
    expect(local.over(110, 10)).toEqual({ take: "drop", action: "Move" });
    expect(useTrayDropMarks.getState().line).toMatchObject({ left: 116 });
    local.drop();
    expect(move).toHaveBeenCalledWith(null);
    local.end();
    expect(useTrayDropMarks.getState()).toEqual({ line: null, tip: null, refuse: null, accept: null });
  });

  it("over 最近: a refusal box, and a release moves nothing", () => {
    trayDom();
    const move = vi.fn();
    const local = pinnedDragLocal("x", move);
    expect(local.over(160, 10)?.take).toBe("refuse");
    expect(useTrayDropMarks.getState().refuse?.text).toMatch(/Recent sorts by time/);
    local.drop();
    expect(move).not.toHaveBeenCalled();
    local.end();
  });

  it("resting on 「… N」 unfolds it after 0.5 s; the drag's end folds it again", () => {
    vi.useFakeTimers();
    try {
      const { more } = trayDom();
      const local = pinnedDragLocal("x", vi.fn());
      local.over(240, 10);
      vi.advanceTimersByTime(UNFOLD_MS - 50);
      expect(more.getAttribute("aria-expanded")).toBe("false");
      local.over(241, 10);
      vi.advanceTimersByTime(60);
      expect(more.getAttribute("aria-expanded")).toBe("true");
      local.end();
      expect(more.getAttribute("aria-expanded")).toBe("false");
    } finally {
      vi.useRealTimers();
    }
  });

  it("startWorkspaceDrag: a local drop replaces the workspace outcome; a local refusal cancels the release", () => {
    for (const take of ["drop", "refuse"] as const) {
      document.body.innerHTML = "<div></div>";
      document.elementsFromPoint = (() => []) as typeof document.elementsFromPoint;
      const local = { over: vi.fn(() => ({ take, action: "a" })), drop: vi.fn(), end: vi.fn() };
      const down = new PointerEvent("pointerdown", { button: 0, clientX: 0, clientY: 0 });
      startWorkspaceDrag({ kind: "agent", hostId: "local", key: "x" }, down, { local });
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 20, clientY: 0 }));
      expect(useWorkspaceDrag.getState().tone).toBe(take === "drop" ? "project" : "refuse");
      window.dispatchEvent(new PointerEvent("pointerup", { clientX: 20, clientY: 0 }));
      expect(local.drop).toHaveBeenCalledTimes(take === "drop" ? 1 : 0);
      expect(local.end).toHaveBeenCalledTimes(1);
      expect(useWorkspaceDrag.getState().ref).toBeNull();
    }
  });
});

describe("HomeDock: menu, Alt+arrows and 撤销", () => {
  let root: Root;
  let host: HTMLDivElement;
  beforeEach(() => {
    home.state.doc = { pins: [agent("e"), agent("x"), agent("h"), app] };
    useShelfToast.setState({ toast: null });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(h(HomeDock, { placement: "desktop", onUsed: () => {} } as never)));
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });
  const button = (key: string) => [...host.querySelectorAll<HTMLElement>("[data-tray-entry]")].find((el) => el.dataset.trayEntry === pinId(agent(key)))!.querySelector<HTMLElement>("[data-tray-item]")!;
  const menuOf = (key: string) => {
    act(() => button(key).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 1, clientY: 1 })));
    return menus.last;
  };

  it("左移 / 右移 are in the menu, greyed at the ends; one moves one step and offers 撤销", async () => {
    const first = menuOf("e");
    expect(first.find((m) => m.label === "tray.moveLeft")?.disabled).toBe(true);
    expect(first.find((m) => m.label === "tray.moveRight")?.disabled).toBe(false);
    expect(menuOf("h").find((m) => m.label === "tray.moveRight")?.disabled).toBe(true);
    await act(async () => menuOf("h").find((m) => m.label === "tray.moveLeft")!.onSelect!());
    expect(order(home.state.doc)).toEqual(["e", "h", "x", "svc"]);
    expect(useShelfToast.getState().toast?.text).toBe("tray.moved:H");
    await act(async () => undoShelfToast());
    expect(order(home.state.doc)).toEqual(["e", "x", "h", "svc"]);
  });

  it("Alt+← / → move the focused pinned entry; past the end nothing happens", async () => {
    await act(async () => void button("e").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", altKey: true, bubbles: true })));
    expect(order(home.state.doc)).toEqual(["x", "e", "h", "svc"]);
    await act(async () => void button("h").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", altKey: true, bubbles: true })));
    expect(order(home.state.doc)).toEqual(["x", "e", "h", "svc"]);
    // Plain arrows stay the tray's focus keys: no move.
    await act(async () => void button("x").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(order(home.state.doc)).toEqual(["x", "e", "h", "svc"]);
  });

  it("the undo of a move uses the home list's own order (withPinMoved back to where it was)", () => {
    const doc = { pins: [agent("e"), agent("x"), agent("h")] } as unknown as HomeDoc;
    const moved = withPinBefore(doc, pinId(agent("e")), null);
    expect(order(withPinMoved(moved, pinId(agent("e")), 0))).toEqual(["e", "x", "h"]);
  });
});
