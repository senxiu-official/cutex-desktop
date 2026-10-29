// The composer's settings row (permissions … | profile · quota | model · context) on a narrow pane: instead of
// clipping its right end, the right group moves to a second row, right-aligned; still too tight there, the quota
// countdown text goes (its hover keeps it), then the Profile name truncates. Never more than two rows.
//
// Measured with the shared ResizeObserver (lib/resizeHub), no `@container` (lib/sizeFlags explains why). Each group's
// natural width is its max-content width, read by laying it out once at `width: max-content` inside the observer
// callback (restored before anything paints), so the decision never depends on the layout it produced.
// Going back to a roomier step needs HYSTERESIS px of slack: a countdown that changes width does not flap the row.
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { sharedResizeObserver, type SharedResizeObserver } from "./resizeHub";
import { contentBox } from "./sizeFlags";

/** 0 = one row; 1 = the right group on a second row; 2 = also without countdown text; 3 = also a truncated Profile name. */
export type ToolbarStep = 0 | 1 | 2 | 3;

export interface ToolbarWidths {
  /** The row's content box width. */
  width: number;
  /** Natural (max-content) width of the left group. */
  left: number;
  /** Natural width of the right group as shown in full. */
  right: number;
  /** Natural width of the right group without the countdown text. */
  rightNoReset: number;
  /** The row's column gap between the two groups. */
  gap: number;
}

export const TOOLBAR_HYSTERESIS = 24;

/**
 * The roomiest step that fits `w`. A step roomier than `prev` must fit with `hysteresis` px to spare; the current
 * step and tighter ones only need to fit. Step 3 is the floor (it always applies when nothing else fits).
 */
export function fitToolbar(w: ToolbarWidths, prev: ToolbarStep, hysteresis = TOOLBAR_HYSTERESIS): ToolbarStep {
  const needs: readonly number[] = [w.left + w.gap + w.right, w.right, w.rightNoReset];
  for (let step = 0; step < needs.length; step++) {
    if (needs[step]! + (step < prev ? hysteresis : 0) <= w.width) return step as ToolbarStep;
  }
  return 3;
}

/** `el`'s width laid out at max-content, unshrunk (inline styles restored before returning). */
function naturalWidth(el: HTMLElement): number {
  const { width, flex } = el.style;
  el.style.width = "max-content";
  el.style.flex = "0 0 auto";
  const w = el.getBoundingClientRect().width;
  el.style.width = width;
  el.style.flex = flex;
  return Math.ceil(w);
}

/** The attributes the right group carries per step (CSS hides the countdown / lets the name shrink from them). */
export const DROP_RESET_ATTR = "data-drop-reset";
export const SQUEEZE_NAME_ATTR = "data-squeeze-name";

/** Natural widths of the right group in full and without countdown text (the attribute state is restored). */
function rightWidths(el: HTMLElement): [full: number, noReset: number] {
  const had = el.hasAttribute(DROP_RESET_ATTR);
  el.removeAttribute(DROP_RESET_ATTR);
  const full = naturalWidth(el);
  el.setAttribute(DROP_RESET_ATTR, "");
  const noReset = naturalWidth(el);
  if (!had) el.removeAttribute(DROP_RESET_ATTR);
  return [full, noReset];
}

/**
 * Callback refs for the row and its two groups, and the step that fits. The row, both groups and the right group's
 * chips are observed: a chip's content changing (a countdown, a model name arriving) re-decides even while the
 * group's own box is pinned (it spans the second row).
 */
export function useToolbarFit(): {
  row: (el: HTMLElement | null) => void;
  left: (el: HTMLElement | null) => void;
  right: (el: HTMLElement | null) => void;
  step: ToolbarStep;
} {
  const [step, setStep] = useState<ToolbarStep>(0);
  const els = useRef<{ row: HTMLElement | null; left: HTMLElement | null; right: HTMLElement | null }>({ row: null, left: null, right: null });
  const ro = useRef<SharedResizeObserver | null>(null);
  const watched = useRef(new Set<Element>());
  const measure = useCallback(() => {
    const { row, left, right } = els.current;
    if (!row || !left || !right) return;
    const box = contentBox(row);
    if (box.width <= 0) return; // not laid out (hidden tab): keep the last step
    const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
    const [full, noReset] = rightWidths(right);
    const widths = { width: box.width, left: naturalWidth(left), right: full, rightNoReset: noReset, gap };
    setStep((prev) => fitToolbar(widths, prev));
  }, []);
  const sync = useCallback(() => {
    const observer = ro.current;
    if (!observer) return;
    const { row, left, right } = els.current;
    // Two levels under the right group: its chips sit in an inner group that is pinned too once it fills the row.
    const chips = right ? [...right.querySelectorAll(":scope > *, :scope > * > *")] : [];
    const want = new Set<Element>([row, left, right, ...chips].filter((e): e is Element => !!e));
    for (const el of watched.current) if (!want.has(el)) observer.unobserve(el);
    for (const el of want) if (!watched.current.has(el)) observer.observe(el);
    watched.current = want;
  }, []);
  useLayoutEffect(() => {
    ro.current = sharedResizeObserver(measure);
    sync();
    measure();
    return () => {
      ro.current?.disconnect();
      ro.current = null;
      watched.current = new Set();
    };
  }, [measure, sync]);
  // The right group's children come and go with the agent (a gutter trigger, the observed-model tag): keep them watched.
  useLayoutEffect(() => sync());
  const row = useCallback((el: HTMLElement | null) => void (els.current.row = el), []);
  const left = useCallback((el: HTMLElement | null) => void (els.current.left = el), []);
  const right = useCallback((el: HTMLElement | null) => void (els.current.right = el), []);
  return { row, left, right, step };
}
