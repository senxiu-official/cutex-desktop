// Overlay scrollbars, the DOM side (owner, 2026-10-10; maths and rules in lib/overlayScrollbars.ts).
// Native scrollbars are hidden by styles.css; this draws a thin thumb over the right / bottom edge of a
// scroller while it is scrolled by the user or hovered, fading out THUMB.hideDelay later. Scrolling
// itself stays native (wheel, touchpad, keys, scrollIntoView, anchoring): a thumb only shows the
// position and can be dragged. Nothing is inserted into React trees — every thumb lives in one fixed,
// aria-hidden layer at the end of <body>, positioned from getBoundingClientRect. Events only mark work;
// one rAF callback reads (hover resolution, metrics, clipping, hit tests), then writes. While no thumb
// exists nothing runs but the passive event listeners.
import {
  type Axis,
  type BoxStyle,
  NATIVE_SCROLLBAR_ATTR,
  type Rect,
  type ScrollIntent,
  THUMB,
  clippingAncestors,
  coverSamples,
  innermostScrollers,
  intersect,
  longestUncovered,
  overflowing,
  scrollForDrag,
  scrollKey,
  scrollsOn,
  thumbGeometry,
  thumbRect,
  trackRect,
  userScroll,
} from "./overlayScrollbars";

const LAYER_ATTR = "data-overlay-scrollbars";
const OPT_OUT = `[${NATIVE_SCROLLBAR_ATTR}]`;
/** While a thumb exists, re-measure this often: content can grow without a scroll / resize event. */
const WATCH_MS = 300;
/** Re-resolve the hovered scroller on pointer moves at most this often (content scrolled under a
 *  resting pointer, a scroller that started to overflow). */
const MOVE_MS = 200;
/** A wheel step at least this large (px) is a mouse notch: forwarded smoothly, like the native one. */
const NOTCH_PX = 40;
/** Presses that must not leave a thumb (see onPointerDown). Releases are not in here. */
const SWALLOWED = ["mousedown", "click", "dblclick", "auxclick", "contextmenu"] as const;

interface AxisMetrics {
  view: number;
  content: number;
  pos: number;
  on: boolean;
}

interface Metrics {
  box: Rect;
  x: AxisMetrics;
  y: AxisMetrics;
  rtl: boolean;
}

interface Thumb {
  el: Element;
  axis: Axis;
  hovered: boolean;
  dragging: boolean;
  /** Wanted visible (it may still be hidden: nothing to scroll, clipped away, covered). */
  shown: boolean;
  hideTimer: ReturnType<typeof setTimeout> | undefined;
  dropTimer: ReturnType<typeof setTimeout> | undefined;
  /** Ancestors that clip the scroller; computed on first layout. */
  clippers: Element[] | null;
  /** Last layout, for dragging. */
  layout: { view: number; content: number; track: number; size: number } | null;
  /** Read-phase result for the write phase (screen px). */
  plan: { clip: Rect; strip: Rect; on: boolean } | null;
  dom: { clip: HTMLDivElement; hit: HTMLDivElement } | null;
  /** Last written geometry / visibility (skip identical writes). */
  css: string;
  on: boolean;
}

let installed: (() => void) | null = null;

/** Start the overlay scrollbars for this window (main.tsx, before React mounts so its capture listeners
 *  run first). Returns a function that removes them again. */
export function installOverlayScrollbars(): () => void {
  if (installed) return installed;
  const doc = document;
  const layer = doc.createElement("div");
  layer.setAttribute(LAYER_ATTR, "");
  layer.setAttribute("aria-hidden", "true");
  doc.body.appendChild(layer);

  const thumbs: Record<Axis, Map<Element, Thumb>> = { x: new Map(), y: new Map() };
  const byHit = new WeakMap<Element, Thumb>();
  const hover: Record<Axis, Element | null> = { x: null, y: null };
  const lastPos = new WeakMap<Element, { top: number; left: number }>();
  const pendingScroll = new Map<Element, boolean>();
  /** Re-resolve the hovered scrollers in the next frame, from `hoverTarget` or (when that is gone —
   *  React replaced the element under a resting pointer) from the last pointer position. */
  let hoverDirty = false;
  let hoverTarget: Element | null = null;
  /** Last mouse / pen position in the window (null: outside, or touch). */
  let pointer: { x: number; y: number } | null = null;
  let intent: ScrollIntent<Node> | null = null;
  let frame = 0;
  let watch: ReturnType<typeof setInterval> | undefined;
  let lastMove = 0;
  let drags = 0;

  const ro = new ResizeObserver(() => schedule());
  // A menu / popover opening over a shown thumb must clip it in the same frame, not at the next
  // WATCH_MS tick (the bar briefly covered the new popover). Observed only while thumbs exist.
  const mo = new MutationObserver(() => schedule());
  const all = (): Thumb[] => [...thumbs.y.values(), ...thumbs.x.values()];
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(run);
  };
  const thumbFor = (target: EventTarget | null): Thumb | undefined => {
    const hit = target instanceof Element ? target.closest(".osb-hit") : null;
    return hit ? byHit.get(hit) : undefined;
  };
  const inLayer = (target: EventTarget | null): boolean => target instanceof Node && layer.contains(target);
  const contains = (outer: Node, inner: Node) => outer.contains(inner);
  const root = () => doc.scrollingElement ?? doc.documentElement;

  // ── reads ──────────────────────────────────────────────────────────────────────────────────────

  function canScroll(el: Element, axis: Axis): boolean {
    if (!overflowing(axis === "y" ? el.scrollHeight : el.scrollWidth, axis === "y" ? el.clientHeight : el.clientWidth)) return false;
    const style = getComputedStyle(el);
    const overflow = axis === "y" ? style.overflowY : style.overflowX;
    // The page itself: <html> overflow visible still scrolls the viewport.
    return el === root() ? overflow !== "hidden" && overflow !== "clip" : scrollsOn(overflow);
  }

  function resolve(target: Element): { x: Element | null; y: Element | null } {
    const chain: Element[] = [];
    for (let n: Element | null = target; n; n = n.parentElement) chain.push(n);
    return innermostScrollers(chain, { optOut: (el) => el.hasAttribute(NATIVE_SCROLLBAR_ATTR), scrolls: canScroll });
  }

  /** The padding box (where content scrolls) in screen px, honouring CSS zoom / transforms. */
  function clientBox(el: Element): Rect {
    if (el === root()) return { left: 0, top: 0, width: innerWidth, height: innerHeight };
    const r = el.getBoundingClientRect();
    const local = el as HTMLElement;
    const sx = local.offsetWidth ? r.width / local.offsetWidth : 1;
    const sy = local.offsetHeight ? r.height / local.offsetHeight : 1;
    return { left: r.left + el.clientLeft * sx, top: r.top + el.clientTop * sy, width: el.clientWidth * sx, height: el.clientHeight * sy };
  }

  function measure(el: Element): Metrics {
    const style = getComputedStyle(el);
    const scrolls = (overflow: string) => (el === root() ? overflow !== "hidden" && overflow !== "clip" : scrollsOn(overflow));
    const x = { view: el.clientWidth, content: el.scrollWidth, pos: el.scrollLeft, on: false };
    const y = { view: el.clientHeight, content: el.scrollHeight, pos: el.scrollTop, on: false };
    x.on = scrolls(style.overflowX) && overflowing(x.content, x.view);
    y.on = scrolls(style.overflowY) && overflowing(y.content, y.view);
    return { box: clientBox(el), x, y, rtl: style.direction === "rtl" };
  }

  function boxStyle(s: CSSStyleDeclaration): BoxStyle {
    const contain = s.contain;
    const willChange = s.willChange;
    return {
      position: s.position,
      containsFixed:
        s.transform !== "none" ||
        s.translate !== "none" ||
        s.rotate !== "none" ||
        s.scale !== "none" ||
        s.perspective !== "none" ||
        s.filter !== "none" ||
        s.backdropFilter !== "none" ||
        /paint|layout|strict|content/.test(contain) ||
        /transform|translate|rotate|scale|perspective|filter/.test(willChange),
      clips: s.overflowX !== "visible" || s.overflowY !== "visible" || /paint|strict|content/.test(contain),
    };
  }

  function clippersOf(el: Element): Element[] {
    if (el === root()) return [];
    const chain: Element[] = [];
    for (let n: Element | null = el; n && n !== doc.documentElement; n = n.parentElement) chain.push(n);
    const styles = chain.map((n) => boxStyle(getComputedStyle(n)));
    return clippingAncestors(styles).map((i) => chain[i]!);
  }

  /** Something else (a dialog, popover, menu, a side card over the conversation) is on top of the
   *  scroller at this point. Walks the hit-test stack from the top, skipping the layer and thin
   *  things (an edge resize handle is a few px wide; the bar sits exactly there) until it reaches the
   *  scroller (or something around it) or a real cover. */
  function coveredAt(el: Element, x: number, y: number): boolean {
    for (const n of doc.elementsFromPoint(x, y)) {
      if (layer.contains(n)) continue;
      if (n === el || el.contains(n) || n.contains(el)) return false;
      const r = n.getBoundingClientRect();
      if (Math.min(r.width, r.height) >= 2 * THUMB.hit) return true;
    }
    return false;
  }

  /** The part of the bar's strip that is still on top: hit-tests samples along the bar's centre line
   *  (coverSamples), keeps the longest uncovered run and bisects its ends against the neighbouring
   *  covered samples, so a menu or card over part of the scroller cuts the thumb at its edge instead of
   *  the thumb being drawn over it. Null when all of it is covered. */
  function uncovered(el: Element, axis: Axis, part: Rect): Rect | null {
    const line = THUMB.inset + THUMB.thin / 2;
    const start = axis === "y" ? part.top : part.left;
    const length = axis === "y" ? part.height : part.width;
    const at = (v: number) => (axis === "y" ? coveredAt(el, part.left + part.width - line, v) : coveredAt(el, v, part.top + part.height - line));
    const n = coverSamples(length);
    const centre = (i: number) => start + ((i + 0.5) * length) / n;
    const flags = Array.from({ length: n }, (_, i) => at(centre(i)));
    const run = longestUncovered(flags);
    if (!run) return null;
    if (run[0] === 0 && run[1] === n - 1) return part;
    /** Edge between a covered point `c` and an uncovered point `u` (px, ~1 px after 4 halvings). */
    const edge = (c: number, u: number) => {
      for (let k = 0; k < 4; k++) {
        const mid = (c + u) / 2;
        if (at(mid)) c = mid;
        else u = mid;
      }
      return u;
    };
    const lo = run[0] === 0 ? start : edge(centre(run[0] - 1), centre(run[0]));
    const hi = run[1] === n - 1 ? start + length : edge(centre(run[1] + 1), centre(run[1]));
    return axis === "y" ? { left: part.left, width: part.width, top: lo, height: hi - lo } : { left: lo, width: hi - lo, top: part.top, height: part.height };
  }

  function plan(t: Thumb, metrics: Map<Element, Metrics>, viewport: Rect): void {
    const el = t.el;
    if (!el.isConnected) {
      if (hover[t.axis] === el) hover[t.axis] = null;
      drop(t);
      return;
    }
    let m = metrics.get(el);
    if (!m) {
      m = measure(el);
      metrics.set(el, m);
    }
    const a = m[t.axis];
    const track = trackRect(m.box, t.axis, m.x.on && m.y.on);
    const length = t.axis === "y" ? track.height : track.width;
    const g = a.on ? thumbGeometry({ view: a.view, content: a.content, pos: a.pos, track: length, rtl: t.axis === "x" && m.rtl }) : null;
    if (!g) {
      t.plan = null;
      t.layout = null;
      return;
    }
    t.layout = { view: a.view, content: a.content, track: length, size: g.size };
    const strip = thumbRect(track, t.axis, g);
    if (t.clippers === null) t.clippers = clippersOf(el);
    let visible = intersect(m.box, viewport);
    for (const c of t.clippers) {
      if (!visible) break;
      visible = intersect(visible, clientBox(c));
    }
    if (!visible) {
      t.plan = null;
      return;
    }
    const part = intersect(strip, visible);
    // While dragging the thumb stays whole; otherwise it is clipped to the part nothing covers.
    const open = !t.shown || part === null || t.dragging ? part : uncovered(el, t.axis, part);
    const clip = open && open !== part ? intersect(visible, t.axis === "y" ? { left: visible.left, width: visible.width, top: open.top, height: open.height } : { left: open.left, width: open.width, top: visible.top, height: visible.height }) : visible;
    const on = t.shown && open !== null && clip !== null;
    t.plan = { clip: clip ?? visible, strip, on };
  }

  function layerScale(): number {
    // CSS zoom on <html> (the browser preview's 界面缩放) scales the layer too.
    const w = layer.offsetWidth;
    return w ? layer.getBoundingClientRect().width / w : 1;
  }

  // ── writes ─────────────────────────────────────────────────────────────────────────────────────

  function build(t: Thumb): { clip: HTMLDivElement; hit: HTMLDivElement } {
    const clip = doc.createElement("div");
    clip.className = "osb-clip";
    const hit = doc.createElement("div");
    hit.className = "osb-hit";
    hit.dataset.axis = t.axis;
    const bar = doc.createElement("div");
    bar.className = "osb-bar";
    hit.appendChild(bar);
    clip.appendChild(hit);
    // Wheel over the thumb would otherwise scroll whatever is under the layer (nothing): pass it on.
    // Non-passive only here, so ordinary wheel scrolling never waits for the main thread.
    hit.addEventListener("wheel", (e) => forwardWheel(t, e), { passive: false });
    byHit.set(hit, t);
    layer.appendChild(clip);
    return { clip, hit };
  }

  function write(t: Thumb, scale: number): void {
    const p = t.plan;
    const on = p !== null && p.on;
    if (!t.dom) {
      if (!on) return;
      t.dom = build(t);
    }
    // A hidden thumb keeps its last geometry while it fades out: re-planned unshown, the clip is no
    // longer narrowed to the uncovered part (and a closing popover may report a stale box), so the
    // fading bar would jump to another place before it disappears.
    if (p && on) {
      const px = (v: number) => `${Math.round((v / scale) * 100) / 100}px`;
      const { clip, strip } = p;
      const key = `${clip.left},${clip.top},${clip.width},${clip.height},${strip.left},${strip.top},${strip.width},${strip.height},${scale}`;
      if (key !== t.css) {
        t.css = key;
        const c = t.dom.clip.style;
        c.left = px(clip.left);
        c.top = px(clip.top);
        c.width = px(clip.width);
        c.height = px(clip.height);
        const h = t.dom.hit.style;
        h.left = px(strip.left - clip.left);
        h.top = px(strip.top - clip.top);
        h.width = px(strip.width);
        h.height = px(strip.height);
      }
    }
    if (on !== t.on) {
      t.on = on;
      t.dom.hit.toggleAttribute("data-on", on);
    }
  }

  function run(): void {
    frame = 0;
    // Reads: hover, scrolls, metrics, clipping, hit tests.
    if (hoverDirty) {
      hoverDirty = false;
      let target = hoverTarget?.isConnected ? hoverTarget : null;
      hoverTarget = null;
      if (!target && pointer) target = doc.elementFromPoint(pointer.x, pointer.y);
      // Over a thumb: it keeps whatever it shows (onOver set its own axis).
      if (!target || !inLayer(target)) {
        const r = target ? resolve(target) : { x: null, y: null };
        setHover("y", r.y);
        setHover("x", r.x);
      }
    }
    for (const [el, user] of pendingScroll) scrolled(el, user);
    pendingScroll.clear();
    const metrics = new Map<Element, Metrics>();
    const viewport = { left: 0, top: 0, width: innerWidth, height: innerHeight };
    const list = all();
    for (const t of list) plan(t, metrics, viewport);
    const scale = layerScale();
    // Writes.
    for (const t of list) if (thumbs[t.axis].get(t.el) === t) write(t, scale);
  }

  // ── state ──────────────────────────────────────────────────────────────────────────────────────

  function create(el: Element, axis: Axis): Thumb {
    const t: Thumb = { el, axis, hovered: false, dragging: false, shown: false, hideTimer: undefined, dropTimer: undefined, clippers: null, layout: null, plan: null, dom: null, css: "", on: false };
    thumbs[axis].set(el, t);
    ro.observe(el);
    if (watch === undefined) {
      watch = setInterval(tick, WATCH_MS);
      mo.observe(doc.body, { childList: true, subtree: true });
    }
    return t;
  }

  function drop(t: Thumb): void {
    clearTimeout(t.hideTimer);
    clearTimeout(t.dropTimer);
    t.dom?.clip.remove();
    t.dom = null;
    if (thumbs[t.axis].get(t.el) === t) thumbs[t.axis].delete(t.el);
    if (!thumbs.x.has(t.el) && !thumbs.y.has(t.el)) ro.unobserve(t.el);
    if (thumbs.x.size === 0 && thumbs.y.size === 0 && watch !== undefined) {
      clearInterval(watch);
      watch = undefined;
      mo.disconnect();
    }
  }

  function show(t: Thumb): void {
    clearTimeout(t.hideTimer);
    clearTimeout(t.dropTimer);
    t.shown = true;
    schedule();
  }

  /** Nothing holds the thumb any more: hide it after the delay. */
  function release(t: Thumb): void {
    if (t.hovered || t.dragging) return;
    clearTimeout(t.hideTimer);
    t.hideTimer = setTimeout(() => hide(t), THUMB.hideDelay);
  }

  function hide(t: Thumb): void {
    t.shown = false;
    schedule();
    clearTimeout(t.dropTimer);
    t.dropTimer = setTimeout(() => {
      if (!t.shown && !t.hovered && !t.dragging) drop(t);
    }, THUMB.fadeOut + 50);
  }

  function setHover(axis: Axis, el: Element | null): void {
    const prev = hover[axis];
    if (prev === el) return;
    hover[axis] = el;
    if (prev) {
      const t = thumbs[axis].get(prev);
      if (t) {
        t.hovered = false;
        release(t);
      }
    }
    if (el) {
      const t = thumbs[axis].get(el) ?? create(el, axis);
      t.hovered = true;
      show(t);
    }
  }

  /** A scroll of `el`: show (or keep showing) its thumb when the user scrolled it or it already shows. */
  function scrolled(el: Element, user: boolean): void {
    if (!el.isConnected) return;
    const prev = lastPos.get(el);
    const pos = { top: el.scrollTop, left: el.scrollLeft };
    lastPos.set(el, pos);
    for (const axis of ["y", "x"] as const) {
      if (prev && (axis === "y" ? prev.top === pos.top : prev.left === pos.left)) continue;
      const t = thumbs[axis].get(el);
      const live = t !== undefined && (t.shown || t.hovered || t.dragging);
      if (!live && !user) continue;
      if (!canScroll(el, axis)) continue;
      const thumb = t ?? create(el, axis);
      show(thumb);
      release(thumb);
    }
  }

  // ── input ──────────────────────────────────────────────────────────────────────────────────────

  /** The scroller a wheel over `t`'s thumb would have reached on `axis`: `t.el` or the nearest
   *  ancestor that scrolls that way (a vertical wheel over a code block's horizontal thumb scrolls the
   *  timeline). */
  function wheelTarget(t: Thumb, axis: Axis): Element | null {
    for (let n: Element | null = t.el; n; n = n.parentElement) if (canScroll(n, axis) && !n.closest(OPT_OUT)) return n;
    return null;
  }

  function forwardWheel(t: Thumb, e: WheelEvent): void {
    if (e.ctrlKey) return;
    e.preventDefault();
    const unit = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? (t.axis === "y" ? t.el.clientHeight : t.el.clientWidth) : 1;
    let dx = e.deltaX * unit;
    let dy = e.deltaY * unit;
    // Shift + wheel scrolls sideways, as it would natively.
    if (e.shiftKey && dx === 0) [dx, dy] = [dy, 0];
    const behavior = Math.max(Math.abs(dx), Math.abs(dy)) >= NOTCH_PX ? "smooth" : "instant";
    const now = performance.now();
    if (dy !== 0) {
      const el = wheelTarget(t, "y");
      if (el) {
        intent = { at: now, target: el };
        el.scrollBy({ top: dy, behavior });
      }
    }
    if (dx !== 0) {
      const el = wheelTarget(t, "x");
      if (el) {
        intent = { at: now, target: el };
        el.scrollBy({ left: dx, behavior });
      }
    }
  }

  function startDrag(t: Thumb, e: PointerEvent): void {
    const dom = t.dom;
    const geo = t.layout;
    if (!dom || !geo) return;
    const { el, axis } = t;
    const hit = dom.hit;
    const start = axis === "y" ? e.clientY : e.clientX;
    const from = axis === "y" ? el.scrollTop : el.scrollLeft;
    t.dragging = true;
    drags++;
    clearTimeout(t.hideTimer);
    hit.setAttribute("data-dragging", "");
    try {
      hit.setPointerCapture(e.pointerId);
    } catch {
      // The pointer is already gone: the drag ends on the next event.
    }
    let done = false;
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      const to = from + scrollForDrag((axis === "y" ? ev.clientY : ev.clientX) - start, geo);
      el.scrollTo(axis === "y" ? { top: to, behavior: "instant" } : { left: to, behavior: "instant" });
    };
    const end = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId || done) return;
      done = true;
      hit.removeEventListener("pointermove", move);
      hit.removeEventListener("pointerup", end);
      hit.removeEventListener("pointercancel", end);
      hit.removeEventListener("lostpointercapture", end);
      hit.removeAttribute("data-dragging");
      t.dragging = false;
      drags--;
      release(t);
      schedule();
    };
    hit.addEventListener("pointermove", move);
    hit.addEventListener("pointerup", end);
    hit.addEventListener("pointercancel", end);
    hit.addEventListener("lostpointercapture", end);
  }

  // Window capture, registered before the app's own listeners: presses on a thumb never reach
  // outside-click handlers (a popover would close when its own thumb is dragged), focus or selection.
  // Releases (pointerup / mouseup) pass: another component's drag may end over a thumb.
  const onPointerDown = (e: PointerEvent) => {
    if (!inLayer(e.target)) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    const t = thumbFor(e.target);
    if (t && e.button === 0) startDrag(t, e);
  };
  const swallow = (e: Event) => {
    if (!inLayer(e.target)) return;
    e.stopImmediatePropagation();
    if (e.type === "mousedown" || e.type === "contextmenu") e.preventDefault();
  };
  const hoverAt = (target: Element | null) => {
    hoverTarget = target;
    hoverDirty = true;
    schedule();
  };
  const onOver = (e: PointerEvent) => {
    if (e.pointerType === "touch") return;
    pointer = { x: e.clientX, y: e.clientY };
    const t = thumbFor(e.target);
    if (t) {
      // Onto a thumb (maybe an outer scroller's, showing because it scrolled): it stays.
      hoverDirty = false;
      setHover(t.axis, t.el);
      return;
    }
    if (inLayer(e.target) || !(e.target instanceof Element)) return;
    lastMove = performance.now();
    hoverAt(e.target);
  };
  const onMove = (e: PointerEvent) => {
    if (e.pointerType === "touch") return;
    pointer = { x: e.clientX, y: e.clientY };
    const now = performance.now();
    if (drags > 0 || now - lastMove < MOVE_MS || inLayer(e.target) || !(e.target instanceof Element)) return;
    lastMove = now;
    hoverAt(e.target);
  };
  const onOut = (e: PointerEvent) => {
    // Left the window.
    if (e.relatedTarget === null && drags === 0) {
      pointer = null;
      hoverAt(null);
    }
  };
  /** While thumbs exist: re-measure, and re-resolve the hover from the resting pointer. */
  const tick = () => {
    if (pointer && drags === 0) hoverAt(null);
    else schedule();
  };
  const onWheel = (e: Event) => {
    if (!inLayer(e.target)) intent = { at: performance.now(), target: e.target instanceof Node ? e.target : null };
  };
  const onKey = (e: KeyboardEvent) => {
    if (!scrollKey(e.key)) return;
    const focus = doc.activeElement;
    intent = { at: performance.now(), target: focus && focus !== doc.body && focus !== doc.documentElement ? focus : null };
  };
  const onScroll = (e: Event) => {
    const el = e.target === doc ? root() : e.target instanceof Element ? e.target : null;
    if (!el || inLayer(el) || el.closest(OPT_OUT)) return;
    const user = userScroll(intent, performance.now(), el, contains);
    pendingScroll.set(el, (pendingScroll.get(el) ?? false) || user);
    schedule();
  };

  const capture = { capture: true } as const;
  const passive = { capture: true, passive: true } as const;
  addEventListener("pointerdown", onPointerDown, capture);
  for (const type of SWALLOWED) addEventListener(type, swallow, capture);
  addEventListener("pointerover", onOver, passive);
  addEventListener("pointermove", onMove, passive);
  addEventListener("pointerout", onOut, passive);
  addEventListener("wheel", onWheel, passive);
  addEventListener("touchstart", onWheel, passive);
  addEventListener("touchmove", onWheel, passive);
  addEventListener("keydown", onKey, passive);
  doc.addEventListener("scroll", onScroll, passive);
  addEventListener("resize", schedule, passive);

  installed = () => {
    removeEventListener("pointerdown", onPointerDown, capture);
    for (const type of SWALLOWED) removeEventListener(type, swallow, capture);
    removeEventListener("pointerover", onOver, passive);
    removeEventListener("pointermove", onMove, passive);
    removeEventListener("pointerout", onOut, passive);
    removeEventListener("wheel", onWheel, passive);
    removeEventListener("touchstart", onWheel, passive);
    removeEventListener("touchmove", onWheel, passive);
    removeEventListener("keydown", onKey, passive);
    doc.removeEventListener("scroll", onScroll, passive);
    removeEventListener("resize", schedule, passive);
    if (frame) cancelAnimationFrame(frame);
    for (const t of all()) drop(t);
    ro.disconnect();
    mo.disconnect();
    layer.remove();
    installed = null;
  };
  return installed;
}
