// Inline images (data: URLs, often ~1 MB of base64 each) far from what shows get their src only when they
// come near the scrolled view: putting a long data URL on an <img> costs the main thread (~1 ms each,
// image-heavy measurement 2026-10-26) and its decode keeps memory, for rows nobody looks at. Until then the
// <img> shows an empty SVG of the same pixel size (lib/imageHeader), so it lays out exactly as the image
// will and nothing moves when the real one arrives. An image of unknown size, or no IntersectionObserver,
// gets its src at once, as before.
import { useEffect, useMemo, useState } from "react";
import { dataUrlDimensions } from "./imageHeader";
import { ownerWindowOf } from "./ownerWindow";

/** How far outside its scrolling box (one box height above and below) an inline image is already given its src. */
export const LAZY_IMAGE_MARGIN = "100% 0px";

// One observer per scrolling box, the box as its root: a margin on the implicit root stops at the scrolling
// box's edge, and `scrollMargin` did not widen it there either (headless Chrome 155, measured).
type Observers = { ctor: typeof IntersectionObserver; byRoot: WeakMap<Element, IntersectionObserver>; page?: IntersectionObserver };
let observers: Observers | null = null;
/** A desk window's own (multi-window): an observer from this realm follows the main window's frames, not the desk's. */
const deskObservers = new WeakMap<Window, Observers>();
const waiting = new Map<Element, () => void>();

function scrollRoot(el: Element): Element | null {
  const doc = el.ownerDocument;
  for (let e = el.parentElement; e && e !== doc.body && e !== doc.documentElement; e = e.parentElement) {
    const y = getComputedStyle(e).overflowY;
    if (y === "auto" || y === "scroll") return e;
  }
  return null;
}

function observer(root: Element | null, view: Window = window): IntersectionObserver | null {
  let set: Observers;
  if (view === window) {
    if (typeof IntersectionObserver === "undefined") return null;
    if (observers?.ctor !== IntersectionObserver) observers = { ctor: IntersectionObserver, byRoot: new WeakMap() };
    set = observers;
  } else {
    const ctor = (view as Window & { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver;
    if (!ctor) return null;
    set = deskObservers.get(view) ?? { ctor, byRoot: new WeakMap() };
    deskObservers.set(view, set);
  }
  const known = root ? set.byRoot.get(root) : set.page;
  if (known) return known;
  const io = new set.ctor((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const done = waiting.get(e.target);
      if (!done) continue;
      waiting.delete(e.target);
      io.unobserve(e.target);
      done();
    }
  }, { root, rootMargin: LAZY_IMAGE_MARGIN });
  if (root) set.byRoot.set(root, io); else set.page = io;
  return io;
}

/** Same pixel size as the image, nothing drawn. */
export function placeholderSrc(width: number, height: number): string {
  return `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}'%3E%3C/svg%3E`;
}

/**
 * The src to put on the <img> now for `src`, and a ref for that <img> (its nearness decides). `pending`: the
 * placeholder shows.
 */
export function useLazyDataSrc(src: string | null): { lazyRef: (el: Element | null) => void; shownSrc: string | null; pending: boolean } {
  const [el, lazyRef] = useState<Element | null>(null);
  const [nearSrc, setNearSrc] = useState<string | null>(null);
  const dims = useMemo(() => (src?.startsWith("data:image/") ? dataUrlDimensions(src) : null), [src]);
  const pending = !!src && !!dims && nearSrc !== src && typeof IntersectionObserver !== "undefined";
  useEffect(() => {
    if (!pending || !el || !src) return;
    const io = observer(scrollRoot(el), ownerWindowOf(el));
    if (!io) { setNearSrc(src); return; }
    waiting.set(el, () => setNearSrc(src));
    io.observe(el);
    return () => { waiting.delete(el); io.unobserve(el); };
  }, [pending, el, src]);
  return { lazyRef, shownSrc: pending ? placeholderSrc(dims!.width, dims!.height) : src, pending };
}
