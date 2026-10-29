// Margin attachments' push-down (docs/desktop-modules.md §19.3): each `timeline.turnAttachment` box
// shown in a gutter sits at its turn's first line (an absolutely placed child of a zero-height anchor,
// so it scrolls with the content without measuring); when two would overlap, the later one moves down
// (lib/marginStack.ts) by a translateY. One conversation timeline is on screen at a time (read-only
// timelines have no attachments), so this is a single registry. Re-laid out when a box resizes or
// the timeline's content does (turns above an anchor growing move it).
import { marginStack } from "./marginStack";
import { ownerWindowOf } from "./ownerWindow";

interface Entry {
  side: "left" | "right";
  anchor: HTMLElement;
  box: HTMLElement;
}

const entries = new Map<string, Entry>();
let frame = 0;
/** One observer per window (a desk window's timeline is observed with its own, multi-window). */
const observers = new Map<Window, ResizeObserver>();
const roots = new Set<Element>();

function apply(): void {
  frame = 0;
  for (const side of ["left", "right"] as const) {
    const list = [...entries].filter(([, e]) => e.side === side && e.box.isConnected);
    const boxes = list.map(([id, e]) => ({ id, anchor: e.anchor.getBoundingClientRect().top, height: e.box.offsetHeight }));
    const tops = marginStack(boxes.filter((b) => b.height > 0));
    for (const [id, e] of list) {
      const b = boxes.find((x) => x.id === id)!;
      const top = tops.get(id);
      const shift = top === undefined ? 0 : Math.round(top - b.anchor);
      const value = shift ? `translateY(${shift}px)` : "";
      if (e.box.style.transform !== value) e.box.style.transform = value;
    }
  }
}

/** On the next frame of `view` (the window whose boxes changed). */
function schedule(view: Window = window): void {
  if (frame || typeof view.requestAnimationFrame === "undefined") return;
  frame = view.requestAnimationFrame(apply);
}

/** A margin box beside its anchor; returns the unregister function. */
export function registerMargin(id: string, side: "left" | "right", anchor: HTMLElement, box: HTMLElement): () => void {
  entries.set(id, { side, anchor, box });
  const view = ownerWindowOf(box);
  let observer = observers.get(view);
  if (!observer && typeof ResizeObserver !== "undefined") observers.set(view, (observer = new view.ResizeObserver(() => schedule(view))));
  observer?.observe(box);
  const root = anchor.closest("[data-timeline-root]");
  if (root && !roots.has(root)) {
    roots.add(root);
    observer?.observe(root);
  }
  schedule(view);
  return () => {
    if (entries.get(id)?.box === box) entries.delete(id);
    observer?.unobserve(box);
    for (const r of roots) {
      if (!r.isConnected) {
        observer?.unobserve(r);
        roots.delete(r);
      }
    }
    schedule(view);
  };
}
