// The desktop's grid (contract 1.24, owner 2026-10-24: 一格 40 px — 「你现在的单个其实是占据 2x2」; 1.23 was 96 px cells,
// 「可以固定，或者给个 grid，现在 grid 好像太细」;
// .claude/previews/preview-widgets-grid2.html; pure, unit-tested in test/deskCells.test.ts). Boxes are whole units:
// a unit is 40 px, two neighbours are 16 px apart (the pitch is 56 px), so every box is n × 56 − 16 px wide and no
// two can be closer than one gap; two units and a gap are one 1.23 cell (96 px), so 1.23 layouts double exactly
// (`unitsOfCellBand`). Positions and sizes here are in units (named "cells" in the code); the surface draws px.
// The drop rule is the one of the free grid (design 030 Q2): one covered box of the same size swaps, else each
// covered one goes to its nearest free place; never refused. Bands are stored per width band as cells with the
// box's anchor (left / right edge or centre); a band at another column count is derived from them. Layouts
// stored on the old 8 px grid (`desk.bands`, contract 1.22) are migrated: each box to its nearest cells, overlaps
// to the nearest free place (below when nothing nearer is free).
import type { AnchoredBox, BandKey, Box } from "./deskLayout";

export const CELL = 40;
export const GAP = 16;
export const PITCH = CELL + GAP;
/** The 1.23 cell's pitch (96 + 16): two units. */
export const CELL_1_23_PITCH = 2 * PITCH;

export interface Cells {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface AnchoredCells extends Cells {
  ax: "l" | "r" | "c";
}
export type CellLayout = Readonly<Record<string, Cells>>;

/** A 1.23 band (96 px cells) in units: every number doubles (two units + a gap = one cell; nothing moves). */
export function unitsOfCellBand(b: CellBand): CellBand {
  return { cols: b.cols * 2, at: Object.fromEntries(Object.entries(b.at).map(([k, r]) => [k, { x: r.x * 2, y: r.y * 2, w: r.w * 2, h: r.h * 2, ax: r.ax }])) };
}
/** A stored band on the cell grid: the column count it was arranged at and its boxes. */
export interface CellBand {
  cols: number;
  at: Record<string, AnchoredCells>;
}

/** The columns a desktop of `width` px holds (at least one). */
export const colsFor = (width: number): number => Math.max(1, Math.floor((width + GAP) / PITCH));
/** The px of `n` cells side by side (with the gaps between them). */
export const spanPx = (n: number): number => n * PITCH - GAP;
/** The cells nearest to `px` (at least one): how a 1.22 size in px maps to the grid. */
export const spansOf = (px: number): number => Math.max(1, Math.round((px + GAP) / PITCH));
/** A box in px (for drawing). */
export const toPx = (c: Cells): Box => ({ x: c.x * PITCH, y: c.y * PITCH, w: spanPx(c.w), h: spanPx(c.h) });

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const overlap = (a: Cells, b: Cells): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Whether `r` lies inside the columns and covers no box of `at` (except `skip`). */
export function isFree(at: CellLayout, r: Cells, cols: number, skip: ReadonlySet<string> = new Set()): boolean {
  if (r.x < 0 || r.y < 0 || r.x + r.w > cols) return false;
  for (const [id, o] of Object.entries(at)) if (!skip.has(id) && overlap(o, r)) return false;
  return true;
}

const bottomOf = (at: CellLayout): number => Math.max(0, ...Object.values(at).map((o) => o.y + o.h));

/** The free place for `r`'s size nearest to `r` (ties: higher, then further left); below everything at worst. */
export function nearestFree(at: CellLayout, r: Cells, cols: number): Cells {
  const w = Math.min(r.w, cols);
  const bottom = bottomOf(at);
  let best: { d: number; c: Cells } | null = null;
  for (let y = 0; y <= Math.max(bottom, r.y); y++)
    for (let x = 0; x + w <= cols; x++) {
      const c = { x, y, w, h: r.h };
      if (!isFree(at, c, cols)) continue;
      const d = Math.hypot(x - r.x, y - r.y);
      if (!best || d < best.d - 1e-9) best = { d, c };
    }
  return best ? best.c : { x: 0, y: bottom, w, h: r.h };
}

/** The first free place from the top left, row by row (a new widget / pin). */
export function firstFree(at: CellLayout, w: number, h: number, cols: number): Cells {
  const ww = Math.min(w, cols);
  const bottom = bottomOf(at);
  for (let y = 0; y <= bottom; y++) for (let x = 0; x + ww <= cols; x++) if (isFree(at, { x, y, w: ww, h }, cols)) return { x, y, w: ww, h };
  return { x: 0, y: bottom, w: ww, h };
}

export interface CellMoved {
  id: string;
  to: Cells;
  swap: boolean;
}

/** The drop rule: `id` takes `r`; one covered box of the same size swaps, else each covered one goes to its nearest free place. */
export function place(at: CellLayout, id: string, r: Cells, cols: number): { at: Record<string, Cells>; moved: CellMoved[] } {
  const out: Record<string, Cells> = { ...at, [id]: r };
  const moved: CellMoved[] = [];
  const from = at[id];
  const hit = Object.keys(at).filter((o) => o !== id && overlap(at[o]!, r));
  if (hit.length === 1 && from && at[hit[0]!]!.w === r.w && at[hit[0]!]!.h === r.h && from.w === r.w && from.h === r.h) {
    out[hit[0]!] = { ...from };
    moved.push({ id: hit[0]!, to: out[hit[0]!]!, swap: true });
    return { at: out, moved };
  }
  const pending = new Set(hit);
  hit.sort((a, b) => at[a]!.y - at[b]!.y || at[a]!.x - at[b]!.x);
  for (const o of hit) {
    pending.delete(o);
    const rest = Object.fromEntries(Object.entries(out).filter(([k]) => k !== o && !pending.has(k)));
    out[o] = nearestFree(rest, at[o]!, cols);
    moved.push({ id: o, to: out[o]!, swap: false });
  }
  return { at: out, moved };
}

/** The nearer edge, or the centre when the box sits about in the middle. */
export function anchorOf(r: Cells, cols: number): AnchoredCells["ax"] {
  const left = r.x;
  const right = cols - (r.x + r.w);
  if (left > 0 && right > 0 && Math.abs(left - right) <= 2 && cols >= 12) return "c";
  return left <= right ? "l" : "r";
}

export function anchoredCells(at: CellLayout, cols: number): Record<string, AnchoredCells> {
  return Object.fromEntries(Object.entries(at).map(([id, r]) => [id, { ...r, ax: anchorOf(r, cols) }]));
}

/** What the layout needs of an instance: its size in cells and its smallest width (and a kept w / h). */
export type CellSizeOf = (id: string) => { w: number; h: number; minW: number; ratio?: number };

/** Boxes placed in order (right-anchored first: they own the right edge; then reading order), overlaps to the nearest free place. */
function settle(shifted: Record<string, Cells>, order: readonly string[], cols: number): Record<string, Cells> {
  const out: Record<string, Cells> = {};
  for (const id of order) out[id] = isFree(out, shifted[id]!, cols) ? shifted[id]! : nearestFree(out, shifted[id]!, cols);
  return out;
}

function fitWidth(r: Cells, cols: number, s: ReturnType<CellSizeOf>): Cells {
  if (r.w <= cols) return r;
  const w = Math.max(Math.min(s.minW, cols), cols);
  return { ...r, w, h: s.ratio ? Math.max(1, Math.round(w / s.ratio)) : r.h };
}

/**
 * A cell band stored at `src.cols`, drawn at `cols`: each box keeps its distance to its anchor edge (or its share
 * of the width for the centre); one wider than the columns shrinks; overlaps go to the nearest free place. Ids
 * the band lacks (added on another device) go to the first free place.
 */
export function deriveCells(src: CellBand, cols: number, ids: readonly string[], sizeOf: CellSizeOf): Record<string, Cells> {
  const shifted: Record<string, Cells> = {};
  const known = ids.filter((id) => src.at[id]);
  for (const id of known) {
    const s0 = src.at[id]!;
    let r: Cells = { x: s0.ax === "l" ? s0.x : s0.ax === "r" ? cols - (src.cols - s0.x) : Math.round(((s0.x + s0.w / 2) / src.cols) * cols - s0.w / 2), y: s0.y, w: s0.w, h: s0.h };
    r = fitWidth(r, cols, sizeOf(id));
    r.x = clamp(r.x, 0, Math.max(0, cols - r.w));
    shifted[id] = r;
  }
  const order = [...known].sort((a, b) => Number(src.at[b]!.ax === "r") - Number(src.at[a]!.ax === "r") || shifted[a]!.y - shifted[b]!.y || shifted[a]!.x - shifted[b]!.x);
  const out = settle(shifted, order, cols);
  for (const id of ids) {
    if (out[id]) continue;
    const s = sizeOf(id);
    out[id] = firstFree(out, s.w, s.h, cols);
  }
  return out;
}

/**
 * A band stored on the old 8 px grid (contract 1.22, px boxes with anchors at `src.width`) on the cell grid at
 * `cols`: each size to its nearest cell count, each box to the cells nearest its anchored place (its left edge, its
 * right edge, or its centre), then overlaps to the nearest free place — below everything when nothing nearer is
 * free. Ids the band lacks go to the first free place.
 */
export function migratePxBand(src: { width: number; at: Readonly<Record<string, AnchoredBox>> }, cols: number, ids: readonly string[], sizeOf: CellSizeOf): Record<string, Cells> {
  const shifted: Record<string, Cells> = {};
  const known = ids.filter((id) => src.at[id]);
  for (const id of known) {
    const b = src.at[id]!;
    const s = sizeOf(id);
    const w0 = spansOf(b.w);
    const h = s.ratio ? Math.max(1, Math.round(w0 / s.ratio)) : spansOf(b.h);
    let r: Cells = { x: 0, y: Math.max(0, Math.round(b.y / PITCH)), w: w0, h };
    r = fitWidth(r, cols, s);
    const x = b.ax === "l" ? Math.round(b.x / PITCH) : b.ax === "r" ? cols - r.w - Math.round(Math.max(0, src.width - (b.x + b.w)) / PITCH) : Math.round(((b.x + b.w / 2) / src.width) * cols - r.w / 2);
    r.x = clamp(x, 0, Math.max(0, cols - r.w));
    shifted[id] = r;
  }
  const order = [...known].sort((a, b) => Number(src.at[b]!.ax === "r") - Number(src.at[a]!.ax === "r") || shifted[a]!.y - shifted[b]!.y || shifted[a]!.x - shifted[b]!.x);
  const out = settle(shifted, order, cols);
  for (const id of ids) {
    if (out[id]) continue;
    const s = sizeOf(id);
    out[id] = firstFree(out, s.w, s.h, cols);
  }
  return out;
}

export interface CellEntry {
  id: string;
  area: "header-left" | "header-right" | "side" | "main";
  order: number;
  w: number;
  h: number;
}

/** Columns from which the side column stands beside the main area (as the 760 px band did on the free grid). */
export const SIDE_MIN_COLS = 12;

/**
 * The default layout in cells: the header row (header-left from the left, header-right from the right — the two
 * clocks side by side, owner 2026-10-24), a side column on the right (its width = its widest entry) stacked by
 * order, the main entries packed row by row left of it. Too few columns: no side column, its entries follow.
 */
export function defaultCells(entries: readonly CellEntry[], cols: number): Record<string, Cells> {
  const at: Record<string, Cells> = {};
  const by = (area: CellEntry["area"]) => entries.filter((e) => e.area === area).sort((a, b) => a.order - b.order);
  const fit = (w: number) => Math.min(w, cols);
  let x = 0;
  for (const e of by("header-left")) {
    const r = { x, y: 0, w: fit(e.w), h: e.h };
    at[e.id] = isFree(at, r, cols) ? r : firstFree(at, r.w, e.h, cols);
    x = at[e.id]!.y === 0 ? at[e.id]!.x + at[e.id]!.w : x;
  }
  let right = cols;
  for (const e of by("header-right")) {
    const w = fit(e.w);
    const r = { x: right - w, y: 0, w, h: e.h };
    at[e.id] = r.x >= 0 && isFree(at, r, cols) ? r : firstFree(at, w, e.h, cols);
    if (at[e.id]!.y === 0) right = at[e.id]!.x;
  }
  const top = bottomOf(at);
  const side = by("side");
  const wide = cols >= SIDE_MIN_COLS && side.length > 0;
  const sideW = wide ? Math.min(Math.max(...side.map((e) => fit(e.w))), cols - 2) : 0;
  if (wide) {
    let y = top;
    for (const e of side) {
      at[e.id] = { x: cols - sideW, y, w: sideW, h: e.h };
      y += e.h;
    }
  }
  const mainCols = wide ? cols - sideW : cols;
  const placed: Record<string, Cells> = {};
  for (const e of by("main")) placed[e.id] = firstFree(placed, Math.min(e.w, mainCols), e.h, mainCols);
  for (const [id, r] of Object.entries(placed)) at[id] = { ...r, y: r.y + top };
  if (!wide) for (const e of side) at[e.id] = firstFree(at, fit(e.w), e.h, cols);
  return at;
}

/** A size in cells within the limits, keeping the ratio. */
export function clampSize(w: number, h: number, limits: { min: readonly [number, number]; max: readonly [number, number]; ratio?: number }, room: number): { w: number; h: number } {
  let ww = clamp(Math.round(w), limits.min[0], Math.max(limits.min[0], Math.min(limits.max[0], room)));
  let hh: number;
  if (limits.ratio) {
    hh = Math.max(1, Math.round(ww / limits.ratio));
    if (hh > limits.max[1]) {
      hh = limits.max[1];
      ww = Math.max(1, Math.round(hh * limits.ratio));
    }
  } else hh = clamp(Math.round(h), limits.min[1], limits.max[1]);
  return { w: ww, h: hh };
}

export type { BandKey };

/**
 * The columns nothing covers (owner 2026-11-10): the grid of `cols` sits centred in `width` px and `cover.left` /
 * `cover.right` px of the width are under a Shelf. `from` is the first free column, `count` how many there are.
 */
export function visibleCols(width: number, cols: number, cover: { left: number; right: number }): { from: number; count: number } {
  const gridLeft = Math.max(0, Math.floor((width - spanPx(cols)) / 2));
  const from = clamp(Math.ceil((cover.left - gridLeft) / PITCH), 0, cols);
  const to = clamp(Math.floor((width - cover.right - gridLeft + GAP) / PITCH), from, cols);
  return { from, count: to - from };
}

/**
 * The saved layout `full` seen through the columns [`from`, `from + count`) while a Shelf covers the rest (owner
 * 2026-11-10): a view only — computed from the saved boxes on every draw and never stored, so when the room comes
 * back the desktop is exactly as it was. Boxes wholly inside keep their place; the others keep the reading order:
 * each takes the first free place inside at or below the row of the widget before it (filling the free columns).
 * One wider than the free columns is hidden (never shrunk).
 */
export function reflowCells(full: CellLayout, from: number, count: number): { at: Record<string, Cells>; hidden: string[] } {
  const inside = (r: Cells) => r.x >= from && r.x + r.w <= from + count;
  const local: Record<string, Cells> = {};
  for (const [id, r] of Object.entries(full)) if (inside(r)) local[id] = { ...r, x: r.x - from };
  const hidden: string[] = [];
  const order = Object.keys(full).sort((a, b) => full[a]!.y - full[b]!.y || full[a]!.x - full[b]!.x);
  let row = 0;
  for (const id of order) {
    const r = full[id]!;
    if (local[id]) {
      row = local[id]!.y;
      continue;
    }
    if (r.w > count) {
      hidden.push(id);
      continue;
    }
    local[id] = freeFrom(local, r.w, r.h, count, row);
    row = local[id]!.y;
  }
  return { at: Object.fromEntries(Object.entries(local).map(([id, r]) => [id, { ...r, x: r.x + from }])), hidden };
}

/** The first free place at or below row `y0`, row by row from the left. */
function freeFrom(at: CellLayout, w: number, h: number, cols: number, y0: number): Cells {
  const bottom = Math.max(bottomOf(at), y0);
  for (let y = y0; y <= bottom; y++) for (let x = 0; x + w <= cols; x++) if (isFree(at, { x, y, w, h }, cols)) return { x, y, w, h };
  return { x: 0, y: bottom, w, h };
}

// ── A Shelf over the desktop (modules/home/deskCover measures it) ──

export interface DeskCover {
  left: number;
  right: number;
}
/** The px of `area` under `covers` from each side (with a gap so a widget never touches a Shelf's edge). Pure. */
export function coverOf(area: { left: number; right: number; top: number; bottom: number }, covers: readonly { left: number; right: number; top: number; bottom: number }[]): DeskCover {
  let left = 0;
  let right = 0;
  const mid = (area.left + area.right) / 2;
  for (const b of covers) {
    if (b.right <= b.left || b.bottom <= area.top || b.top >= area.bottom || b.right <= area.left || b.left >= area.right) continue;
    if ((b.left + b.right) / 2 >= mid) right = Math.max(right, area.right - b.left + GAP);
    else left = Math.max(left, b.right - area.left + GAP);
  }
  const width = area.right - area.left;
  return { left: Math.min(width, Math.round(left)), right: Math.min(width, Math.round(right)) };
}
