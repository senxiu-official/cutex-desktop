// The one tooltip (design 040 §2.1, level T): any element with `data-tip="…"` gets a small inverted label after
// 500 ms of hover or on keyboard focus, instead of the OS tooltip of a native `title`. One delegated listener per app
// window (installed by components/Tip for this window and every desk window), so it works in desk windows too.
// Rules: a tip never covers the panel its own button opened (the anchor, or a button inside it, is
// `aria-expanded="true"` → no tip); an anchor marked `data-tip-overflow` (a label that repeats its own text) gets one
// only while that text is cut off; an anchor inside an open float, or in the sidebar (`data-tip-beside`), gets its
// tip outside that edge; a press, Esc, a scroll or leaving the window hides it at once. Reduced motion: no fade
// (`--motion-short` is 0).
import { placePanel, type PanelSide } from "./anchoredPanel";
import { isElement } from "./ownerWindow";

export const TIP_DELAY = 500;
/** Moving from one tip to the next within this long shows the next one at once (no second wait). */
const WARM = 400;
const GAP = 6;
const MARGIN = 16;

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Where a tip goes. In a float (`float`: its box): beside the float, on the side with room, level with the anchor —
 * never over the float's rows. Else on `side` (`data-tip-side`) or below the anchor, above when there is no room.
 */
export function placeTip(
  anchor: Box,
  box: { width: number; height: number },
  view: { width: number; height: number },
  { float = null, side }: { float?: Box | null; side?: PanelSide } = {},
): { left: number; top: number; side: PanelSide } {
  if (float) {
    const s: PanelSide = float.right + GAP + box.width <= view.width - MARGIN || float.left - GAP - box.width < MARGIN ? "right" : "left";
    return { ...placePanel({ left: float.left, right: float.right, top: anchor.top, bottom: anchor.bottom }, box, s, view), side: s };
  }
  let s: PanelSide = side ?? (anchor.bottom + GAP + box.height <= view.height - MARGIN ? "below" : "above");
  // A side with no room flips (a left-docked sidebar's tips go right; docked right, they go left).
  if (s === "right" && anchor.right + GAP + box.width > view.width - MARGIN && anchor.left - GAP - box.width >= MARGIN) s = "left";
  else if (s === "left" && anchor.left - GAP - box.width < MARGIN && anchor.right + GAP + box.width <= view.width - MARGIN) s = "right";
  return { ...placePanel(anchor, box, s, view), side: s };
}

/** What counts as an open floating panel (a menu, popover, picker, tray panel). */
const OPEN_FLOAT = '.float, [role="menu"], [data-popover]';

/**
 * No tip while the anchor's own panel is open (it would cover it): the anchor (or a button in it) is expanded and a
 * float is open. An expanded toggle that opened no float (the sidebar button: the sidebar is shown) keeps its tip.
 */
export function tipSuppressed(anchor: Element): boolean {
  const expanded = anchor.getAttribute("aria-expanded") === "true" || !!anchor.querySelector('[aria-expanded="true"]');
  return expanded && !!anchor.ownerDocument.querySelector(OPEN_FLOAT);
}

/**
 * A `data-tip-overflow` anchor repeats its own text in the tip: worth showing only when the text is cut off (the
 * anchor or an element in it is truncated / line-clamped). Any other anchor: always.
 */
export function tipWanted(anchor: Element): boolean {
  if (!anchor.hasAttribute("data-tip-overflow")) return true;
  return [anchor, ...anchor.querySelectorAll("*")].some((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1);
}

/** The float the anchor sits in (not the anchor itself), for placing its tip outside. */
export function floatAround(anchor: Element): Element | null {
  return anchor.parentElement?.closest(".float") ?? null;
}

/** Hook up tips in one window; returns the detach. */
export function installTips(win: Window): () => void {
  const doc = win.document;
  let anchor: HTMLElement | null = null;
  let tip: HTMLElement | null = null;
  let timer = 0;
  let watch = 0;
  let hiddenAt = 0;
  /** An anchor that was pressed shows no tip again until the pointer leaves it. */
  let pressed: HTMLElement | null = null;
  let describedBy: string | null = null;

  const text = (el: HTMLElement) => el.getAttribute("data-tip")?.trim() ?? "";

  /** The tip goes; the anchor stays armed (a `data-tip-overflow` label whose text fits again). */
  const dropTip = () => {
    if (watch) win.clearInterval(watch);
    watch = 0;
    if (tip) {
      tip.remove();
      tip = null;
      hiddenAt = Date.now();
      if (anchor) {
        if (describedBy === null) anchor.removeAttribute("aria-describedby");
        else anchor.setAttribute("aria-describedby", describedBy);
      }
    }
  };

  /**
   * While a `data-tip-overflow` anchor is hovered / focused its size can change (the window or its pane is
   * resized): the tip follows whether the text is cut off now — it appears once it is, goes once it fits.
   */
  let overflow: { el: HTMLElement; stop: () => void } | null = null;
  const stopOverflow = () => {
    overflow?.stop();
    overflow = null;
  };
  const watchOverflow = (el: HTMLElement) => {
    if (overflow?.el === el || !el.hasAttribute("data-tip-overflow")) return;
    stopOverflow();
    const check = () => {
      if (anchor !== el || timer) return;
      if (tip && !tipWanted(el)) dropTip();
      else if (!tip && tipWanted(el)) show(el);
    };
    const Observer = (win as Window & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    const ro = Observer ? new Observer(check) : null;
    ro?.observe(el);
    win.addEventListener("resize", check);
    overflow = {
      el,
      stop: () => {
        ro?.disconnect();
        win.removeEventListener("resize", check);
      },
    };
  };

  const hide = () => {
    win.clearTimeout(timer);
    timer = 0;
    dropTip();
    stopOverflow();
    anchor = null;
  };

  const show = (el: HTMLElement) => {
    timer = 0;
    const label = text(el);
    if (el === anchor) watchOverflow(el);
    if (!el.isConnected || !label || tipSuppressed(el) || !tipWanted(el)) return;
    tip?.remove();
    const t = doc.createElement("div");
    t.className = "tip";
    t.id = "cutex-tip";
    t.setAttribute("role", "tooltip");
    t.setAttribute("data-tip-shown", "");
    t.textContent = label;
    Object.assign(t.style, { position: "fixed", zIndex: "180", left: "-9999px", top: "-9999px" });
    doc.body.append(t);
    const a = el.getBoundingClientRect();
    // In a float, or in an area marked `data-tip-beside` (the sidebar): outside its edge, level with the anchor —
    // never over the rows a project row or fold just opened.
    const f = (floatAround(el) ?? el.closest("[data-tip-beside]"))?.getBoundingClientRect() ?? null;
    const b = t.getBoundingClientRect();
    const side = (el.getAttribute("data-tip-side") as PanelSide | null) ?? undefined;
    const at = placeTip(a, { width: b.width, height: b.height }, { width: win.innerWidth, height: win.innerHeight }, { float: f, side });
    Object.assign(t.style, { left: `${at.left}px`, top: `${at.top}px` });
    t.setAttribute("data-side", at.side);
    tip = t;
    describedBy = el.getAttribute("aria-describedby");
    el.setAttribute("aria-describedby", describedBy ? `${describedBy} cutex-tip` : "cutex-tip");
    // The anchor can go, open its panel or change its text while the tip is up.
    watch = win.setInterval(() => {
      if (!tip || !anchor) return;
      if (!anchor.isConnected || tipSuppressed(anchor) || !text(anchor)) hide();
      else if (tip.textContent !== text(anchor)) tip.textContent = text(anchor);
    }, 200);
  };

  const arm = (el: HTMLElement) => {
    if (el === anchor) return;
    hide();
    anchor = el;
    if (Date.now() - hiddenAt < WARM) show(el);
    else timer = win.setTimeout(() => anchor === el && show(el), TIP_DELAY);
  };

  const tipOf = (target: EventTarget | null) => (isElement(target) ? target.closest<HTMLElement>("[data-tip]") : null);

  const onOver = (e: PointerEvent) => {
    if (e.pointerType === "touch") return;
    const el = tipOf(e.target);
    if (el && el !== pressed) arm(el);
  };
  const onOut = (e: PointerEvent) => {
    const to = e.relatedTarget as Node | null;
    if (pressed && !(to && pressed.contains(to))) pressed = null;
    if (anchor && !(to && anchor.contains(to))) hide();
  };
  const onDown = (e: PointerEvent) => {
    pressed = tipOf(e.target);
    hide();
  };
  const onFocus = (e: FocusEvent) => {
    const el = tipOf(e.target);
    // Keyboard focus only: a click focuses too, and that is a press.
    if (el && el === e.target && el !== pressed && el.matches(":focus-visible")) arm(el);
  };
  const onBlur = (e: FocusEvent) => {
    if (pressed && e.target === pressed) pressed = null;
    if (anchor && e.target === anchor) hide();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && (tip || timer)) hide();
    // Enter / Space act on the focused anchor: like a press, its tip goes and stays away until focus moves.
    else if ((e.key === "Enter" || e.key === " ") && anchor && (tip || timer)) {
      pressed = anchor;
      hide();
    }
  };

  doc.addEventListener("pointerover", onOver);
  doc.addEventListener("pointerout", onOut);
  doc.addEventListener("pointerdown", onDown, true);
  doc.addEventListener("focusin", onFocus);
  doc.addEventListener("focusout", onBlur);
  doc.addEventListener("keydown", onKey, true);
  doc.addEventListener("scroll", hide, true);
  doc.addEventListener("wheel", hide, { capture: true, passive: true });
  win.addEventListener("blur", hide);
  return () => {
    hide();
    doc.removeEventListener("pointerover", onOver);
    doc.removeEventListener("pointerout", onOut);
    doc.removeEventListener("pointerdown", onDown, true);
    doc.removeEventListener("focusin", onFocus);
    doc.removeEventListener("focusout", onBlur);
    doc.removeEventListener("keydown", onKey, true);
    doc.removeEventListener("scroll", hide, true);
    doc.removeEventListener("wheel", hide, { capture: true });
    win.removeEventListener("blur", hide);
  };
}
