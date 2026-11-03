// The selected item's bar on a rail edge: the Shelf's page icons (side/ShelfRail) and the sidebar's agent rail
// (AgentRows). Owner 2026-10-25: switching shrank the old bar to a dot that flashed before it went (a height
// transition to 0 on a rounded 3 px bar). The bar now never reaches zero height: it stays mounted and turning off
// is instant (no shrink). Owner 2026-10-26: the new bar fading in from the short height still read as a dot that
// flashed (a frame with no bar, then a faint short one growing), so turning on is instant too — the bar switches
// straight from the old icon to the new one in the same frame. Only on ⇄ dim moves between two heights.
// Reduced motion: no transition at all.
import { useLayoutEffect, useRef } from "react";

export type SelectionLevel = "on" | "dim" | "off";

export function SelectionMark({ level, className, on, dim, horizontal = false }: {
  level: SelectionLevel;
  /** Placement (side, offset, corner rounding). */
  className: string;
  /** Height and colour when selected (horizontal: width). */
  on: string;
  /** Height and colour of the faint state (horizontal: width). */
  dim: string;
  /** A bar along a horizontal rail's edge (portrait's Shelf Rail, lib/portrait): 3 px tall, centred across. */
  horizontal?: boolean;
}) {
  // The level drawn last: coming from off, the new state applies without a transition (CSS takes the transition of
  // the new style, so it must be absent in the render that turns the bar on).
  const last = useRef(level);
  const fromOff = last.current === "off";
  useLayoutEffect(() => {
    last.current = level;
  }, [level]);
  const state = level === "off"
    ? `${dim} opacity-0 transition-none`
    : `${level === "on" ? on : dim} opacity-100 ${fromOff ? "transition-none" : `${horizontal ? "transition-[width,background-color]" : "transition-[height,background-color]"} duration-(--motion-short) ease-(--ease-standard) motion-reduce:transition-none`}`;
  if (horizontal) return <span aria-hidden data-selection-mark={level} className={`pointer-events-none absolute left-1/2 h-[3px] -translate-x-1/2 ${className} ${state}`} />;
  return <span aria-hidden data-selection-mark={level} className={`pointer-events-none absolute top-1/2 w-[3px] -translate-y-1/2 ${className} ${state}`} />;
}
