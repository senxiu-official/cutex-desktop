// The width tooltip while an edge is dragged or stepped with the arrow keys (owner 2026-10-21, checklist #5,
// docs/design/014-width-feedback.md): the panel's width in px — and, for a conversation column, its share of the
// work row in % — in a small tip beside the edge, following it. One at a time; components/WidthTip draws it.
// Every width handle reports here (components/PaneResizer, lib/sideResize, components/SettingsShelf,
// components/side/SideArea). Shell code.
import { create } from "zustand";
import { queryAppWindows } from "./appWindowSet";

export interface WidthTipState {
  /** Where (viewport px): beside the edge, at the pointer's height (keys: the edge's middle). */
  x: number;
  y: number;
  px: number;
  /** A conversation column: its share of the work row (%); null = px only. */
  pct: number | null;
  /** The edge's document when it is a desk window's (multi-window P3.5: the tip shows there); absent: the main window. */
  doc?: Document;
}

export const useWidthTip = create<{ tip: WidthTipState | null }>(() => ({ tip: null }));

/** How long the tip stays after the last arrow key (the keys' resize session is shorter: lib/columnGlide KEY_RESIZE_MS). */
export const WIDTH_TIP_KEY_MS = 900;
let timer: ReturnType<typeof setTimeout> | null = null;

/** The share of `row` px a width is (rounded, 0–100), or null without a row. */
export function widthPct(px: number, row: number): number | null {
  return row > 0 ? Math.max(0, Math.min(100, Math.round((px / row) * 100))) : null;
}

/**
 * Shows / moves the tip for the edge `el` (a width handle): `px` the panel's width now, `pct` (a conversation
 * column) its share of the row; `y` the pointer's height (absent: the edge's middle). `keys`: it goes by itself
 * once the keys rest.
 */
export function showWidthTip(el: Element | null, px: number, opts: { pct?: number | null; y?: number; keys?: boolean } = {}): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  const r = el && typeof el.getBoundingClientRect === "function" ? el.getBoundingClientRect() : undefined;
  const x = r ? Math.round(r.left + r.width / 2) : 0;
  const y = Math.round(opts.y ?? (r ? r.top + r.height / 2 : 0));
  const doc = el?.ownerDocument;
  useWidthTip.setState({ tip: { x, y, px: Math.round(px), pct: opts.pct ?? null, ...(doc && typeof document !== "undefined" && doc !== document ? { doc } : {}) } });
  if (opts.keys) timer = setTimeout(hideWidthTip, WIDTH_TIP_KEY_MS);
}

export function hideWidthTip(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  if (useWidthTip.getState().tip) useWidthTip.setState({ tip: null });
}

/** The work row's width (the conversation columns' % is of it): the element the row marks. */
export function workRowWidth(): number {
  if (typeof document === "undefined") return 0;
  return queryAppWindows<HTMLElement>("[data-side-work]")?.clientWidth ?? 0;
}
