// Overlay scrollbars (owner, 2026-10-10). Native scrollbars are hidden everywhere (styles.css), so a
// scroller never loses width when its content starts to overflow (on Windows a native bar took 10–15 px
// and the content jumped; Electron's OverlayScrollbar features have no effect there). Instead the shell
// draws thin thumbs over the right / bottom edge in one fixed layer (lib/overlayScrollbarManager.ts).
// This file is the pure part: thumb maths, which scroller a pointer belongs to, the opt-out, which
// ancestors clip a scroller, and when a scroll counts as the user's.

export type Axis = "x" | "y";

/** Opt-out: this element and everything inside it keep their native scrollbars (styled by the
 *  component, or hidden with `scrollbar-width: none`) and get no overlay thumb. */
export const NATIVE_SCROLLBAR_ATTR = "data-native-scrollbar";

export const THUMB = {
  /** Bar thickness at rest / while hovered or dragged (px; styles.css `.osb-bar`). */
  thin: 5,
  wide: 8,
  /** Grab strip thickness along the edge (px): the bar sits inside it, `inset` from the edge. */
  hit: 11,
  /** Gap between the bar and the scroller's edge / the track ends (px). */
  inset: 3,
  /** Shortest thumb (px), so a long list still has something to grab. */
  min: 24,
  /** The thumb hides this long after the last scroll / after the pointer leaves (ms). */
  hideDelay: 1000,
  /** Fade-out duration before the thumb's nodes are dropped (ms; styles.css `.osb-hit`). */
  fadeOut: 300,
} as const;

/** A scroll counts as the user's when it follows a wheel / touch / scroll key this soon (ms). */
export const INTENT_WINDOW = 600;

/** Overflow of at most this many px is rounding, not something to scroll. */
export const OVERFLOW_SLACK = 1;

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** `overflow-x` / `overflow-y` values that make a box a user scroller. */
export function scrollsOn(overflow: string): boolean {
  return overflow === "auto" || overflow === "scroll" || overflow === "overlay";
}

/** More content than view on one axis (ignoring sub-pixel rounding). */
export function overflowing(content: number, view: number): boolean {
  return content - view > OVERFLOW_SLACK;
}

export interface ThumbInput {
  /** Visible length of the scroller on this axis (clientHeight / clientWidth). */
  view: number;
  /** Scrollable length (scrollHeight / scrollWidth), same units as `view`. */
  content: number;
  /** scrollTop / scrollLeft, same units. */
  pos: number;
  /** Track length in screen px (may differ from `view` under CSS zoom / transforms). */
  track: number;
  /** Horizontal axis of a right-to-left box: scrollLeft runs from 0 (start, right) to -range. */
  rtl?: boolean;
  min?: number;
}

/** Thumb length and offset along the track (screen px), or null when there is nothing to scroll. */
export function thumbGeometry({ view, content, pos, track, rtl = false, min = THUMB.min }: ThumbInput): { size: number; offset: number } | null {
  if (!(view > 0) || !(track > 0) || !overflowing(content, view)) return null;
  const size = Math.min(track, Math.max(Math.min(min, track), (track * view) / content));
  const range = content - view;
  // Offset grows left → right in both directions, and so does scrollLeft (drag maps the same way).
  const along = rtl ? range + pos : pos;
  const ratio = Math.min(1, Math.max(0, along / range));
  return { size, offset: (track - size) * ratio };
}

/** Scroll distance for dragging the thumb `delta` screen px (inverse of thumbGeometry). */
export function scrollForDrag(delta: number, { view, content, track, size }: { view: number; content: number; track: number; size: number }): number {
  const free = track - size;
  if (!(free > 0)) return 0;
  return (delta * Math.max(0, content - view)) / free;
}

/** Where the grab strip runs for one axis of a scroller whose client box is `box` (screen px). With
 *  both axes overflowing, each track stops short of the corner so the two thumbs never overlap. */
export function trackRect(box: Rect, axis: Axis, corner: boolean): Rect {
  const end = THUMB.inset + (corner ? THUMB.hit : 0);
  if (axis === "y") return { left: box.left + box.width - THUMB.hit, top: box.top + THUMB.inset, width: THUMB.hit, height: Math.max(0, box.height - THUMB.inset - end) };
  return { left: box.left + THUMB.inset, top: box.top + box.height - THUMB.hit, width: Math.max(0, box.width - THUMB.inset - end), height: THUMB.hit };
}

/** The thumb's strip on screen, given its track and geometry. */
export function thumbRect(track: Rect, axis: Axis, g: { size: number; offset: number }): Rect {
  return axis === "y" ? { left: track.left, top: track.top + g.offset, width: track.width, height: g.size } : { left: track.left + g.offset, top: track.top, width: g.size, height: track.height };
}

export function intersect(a: Rect, b: Rect): Rect | null {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.left + a.width, b.left + b.width);
  const bottom = Math.min(a.top + a.height, b.top + b.height);
  return right > left && bottom > top ? { left, top, width: right - left, height: bottom - top } : null;
}

export interface ScrollProbe<T> {
  /** Carries the opt-out attribute itself. */
  optOut(el: T): boolean;
  /** Scrolls on this axis (overflow auto / scroll) and has more content than view there. */
  scrolls(el: T, axis: Axis): boolean;
}

/** Which scroller a pointer over `chain[0]` belongs to, per axis: the innermost scroller on that axis
 *  among the element and its ancestors (`chain` = element, parent, …, root). Everything at or inside
 *  an opt-out element is skipped; scrollers above it still count. Nested scrollers on the same axis:
 *  only the innermost — an outer one shows only when it scrolls itself. */
export function innermostScrollers<T>(chain: readonly T[], probe: ScrollProbe<T>): { x: T | null; y: T | null } {
  let start = 0;
  for (let i = chain.length - 1; i >= 0; i--) {
    if (probe.optOut(chain[i]!)) {
      start = i + 1;
      break;
    }
  }
  let x: T | null = null;
  let y: T | null = null;
  for (let i = start; i < chain.length && (x === null || y === null); i++) {
    const el = chain[i]!;
    if (y === null && probe.scrolls(el, "y")) y = el;
    if (x === null && probe.scrolls(el, "x")) x = el;
  }
  return { x, y };
}

export interface BoxStyle {
  /** Computed `position`. */
  position: string;
  /** Establishes a containing block for fixed / absolute descendants (transform, filter, contain…). */
  containsFixed: boolean;
  /** Clips its content (overflow other than visible, contain: paint). */
  clips: boolean;
}

/** Which ancestors clip a scroller (indices into `chain` = scroller, parent, …, root). Overflow
 *  clipping follows the containing-block chain: an absolutely positioned box skips static ancestors
 *  up to its positioned one, a fixed box escapes everything but a transformed (or similar) ancestor. */
export function clippingAncestors(chain: readonly BoxStyle[]): number[] {
  type Need = "parent" | "positioned" | "fixedCB";
  const need = (p: string): Need => (p === "absolute" ? "positioned" : p === "fixed" ? "fixedCB" : "parent");
  const out: number[] = [];
  let want: Need = chain[0] ? need(chain[0].position) : "parent";
  for (let i = 1; i < chain.length; i++) {
    const a = chain[i]!;
    const isBlock = want === "parent" || (want === "positioned" && (a.position !== "static" || a.containsFixed)) || (want === "fixedCB" && a.containsFixed);
    if (!isBlock) continue;
    if (a.clips) out.push(i);
    want = need(a.position);
  }
  return out;
}

/** The last input that can scroll something: a wheel / touch over `target`, or a scroll key with
 *  focus on `target` (null target: focus on the page, so any scroller may be the one). */
export interface ScrollIntent<T> {
  at: number;
  target: T | null;
}

/** Whether a scroll of `scroller` at `now` follows the user's own input (wheel / touch / keys) rather
 *  than code (a streaming timeline sticking to the bottom, scrollIntoView after a click). Only those —
 *  and scrolls of a hovered or already showing scroller — bring up a thumb. */
export function userScroll<T>(intent: ScrollIntent<T> | null, now: number, scroller: T, contains: (outer: T, inner: T) => boolean): boolean {
  if (!intent || now - intent.at > INTENT_WINDOW || now < intent.at) return false;
  return intent.target === null || contains(scroller, intent.target);
}

/** Keys that scroll the focused scroller (or the one under the last click). */
export function scrollKey(key: string): boolean {
  return key === "PageUp" || key === "PageDown" || key === "Home" || key === "End" || key === " " || key === "ArrowUp" || key === "ArrowDown" || key === "ArrowLeft" || key === "ArrowRight";
}

/** Hit-test samples along a thumb of this length (px): about one per 12 px, 3 – 24. */
export function coverSamples(length: number): number {
  return Math.min(24, Math.max(3, Math.round(length / 12)));
}

/** The longest run of uncovered samples, as [first, last] indices (inclusive); null when every sample
 *  is covered. Ties keep the earlier run. A menu or card over part of a scroller cuts its thumb to
 *  the part that is still on top (owner 2026-10-14: the sidebar thumb was drawn over a context menu). */
export function longestUncovered(covered: readonly boolean[]): [number, number] | null {
  let best: [number, number] | null = null;
  let start = -1;
  for (let i = 0; i <= covered.length; i++) {
    if (i < covered.length && !covered[i]) {
      if (start < 0) start = i;
      continue;
    }
    if (start >= 0 && (!best || i - 1 - start > best[1] - best[0])) best = [start, i - 1];
    start = -1;
  }
  return best;
}
