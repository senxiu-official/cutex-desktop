// The desktop's free layout (design 030 v2; pure, unit-tested in test/deskLayout.test.ts): an invisible 8 px grid,
// smart guides (edges, centres, a 12 px gap, the desktop's edges and centre; Alt: none), the drop rule among widgets
// (one covered of the same size swaps, else each covered goes to its nearest free place; never refused), three
// width bands whose positions are anchored to the nearer edge, and the default layout (today's look).
// Boxes are in px of the desktop's content width; sizes are multiples of the step unless a guide snapped them.

export const STEP = 8;
/** The standard space between two widgets (a guide snaps a neighbour to it). */
export const GAP = 12;
/** How near (px) an edge / centre must come for a guide to take it. */
export const SNAP = 6;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** A stored box: its horizontal anchor (left / right edge, or the centre). */
export interface AnchoredBox extends Box {
  ax: "l" | "r" | "c";
}
export type Layout = Readonly<Record<string, Box>>;

export type BandKey = "n" | "m" | "w";
/** Width bands of the desktop's content width (design 030 Q3): narrow < 760, medium < 1280, wide. */
export function bandOf(width: number): BandKey {
  return width < 760 ? "n" : width < 1280 ? "m" : "w";
}

export const roundStep = (v: number): number => Math.round(v / STEP) * STEP;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const overlap = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** The nearer edge, or the centre when the box sits about in the middle. */
export function anchorOf(r: Box, width: number): AnchoredBox["ax"] {
  const cx = r.x + r.w / 2;
  if (Math.abs(cx - width / 2) < width * 0.06 && r.x > 0 && r.x + r.w < width) return "c";
  return r.x <= width - (r.x + r.w) ? "l" : "r";
}

/** Whether `r` is inside the width and at least a GAP from every box in `at` (except `skip`). */
export function isFree(at: Layout, r: Box, width: number, skip: ReadonlySet<string> = new Set()): boolean {
  if (r.x < 0 || r.y < 0 || r.x + r.w > width) return false;
  for (const [id, o] of Object.entries(at)) {
    if (skip.has(id)) continue;
    if (overlap({ x: o.x - GAP, y: o.y - GAP, w: o.w + 2 * GAP, h: o.h + 2 * GAP }, r)) return false;
  }
  return true;
}

/** The free place for `r`'s size nearest to `r`: beside another box (one GAP away), its own place, or below all. */
export function nearestFree(at: Layout, r: Box, width: number): Box {
  const cand: { x: number; y: number }[] = [{ x: r.x, y: r.y }];
  for (const o of Object.values(at)) {
    cand.push({ x: o.x + o.w + GAP, y: o.y }, { x: o.x - GAP - r.w, y: o.y }, { x: o.x, y: o.y + o.h + GAP }, { x: o.x, y: o.y - GAP - r.h }, { x: o.x + o.w + GAP, y: r.y }, { x: r.x, y: o.y + o.h + GAP });
  }
  const bottom = Math.max(0, ...Object.values(at).map((o) => o.y + o.h + GAP));
  cand.push({ x: 0, y: bottom }, { x: clamp(r.x, 0, Math.max(0, width - r.w)), y: bottom });
  let best: { d: number; t: Box } | null = null;
  for (const c of cand) {
    // Beside a box = exactly one GAP away (not rounded to the step: the gap stays even).
    const t = { x: clamp(c.x, 0, Math.max(0, width - r.w)), y: Math.max(0, c.y), w: r.w, h: r.h };
    if (!isFree(at, t, width)) continue;
    const d = Math.hypot(t.x - r.x, t.y - r.y);
    if (!best || d < best.d || (d === best.d && (t.y < best.t.y || (t.y === best.t.y && t.x < best.t.x)))) best = { d, t };
  }
  return best ? best.t : { x: 0, y: bottom, w: r.w, h: r.h };
}

/** The first free place from the top left (a new pin / widget). */
export function firstFree(at: Layout, w: number, h: number, width: number): Box {
  const boxes = Object.values(at);
  const bottom = Math.max(0, ...boxes.map((o) => o.y + o.h + GAP));
  // Candidates: the top / left edge, and one GAP past each box (rows top first, then left first).
  const ys = [...new Set([0, ...boxes.map((o) => o.y), ...boxes.map((o) => o.y + o.h + GAP)])].sort((a, c) => a - c);
  const xs = [...new Set([0, ...boxes.map((o) => o.x + o.w + GAP)])].sort((a, c) => a - c);
  for (const y of ys) for (const x of xs) if (x + w <= width && isFree(at, { x, y, w, h }, width)) return { x, y, w, h };
  return { x: 0, y: bottom, w, h };
}

export interface Moved {
  id: string;
  to: Box;
  swap: boolean;
}

/**
 * The drop rule (design 030 Q2): `id` takes `r`. Exactly one covered box of the same size (and `id` keeps its
 * size) swaps with it; otherwise each covered box (top to bottom) goes to the free place nearest its own. Nothing
 * else moves; never refused (the caller keeps `r` inside the width).
 */
export function place(at: Layout, id: string, r: Box, width: number): { at: Record<string, Box>; moved: Moved[] } {
  const out: Record<string, Box> = { ...at, [id]: r };
  const moved: Moved[] = [];
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
    out[o] = nearestFree(rest, at[o]!, width);
    moved.push({ id: o, to: out[o]!, swap: false });
  }
  return { at: out, moved };
}

/** A guide line to draw: vertical at x (or horizontal at y), from / to along the other axis; `label` e.g. "12". */
export interface Guide {
  dir: "v" | "h";
  at: number;
  from: number;
  to: number;
  label?: "gap" | "centre" | "edge";
}

interface Target {
  v: number;
  o?: Box;
  kind?: "edge" | "centre" | "gap";
}

/**
 * Snapping a moved box: each axis takes the nearest target within SNAP px — the other boxes' edges and centres,
 * one GAP beside them, the desktop's edges and centre — for the box's start / centre / end; found: snapped, with a
 * guide; else the step. `alt`: neither (1 px).
 */
export function snapMove(others: readonly Box[], r: Box, width: number, alt: boolean): { box: Box; guides: Guide[] } {
  if (alt) return { box: { ...r, x: clamp(Math.round(r.x), 0, Math.max(0, width - r.w)), y: Math.max(0, Math.round(r.y)) }, guides: [] };
  const axis = (pos: number, size: number, vert: boolean) => {
    const targets: Target[] = [{ v: 0, kind: "edge" }];
    if (vert) targets.push({ v: width, kind: "edge" }, { v: width / 2, kind: "centre" });
    for (const o of others) {
      const a = vert ? o.x : o.y;
      const s = vert ? o.w : o.h;
      targets.push({ v: a, o }, { v: a + s, o }, { v: a + s / 2, o, kind: "centre" }, { v: a + s + GAP, o, kind: "gap" }, { v: a - GAP, o, kind: "gap" });
    }
    let best: { d: number; t: Target } | null = null;
    for (const [off, mid] of [[0, false], [size / 2, true], [size, false]] as const)
      for (const t of targets) {
        if ((t.kind === "centre") !== mid) continue;
        const d = t.v - (pos + off);
        if (Math.abs(d) <= SNAP && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, t };
      }
    return best ? { pos: pos + best.d, t: best.t } : { pos: roundStep(pos), t: null };
  };
  const gx = axis(r.x, r.w, true);
  const gy = axis(r.y, r.h, false);
  const box = { ...r, x: clamp(gx.pos, 0, Math.max(0, width - r.w)), y: Math.max(0, gy.pos) };
  const guides: Guide[] = [];
  const line = (dir: "v" | "h", t: Target): Guide => {
    const o = t.o;
    const label = t.kind === "gap" ? "gap" : t.kind === "centre" && !o ? "centre" : t.kind === "edge" ? "edge" : undefined;
    if (dir === "v") return { dir, at: t.v, from: o ? Math.min(box.y, o.y) : 0, to: o ? Math.max(box.y + box.h, o.y + o.h) : Number.POSITIVE_INFINITY, ...(label ? { label } : {}) };
    return { dir, at: t.v, from: o ? Math.min(box.x, o.x) : 0, to: o ? Math.max(box.x + box.w, o.x + o.w) : width, ...(label ? { label } : {}) };
  };
  if (gx.t) guides.push(line("v", gx.t));
  if (gy.t) guides.push(line("h", gy.t));
  return { box, guides };
}

export interface SizeLimits {
  min: readonly [number, number];
  max: readonly [number, number];
  /** w / h kept. */
  ratio?: number;
}

/** Resizing: the right / bottom edge snaps like a move (to other edges, a GAP before them, the desktop's right); then the step, the limits, the ratio. */
export function snapResize(others: readonly Box[], r: Box, width: number, alt: boolean, limits: SizeLimits): { box: Box; guides: Guide[] } {
  let w = r.w;
  let h = r.h;
  const guides: Guide[] = [];
  if (!alt) {
    const xs: Target[] = [{ v: width }, ...others.flatMap((o) => [o.x, o.x + o.w, o.x - GAP].map((v) => ({ v, o })))];
    const ys: Target[] = others.flatMap((o) => [o.y, o.y + o.h, o.y - GAP].map((v) => ({ v, o })));
    const ex = xs.find((t) => Math.abs(t.v - (r.x + w)) <= SNAP);
    const ey = ys.find((t) => Math.abs(t.v - (r.y + h)) <= SNAP);
    if (ex) {
      w = ex.v - r.x;
      guides.push({ dir: "v", at: ex.v, from: Math.min(r.y, ex.o?.y ?? r.y), to: Math.max(r.y + h, ex.o ? ex.o.y + ex.o.h : r.y + h) });
    } else w = roundStep(w);
    if (ey) {
      h = ey.v - r.y;
      guides.push({ dir: "h", at: ey.v, from: Math.min(r.x, ey.o!.x), to: Math.max(r.x + w, ey.o!.x + ey.o!.w) });
    } else h = roundStep(h);
  }
  w = clamp(w, limits.min[0], Math.max(limits.min[0], Math.min(limits.max[0], width - r.x)));
  if (limits.ratio) {
    h = Math.round(w / limits.ratio);
    if (h > limits.max[1]) {
      h = limits.max[1];
      w = Math.round(h * limits.ratio);
    }
  } else h = clamp(h, limits.min[1], limits.max[1]);
  return { box: { ...r, w, h }, guides };
}

/**
 * A band stored at `src.width`, drawn at `width`: each box keeps its distance to its anchor edge (or its centre
 * share); a box wider than the room shrinks to fit (not below its min); then boxes that now overlap go to their
 * nearest free place — right-anchored ones first (they own the right edge), then in reading order. Boxes for ids
 * the band does not have (a widget added on another device) go to the first free place with `sizeOf`.
 */
export function deriveBand(src: { width: number; at: Readonly<Record<string, AnchoredBox | Box>> }, width: number, ids: readonly string[], sizeOf: (id: string) => { w: number; h: number; minW: number; ratio?: number }): Record<string, Box> {
  const shifted: Record<string, Box> = {};
  const axOf = (id: string): AnchoredBox["ax"] => {
    const b = src.at[id]!;
    return "ax" in b && b.ax ? b.ax : anchorOf(b, src.width);
  };
  const known = ids.filter((id) => src.at[id]);
  for (const id of known) {
    const s0 = src.at[id]!;
    const ax = axOf(id);
    let r: Box = { x: ax === "l" ? s0.x : ax === "r" ? width - (src.width - s0.x) : Math.round(((s0.x + s0.w / 2) / src.width) * width - s0.w / 2), y: s0.y, w: s0.w, h: s0.h };
    if (r.w > width) {
      const s = sizeOf(id);
      const w = Math.max(s.minW, width);
      r = { ...r, w, h: s.ratio ? Math.round(w / s.ratio) : r.h };
    }
    r.x = clamp(r.x, 0, Math.max(0, width - r.w));
    shifted[id] = r;
  }
  const order = [...known].sort((a, b) => Number(axOf(b) === "r") - Number(axOf(a) === "r") || shifted[a]!.y - shifted[b]!.y || shifted[a]!.x - shifted[b]!.x);
  const out: Record<string, Box> = {};
  for (const id of order) out[id] = isFree(out, shifted[id]!, width) ? shifted[id]! : nearestFree(out, shifted[id]!, width);
  for (const id of ids) {
    if (out[id]) continue;
    const s = sizeOf(id);
    out[id] = firstFree(out, Math.min(s.w, width), s.h, width);
  }
  return out;
}

/** With anchors, for storing a band. */
export function anchored(at: Layout, width: number): Record<string, AnchoredBox> {
  return Object.fromEntries(Object.entries(at).map(([id, r]) => [id, { ...r, ax: anchorOf(r, width) }]));
}

export interface DefaultEntry {
  id: string;
  area: "header-left" | "header-right" | "side" | "main";
  order: number;
  w: number;
  h: number;
}

/**
 * The default layout (design 030 §10; today's look): the header row (header-left from the left, header-right
 * from the right), a side column on the right (≥ 760 px; its width = its widest entry) stacked by order, the main
 * entries packed row by row left of it, one GAP apart. Narrow: no side column — the side entries follow the main ones.
 */
export function defaultLayout(entries: readonly DefaultEntry[], width: number): Record<string, Box> {
  const at: Record<string, Box> = {};
  const by = (area: DefaultEntry["area"]) => entries.filter((e) => e.area === area).sort((a, b) => a.order - b.order);
  const fit = (w: number) => Math.min(w, width);
  let x = 0;
  for (const e of by("header-left")) {
    at[e.id] = { x, y: 0, w: fit(e.w), h: e.h };
    x += fit(e.w) + GAP;
  }
  let right = width;
  for (const e of by("header-right")) {
    const w = fit(e.w);
    const box = { x: Math.max(0, right - w), y: 0, w, h: e.h };
    if (!isFree(at, box, width)) at[e.id] = firstFree(at, w, e.h, width);
    else at[e.id] = box;
    right = at[e.id]!.x - GAP;
  }
  const headerBottom = Math.max(0, ...Object.values(at).map((r) => r.y + r.h));
  const top = headerBottom ? roundStep(headerBottom + GAP) : 0;
  const side = by("side");
  const wide = width >= 760 && side.length > 0;
  const sideW = wide ? Math.max(...side.map((e) => fit(e.w))) : 0;
  if (wide) {
    let y = top;
    for (const e of side) {
      at[e.id] = { x: width - sideW, y, w: sideW, h: e.h };
      y += e.h + GAP;
    }
  }
  const mainW = wide ? width - sideW - GAP : width;
  const placed: Record<string, Box> = {};
  for (const e of by("main")) {
    const w = Math.min(e.w, mainW);
    const r = firstFree(placed, w, e.h, mainW);
    placed[e.id] = r;
  }
  for (const [id, r] of Object.entries(placed)) at[id] = { ...r, y: r.y + top };
  if (!wide) {
    for (const e of side) at[e.id] = firstFree(at, fit(e.w), e.h, width);
  }
  return at;
}
