// The conversation header's 「N 个服务」 popover (components/ServiceLinks AgentServicesView): where it sits, how tall
// it may be, and how its rows are laid out (owner 2026-10-25: with 16 services it ran off the bottom of the window).
//   · Never taller than the room below the pill (or above it, when that is roomier and below is short): the header
//     and the footer stay, the list scrolls inside.
//   · Many services and a wide enough window: two columns of compact rows, paged to what fits (‹ 1/2 ›, PageUp /
//     PageDown). Narrow windows: one column that scrolls.
// Row heights are the drawn ones (ServiceLinks); the list still scrolls should a row come out taller.
import type { ServiceView } from "../../../shared/ipc";

export const POP_W = 340;
export const POP_W_WIDE = 600;
/** Kept free between the popover and the window's edge / the pill. */
export const POP_MARGIN = 8;
export const POP_GAP = 6;
/** Title, sub line, footer (and pager), padding. */
export const POP_CHROME = 136;
/** A one-column row (name, status, the 和它的智能体一起打开 checkbox) and a compact two-column one. */
export const ROW_H = 66;
export const ROW_H_COMPACT = 44;

export interface Rect {
  top: number;
  bottom: number;
  right: number;
}

export interface ServicesPopoverLayout {
  /** CSS `top` (below the pill) or `bottom` (above it). */
  top?: number;
  bottom?: number;
  left: number;
  width: number;
  maxHeight: number;
  columns: 1 | 2;
  /** Services per page; `Infinity` = one scrolling list. */
  pageSize: number;
}

export function servicesPopoverLayout(count: number, anchor: Rect, view: { width: number; height: number }): ServicesPopoverLayout {
  const below = Math.max(0, view.height - anchor.bottom - POP_GAP - POP_MARGIN);
  const above = Math.max(0, anchor.top - POP_GAP - POP_MARGIN);
  const natural = POP_CHROME + count * ROW_H;
  const up = natural > below && above > below;
  const room = up ? above : below;
  const two = natural > room && view.width >= POP_W_WIDE + 2 * POP_MARGIN;
  const wanted = two ? POP_W_WIDE : POP_W;
  const width = Math.min(wanted, view.width - 2 * POP_MARGIN);
  const left = Math.max(POP_MARGIN, Math.min(anchor.right - width, view.width - width - POP_MARGIN));
  const pageSize = two ? 2 * Math.max(1, Math.floor((room - POP_CHROME) / ROW_H_COMPACT)) : Infinity;
  const place = up ? { bottom: view.height - anchor.top + POP_GAP } : { top: anchor.bottom + POP_GAP };
  return { ...place, left, width, maxHeight: room, columns: two ? 2 : 1, pageSize };
}

export function pageCount(count: number, pageSize: number): number {
  return Number.isFinite(pageSize) ? Math.max(1, Math.ceil(count / pageSize)) : 1;
}

/** The page's slice (a page past the end, after services went away: the last one). */
export function pageOf<T>(list: readonly T[], pageSize: number, page: number): { rows: readonly T[]; page: number; pages: number } {
  const pages = pageCount(list.length, pageSize);
  const p = Math.min(Math.max(0, page), pages - 1);
  return { rows: Number.isFinite(pageSize) ? list.slice(p * pageSize, (p + 1) * pageSize) : list, page: p, pages };
}

/** Where it is reached, after the health word: 「:24301」; a static service with no port 「静态」; nothing else is shown. */
export function serviceWhere(s: Pick<ServiceView, "port" | "runtime">, staticWord: string): string | null {
  if (typeof s.port === "number" && s.port > 0) return `:${s.port}`;
  return s.runtime === "static" ? staticWord : null;
}

/** 「运行中 · :24301」 / 「运行中 · 静态」 / 「运行中」: the empty parts left out. */
export function serviceStatusLine(health: string, where: string | null): string {
  return where ? `${health} · ${where}` : health;
}
