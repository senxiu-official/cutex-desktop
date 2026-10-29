// A Shelf collapsing to its Shelf Rail / expanding again (docs/desktop-modules.md §24.12.3, owner 2026-10-21):
// its box's width moves smoothly between the strip (rail only) and its full width, the conversation columns
// following frame by frame. Its page body keeps its final width meanwhile (clipped by the box, fading in) so
// the panes do not lay out at every frame; the instances drawn over those panes (components/side/
// SideInstanceLayer) wait until the box has arrived. Nothing moves with prefers-reduced-motion. The widths
// are the ones the shell computed (no measuring), remembered per Shelf across the strip / full box swap.
// Shell code: names no feature.
import { useLayoutEffect, useRef, type RefObject } from "react";
import { create } from "zustand";
import { reducedMotion } from "./paneFly";
import { EASE_STANDARD, MOTION } from "./motion";
import { slotsMotion } from "./sideSlots";

/** A Shelf's box between its rail and its width: motion `medium` (docs/design/021-motion.md). */
export const SHELF_MOTION_MS = MOTION.medium;
const EASE = EASE_STANDARD;

/** The pages whose instances wait for their Shelf's box to arrive (the page in view of a Shelf that expands). */
export const useShelfMotion = create<{ pages: readonly string[] }>(() => ({ pages: [] }));

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
/** A Shelf box as last drawn: its width, collapsed or not, and whether it was in the row (not a drawer / floating box). */
export interface ShelfBoxShot {
  width: number;
  collapsed: boolean;
  inFlow?: boolean;
}
const last = new Map<string, ShelfBoxShot>();

/**
 * Whether a width change of a Shelf's box is a collapse / expand worth moving (pure; tested). Only between two boxes in
 * the row: a drawer / floating box folding to its rail was never in the row (shelf-width-stable 2026-10-27: closing the
 * narrow window's 460 px drawer put it in the row at 460 px for a frame and squeezed the conversation to 160 px).
 */
export function shelfMotionFrom(prev: ShelfBoxShot | undefined, width: number, collapsed: boolean): number | null {
  if (!prev || prev.inFlow === false || prev.collapsed === collapsed || Math.abs(prev.width - width) < 2) return null;
  return prev.width;
}

function wait(pageId: string | null, on: boolean): void {
  if (!pageId) return;
  const pages = useShelfMotion.getState().pages.filter((p) => p !== pageId);
  useShelfMotion.setState({ pages: on ? [...pages, pageId] : pages });
}

/**
 * A Shelf's box (`ref`, in the row: `width` px with its seam) collapsed or not. `inFlow` false (a floating /
 * drawer / maximised box): remembered, never moved. `still` (the row's width changed in this render: a window
 * resize, the sidebar, 贴边显示 coming on): no motion starts — but one already running goes on (a change of `still`
 * alone does not cancel it: the Shelf opening with 贴边显示 on changed the row's width in the next render, the motion
 * stopped there and the Shelf and the conversation jumped to their end widths, shelf-width-stable 2026-10-27).
 * `pageId`: its page in view (its instances wait).
 */
export function useShelfBoxMotion(ref: RefObject<HTMLElement | null>, shelfId: string | null, width: number, collapsed: boolean, inFlow: boolean, pageId: string | null, still = false): void {
  const stillNow = useRef(still);
  stillNow.current = still;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!shelfId) return;
    const prev = last.get(shelfId);
    last.set(shelfId, { width, collapsed, inFlow });
    const from = inFlow && !stillNow.current ? shelfMotionFrom(prev, width, collapsed) : null;
    if (from === null || !el || reducedMotion() || typeof el.animate !== "function") return;
    const body = collapsed ? null : el.querySelector<HTMLElement>("[data-shelf-body]");
    const bodyWidth = body?.getBoundingClientRect().width ?? 0;
    const overflow = el.style.overflow;
    el.style.overflow = "hidden";
    if (body && bodyWidth > 0) {
      body.style.minWidth = `${bodyWidth}px`;
      body.animate([{ opacity: 0 }, { opacity: 1 }], { duration: SHELF_MOTION_MS, easing: EASE });
    }
    const waiting = !collapsed ? pageId : null;
    wait(waiting, true);
    const anim = el.animate([{ width: `${from}px` }, { width: `${width}px` }], { duration: SHELF_MOTION_MS, easing: EASE });
    const started = now();
    // The instance layer follows the box frame by frame (lib/sideSlots: it polls the animations only now).
    slotsMotion();
    let done = false;
    const end = () => {
      if (done) return;
      done = true;
      el.style.overflow = overflow;
      if (body) body.style.minWidth = "";
      wait(waiting, false);
    };
    anim.onfinish = end;
    anim.oncancel = end;
    return () => {
      // Undone in the same frame it started (React's StrictMode runs a new box's effect twice in development):
      // the next run moves it again from where it was, instead of finding it already arrived.
      if (now() - started < 16 && last.get(shelfId)?.width === width) last.set(shelfId, prev!);
      anim.cancel();
      end();
    };
  }, [ref, shelfId, width, collapsed, inFlow, pageId]);
}

// ── The conversation column follows (shelf-width-stable, owner 2026-10-27: 「打开 Shelf / 换页的时候经常整个 Shelf 和会话宽度变化」) ──
// A Shelf opening beside the single column can switch the column between its own width (by content, centred) and
// filling the row (lib/workSurface singleColumnWidth: what is left is under its width). A filling column is a flex item
// that takes whatever the row has left — and while the Shelf's box eases open it has a lot left: on the first frame
// the column jumped from its 770 px to 1112 px, then shrank with the box to 660 px (1440 px window). The column's
// max-width eases instead from the width it had to the width it ends at, with the box's duration and easing, so both
// edges move straight from where they were; the leftover space stays the desktop (centred) until the box arrives.

/** Where the column's max-width eases from / to (pure; tested): only beside a Shelf's box in motion, a real change. */
export function columnFollow(i: { from: number | null; to: number | null; boxMoving: boolean; still: boolean; following: boolean }): { from: number; to: number } | null {
  if (!i.boxMoving || i.from === null || i.to === null || Math.abs(i.from - i.to) < 2) return null;
  // The row's width changed (a window resize, 贴边显示): a running follow is retargeted, none starts.
  if (i.still && !i.following) return null;
  return { from: i.from, to: i.to };
}

const following = new WeakMap<HTMLElement, Animation>();

/**
 * The conversation column `col` in the work row `row`: `target` = its width when every box has arrived (its own
 * width, or the room it fills; null = not a single column). Called in the row's render after its Shelf boxes
 * (their motions start first: children's layout effects run before the parent's).
 */
export function useColumnFollow(col: RefObject<HTMLElement | null>, row: RefObject<HTMLElement | null>, target: number | null, still: boolean): void {
  const before = useRef<number | null>(null);
  useLayoutEffect(() => {
    const prev = before.current;
    before.current = target;
    const el = col.current;
    const root = row.current;
    if (!el || !root || typeof el.animate !== "function" || reducedMotion()) return;
    const moving = [...root.querySelectorAll<HTMLElement>("[data-shelf-box], [data-side-box]")].flatMap((b) => (typeof b.getAnimations === "function" ? b.getAnimations() : [])).filter((a) => a.playState === "running");
    const running = following.get(el);
    const live = !!running && running.playState === "running";
    const f = columnFollow({ from: live ? el.getBoundingClientRect().width : prev, to: target, boxMoving: moving.length > 0, still, following: live });
    if (!f) return;
    running?.cancel();
    const elapsed = Number(moving[0]?.currentTime ?? 0) || 0;
    const anim = el.animate([{ maxWidth: `${f.from}px` }, { maxWidth: `${f.to}px` }], { duration: Math.max(1, SHELF_MOTION_MS - elapsed), easing: EASE });
    following.set(el, anim);
    const done = () => following.get(el) === anim && following.delete(el);
    anim.onfinish = done;
    anim.oncancel = done;
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps
}
