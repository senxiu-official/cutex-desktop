// @vitest-environment jsdom
// Owner report 2026-10-21: "when the whole WINDOW is resized, panels often fly around". Measured in the mock
// preview with headless Chrome (1920 → 1100 → 1920 in 20 px steps, ±10 px wobbles, fast jumps): folds for lack of
// room flipped at every pixel across their threshold and moved frame by frame (the Shelf box's width animation,
// the sidebar's width transition driving the row), the row and the instance layer were laid out a frame late
// (ResizeObserver → plain state update), a group left off centre by a drag jumped back to the centre on a 1 px
// resize, and a placeholder cut away entirely (a 1100 px window with the Settings Shelf open) sent the instance
// layer into an endless render loop (a blank window). The pure parts here; the rendered row: test/layoutRules
// (D), the Settings Shelf's keys: test/settingsShelf.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
}));
const view = { hostId: "local", sessionId: "eva", workspaceKey: null, available: () => true };
vi.mock("../src/renderer/src/lib/sideComponents", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSideView: () => view,
  sideViewNow: () => view,
  useSideRegistry: () => new Map(),
  sideRegistry: () => new Map(),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { FOLD_HYSTERESIS, foldHeld } from "../src/renderer/src/lib/foldHysteresis";
import { expandedBox, workspaceRow, type RowInput } from "../src/renderer/src/lib/workspaceRow";
import { sideFrame } from "../src/renderer/src/lib/sideFrame";
import { CARD_GAP, COLLAPSED_SHELF_WIDTH, MIN_CONVERSATION, MIN_SIDE, shelfRow } from "../src/renderer/src/lib/sideLayout";
import { sidebarAutoRail } from "../src/renderer/src/lib/workspaces";
import { keepLeadShare, pinnedLead, resetRowDrag, setPinnedLead, useRowDrag } from "../src/renderer/src/lib/rowDrag";
import * as glide from "../src/renderer/src/lib/columnGlide";
import { registerSideSlot, slotsRelayout } from "../src/renderer/src/lib/sideSlots";

const { SideInstanceLayer } = await import("../src/renderer/src/components/side/SideInstanceLayer");

describe("folds for lack of room keep a slack (no flapping at the threshold)", () => {
  it("foldHeld: short now, or folded before and within the slack", () => {
    const short = (area: number) => (slack: number) => area < 1000 + slack;
    expect(foldHeld(short(999), false)).toBe(true);
    expect(foldHeld(short(1000), false)).toBe(false);
    expect(foldHeld(short(1000), true)).toBe(true);
    expect(foldHeld(short(1000 + FOLD_HYSTERESIS - 1), true)).toBe(true);
    expect(foldHeld(short(1000 + FOLD_HYSTERESIS), true)).toBe(false);
  });

  const two = (area: number, held: boolean, mode: RowInput["mode"] = "fill"): RowInput => ({
    area,
    mode,
    placement: "outer",
    split: 0.5,
    held,
    workspaces: [
      { want: mode === "fill" ? null : 700, min: 300, rail: false, shelves: [{ id: "a", side: "right", width: 400, collapsed: false }] },
      { want: mode === "fill" ? null : 700, min: 300, rail: false, shelves: [{ id: "b", side: "right", width: 400, collapsed: true }] },
    ],
  });
  const forced = (input: RowInput) => workspaceRow(input).workspaces[0]!.shelves[0]!.forced;

  for (const mode of ["fill", "content"] as const) {
    it(`workspaceRow (${mode}): the Shelves shown as rails for lack of room come back only past the slack`, () => {
      // The threshold: both columns' minimum beside the expanded Shelf (+ rail + seam), the other's rail and the gap.
      const at = 2 * 300 + expandedBox(400) + COLLAPSED_SHELF_WIDTH + CARD_GAP;
      expect(forced(two(at - 1, false, mode))).toBe(true);
      expect(forced(two(at, false, mode))).toBe(false);
      expect(forced(two(at, true, mode))).toBe(true);
      expect(forced(two(at + FOLD_HYSTERESIS - 1, true, mode))).toBe(true);
      expect(forced(two(at + FOLD_HYSTERESIS, true, mode))).toBe(false);
      // Held, the row still never leaves the work area.
      const row = workspaceRow(two(at + 10, true, mode));
      const total = row.workspaces.reduce((n, w) => n + (w.width ?? 0) + w.shelves.reduce((m, x) => m + x.box, 0), 0) + CARD_GAP;
      expect(total).toBeLessThanOrEqual(at + 10);
    });
  }

  it("sideFrame: the right Shelf stays a drawer within the slack", () => {
    const frame = (areaWidth: number, wasNarrow: boolean) => sideFrame({ areaWidth, stored: 400, open: true, pages: 0, laneWhenHidden: "hide", pageBar: "tabs", mode: "push", layered: null, wasNarrow }).kind;
    const at = MIN_CONVERSATION + MIN_SIDE;
    expect(frame(at - 1, false)).toBe("drawer");
    expect(frame(at, false)).toBe("flow");
    expect(frame(at, true)).toBe("drawer");
    expect(frame(at + FOLD_HYSTERESIS - 1, true)).toBe("drawer");
    expect(frame(at + FOLD_HYSTERESIS, true)).toBe("flow");
  });

  it("shelfRow: the left Shelf off the row comes back only past the slack", () => {
    const fits = (areaWidth: number, leftWasOut: boolean) => shelfRow({ areaWidth, left: { collapsed: false, width: 400 }, right: null, conversationMin: MIN_CONVERSATION, layered: false, leftWasOut }).leftFits;
    const at = 400 + CARD_GAP + MIN_CONVERSATION;
    expect(fits(at - 1, false)).toBe(false);
    expect(fits(at, false)).toBe(true);
    expect(fits(at, true)).toBe(false);
    expect(fits(at + FOLD_HYSTERESIS, true)).toBe(true);
  });

  it("sidebarAutoRail: the sidebar's automatic rail comes back only past the slack", () => {
    let at = 0;
    for (let w = 3000; w > 0; w--) if (sidebarAutoRail({ workspaces: 2, windowWidth: w, sidebarWidth: 256 })) {
      at = w + 1;
      break;
    }
    expect(at).toBeGreaterThan(0);
    expect(sidebarAutoRail({ workspaces: 2, windowWidth: at, sidebarWidth: 256, was: true })).toBe(true);
    expect(sidebarAutoRail({ workspaces: 2, windowWidth: at + FOLD_HYSTERESIS, sidebarWidth: 256, was: true })).toBe(false);
    expect(sidebarAutoRail({ workspaces: 1, windowWidth: 100, sidebarWidth: 256, was: true })).toBe(false);
  });
});

describe("no re-centring jump on a window resize (lib/rowDrag)", () => {
  beforeEach(() => useRowDrag.setState({ lead: null, leadShare: null, colW: [null, null] }));

  it("a group a drag left off centre keeps its relative place in the free space; a re-layout centres it", () => {
    setPinnedLead(100);
    expect(pinnedLead(useRowDrag.getState(), 400)).toBe(100);
    // The window resizes with 400 px free: the group keeps a quarter of the free space before it.
    keepLeadShare(400);
    expect(useRowDrag.getState().lead).toBeNull();
    expect(pinnedLead(useRowDrag.getState(), 400)).toBe(100);
    expect(pinnedLead(useRowDrag.getState(), 420)).toBe(105);
    expect(pinnedLead(useRowDrag.getState(), 0)).toBe(0);
    // A later drag pins px again; a workspace opening / 工作区宽度 = centred.
    setPinnedLead(50);
    expect(useRowDrag.getState().leadShare).toBeNull();
    resetRowDrag();
    expect(pinnedLead(useRowDrag.getState(), 400)).toBeNull();
    // Centred (nothing pinned): a resize keeps it centred.
    keepLeadShare(400);
    expect(pinnedLead(useRowDrag.getState(), 400)).toBeNull();
  });
});

describe("arrow keys are a short drag (lib/columnGlide keyResize)", () => {
  afterEach(() => {
    glide.resetColumnGlide();
    vi.useRealTimers();
  });

  it("one drag session while the keys repeat: live at once, stored once when they rest", () => {
    vi.useFakeTimers();
    const sessions: boolean[] = [];
    const off = glide.onResizeDrag((active) => sessions.push(active));
    const shown: number[] = [];
    const stored: number[] = [];
    for (const w of [10, 20, 30]) {
      glide.keyResize(
        () => shown.push(w),
        () => stored.push(w),
      );
      vi.advanceTimersByTime(30);
    }
    expect(shown).toEqual([10, 20, 30]);
    expect(stored).toEqual([]);
    expect(sessions).toEqual([true]);
    vi.advanceTimersByTime(glide.KEY_RESIZE_MS);
    expect(stored).toEqual([30]);
    expect(sessions).toEqual([true, false]);
    off();
  });

  it("during a pointer drag a key stores at once (that drag keeps its session)", () => {
    const stored: number[] = [];
    glide.resizeDrag(true);
    glide.keyResize(
      () => {},
      () => stored.push(1),
    );
    expect(stored).toEqual([1]);
    expect(glide.resizing()).toBe(true);
    glide.resizeDrag(false);
  });
});

describe("the instance layer (components/side/SideInstanceLayer)", () => {
  let root: Root;
  let container: HTMLElement;
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("a placeholder with nothing of it on screen does not loop the layer (was: Maximum update depth exceeded, a blank window)", () => {
    act(() => root.render(h(SideInstanceLayer)));
    // Not in the document (as a pane cut away entirely by a work row narrower than its Shelf): no box.
    const off = registerSideSlot("i1", { el: document.createElement("div"), cardId: "c1", pageId: "p1" });
    expect(() => {
      act(() => slotsRelayout());
      act(() => root.render(h(SideInstanceLayer)));
    }).not.toThrow();
    act(() => off());
  });
});
