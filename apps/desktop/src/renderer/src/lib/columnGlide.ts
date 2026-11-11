// The conversation columns glide to their new place (owner 2026-10-21, lib/workSurface): a Shelf opening /
// closing beside the single column, a second workspace opening or closing. Every element marked
// `data-glide="<pane id>"` in the work area is measured after each structural change; one that moved animates
// from where it was (translate + width; nothing with prefers-reduced-motion). Only discrete changes glide: a
// width being dragged (a column handle, a Shelf's or the sidebar's edge, the single column's edges —
// `resizeDrag`) and the work area changing width (the window resized, the sidebar dragged) refresh the
// remembered boxes without moving anything; otherwise every step of a drag would start a glide from the step
// before and the panels would fly out and back (owner 2026-10-21). A Shelf's own collapse / expand already
// moves the columns frame by frame (lib/shelfMotion): no second motion then. Shell code: names no feature.
import { reducedMotion } from "./paneFly";
import { SHELF_MOTION_MS } from "./shelfMotion";
import { EASE_STANDARD } from "./motion";
import { slotsMotion } from "./sideSlots";
import { ownerWindowOf } from "./ownerWindow";
import { onEveryAppWindow } from "./appWindowSet";

const EASE = EASE_STANDARD;
const last = new Map<string, { left: number; width: number }>();

const glideBoxes = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>("[data-glide]")].filter((el) => !el.hidden);

let dragging = false;
let settleUntil = 0;
/** After a drag ends, the release stores the width (one more layout): that is still the drag, not a glide. */
const SETTLE_MS = 300;
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
const release = () => resizeDrag(false);
/** Removes the release listeners (on every app window: the drag may be in a desk window, multi-window). */
let stopRelease: (() => void) | null = null;

/**
 * A width drag starts (`true`) / ends (`false`) anywhere in the window: nothing glides meanwhile. One drag at a
 * time; a pointer released / cancelled anywhere ends it too (a handle that lost its capture without a release).
 */
export function resizeDrag(active: boolean): void {
  if (active === dragging) return;
  dragging = active;
  for (const fn of [...listeners]) fn(active);
  if (typeof window === "undefined") return;
  if (active) {
    stopRelease = onEveryAppWindow((win) => {
      win.addEventListener("pointerup", release, true);
      win.addEventListener("pointercancel", release, true);
      return () => {
        win.removeEventListener("pointerup", release, true);
        win.removeEventListener("pointercancel", release, true);
      };
    });
    return;
  }
  settleUntil = now() + SETTLE_MS;
  stopRelease?.();
  stopRelease = null;
}

const listeners = new Set<(active: boolean) => void>();

/**
 * A width drag starts / ends (called synchronously, before the release's own store writes render): the work
 * row (components/side/SideArea) keeps the panels the drag does not touch where they are (lib/workspaceRow).
 */
export function onResizeDrag(fn: (active: boolean) => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** How long the arrow keys' resize session stays open after the last key (the row has laid it out by then). */
export const KEY_RESIZE_MS = 160;
let keyTimer: ReturnType<typeof setTimeout> | null = null;
let keyCommit: (() => void) | null = null;

/** Ends the arrow keys' resize session now (its last width stored, as a pointer release does). */
export function endKeyResize(): void {
  if (keyTimer !== null) clearTimeout(keyTimer);
  keyTimer = null;
  const commit = keyCommit;
  keyCommit = null;
  if (!commit) return;
  commit();
  resizeDrag(false);
}

/**
 * A width stepped with the arrow keys (宽度规则 1, owner 2026-10-21: only the two panels beside the edge change, as
 * with the pointer): the step is a short drag — it opens a drag session (`resizeDrag(true)`: the work row keeps
 * what the edge does not touch), shows the new width live (`preview`), and once the keys rest (`KEY_RESIZE_MS`)
 * stores it (`commit`) and ends the session the way a release does. Held keys step within one session.
 */
export function keyResize(preview: () => void, commit: () => void): void {
  if (!keyCommit) {
    if (dragging) {
      // A pointer drag is going on: the step is stored at once (that drag's session keeps the row).
      preview();
      commit();
      return;
    }
    resizeDrag(true);
  }
  keyCommit = commit;
  preview();
  if (keyTimer !== null) clearTimeout(keyTimer);
  keyTimer = setTimeout(endKeyResize, KEY_RESIZE_MS);
}

/** Whether a width drag is going on now (what onResizeDrag reports; not the settling time after its release). */
export function resizeDragActive(): boolean {
  return dragging;
}

/** Whether a width drag is going on (or has just been released). */
export function resizing(): boolean {
  return dragging || now() < settleUntil;
}

/** Remember where the columns are now (no motion): a window resize, the first layout. */
export function noteColumns(root: HTMLElement | null): void {
  if (!root) return;
  for (const el of glideBoxes(root)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0) last.set(el.dataset.glide!, { left: r.left, width: r.width });
  }
}

let pending: { root: HTMLElement; view: Window; frame: number; timer: ReturnType<typeof setTimeout> | null } | null = null;

function cancelNote(): void {
  if (!pending) return;
  if (typeof pending.view.cancelAnimationFrame === "function") pending.view.cancelAnimationFrame(pending.frame);
  if (pending.timer !== null) clearTimeout(pending.timer);
  pending = null;
}

/** Remember the boxes once the frame has been painted (a resize's steps coalesce into one read). */
function noteLater(root: HTMLElement): void {
  if (pending?.root === root) return;
  cancelNote();
  const view = ownerWindowOf(root);
  if (typeof view.requestAnimationFrame !== "function") return noteColumns(root);
  const p: NonNullable<typeof pending> = { root, view, frame: 0, timer: null };
  p.frame = view.requestAnimationFrame(() => {
    p.timer = setTimeout(() => {
      if (pending !== p) return;
      pending = null;
      noteColumns(root);
    }, 0);
  });
  pending = p;
}

/** The animations running on these elements (each asked on its own: no subtree style pass). */
const motionsOf = (els: readonly HTMLElement[]): Animation[] => els.flatMap((el) => (typeof el.getAnimations === "function" ? el.getAnimations() : []));

let settleGen = 0;

/**
 * The boxes just remembered were read mid-motion (a Shelf's box opening, a glide): remember them again once those
 * motions are over — else the next change (or, before, a focus switch) glided the columns from where a motion
 * happened to have them (owner 2026-10-21: the columns jumped back and slid in when the focus moved).
 */
function noteWhenStill(root: HTMLElement, motions: readonly Animation[]): void {
  if (!motions.length) return;
  const gen = ++settleGen;
  void Promise.all(motions.map((a) => a.finished.catch(() => undefined))).then(() => {
    if (gen === settleGen && root.isConnected && !pending) noteColumns(root);
  });
}

// ── The whole row in one slide (最大化 / 还原, lib/panelGrow) ──────────────────────────────────────
// Gliding each column on its own (translate + width) does not add up in a flex row: while one column eases wider
// and another narrower, the row's centring, the columns' flex-shrink and the Shelves beside them move under the
// animation — the panels jumped on the first frame and snapped again on the last (owner 2026-10-22: 最大化
// flickers). A row change made at once instead slides as a whole: every item of the row eases its width (no shrink,
// no grow meanwhile) and the row's leading space eases with them (`justify-content: flex-start` + `padding-left`),
// so each edge moves straight from where it was to where it goes. The old geometry is taken before the commit
// (`armRowGlide`, from a store listener: the DOM is still the old one), the slide after it (`glideColumns`).
// The eased width holds whatever the item's own basis: a column filling the row is `flex: 1 1 0%`, where a width does
// nothing — with no grow it collapsed to its border for the whole slide (maximize-scroll 2026-10-27: the timeline re-wrapped
// at 0 px and the history left the bottom). The change's later renders (SideArea storing the maximised widths) slide on
// with it: no per-column glide over it from boxes remembered before.

interface RowShot {
  root: HTMLElement;
  lead: number;
  widths: Map<HTMLElement, number>;
}
let armed: RowShot | null = null;
/** The row slide in progress (its motions), if any. */
let sliding: { root: HTMLElement; motions: Animation[] } | null = null;
const slideRunning = (root: HTMLElement): boolean => !!sliding && sliding.root === root && sliding.motions.some((a) => a.playState === "running");

/** The row's flex items: its children, through `display: contents` wrappers; hidden / zero-width ones left out. */
export function rowItems(root: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  const walk = (el: HTMLElement) => {
    for (const c of Array.from(el.children) as HTMLElement[]) {
      if (c.hidden) continue;
      if (getComputedStyle(c).display === "contents") walk(c);
      else if (getComputedStyle(c).position !== "absolute" && getComputedStyle(c).position !== "fixed") out.push(c);
    }
  };
  walk(root);
  return out;
}

function shootRow(root: HTMLElement): RowShot {
  const box = root.getBoundingClientRect();
  const pad = parseFloat(getComputedStyle(root).borderLeftWidth) || 0;
  const items = rowItems(root).filter((el) => el.getBoundingClientRect().width > 0);
  const widths = new Map(items.map((el) => [el, el.getBoundingClientRect().width] as const));
  const first = items.length ? Math.min(...items.map((el) => el.getBoundingClientRect().left)) : box.left + pad;
  return { root, lead: first - box.left - pad, widths };
}

/** Takes the row as it is now: the next `glideColumns` on it slides the whole row from here. Cleared after a frame if nothing came. */
export function armRowGlide(root: HTMLElement | null): void {
  if (!root || resizing() || reducedMotion()) return;
  const shot = shootRow(root);
  armed = shot;
  const view = ownerWindowOf(root);
  if (typeof view.requestAnimationFrame === "function") view.requestAnimationFrame(() => view.requestAnimationFrame(() => armed === shot && (armed = null)));
}

/** An animation that moves the width (not, say, the focus ring's transition). */
const widthMotion = (a: Animation): boolean => {
  if ("transitionProperty" in a) return (a as CSSTransition).transitionProperty === "width";
  const effect = a.effect as KeyframeEffect | null;
  return !!effect?.getKeyframes?.().some((k) => "width" in k);
};

/** The armed row slides from its old geometry to the new one (one motion for every item and the leading space). */
function rowGlide(shot: RowShot): void {
  const now = shootRow(shot.root);
  const motions: Animation[] = [];
  const keep = { flexShrink: "0", flexGrow: "0", flexBasis: "auto" };
  for (const [el, w] of now.widths) {
    const from = shot.widths.get(el);
    if (from === undefined || Math.abs(from - w) < 1 || typeof el.animate !== "function") continue;
    // A Shelf's box easing on its own (lib/shelfMotion, the same duration and easing) keeps that motion.
    if (el.getAnimations?.().some((a) => a.playState === "running" && widthMotion(a))) continue;
    motions.push(el.animate([{ ...keep, width: `${from}px` }, { ...keep, width: `${w}px` }], { duration: SHELF_MOTION_MS, easing: EASE }));
  }
  if (!motions.length && Math.abs(shot.lead - now.lead) < 1) return;
  if (typeof shot.root.animate === "function")
    motions.push(
      shot.root.animate([{ justifyContent: "flex-start", paddingLeft: `${shot.lead}px` }, { justifyContent: "flex-start", paddingLeft: `${now.lead}px` }], { duration: SHELF_MOTION_MS, easing: EASE }),
    );
  sliding = { root: shot.root, motions };
  slotsMotion();
  noteWhenStill(shot.root, motions);
}

/** The columns' own glides (not the row slide, not a Shelf box's motion), by the row they run in. */
const glides = new Map<Animation, HTMLElement>();

/** Ends the column glides running in `root` (each column drawn at its laid-out box at once). */
function stopGlides(root: HTMLElement): void {
  for (const [motion, at] of [...glides]) {
    if (at !== root && at.isConnected) continue;
    glides.delete(motion);
    if (motion.playState === "running" || motion.playState === "paused") motion.cancel();
  }
}

/**
 * After a structural change: the columns that moved glide from their old box. `still`: the change came from a
 * width drag or a resize of the work area (the caller knows), so they only take their new place.
 */
export function glideColumns(root: HTMLElement | null, still = false): void {
  if (!root) return;
  if (armed && armed.root === root) {
    const shot = armed;
    armed = null;
    cancelNote();
    if (!still && !resizing()) {
      rowGlide(shot);
      return;
    }
  }
  // The row slide's own later renders (the maximised widths stored): it carries them; the boxes are taken once it is over.
  if (!still && slideRunning(root)) return;
  if (still) {
    // A column glide still running holds the width it was aiming at — the row has just changed width under it, so
    // that width is gone: it ends now and the columns take their new place in this frame (unmaximize-jump
    // 2026-10-30: a glide toward the row's unmeasured first layout held the column at 860 px for its whole run,
    // then snapped to its 768).
    stopGlides(root);
    // Nothing moves: the boxes are only remembered — after this frame is painted, when reading them costs no
    // layout of its own (read here, in the commit's layout effect, every step of a window resize forced one:
    // perf re-run 2026-10-21 §7.3 N2).
    noteLater(root);
    return;
  }
  // A structural change right after a resize step, before its boxes were remembered: they are taken now, without a glide.
  const stale = pending !== null;
  cancelNote();
  // A Shelf's box moving (lib/shelfMotion) moves the columns frame by frame already: no glide of its own.
  const shelves = motionsOf([...root.querySelectorAll<HTMLElement>("[data-shelf-box], [data-side-box]")]);
  const running = [...shelves, ...motionsOf(glideBoxes(root))];
  const quiet = stale || resizing() || reducedMotion() || shelves.length > 0;
  let moved = false;
  for (const el of glideBoxes(root)) {
    const id = el.dataset.glide!;
    const r = el.getBoundingClientRect();
    const before = last.get(id);
    if (r.width > 0) last.set(id, { left: r.left, width: r.width });
    if (quiet || !before || r.width <= 0 || typeof el.animate !== "function") continue;
    const dx = before.left - r.left;
    if (Math.abs(dx) < 2 && Math.abs(before.width - r.width) < 2) continue;
    const motion = el.animate([{ transform: `translateX(${Math.round(dx)}px)`, width: `${Math.round(before.width)}px` }, { transform: "none", width: `${Math.round(r.width)}px` }], { duration: SHELF_MOTION_MS, easing: EASE });
    if (motion) {
      for (const [m] of glides) if (m.playState === "finished" || m.playState === "idle") glides.delete(m);
      glides.set(motion, root);
    }
    moved = true;
  }
  if (moved) slotsMotion();
  // Read mid-motion (a Shelf's box moving, a glide still running): taken again once it is over.
  noteWhenStill(root, running);
}

/** Tests: forget every remembered box. */
export function resetColumnGlide(): void {
  cancelNote();
  armed = null;
  sliding = null;
  settleGen++;
  if (keyTimer !== null) clearTimeout(keyTimer);
  keyTimer = null;
  keyCommit = null;
  last.clear();
  glides.clear();
  resizeDrag(false);
  settleUntil = 0;
}
