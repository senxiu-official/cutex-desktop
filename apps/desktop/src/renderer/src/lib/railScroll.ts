import { useLayoutEffect, type RefObject } from "react";
import { useOwnerWindow } from "./ownerContext";
import { resizeObserverFor } from "./ownerWindow";

/** Signed scroll speed near either end of the page lane, independent of the number of pages. */
export function railEdgeSpeed(pointer: number, start: number, end: number): number {
  const edge = Math.min(28, (end - start) / 3);
  if (pointer < start || pointer > end || edge <= 0) return 0;
  if (pointer < start + edge) return -12 * (1 - (pointer - start) / edge);
  if (pointer > end - edge) return 12 * (1 - (end - pointer) / edge);
  return 0;
}

export function railRevealDelta(start: number, end: number, itemStart: number, itemEnd: number): number {
  if (itemStart < start) return itemStart - start;
  return itemEnd > end ? itemEnd - end : 0;
}

/** Only the page lane scrolls; its owner and footer remain fixed. Horizontal portrait rails use the same rule. */
export function useRailScroll(ref: RefObject<HTMLDivElement | null>, active: string | null, shape: string, horizontal: boolean, dragging: boolean): void {
  const win = useOwnerWindow();
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const mask = () => {
      const pos = horizontal ? el.scrollLeft : el.scrollTop;
      const room = horizontal ? el.scrollWidth - el.clientWidth : el.scrollHeight - el.clientHeight;
      const before = pos > 1, after = pos < room - 1;
      el.dataset.railBefore = String(before);
      el.dataset.railAfter = String(after);
      const value = before || after ? `linear-gradient(to ${horizontal ? "right" : "bottom"}, ${before ? "transparent" : "black"}, black 12px, black calc(100% - 12px), ${after ? "transparent" : "black"})` : "";
      if (el.style.maskImage !== value) el.style.maskImage = value;
    };
    const button = [...el.querySelectorAll<HTMLElement>("[data-shelf-page]")].find(node => node.dataset.shelfPage === active);
    if (button) {
      const lane = el.getBoundingClientRect(), item = button.getBoundingClientRect();
      // Keep the active button clear of either fade, including the last few padding pixels.
      const inset = (horizontal ? el.scrollWidth > el.clientWidth : el.scrollHeight > el.clientHeight) ? 12 : 0;
      const delta = horizontal ? railRevealDelta(lane.left + inset, lane.right - inset, item.left, item.right) : railRevealDelta(lane.top + inset, lane.bottom - inset, item.top, item.bottom);
      if (delta) {
        const scale = horizontal ? (el.offsetWidth ? lane.width / el.offsetWidth : 1) : (el.offsetHeight ? lane.height / el.offsetHeight : 1);
        if (horizontal) el.scrollLeft += delta / (scale || 1);
        else el.scrollTop += delta / (scale || 1);
      }
    }
    mask();
    el.addEventListener("scroll", mask, { passive: true });
    const observer = resizeObserverFor(el, mask);
    observer?.observe(el);
    win.addEventListener("resize", mask);
    return () => { el.removeEventListener("scroll", mask); observer?.disconnect(); win.removeEventListener("resize", mask); };
  }, [ref, active, shape, horizontal, win]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !dragging) return;
    let frame = 0, speed = 0;
    const tick = () => {
      frame = 0;
      const before = horizontal ? el.scrollLeft : el.scrollTop;
      if (horizontal) el.scrollLeft += speed;
      else el.scrollTop += speed;
      const after = horizontal ? el.scrollLeft : el.scrollTop;
      if (speed && after !== before) frame = win.requestAnimationFrame(tick);
    };
    const move = (event: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const inside = horizontal ? event.clientY >= r.top && event.clientY <= r.bottom : event.clientX >= r.left && event.clientX <= r.right;
      speed = inside ? railEdgeSpeed(horizontal ? event.clientX : event.clientY, horizontal ? r.left : r.top, horizontal ? r.right : r.bottom) : 0;
      if (speed && !frame) frame = win.requestAnimationFrame(tick);
      if (!speed && frame) { win.cancelAnimationFrame(frame); frame = 0; }
    };
    win.addEventListener("pointermove", move, true);
    return () => { win.removeEventListener("pointermove", move, true); if (frame) win.cancelAnimationFrame(frame); };
  }, [ref, dragging, horizontal, win]);
}
