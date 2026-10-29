// @vitest-environment jsdom
// The Shelf and the conversation keep their widths when a Shelf opens / closes (owner 2026-10-27: 「打开侧栏 shelf / 换页的时候
// 经常整个 shelf 和会话宽度变化」): the column follows the box's motion instead of filling what the box has not taken yet
// (lib/shelfMotion columnFollow / useColumnFollow), a motion is not cut by the row's width changing under it (贴边显示),
// a drawer folding to its rail never enters the row at its drawer width, and the drawer decision does not depend on
// history (lib/sideFrame drawerHeld).
import { act, createElement as h, useRef, type RefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { columnFollow, shelfMotionFrom, useColumnFollow, useShelfBoxMotion } from "../src/renderer/src/lib/shelfMotion";
import { drawerHeld, sideFrame, type SideFrameInput } from "../src/renderer/src/lib/sideFrame";
import { singleColumnWidth } from "../src/renderer/src/lib/workSurface";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("columnFollow (pure)", () => {
  it("eases the column from its width to its end width while a Shelf box moves", () => {
    // 1440 px window: the column by content (770) switches to filling what the opened Shelf leaves (660).
    expect(columnFollow({ from: 770, to: 660, boxMoving: true, still: false, following: false })).toEqual({ from: 770, to: 660 });
    // And back when the Shelf closes.
    expect(columnFollow({ from: 660, to: 770, boxMoving: true, still: false, following: false })).toEqual({ from: 660, to: 770 });
  });
  it("does nothing without a box in motion, without a change, or before the first width", () => {
    expect(columnFollow({ from: 770, to: 660, boxMoving: false, still: false, following: false })).toBeNull();
    expect(columnFollow({ from: 770, to: 771, boxMoving: true, still: false, following: false })).toBeNull();
    expect(columnFollow({ from: null, to: 660, boxMoving: true, still: false, following: false })).toBeNull();
    expect(columnFollow({ from: 770, to: null, boxMoving: true, still: false, following: false })).toBeNull();
  });
  it("starts nothing while the row's width changes (a window resize), but retargets a follow already running", () => {
    expect(columnFollow({ from: 770, to: 660, boxMoving: true, still: true, following: false })).toBeNull();
    // 贴边显示 coming on mid-motion: the row is 16 px wider, the column ends 16 px wider.
    expect(columnFollow({ from: 740, to: 676, boxMoving: true, still: true, following: true })).toEqual({ from: 740, to: 676 });
  });
  it("the case it fixes: the column switches from its own width to filling when the Shelf opens", () => {
    // area 1160, reading width 768 (+ chrome = 770); closed: the rail (48) → free 1112 → own width 770.
    expect(singleColumnWidth({ area: 1160, free: 1112, readingWidth: 768, mode: "reading", pct: 60, dragged: 0 })).toBe(770);
    // open (460 + its seam): free 660 → fills (null: a flex item that takes every pixel the box has not taken yet).
    expect(singleColumnWidth({ area: 1160, free: 660, readingWidth: 768, mode: "reading", pct: 60, dragged: 0 })).toBeNull();
  });
});

describe("shelfMotionFrom (pure)", () => {
  it("moves between two boxes in the row", () => {
    expect(shelfMotionFrom({ width: 460, collapsed: false, inFlow: true }, 48, true)).toBe(460);
    expect(shelfMotionFrom({ width: 48, collapsed: true }, 460, false)).toBe(48);
  });
  it("a drawer / floating box folding to its rail does not enter the row at its drawer width", () => {
    // 900 px window: a 460 px drawer over a 620 px row — moved in the row it squeezed the conversation to 160 px.
    expect(shelfMotionFrom({ width: 460, collapsed: false, inFlow: false }, 48, true)).toBeNull();
  });
});

describe("drawerHeld: the drawer decision does not depend on history", () => {
  const base: SideFrameInput = { areaWidth: 620, stored: 460, open: true, pages: 0, laneWhenHidden: "hide", pageBar: "tabs", mode: "push", layered: null };
  it("a collapsed Shelf (its rail's room) holds no drawer verdict for the next opening", () => {
    // Collapsed: the row gives the conversation 572 px (620 − the rail) — narrow by the tool area's measure.
    const closed = sideFrame({ ...base, areaWidth: 572, open: false });
    expect(closed.narrow).toBe(true);
    expect(drawerHeld(closed)).toBe(false);
    // Opened after it and after a reload (nothing held): the same inline Shelf.
    const afterCollapsed = sideFrame({ ...base, wasNarrow: drawerHeld(closed) });
    const afterReload = sideFrame({ ...base, wasNarrow: false });
    expect(afterCollapsed).toEqual(afterReload);
    expect(afterReload.kind).toBe("flow");
    // Before: the closed frame's verdict was held → a 460 px drawer here, an inline 260 px Shelf after a reload.
    expect(sideFrame({ ...base, wasNarrow: closed.narrow }).kind).toBe("drawer");
  });
  it("an open drawer keeps its slack while the window widens a little", () => {
    const drawer = sideFrame({ ...base, areaWidth: 600 });
    expect(drawer.kind).toBe("drawer");
    expect(drawerHeld(drawer)).toBe(true);
    expect(sideFrame({ ...base, areaWidth: 640, wasNarrow: drawerHeld(drawer) }).kind).toBe("drawer");
  });
});

// ── The hooks, with Element.animate / getAnimations stood in ─────────────────────────────────────────────────────

interface FakeAnim {
  el: Element;
  keyframes: Keyframe[];
  duration: number;
  playState: string;
  currentTime: number;
  cancel(): void;
  onfinish: (() => void) | null;
  oncancel: (() => void) | null;
}
let anims: FakeAnim[] = [];
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  anims = [];
  (Element.prototype as unknown as { animate: unknown }).animate = function (this: Element, keyframes: Keyframe[], opts: KeyframeAnimationOptions) {
    const a: FakeAnim = {
      el: this,
      keyframes,
      duration: Number(opts.duration),
      playState: "running",
      currentTime: 0,
      onfinish: null,
      oncancel: null,
      cancel() {
        if (a.playState !== "running") return;
        a.playState = "idle";
        a.oncancel?.();
      },
    };
    anims.push(a);
    return a;
  };
  (Element.prototype as unknown as { getAnimations: unknown }).getAnimations = function (this: Element) {
    return anims.filter((a) => a.el === this && a.playState === "running");
  };
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete (Element.prototype as unknown as { animate?: unknown }).animate;
  delete (Element.prototype as unknown as { getAnimations?: unknown }).getAnimations;
  vi.unstubAllGlobals();
});

let seq = 0;
function Row({ id, box, collapsed, still, target }: { id: string; box: number; collapsed: boolean; still: boolean; target: number | null }) {
  const row = useRef<HTMLDivElement>(null);
  const col = useRef<HTMLDivElement>(null);
  return h("div", { ref: row, "data-side-work": "" }, h("div", { ref: col, "data-conv-card": "" }), h(Box, { id, box, collapsed, still }), h(Follow, { col, row, target, still }));
}
function Box({ id, box, collapsed, still }: { id: string; box: number; collapsed: boolean; still: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useShelfBoxMotion(ref, id, box, collapsed, true, null, still);
  return h("div", { ref, "data-shelf-box": "right", style: { width: box } });
}
// The column follows after the boxes (as in SideWorkArea: the row's own effects run after its children's).
function Follow({ col, row, target, still }: { col: RefObject<HTMLDivElement | null>; row: RefObject<HTMLDivElement | null>; target: number | null; still: boolean }) {
  useColumnFollow(col, row, target, still);
  return null;
}

const widthMotions = () => anims.filter((a) => a.keyframes.some((k) => "width" in k));
const followMotions = () => anims.filter((a) => a.keyframes.some((k) => "maxWidth" in k));

describe("useShelfBoxMotion + useColumnFollow", () => {
  it("opening the Shelf: the box eases 48 → 460 and the column's max-width 770 → 660 alongside it", () => {
    const id = `s-open-${++seq}`;
    act(() => root.render(h(Row, { id, box: 48, collapsed: true, still: false, target: 770 })));
    expect(anims).toHaveLength(0);
    act(() => root.render(h(Row, { id, box: 460, collapsed: false, still: false, target: 660 })));
    expect(widthMotions().map((a) => a.keyframes.map((k) => k.width))).toEqual([["48px", "460px"]]);
    expect(followMotions().map((a) => a.keyframes.map((k) => k.maxWidth))).toEqual([["770px", "660px"]]);
  });

  it("the row's width changing mid-motion (贴边显示) does not cut the Shelf's motion; the column is retargeted", () => {
    const id = `s-edge-${++seq}`;
    act(() => root.render(h(Row, { id, box: 48, collapsed: true, still: false, target: 770 })));
    act(() => root.render(h(Row, { id, box: 460, collapsed: false, still: false, target: 660 })));
    const [box] = widthMotions();
    expect(box!.playState).toBe("running");
    // Next render: the row is 16 px wider (the margins went), so "still" — and the column ends at 676.
    act(() => root.render(h(Row, { id, box: 460, collapsed: false, still: true, target: 676 })));
    expect(box!.playState).toBe("running");
    expect(followMotions().filter((a) => a.playState === "running").map((a) => a.keyframes.at(-1)!.maxWidth)).toEqual(["676px"]);
  });

  it("nothing starts while the row's width changes (a window resize), and nothing follows without a moving box", () => {
    const id = `s-still-${++seq}`;
    act(() => root.render(h(Row, { id, box: 48, collapsed: true, still: false, target: 770 })));
    act(() => root.render(h(Row, { id, box: 460, collapsed: false, still: true, target: 660 })));
    expect(anims).toHaveLength(0);
    // A column width change with every box at rest (a drag's release, a setting): not this hook's.
    act(() => root.render(h(Row, { id, box: 460, collapsed: false, still: false, target: 600 })));
    expect(anims).toHaveLength(0);
  });
});
