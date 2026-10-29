// Card body placeholders of the right side (docs/desktop-modules.md §18.10, the instance layer): each
// card registers the element its shown instance should cover; the instance layer (App root) renders
// that instance in a fixed box aligned to it. Moving / maximising / full screen only change the
// placeholder, never the instance's parent, so nothing remounts.
import { useSyncExternalStore } from "react";
import { ownerWindowOf } from "./ownerWindow";

export interface SideSlot {
  el: HTMLElement;
  /** The card's page / card ids (Body props: mode, focus). */
  cardId: string;
  pageId: string;
}

let slots: ReadonlyMap<string, SideSlot> = new Map();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function registerSideSlot(instanceId: string, slot: SideSlot): () => void {
  const next = new Map(slots);
  next.set(instanceId, slot);
  slots = next;
  emit();
  return () => {
    if (slots.get(instanceId)?.el !== slot.el) return;
    const after = new Map(slots);
    after.delete(instanceId);
    slots = after;
    emit();
  };
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useSideSlots(): ReadonlyMap<string, SideSlot> {
  return useSyncExternalStore(subscribe, () => slots);
}

// Elements whose size changes move the placeholders without resizing them (the work area: the
// sidebar dragged / toggled, a banner above). The instance layer observes them too.
let anchors: ReadonlySet<HTMLElement> = new Set();

export function registerSideAnchor(el: HTMLElement): () => void {
  anchors = new Set([...anchors, el]);
  emit();
  return () => {
    const next = new Set(anchors);
    next.delete(el);
    anchors = next;
    emit();
  };
}

export function useSideAnchors(): ReadonlySet<HTMLElement> {
  return useSyncExternalStore(subscribe, () => anchors);
}

// The work row laid out again (components/side/SideArea, from a layout effect: a window resize, a fold, a
// width): the instance layer measures its placeholders at once, in the same frame — a ResizeObserver or a
// MutationObserver alone would draw the instances one frame behind their panes (owner 2026-10-21: panels
// flying when the window is resized).
const relayoutListeners = new Set<() => void>();

export function onSlotsRelayout(fn: () => void): () => void {
  relayoutListeners.add(fn);
  return () => void relayoutListeners.delete(fn);
}

export function slotsRelayout(): void {
  for (const fn of [...relayoutListeners]) fn();
}

export interface SlotRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Where an instance is laid out (its placeholder) and the part of it that may paint (`clip`, within `rect`). */
export interface SlotBox {
  rect: SlotRect;
  clip: SlotRect;
}

/** The overlap of two boxes (width / height 0 when they do not meet). Pure; tested. */
export function intersectRect(a: SlotRect, b: SlotRect): SlotRect {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.left + a.width, b.left + b.width);
  const bottom = Math.min(a.top + a.height, b.top + b.height);
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

const round = (r: SlotRect): SlotRect => {
  const left = Math.round(r.left);
  const top = Math.round(r.top);
  return { left, top, width: Math.round(r.left + r.width) - left, height: Math.round(r.top + r.height) - top };
};

// The boxes an instance never paints outside of even when they do not clip (their overflow is visible): the
// pane (card), its Shelf's box and the work row.
const BOUNDS = "[data-side-card], [data-shelf-box], [data-side-box], [data-side-work]";

/**
 * A placeholder's box and the part of it the instance may paint: the placeholder cut to its pane, its Shelf's
 * box, the work row, every ancestor that clips its overflow and the window — so an instance (a frame, a guest
 * page) never draws over another pane, the other workspace or outside the work area, even for a frame while
 * the row is out of step. null: nothing of it shows (hidden / collapsed / covered by a hidden ancestor, or
 * cut away entirely).
 */
export function slotBox(el: HTMLElement): SlotBox | null {
  if (!el.isConnected) return null;
  const r = el.getBoundingClientRect();
  const rect = round({ left: r.left, top: r.top, width: r.width, height: r.height });
  if (rect.width <= 0 || rect.height <= 0) return null;
  let clip: SlotRect = { left: r.left, top: r.top, width: r.width, height: r.height };
  const own = ownerWindowOf(el);
  const view = typeof window === "undefined" ? null : { left: 0, top: 0, width: own.innerWidth, height: own.innerHeight };
  if (view && view.width > 0 && view.height > 0) clip = intersectRect(clip, view);
  for (let a = el.parentElement; a && a !== el.ownerDocument.body && a !== el.ownerDocument.documentElement; a = a.parentElement) {
    if (a.hidden) return null;
    const cs = getComputedStyle(a);
    if (cs.display === "none") return null;
    const clips = (cs.overflowX && cs.overflowX !== "visible") || (cs.overflowY && cs.overflowY !== "visible");
    if (!clips && !a.matches(BOUNDS)) continue;
    const b = a.getBoundingClientRect();
    // An ancestor not laid out (0 × 0: a `display: contents` wrapper) does not bound anything.
    if (b.width <= 0 && b.height <= 0 && cs.display === "contents") continue;
    clip = intersectRect(clip, { left: b.left, top: b.top, width: b.width, height: b.height });
  }
  if (getComputedStyle(el).visibility === "hidden") return null;
  const c = round(clip);
  if (c.width <= 0 || c.height <= 0) return null;
  return { rect, clip: c };
}

// Motion in the work area the instance layer follows frame by frame (a column glide, a Shelf's box opening:
// lib/columnGlide, lib/shelfMotion — Web Animations, which fire no DOM event). Only after such a signal (or a
// CSS transition / animation starting) does the layer ask `moving()`: `getAnimations({ subtree: true })` makes
// the browser compute the whole row's style first, and asked on every DOM change it forced a style recalc per
// streamed delta while nothing moved (perf re-run 2026-10-21 §7.3 N3).
const motionListeners = new Set<() => void>();

export function onSlotsMotion(fn: () => void): () => void {
  motionListeners.add(fn);
  return () => void motionListeners.delete(fn);
}

/** Something in the work area started moving (an animation just created): the instance layer follows it until it stops. */
export function slotsMotion(): void {
  for (const fn of [...motionListeners]) fn();
}

/** CSS properties whose transition can move or resize a placeholder (a colour, opacity, a ring's stroke cannot). */
export const LAYOUT_PROPS = /^(all|width|height|min-|max-|inset|left|right|top|bottom|margin|padding|flex|grid|transform|translate|scale|gap)/;
/** The same for keyframes (camelCase property names). */
const LAYOUT_KEYS = /^(width|height|min[A-Z]|max[A-Z]|inset|left|right|top|bottom|margin|padding|flex|grid|transform|translate|scale|gap)/;

// A transition in a clipped/background document can remain play-pending indefinitely,
// even as that document's clock advances. It is not moving yet. Wait for the browser
// to start it instead of keeping every instance/frost layer polling each frame.
// ready also covers Web Animations, which emit no CSS transitionstart event.
const waitingForStart = new WeakSet<Animation>();
function followWhenReady(animation: Animation): void {
  if (waitingForStart.has(animation)) return;
  waitingForStart.add(animation);
  void animation.ready.then(() => {
    waitingForStart.delete(animation);
    const target = (animation.effect as KeyframeEffect | null)?.target;
    if (animation.playState === "running" && !animation.pending && (!target || target.isConnected)) slotsMotion();
  }, () => { waitingForStart.delete(animation); }); // Cancellation rejects ready.
}

/** Whether an animation / transition can move a placeholder: what it animates is a box property. */
export function animationMovesBoxes(a: Animation): boolean {
  const prop = (a as Animation & { transitionProperty?: string }).transitionProperty;
  if (typeof prop === "string") return LAYOUT_PROPS.test(prop);
  const effect = a.effect as KeyframeEffect | null;
  if (!effect || typeof effect.getKeyframes !== "function") return true;
  return effect.getKeyframes().some((k) => Object.keys(k).some((key) => LAYOUT_KEYS.test(key)));
}

/**
 * Whether something under `root` is moving now: a finite animation / transition of a box property (a glide, a
 * Shelf opening). Not a colour fading or a progress ring's stroke easing — with those counted, a usage ring
 * transitioning every few seconds kept the instance layer polling frame by frame while nothing moved.
 */
export function moving(root: Element): boolean {
  if (typeof (root as HTMLElement).getAnimations !== "function") return false;
  return (root as HTMLElement).getAnimations({ subtree: true }).some((a) => {
    if (a.playState !== "running") return false;
    const end = a.effect?.getComputedTiming().endTime;
    if (typeof end !== "number" || !Number.isFinite(end) || !animationMovesBoxes(a)) return false;
    if (a.pending && a.startTime === null) {
      followWhenReady(a);
      return false;
    }
    return true;
  });
}
