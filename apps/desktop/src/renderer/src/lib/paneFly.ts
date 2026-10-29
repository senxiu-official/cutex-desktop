// The collapse / restore gesture (docs/desktop-modules.md §24 step 4; the prototype's `fly`): a ghost of
// the pane — a card with its title — flies between the pane's place and its chip in the tray (motion `long`,
// the card's corners rounding into the pill). Nothing flies with prefers-reduced-motion. DOM only, after
// the next paint (the chip / the pane is there by then). Shell code: names no feature.
import { EASE_STANDARD, MOTION, motionAllowed } from "./motion";
import { ownerWindowOf } from "./ownerWindow";
import { queryAppWindows } from "./appWindowSet";

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

// Motion tokens (docs/design/021-motion.md, lib/motion): one curve, three durations.
const DURATION = MOTION.long;
const EASING = EASE_STANDARD;

/** No motion now: reduced motion, or the first paint has not settled (lib/motion). */
export function reducedMotion(): boolean {
  return !motionAllowed();
}

/** A plain box of an element (null: none, or nothing to see). */
export function boxOf(el: Element | null | undefined): Box | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? { left: r.left, top: r.top, width: r.width, height: r.height } : null;
}

/** Two frames of `win` (the tray and its chips are the main window's until per-window layouts, P3). */
function afterPaint(fn: () => void, win: Window = window): void {
  if (typeof win.requestAnimationFrame !== "function") return;
  win.requestAnimationFrame(() => win.requestAnimationFrame(fn));
}

const asCard = (b: Box) => ({ left: `${b.left}px`, top: `${b.top}px`, width: `${b.width}px`, height: `${b.height}px`, borderRadius: "13px", opacity: 1 });
const asPill = (b: Box) => ({ left: `${b.left}px`, top: `${b.top}px`, width: `${b.width}px`, height: `${b.height}px`, borderRadius: "999px", opacity: 0.25 });

function ghost(title: string, doc: Document): HTMLElement {
  const g = doc.createElement("div");
  g.className = "pane-fly";
  g.setAttribute("aria-hidden", "true");
  const head = doc.createElement("div");
  head.className = "pane-fly-head";
  head.textContent = title;
  g.appendChild(head);
  doc.body.appendChild(g);
  return g;
}

/** The chip element of a tray key. */
export const chipElement = (key: string): HTMLElement | null => (typeof document === "undefined" ? null : queryAppWindows<HTMLElement>(`[data-pane-chip="${CSS.escape(key)}"]`));

/** A pane went to the tray: its ghost flies from `from` (where it was) into chip `key`. */
export function flyToChip(from: Box | null, key: string, title: string): void {
  if (!from || reducedMotion() || typeof document === "undefined") return;
  afterPaint(() => {
    const chip = chipElement(key);
    const to = boxOf(chip);
    if (!chip || !to) return;
    const g = ghost(title, chip.ownerDocument);
    chip.style.opacity = "0";
    const anim = g.animate([asCard(from), asPill(to)], { duration: DURATION, easing: EASING, fill: "forwards" });
    const done = () => {
      g.remove();
      chip.style.opacity = "";
    };
    anim.onfinish = done;
    anim.oncancel = done;
  });
}

/** A chip came back: its ghost flies from the chip's place (`from`) to the pane, which shows once it lands. */
export function flyFromChip(from: Box | null, pane: () => HTMLElement[], title: string): void {
  if (!from || reducedMotion() || typeof document === "undefined") return;
  afterPaint(() => {
    const els = pane();
    const to = boxOf(els[0]);
    if (!to) return;
    const g = ghost(title, els[0]!.ownerDocument);
    for (const el of els) el.style.opacity = "0";
    const anim = g.animate([asPill(from), asCard(to)], { duration: DURATION, easing: EASING, fill: "forwards" });
    const done = () => {
      for (const el of els) el.style.opacity = "";
      ownerWindowOf(g).requestAnimationFrame(() => g.remove());
    };
    anim.onfinish = done;
    anim.oncancel = done;
  });
}
