// Shared row look of the status capsule's sections (quiet pass, owner 2026-10-14): the modules'
// Bodies (plan, jobs, delegations, alarms, background terminals, sub-agents, goal) keep their data
// and actions and lay their rows out with these classes, so every kind has the same rhythm:
// a 32px row — small leading icon / dot, truncating title, right-aligned muted meta in tabular
// numbers — whose actions take the meta's place on hover or keyboard focus. The same rows show in
// the status-row chips' panels.
//
// `data-capsule-row` marks one item row and `data-capsule-line` any other line of a Body (group
// label, 已结束 fold, explanation); the capsule counts them to show a kind with a single item inline,
// without its heading (modules/status-capsule).

/** One item row (add `hover:bg-hover` for a row without its own button). */
export const CAPSULE_ROW = "group/row relative flex min-h-8 min-w-0 items-center gap-2 rounded-lg px-2 text-[13px]";

/** The row's main button (fills the row; the actions are its siblings). */
export const CAPSULE_ROW_MAIN = "flex min-h-8 min-w-0 flex-1 items-center gap-2 text-left outline-none focus-visible:underline";

/** Leading icon slot (14px icons). */
export const CAPSULE_ROW_ICON = "flex w-3.5 shrink-0 items-center justify-center text-subtle";

/** Right-aligned meta: muted, tabular; hidden while the row's actions show. */
export const CAPSULE_ROW_META = "shrink-0 text-[11px] text-subtle tabular-nums group-hover/row:hidden group-focus-within/row:hidden";

/** The meta of a row without actions: stays. */
export const CAPSULE_ROW_META_STATIC = "shrink-0 text-[11px] text-subtle tabular-nums";

/**
 * The row's actions: collapsed to no width (still in the tab order) until the row is hovered or
 * something in it has keyboard focus. `shown` (e.g. an armed second click) keeps them visible.
 */
export function capsuleRowActions(shown = false): string {
  return `flex shrink-0 items-center gap-0.5 ${shown ? "" : "max-w-0 overflow-hidden opacity-0 group-hover/row:max-w-none group-hover/row:overflow-visible group-hover/row:opacity-100 group-focus-within/row:max-w-none group-focus-within/row:overflow-visible group-focus-within/row:opacity-100"}`;
}

/** A small text action inside a row. */
export const CAPSULE_ROW_ACTION = "shrink-0 rounded-md px-1.5 py-0.5 text-[11px] text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-50";

/** A secondary line of a Body (group label, fold): smaller, muted, same inset. */
export const CAPSULE_LINE = "flex h-7 w-full items-center gap-1.5 rounded-lg px-2 text-left text-[11px] text-subtle";

/** Status dot (the only colour in a row). */
export const CAPSULE_DOT = "size-1.5 shrink-0 rounded-full";

/** 0–1 → percent width of a 2px progress bar under a row. */
export function progressWidth(ratio: number): string {
  const r = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0;
  return `${Math.round(r * 1000) / 10}%`;
}
