// Menus / popovers / tooltips are always on top (owner 2026-10-23): the foretell outlines (design 008) and the drop
// previews sit under them. By z-index alone (styles.css 「Layers」: previews 47–49, overlays ≥ 50) that holds for the
// window-level overlays only — a popover inside a pane (the composer's palettes and menus, a status chip's list)
// lives in its card's stacking context (`isolate`, the acrylic backdrop-filter) and can never rise above a
// window-level layer. So the preview layers also leave a hole where every open popover is: an even-odd clip-path
// with one rounded rectangle per popover. Pure parts tested (test/layerOrder.test.ts).
import { useEffect, useState } from "react";
import { useOwnerWindow } from "./ownerContext";

/** What counts as an open popover / menu / tooltip — a dropdown list or a panel that floats marks itself `data-popover` (not `role="listbox"`: lists in panes use it too). */
export const POPOVER_SELECTOR = '[role="menu"], [role="dialog"], [role="tooltip"], [data-popover]';

/** The preview layers themselves (never a hole for their own labels). */
const PREVIEW_LAYERS = "[data-foretell], [data-side-dnd], [data-ws-dnd]";

export interface HoleBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

const f = (n: number) => Math.round(n * 100) / 100;

/** A rounded rectangle as path data (radius clamped to the box). */
function rounded(b: HoleBox, r: number): string {
  const k = Math.max(0, Math.min(r, b.width / 2, b.height / 2));
  const { left: x, top: y, width: w, height: h } = b;
  if (!k) return `M${f(x)},${f(y)}H${f(x + w)}V${f(y + h)}H${f(x)}Z`;
  return `M${f(x + k)},${f(y)}H${f(x + w - k)}A${f(k)},${f(k)} 0 0 1 ${f(x + w)},${f(y + k)}V${f(y + h - k)}A${f(k)},${f(k)} 0 0 1 ${f(x + w - k)},${f(y + h)}H${f(x + k)}A${f(k)},${f(k)} 0 0 1 ${f(x)},${f(y + h - k)}V${f(y + k)}A${f(k)},${f(k)} 0 0 1 ${f(x + k)},${f(y)}Z`;
}

/** The clip of a window-sized layer (`w` × `h`) with a hole per box; undefined: no hole (no clip at all). */
export function holesClip(w: number, h: number, holes: readonly HoleBox[], radius = 12): string | undefined {
  const shown = holes.filter((b) => b.width > 0 && b.height > 0);
  if (!shown.length) return undefined;
  return `path(evenodd, "M0,0H${f(w)}V${f(h)}H0Z ${shown.map((b) => rounded(b, radius)).join(" ")}")`;
}

/** The open popovers (menus, dialogs, tooltips; not the preview layers' own labels). */
export function openPopovers(root: ParentNode = document): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(POPOVER_SELECTOR)].filter((el) => !el.closest(PREVIEW_LAYERS));
}

/** `els`' border boxes on screen now, a pixel larger so their edge stays clean (hidden / empty ones left out). */
export function popoverBoxes(els: readonly HTMLElement[]): HoleBox[] {
  const out: HoleBox[] = [];
  for (const el of els) {
    if (!el.isConnected) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    out.push({ left: r.left - 1, top: r.top - 1, width: r.width + 2, height: r.height + 2 });
  }
  return out;
}

/** The open popovers on screen now (their border boxes, a pixel larger so their edge stays clean). */
export function openPopoverBoxes(root: ParentNode = document): HoleBox[] {
  return popoverBoxes(openPopovers(root));
}

/**
 * With no popover open, how often a showing layer looks for one (0.2.0 beta perf audit: the whole-document query on
 * every frame was ~20 % of the main thread during a drag). A menu opening mid-drag gets its hole within this; while
 * one is open the search runs every frame again (a submenu, a popover closing).
 */
export const HOLE_SEARCH_MS = 100;

/**
 * The clip-path of a preview layer while it shows (`active`): a hole for every open popover, followed frame by frame
 * (a popover moving or scrolling; a new one: see HOLE_SEARCH_MS). Nothing runs while the layer shows nothing.
 */
export function useOverlayHoles(active: boolean): string | undefined {
  const [clip, setClip] = useState<string | undefined>(undefined);
  // The layer's own window (a desk window's layer, multi-window): its popovers, its size, its frames.
  const win = useOwnerWindow();
  useEffect(() => {
    if (!active || typeof win.requestAnimationFrame !== "function") {
      setClip(undefined);
      return;
    }
    let frame = 0;
    let last: string | undefined = "∅";
    let found: HTMLElement[] = [];
    let searchedAt = -Infinity;
    const tick = (now: number) => {
      if (found.length || now - searchedAt >= HOLE_SEARCH_MS) {
        found = openPopovers(win.document);
        searchedAt = now;
      }
      const next = holesClip(win.innerWidth, win.innerHeight, popoverBoxes(found));
      if (next !== last) setClip((last = next));
      frame = win.requestAnimationFrame(tick);
    };
    tick(performance.now());
    return () => win.cancelAnimationFrame(frame);
  }, [active, win]);
  return clip;
}
