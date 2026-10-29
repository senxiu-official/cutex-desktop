import { isElement } from "./ownerWindow";
// Looping animations rest while the window is not in front (perf audit 2026-10-23 §4.3, owner 2026-10-23): with
// everything open, the running rings, pulsing dots, typing dots and spinners kept the main thread ~33 % busy while
// nothing changed — all of it the loops (paused: ~1.4 %). Not in front = the window lost focus, is minimised or
// covered (`document.visibilityState`). Only infinite loops are paused — a one-shot animation (a pane easing in, a
// toast) still finishes, so nothing is left half-drawn in a window the owner can still see beside another one.
// Back in front they run again from the shared phase (lib/animationPhase). In front: nothing changes.
// `setLoopPauseEnabled(false)` (性能 → 流畅优先) keeps them running while the window is not in front.
// Shell code: names no feature.

let enabled = true;
let refresh: (() => void) | null = null;

function isLoop(a: Animation): boolean {
  return a.effect?.getTiming?.().iterations === Infinity;
}

/** Whether loops pause while the window is not in front (default on). */
export function setLoopPauseEnabled(on: boolean): void {
  if (enabled === on) return;
  enabled = on;
  refresh?.();
}

export function loopPauseEnabled(): boolean {
  return enabled;
}

/**
 * Pauses every running infinite animation while the window is not in front, and those that start meanwhile; plays
 * them again (phase-aligned, `startTime = 0`) when it is. Returns the uninstall (which plays them again too).
 */
export function installLoopPause(win: Window = window, doc: Document = document): () => void {
  if (typeof doc.getAnimations !== "function") return () => {};
  // The loops this paused (not the page's own pauses). Weak: a loop whose element is removed while resting (an agent
  // row leaving the list) is not kept alive, with its detached element, until the window comes back.
  let paused = new WeakSet<Animation>();
  let resting = false;
  const inFront = () => doc.visibilityState === "visible" && doc.hasFocus();
  const rest = (a: Animation) => {
    if (a.playState !== "running" || !isLoop(a)) return;
    a.pause();
    paused.add(a);
  };
  const wake = () => {
    for (const a of doc.getAnimations()) {
      // Still paused by us (not cancelled / finished / removed with its element): run again in the shared phase.
      if (paused.has(a) && a.playState === "paused") a.startTime = 0;
    }
    paused = new WeakSet();
  };
  const update = () => {
    const next = enabled && !inFront();
    if (next === resting) return;
    resting = next;
    if (resting) for (const a of doc.getAnimations()) rest(a);
    else wake();
  };
  // A loop that starts while resting (an agent starts running in the background): paused at once. Registered after
  // lib/animationPhase, whose alignment would otherwise start it again.
  const onStart = (e: Event) => {
    if (!resting) return;
    const { target, animationName } = e as AnimationEvent;
    if (!isElement(target)) return;
    for (const a of target.getAnimations()) if ((a as CSSAnimation).animationName === animationName) rest(a);
  };
  win.addEventListener("focus", update);
  win.addEventListener("blur", update);
  doc.addEventListener("visibilitychange", update);
  doc.addEventListener("animationstart", onStart, true);
  refresh = update;
  update();
  return () => {
    win.removeEventListener("focus", update);
    win.removeEventListener("blur", update);
    doc.removeEventListener("visibilitychange", update);
    doc.removeEventListener("animationstart", onStart, true);
    if (refresh === update) refresh = null;
    resting = false;
    wake();
  };
}
