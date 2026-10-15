// The queue frame's section strips (owner 2026-10-12): hovering a rail cell slides a small label out
// to the LEFT of the rail (the section name); while dragging over a section it shows the drop hint.
// Setting 「悬停时显示分区名」 (local pref `queueSectionStrip`, default on). When the frame sits too
// close to the left edge that would clip it (the conversation column, else the window) the strip
// renders inside the frame, over the row start.
import { createContext, useEffect, useState, type RefObject } from "react";

export type StripTone = "accent" | "muted" | "warn" | "danger";

export interface StripLabel {
  text: string;
  tone: StripTone;
}

export interface RailStripSettings {
  enabled: boolean;
  /** No room on the left: render inside the frame. */
  inside: boolean;
}

export const RailStripContext = createContext<RailStripSettings>({ enabled: false, inside: false });

/** Room the strip needs to the left of the rail (px). */
export const STRIP_ROOM = 150;

/** Whether `room` px between the frame and the edge that would clip the strip is too little. */
export function stripInside(room: number): boolean {
  return room < STRIP_ROOM;
}

/** Left edge (viewport px) of the nearest ancestor that clips horizontally (else the window, 0). */
function clipLeft(el: HTMLElement): number {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowX;
    if (o !== "visible") return p.getBoundingClientRect().left;
  }
  return 0;
}

/** `inside` for the element at `ref`, re-measured on window resize and when the element resizes. */
export function useStripInside(ref: RefObject<HTMLElement | null>, enabled: boolean): boolean {
  const [inside, setInside] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    const measure = () => setInside(stripInside(el.getBoundingClientRect().left - clipLeft(el)));
    measure();
    window.addEventListener("resize", measure);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(el);
    return () => {
      window.removeEventListener("resize", measure);
      ro?.disconnect();
    };
  }, [ref, enabled]);
  return inside;
}
