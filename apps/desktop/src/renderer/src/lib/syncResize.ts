// One synchronous layout pass per frame for the window's resize observers (perf re-run 2026-10-21 §7.3 N2,
// docs/research/perf-baseline-20261020.md). The work row (components/side/SideArea), the Settings Shelf
// (components/SettingsShelf) and the instance layer (components/side/SideInstanceLayer) each lay out in the
// same frame as a resize — a ResizeObserver runs after layout and before paint, so a plain state update was
// painted a frame late (owner 2026-10-21: panels flying on a window resize). Each used to own an observer that
// called `flushSync` on its own: two to three synchronous commits per resize step, each re-rendering the
// conversation columns. Here one observer watches every element and, per notification, runs:
//   1. every "layout" callback of the elements that changed, all inside ONE `flushSync` (one commit; the work
//      row's layout effect then moves the instance layer in that commit, lib/sideSlots slotsRelayout);
//   2. then every "follow" callback (the instance layer measuring its placeholders) — skipped by the callers
//      that already measured in step 1's commit (`syncPass`).
// Shell code: names no feature.
import { flushSync } from "react-dom";
import { ownerWindowOf } from "./ownerWindow";

export type SyncPhase = "layout" | "follow";

interface Watch {
  fn: () => void;
  phase: SyncPhase;
}

const watches = new Map<Element, Set<Watch>>();
/** One observer per window (a desk window's elements are observed with its own, multi-window); `count`: its elements. */
const observers = new Map<Window, { ro: ResizeObserver; count: number }>();
let pass = 0;

/** The current resize pass (incremented once per observer notification): "measured in this pass already". */
export function syncPass(): number {
  return pass;
}

function run(entries: readonly ResizeObserverEntry[] | undefined): void {
  pass++;
  const layout = new Set<() => void>();
  const follow = new Set<() => void>();
  // No entries (a test calling the callback by hand): every element counts as changed.
  const targets = entries && entries.length ? entries.map((e) => e.target) : [...watches.keys()];
  for (const t of targets) {
    for (const w of watches.get(t) ?? []) (w.phase === "layout" ? layout : follow).add(w.fn);
  }
  if (layout.size) {
    flushSync(() => {
      for (const fn of layout) fn();
    });
  }
  for (const fn of follow) fn();
}

/**
 * Calls `fn` (synchronously, before paint) whenever `el` changes size. "layout" callbacks of one notification
 * share one `flushSync`; "follow" callbacks run after it (and flush their own updates if they need to).
 */
export function observeSync(el: Element, fn: () => void, phase: SyncPhase = "layout"): () => void {
  if (typeof ResizeObserver === "undefined") return () => {};
  const view = ownerWindowOf(el);
  const w: Watch = { fn, phase };
  let set = watches.get(el);
  if (!set) {
    set = new Set();
    watches.set(el, set);
    let o = observers.get(view);
    if (!o) observers.set(view, (o = { ro: new view.ResizeObserver((entries) => run(entries)), count: 0 }));
    o.count++;
    o.ro.observe(el);
  }
  set.add(w);
  return () => {
    const now = watches.get(el);
    if (!now?.delete(w)) return;
    if (now.size) return;
    watches.delete(el);
    const o = observers.get(view);
    if (!o) return;
    o.ro.unobserve(el);
    if (--o.count === 0) {
      o.ro.disconnect();
      observers.delete(view);
    }
  };
}
