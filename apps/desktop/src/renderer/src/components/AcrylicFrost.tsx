// 亚克力 without a per-frame blur (#14, perf-baseline-20261020.md §10). Each acrylic card used to blur what is
// behind it itself (`backdrop-filter`); any looping animation on screen (a running ring, a spinner) then made
// the browser redo that 30 px blur for the card every frame. Instead the desktop background is drawn a second
// time, blurred once (a plain `filter` on a layer that does not change), right above the sharp one and clipped
// to the cards' shapes; the cards keep their translucent colour over it and drop their own `backdrop-filter`
// (styles.css `:root[data-acrylic-frost]`). Same look: the cards show the blurred desktop, the gaps between
// them the sharp one.
// The clip follows the cards: re-measured when a card or the window changes size (the shared ResizeObserver),
// frame by frame only while a card's box animates (a glide, a Shelf opening), when the work row is laid out
// again (lib/sideSlots), and when a card comes or goes.
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { sharedResizeObserver } from "../lib/resizeHub";
import { LAYOUT_PROPS, moving, onSlotsMotion, onSlotsRelayout } from "../lib/sideSlots";
import { isElement, ownerWindowOf } from "../lib/ownerWindow";

export const CARD_SELECTOR = ".shell-card, .sidebar-card, .shelf-rail-card";

/**
 * One rounded rectangle as SVG path data (radii clamped to the box, like CSS does). `r`: one radius, or each corner's
 * (top-left, top-right, bottom-right, bottom-left: a Shelf pane is square on its rail's side, Rail look A).
 */
export function roundedRect(x: number, y: number, w: number, h: number, r: number | readonly [number, number, number, number]): string {
  const f = (n: number) => Math.round(n * 100) / 100;
  if (typeof r !== "number" && !r.every((v) => v === r[0])) {
    const [tl, tr, br, bl] = r.map((v) => Math.max(0, Math.min(v, w / 2, h / 2))) as [number, number, number, number];
    const arc = (k: number, ex: number, ey: number) => (k ? `A${f(k)},${f(k)} 0 0 1 ${f(ex)},${f(ey)}` : "");
    return `M${f(x + tl)},${f(y)}H${f(x + w - tr)}${arc(tr, x + w, y + tr)}V${f(y + h - br)}${arc(br, x + w - br, y + h)}H${f(x + bl)}${arc(bl, x, y + h - bl)}V${f(y + tl)}${arc(tl, x + tl, y)}Z`;
  }
  const k = Math.max(0, Math.min(typeof r === "number" ? r : r[0], w / 2, h / 2));
  if (!k) return `M${f(x)},${f(y)}H${f(x + w)}V${f(y + h)}H${f(x)}Z`;
  return `M${f(x + k)},${f(y)}H${f(x + w - k)}A${f(k)},${f(k)} 0 0 1 ${f(x + w)},${f(y + k)}V${f(y + h - k)}A${f(k)},${f(k)} 0 0 1 ${f(x + w - k)},${f(y + h)}H${f(x + k)}A${f(k)},${f(k)} 0 0 1 ${f(x)},${f(y + h - k)}V${f(y + k)}A${f(k)},${f(k)} 0 0 1 ${f(x + k)},${f(y)}Z`;
}

export function transparent(color: string): boolean {
  return color === "transparent" || /^rgba\(.*,\s*0\)$/.test(color) || /\/\s*0\)$/.test(color);
}

/** The clip of the frost layer (`origin`: its own box): every card on screen, by its border box and radius. */
export function cardsClip(origin: DOMRect, cards: readonly Element[]): string {
  const parts: string[] = [];
  for (const card of cards) {
    const r = card.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const cs = getComputedStyle(card);
    // A card that paints nothing (the empty main card while the desktop shows) lets the sharp desktop through.
    if (transparent(cs.backgroundColor)) continue;
    const radius = (v: string) => parseFloat(v) || 0;
    parts.push(roundedRect(r.left - origin.left, r.top - origin.top, r.width, r.height, [radius(cs.borderTopLeftRadius), radius(cs.borderTopRightRadius), radius(cs.borderBottomRightRadius), radius(cs.borderBottomLeftRadius)]));
  }
  return parts.length ? `path("${parts.join(" ")}")` : "inset(50%)";
}

/**
 * The blurred copy (`children`: the desktop background, drawn again) clipped to the cards. Mounted only with
 * 亚克力 and a desktop background; marks <html data-acrylic-frost> while mounted.
 */
export function AcrylicFrost({ children }: { children: ReactNode }) {
  return (
    <FrostLayer selector={CARD_SELECTOR} marker="acrylicFrost" className="acrylic-frost">
      {children}
    </FrostLayer>
  );
}

/** The window bar's frost over the desktop (styles.css `[data-window-titlebar]`), drawn the same way. */
export const TITLEBAR_SELECTOR = "[data-window-titlebar]";

/**
 * The title bar's frost over the desktop, blurred once like the cards' (any material): its own
 * backdrop-filter re-blurred every frame something in or under the bar moved (perf-baseline §10).
 * Marks <html data-titlebar-frost>.
 */
export function TitlebarFrost({ children }: { children: ReactNode }) {
  return (
    <FrostLayer selector={TITLEBAR_SELECTOR} marker="titlebarFrost" className="titlebar-frost">
      {children}
    </FrostLayer>
  );
}

/** A blurred copy of `children` (the layer's CSS class sets the filter) clipped to the elements of `selector`. */
function FrostLayer({ selector, marker, className, children }: { selector: string; marker: string; className: string; children: ReactNode }) {
  const frost = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = frost.current;
    if (!el) return;
    // The layer's own window (a desk window's, multi-window): its cards, its frames, its motion events.
    const doc = el.ownerDocument;
    const view = ownerWindowOf(el);
    const root = doc.documentElement;
    root.dataset[marker] = "";
    let cards: Element[] = [];
    let frame = 0;
    const ro = sharedResizeObserver(() => measure());
    const measure = () => {
      const now = [...doc.querySelectorAll(selector)];
      if (now.length !== cards.length || now.some((c, i) => c !== cards[i])) {
        for (const c of cards) if (!now.includes(c)) ro.unobserve(c);
        for (const c of now) if (!cards.includes(c)) ro.observe(c);
        cards = now;
      }
      el.style.clipPath = cardsClip(el.getBoundingClientRect(), cards);
    };
    // A card's box animating (a column glide, a Shelf opening / closing — Web Animations signalled through
    // lib/sideSlots, or a CSS transition / animation of a box property on a card or around one): follow it
    // frame by frame until nothing in the work area moves.
    const follow = () => {
      frame = 0;
      measure();
      const host = doc.querySelector("[data-pane-host]");
      if (host && moving(host)) frame = view.requestAnimationFrame(follow);
    };
    const start = () => {
      if (!frame) frame = view.requestAnimationFrame(follow);
    };
    const onMotion = (e: Event) => {
      if ("propertyName" in e && !LAYOUT_PROPS.test((e as TransitionEvent).propertyName)) return;
      if (isElement(e.target) && (e.target.matches(selector) || e.target.querySelector(selector))) start();
    };
    const offMotion = onSlotsMotion(start);
    // The work row laid out again in a layout effect (a fold, a width): measure in the same frame.
    const offRelayout = onSlotsRelayout(measure);
    const onEnd = (e: Event) => isElement(e.target) && e.target.matches(selector) && measure();
    // Cards come and go with the panes (a Shelf, a second workspace, the sidebar as a rail): the work area's
    // direct structure, not every streamed row (the pane host, two levels of its children).
    const host = doc.querySelector("[data-pane-host]");
    const mo = new MutationObserver(() => measure());
    if (host) mo.observe(host, { childList: true, subtree: false, attributes: true, attributeFilter: ["class", "hidden"] });
    // The desktop shown / covered, edge to edge: which cards paint changes.
    mo.observe(root, { attributes: true, attributeFilter: ["data-desk-state", "data-edge-to-edge", "data-theme"] });
    ro.observe(doc.body);
    measure();
    doc.addEventListener("animationstart", onMotion, true);
    doc.addEventListener("transitionrun", onMotion, true);
    doc.addEventListener("animationend", onEnd, true);
    doc.addEventListener("transitionend", onEnd, true);
    return () => {
      delete root.dataset[marker];
      offMotion();
      offRelayout();
      view.cancelAnimationFrame(frame);
      ro.disconnect();
      mo.disconnect();
      doc.removeEventListener("animationstart", onMotion, true);
      doc.removeEventListener("transitionrun", onMotion, true);
      doc.removeEventListener("animationend", onEnd, true);
      doc.removeEventListener("transitionend", onEnd, true);
    };
  }, [selector, marker]);
  return (
    <div ref={frost} data-frost-layer="" aria-hidden inert className={className}>
      {children}
    </div>
  );
}
