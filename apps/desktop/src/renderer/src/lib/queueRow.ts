// Queue panel row styles and text (components/QueuePanel, TurnQueue, AdmissionRows). Pure.

/**
 * One row anatomy for every queue row (queue refinement 2026-10-15): [kind icon, 16px slot, muted]
 * [primary text, one line, truncated] [quiet meta at the end] [actions on hover / keyboard focus,
 * in the meta's place]. Same height (24px) and paddings in every section; at most one accent per row
 * (warn only for paused / needs-you).
 */
export const QUEUE_ROW = "group/row flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded-md pr-1 pl-0.5";
/** The row's primary text (its colour added by the row: foreground, muted while sending). */
export const ROW_TEXT = "min-w-0 flex-1 truncate text-sm";
/** Quiet words at the row end (colour added by the row: subtle, warn when paused). */
export const ROW_META = "shrink-0 pl-1 text-[11px] whitespace-nowrap";
/**
 * Row actions: no room and invisible until the row is hovered or one of them has focus (still
 * reachable with Tab: clipped, not display:none; the negative margin cancels the row gap meanwhile).
 */
export const ROW_ACTIONS = "-ml-1.5 flex max-w-0 shrink-0 items-center gap-0.5 overflow-hidden opacity-0 group-hover/row:ml-0 group-hover/row:max-w-none group-hover/row:overflow-visible group-hover/row:opacity-100 focus-within:ml-0 focus-within:max-w-none focus-within:overflow-visible focus-within:opacity-100";
/** Meta that gives way to the row's actions on hover / focus. */
export const META_YIELDS = "group-hover/row:hidden group-focus-within/row:hidden";

/** A message as one row's text: no leading / trailing blank lines or return glyphs (⏎ ↵), whitespace collapsed. */
export function rowText(text: string): string {
  return text.replace(/^[\s⏎↵]+|[\s⏎↵]+$/gu, "").replace(/\s+/g, " ");
}
