// @vitest-environment jsdom
// Owner report 2026-10-21 (real app, two workspaces, the focused one's Shelf expanded with an agent page and
// Project 视图): (1) the page drew outside its pane, over the other workspace; (2) the expanded Shelf overlapped
// the other workspace's column; (3) dragging a width made the panels fly out and back; (4) the 搜索 / 书签 / 批注
// strip wrapped into a stack over the text of a narrow column.
// Root cause of (1)–(2): SideWorkArea measured the row once, on the element mounted first; one and two
// workspaces render different roots, so after a second workspace opened it kept observing a detached div — the
// row was laid out for a stale (or 0 = "not measured") width and the instance layer never saw the work area
// move. Plus: the instances are now cut to their pane / Shelf / work row (lib/sideSlots slotBox) and follow
// boxes that move without resizing; the row never needs more than the work area; a Shelf's handle stops where
// the row would fold it; nothing glides while a width is dragged or the area changes width; the top strip is
// one row beside / over the column (the timeline starts below it) or one compact button.
import { act, createElement as h, useContext } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
}));
const ctx = { hostId: "local", sessionId: "eva", workspaceKey: null, available: () => true };
vi.mock("../src/renderer/src/lib/sideComponents", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSideView: () => ctx,
  sideViewNow: () => ctx,
  useSideRegistry: () => new Map(),
  sideRegistry: () => new Map(),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import type { SessionResource } from "@cutex-desktop/protocol";
import type { SideBinding } from "../src/renderer/src/modules/slots";
import type { ItemId } from "../src/renderer/src/modules/types";
import { applyOpen, CARD_GAP, COLLAPSED_SHELF_WIDTH, emptyLayout, place, placeSpec, RAIL_WIDTH, shelvesOf, SINGLETON_KEY, type SideLayout } from "../src/renderer/src/lib/sideLayout";
import { defaultLayout, openBeside, focusPane, conversationPanes } from "../src/renderer/src/lib/paneLayout";
import { usePanes } from "../src/renderer/src/lib/paneStore";
import { useSide } from "../src/renderer/src/lib/sideLayoutStore";
import { useApp } from "../src/renderer/src/store";
import * as appearance from "../src/renderer/src/lib/appearance";
import { DEFAULT_APPEARANCE } from "../src/renderer/src/lib/appearanceModel";
import { WsRowContext } from "../src/renderer/src/lib/workspaceRowView";
import { expandedBox, workspaceRow, type RowInput, type RowOut, type WorkspaceWidthMode } from "../src/renderer/src/lib/workspaceRow";
import { WS_CONVERSATION_MIN_W } from "../src/renderer/src/lib/workspaces";
import { intersectRect, slotBox } from "../src/renderer/src/lib/sideSlots";
import * as glide from "../src/renderer/src/lib/columnGlide";
import { gutterLayout, topStripMode } from "../src/renderer/src/lib/gutterLayout";
import { leadBand, reservedBands } from "../src/renderer/src/lib/timelineReserve";

const { SideWorkArea } = await import("../src/renderer/src/components/side/SideArea");
const { setRowReserve, setShelvesTaken, setSideWorkWidth, useSideWidthHandle } = await import("../src/renderer/src/lib/sideResize");

// ── (2) the row never takes more than the work area ──

/** The width the row takes on screen: shelves / rails / gaps as computed, flex columns at their share (never below their CSS minimum). */
function rowSpan(input: RowInput, out: RowOut): number {
  const n = input.workspaces.length;
  const fixed = out.workspaces.reduce((s, w, i) => s + w.shelves.reduce((a, x) => a + x.box, 0) + (input.workspaces[i]!.rail ? COLLAPSED_SHELF_WIDTH : 0), 0) + (n - 1) * CARD_GAP;
  const explicit = out.workspaces.reduce((s, w) => s + (w.width ?? 0), 0);
  const flex = out.workspaces.filter((w) => w.width === null).length;
  // Flex columns (PaneHost: flex-basis 0, min-width WS_CONVERSATION_MIN_W) share what is left, at least their minimum each.
  const left = Math.max(0, input.area - fixed - explicit);
  return fixed + explicit + (flex ? Math.max(flex * WS_CONVERSATION_MIN_W, left) : 0);
}

describe("(2) two workspaces never overlap: the row fits the work area at every width and state", () => {
  const modes: WorkspaceWidthMode[] = ["smart", "content", "fill"];
  const shelfWidths = [260, 420, 760, 1200, 1600];
  it("sweeps areas 400–4000 px × 智能 / 按内容 / 铺满 × 外侧 / 偏右 × Shelf widths × collapsed / other rail", () => {
    let checked = 0;
    for (let area = 400; area <= 4000; area += 23)
      for (const mode of modes)
        for (const placement of ["outer", "right"] as const)
          for (const width of shelfWidths)
            for (const collapsed of [false, true])
              for (const rail of [false, true])
                for (const want of [null, 600, 770, 1400]) {
                  const input: RowInput = {
                    area,
                    mode,
                    placement,
                    workspaces: [
                      { want, min: WS_CONVERSATION_MIN_W, rail: false, shelves: [{ id: "s1", side: "right", width, collapsed }] },
                      { want, min: WS_CONVERSATION_MIN_W, rail, shelves: [] },
                    ],
                  };
                  const out = workspaceRow(input);
                  const span = rowSpan(input, out);
                  if (span > area) throw new Error(`overlap at ${JSON.stringify({ area, mode, placement, width, collapsed, rail, want })}: ${span} > ${area} (${JSON.stringify(out)})`);
                  for (const w of out.workspaces) if (w.width !== null) expect(w.width).toBeGreaterThanOrEqual(0);
                  checked++;
                }
    expect(checked).toBeGreaterThan(10000);
  });

  it("the Shelf stays expanded only while both columns keep their minimum beside it, else it is drawn as its rail", () => {
    const at = (area: number) => workspaceRow({ area, mode: "smart", placement: "right", workspaces: [{ want: null, min: 300, rail: false, shelves: [{ id: "s1", side: "right", width: 420, collapsed: false }] }, { want: null, min: 300, rail: true, shelves: [] }] });
    const need = expandedBox(420) + COLLAPSED_SHELF_WIDTH + CARD_GAP + 600;
    expect(at(need).workspaces[0]!.shelves[0]!.expanded).toBe(true);
    expect(at(need - 1).workspaces[0]!.shelves[0]).toMatchObject({ expanded: false, forced: true, box: COLLAPSED_SHELF_WIDTH });
    // Not even the minimum beside the rails: the columns share what is left (explicit widths), nothing leaves the area.
    const tiny = at(500);
    expect(tiny.workspaces.map((w) => w.width)).toEqual([Math.floor((500 - 2 * COLLAPSED_SHELF_WIDTH - CARD_GAP) / 2), Math.floor((500 - 2 * COLLAPSED_SHELF_WIDTH - CARD_GAP) / 2)]);
  });
});

// ── (2) root cause: the row follows the element mounted now ──

let clock = 100;
const host: SideBinding = { kind: "host", hostId: "local" };
function withBrowser(l: SideLayout = emptyLayout()): SideLayout {
  const input = { kind: "browser.tab" as ItemId, binding: host, key: SINGLETON_KEY, state: { url: "https://example.com" } as never, v: 1, pinned: false };
  const decision = place(l, { ...input, transient: false, activePage: l.activePage, columnOpen: l.open }, placeSpec({ home: "browser" }));
  return applyOpen(l, decision, input, ++clock, { reveal: true, home: "browser" }).layout;
}
const session = (id: string, name: string) => ({ cutexSessionId: id, displayName: name, avatar: null, native: { threadId: null }, runtime: { status: "online" }, cwd: "" }) as unknown as SessionResource;

let root: Root;
let container: HTMLElement;
let area = 1600;
/** Every ResizeObserver made, with what it observes (the real browser keeps an observer on a detached element). */
let observers: { cb: () => void; els: Element[] }[] = [];
const q = (sel: string) => container.querySelector<HTMLElement>(sel);

function twoPanes(focused: 0 | 1) {
  let work = defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "eva" });
  work = openBeside(work, { hostId: "local", sessionId: "alden" }, 1);
  const panes = conversationPanes(work);
  work = focusPane(work, panes[focused]!, 2);
  usePanes.setState({ layout: work });
}
function Columns() {
  const row = useContext(WsRowContext);
  return h("i", { "data-row-widths": row ? row.widths.join(",") : "none" });
}
function render(split: { focused: number } | null) {
  act(() => root.render(h(SideWorkArea, { side: true, split, single: split ? null : "main", children: h(Columns) })));
}
/** The window resized: every observer reports (as a browser does, also for a removed element). */
function resizeTo(w: number) {
  area = w;
  act(() => {
    for (const o of observers) o.cb();
  });
}

describe("(1)(2) root cause: the work row is measured on the element on screen", () => {
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    area = 1600;
    observers = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        o: { cb: () => void; els: Element[] };
        constructor(cb: () => void) {
          this.o = { cb, els: [] };
          observers.push(this.o);
        }
        observe(el: Element) {
          this.o.els.push(el);
        }
        disconnect() {
          observers = observers.filter((x) => x !== this.o);
        }
        unobserve() {}
      },
    );
    // Like a browser: a removed element has no width.
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.isConnected && this.hasAttribute("data-side-work") ? area : 0;
    });
    localStorage.clear();
    useApp.setState({ selectedId: "eva", selectedHost: null, hosts: null, sidebar: { active: [session("eva", "Eva"), session("alden", "Alden")], retired: [], hostRows: {}, projects: null } as never });
    useSide.setState({ scope: "host:local", layout: withBrowser(), mode: null, narrow: false, liveWidth: {} });
    appearance.setAppearance({ ...DEFAULT_APPEARANCE }, false);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    appearance.setAppearance({ ...DEFAULT_APPEARANCE }, false);
  });

  it("a second workspace opens (a new row element): the window narrowing is still seen — the Shelf gives way instead of overlapping", () => {
    usePanes.setState({ layout: defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "eva" }) });
    render(null);
    const first = q("[data-side-work]");
    twoPanes(0);
    render({ focused: 0 });
    const row = q("[data-side-work]")!;
    expect(row).not.toBe(first);
    expect(row.dataset.wsArea).toBe("1600");
    // Observed now: the row on screen (not the removed one).
    expect(observers.some((o) => o.els.includes(row))).toBe(true);
    expect(observers.some((o) => o.els.includes(first!))).toBe(false);
    const box = () => Number.parseFloat(q("[data-ws-shelf-box]")!.style.width);
    expect(box()).toBe(expandedBox(DEFAULT_APPEARANCE.sidePaneWidth));
    // Narrower than both columns' minimum beside the expanded Shelf: it shows as its rail (before: the row kept
    // 1600 or 0 = "not measured" and drew the Shelf expanded across the other workspace). 宽度规则 4 (owner
    // 2026-10-21): a window resize stores nothing — the Shelf is still expanded, back as soon as there is room.
    resizeTo(1000);
    expect(q("[data-side-work]")!.dataset.wsArea).toBe("1000");
    expect(box()).toBe(COLLAPSED_SHELF_WIDTH);
    expect(shelvesOf(useSide.getState().layout)[0]!.collapsed).toBeFalsy();
    resizeTo(1600);
    expect(box()).toBe(expandedBox(DEFAULT_APPEARANCE.sidePaneWidth));
  });

  it("a removed row never reports its 0 width as the work area", () => {
    usePanes.setState({ layout: defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "eva" }) });
    render(null);
    twoPanes(0);
    render({ focused: 0 });
    resizeTo(1700);
    expect(q("[data-side-work]")!.dataset.wsArea).toBe("1700");
  });
});

// ── (2)/(3) a Shelf's handle stops where the row would fold it ──

describe("a Shelf dragged beside two workspaces stops at both columns' minimum", () => {
  it("clamps to the work area minus the other Shelf, the second column, the gap, the seam and the other rail", () => {
    useSide.setState({ scope: "host:local", layout: withBrowser(), mode: null, narrow: false, liveWidth: {} });
    const id = shelvesOf(useSide.getState().layout)[0]!.id;
    let handle: ReturnType<typeof useSideWidthHandle> | null = null;
    function Probe() {
      handle = useSideWidthHandle(() => 420 + RAIL_WIDTH, { shelfId: id, side: "right" });
      return null;
    }
    const el = document.createElement("div");
    document.body.appendChild(el);
    const r = createRoot(el);
    act(() => r.render(h(Probe)));
    const area = 1500;
    const rail = COLLAPSED_SHELF_WIDTH;
    setSideWorkWidth(area);
    setShelvesTaken(0, 0);
    setRowReserve(2 * WS_CONVERSATION_MIN_W + 2 * CARD_GAP + rail - 360);
    const target = { setPointerCapture() {}, setAttribute() {}, removeAttribute() {} };
    const ev = (x: number) => ({ button: 0, clientX: x, pointerId: 1, preventDefault() {}, stopPropagation() {}, currentTarget: target }) as never;
    act(() => handle!.onPointerDown(ev(1000)));
    expect(glide.resizing()).toBe(true);
    act(() => handle!.onPointerMove(ev(0)));
    const w = useSide.getState().liveWidth[id]!;
    // What the row then holds: the Shelf expanded beside both columns at their minimum, nothing folds.
    const out = workspaceRow({ area, mode: "smart", placement: "right", workspaces: [{ want: null, min: WS_CONVERSATION_MIN_W, rail: false, shelves: [{ id, side: "right", width: w, collapsed: false }] }, { want: null, min: WS_CONVERSATION_MIN_W, rail: true, shelves: [] }] });
    expect(out.workspaces[0]!.shelves[0]!.expanded).toBe(true);
    expect(area - expandedBox(w) - rail - CARD_GAP).toBeGreaterThanOrEqual(2 * WS_CONVERSATION_MIN_W);
    act(() => handle!.onPointerUp(ev(0)));
    setRowReserve(0);
    setSideWorkWidth(0);
    act(() => r.unmount());
    el.remove();
  });
});

// ── (3) nothing glides while a width is dragged ──

describe("(3) the columns glide only for discrete layout changes", () => {
  function scene() {
    glide.resetColumnGlide();
    const work = document.createElement("div");
    const col = document.createElement("div");
    col.dataset.glide = "main";
    work.appendChild(col);
    document.body.appendChild(work);
    const box = { left: 175, width: 770 };
    col.getBoundingClientRect = () => ({ ...box, top: 0, height: 100, right: box.left + box.width, bottom: 100, x: box.left, y: 0, toJSON() {} }) as DOMRect;
    const animate = vi.fn();
    (col as unknown as { animate: unknown }).animate = animate;
    glide.noteColumns(work);
    return { work, box, animate };
  }

  it("a width drag (any handle): every step only takes its new place; the release too; a discrete change afterwards glides", () => {
    vi.useFakeTimers();
    const { work, box, animate } = scene();
    glide.resizeDrag(true);
    for (let i = 1; i <= 5; i++) {
      box.left = 175 - i * 20;
      box.width = 770 - i * 20;
      glide.glideColumns(work);
    }
    expect(animate).not.toHaveBeenCalled();
    // A pointer released anywhere ends it (a handle that lost its capture), the stored width right after is still the drag.
    window.dispatchEvent(new Event("pointerup"));
    expect(glide.resizing()).toBe(true);
    box.left = 70;
    glide.glideColumns(work);
    expect(animate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(glide.resizing()).toBe(false);
    // A Shelf opening / a second workspace: glides from where it was.
    box.left = 0;
    box.width = 600;
    glide.glideColumns(work);
    expect(animate).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("the work area changing width (window resize, the sidebar dragged): the caller passes still", () => {
    const { work, box, animate } = scene();
    box.left = 100;
    glide.glideColumns(work, true);
    expect(animate).not.toHaveBeenCalled();
  });
});

// ── (1) instances are cut to their pane / Shelf / work row ──

describe("(1) an instance paints only inside its pane, its Shelf and the work row", () => {
  beforeEach(() => {
    vi.stubGlobal("innerWidth", 2400);
    vi.stubGlobal("innerHeight", 1200);
  });
  afterEach(() => vi.unstubAllGlobals());
  const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} }) as DOMRect;
  function tree() {
    const work = document.createElement("div");
    work.setAttribute("data-side-work", "");
    const shelf = document.createElement("div");
    shelf.setAttribute("data-shelf-box", "right");
    const card = document.createElement("div");
    card.setAttribute("data-side-card", "c1");
    const slot = document.createElement("div");
    card.appendChild(slot);
    shelf.appendChild(card);
    work.appendChild(shelf);
    document.body.appendChild(work);
    work.getBoundingClientRect = () => rect(264, 40, 1336, 900);
    shelf.getBoundingClientRect = () => rect(670, 40, 468, 900);
    card.getBoundingClientRect = () => rect(678, 40, 420, 900);
    return { work, shelf, card, slot };
  }

  it("a placeholder wider than its pane (the row out of step) is clipped to the pane, never over the next column", () => {
    const { work, slot } = tree();
    slot.getBoundingClientRect = () => rect(684, 80, 900, 400);
    const box = slotBox(slot)!;
    expect(box.rect).toEqual({ left: 684, top: 80, width: 900, height: 400 });
    expect(box.clip).toEqual({ left: 684, top: 80, width: 414, height: 400 });
    work.remove();
  });

  it("a hidden Shelf / pane (collapsed, covered by a maximised panel) or a cut-away placeholder shows nothing", () => {
    const { work, shelf, slot } = tree();
    slot.getBoundingClientRect = () => rect(684, 80, 400, 400);
    expect(slotBox(slot)!.clip).toEqual({ left: 684, top: 80, width: 400, height: 400 });
    shelf.hidden = true;
    expect(slotBox(slot)).toBeNull();
    shelf.hidden = false;
    slot.getBoundingClientRect = () => rect(1700, 80, 400, 400);
    expect(slotBox(slot)).toBeNull();
    work.remove();
  });

  it("clips to an ancestor that clips its overflow and to the window", () => {
    const { work, card, slot } = tree();
    card.style.overflow = "hidden";
    card.getBoundingClientRect = () => rect(678, 100, 420, 200);
    slot.getBoundingClientRect = () => rect(684, 80, 400, 400);
    expect(slotBox(slot)!.clip).toEqual({ left: 684, top: 100, width: 400, height: 200 });
    vi.stubGlobal("innerWidth", 900);
    expect(slotBox(slot)!.clip).toEqual({ left: 684, top: 100, width: 216, height: 200 });
    work.remove();
    expect(intersectRect({ left: 0, top: 0, width: 10, height: 10 }, { left: 20, top: 0, width: 5, height: 5 })).toMatchObject({ width: 0 });
  });
});

// ── (4) the top strip never wraps over the text ──

describe("(4) 搜索 / 书签 / 批注: one row beside the column, over it (the timeline below), or one compact button", () => {
  const geo = (card: number, reading = 760) => gutterLayout({ cardWidth: card, sideCover: 0, readingWidth: reading, columnPadding: 24, capsule: null, conversationVisible: true });
  it("wide column with a gutter: beside; a full-width column: one row over its top; a narrow one: compact", () => {
    expect(topStripMode({ side: "left", natural: 220, cardWidth: 1400, geometry: geo(1400) })).toBe("beside");
    expect(topStripMode({ side: "left", natural: 220, cardWidth: 556, geometry: geo(556) })).toBe("row");
    expect(topStripMode({ side: "left", natural: 220, cardWidth: 350, geometry: geo(350) })).toBe("compact");
    // A gutter too narrow for it: not beside (it would cross the text).
    expect(topStripMode({ side: "left", natural: 220, cardWidth: 900, geometry: geo(900) })).toBe("row");
  });

  it("the timeline starts below a strip over the column (in flow), not under it; beside the column it takes nothing", () => {
    const frame = { left: 0, top: 100, right: 556, bottom: 900 };
    const column = { left: 24, top: 100, right: 532, bottom: 2000 };
    expect(leadBand(frame, column, [{ left: 8, top: 108, right: 240, bottom: 144 }])).toBe(44);
    expect(leadBand(frame, { left: 400, top: 100, right: 1000, bottom: 2000 }, [{ left: 8, top: 108, right: 240, bottom: 144 }])).toBe(0);
    // The overlays' band is still measured from the scroller (the capsule): independent of the lead.
    expect(reservedBands({ left: 0, top: 150, right: 556, bottom: 900 }, column, [{ left: 8, top: 108, right: 240, bottom: 144 }]).top).toBe(0);
  });
});
