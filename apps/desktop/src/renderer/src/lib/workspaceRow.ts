// The work row by content width (owner 2026-10-21, docs/desktop-modules.md §24.15): a workspace is its
// conversation column at its own width (the default / dragged single-column width, lib/workSurface) plus its
// Shelf at its own width; one or two workspaces are centred as a group and the free space shows the desktop
// (工作区宽度「按内容」). 「铺满窗口」 keeps today's fill: the columns share the row, edge to edge. 「智能」 (the
// default, owner 2026-10-21): one workspace by content, two fill the window (`rowWidthMode`).
// 宽度规则 (owner 2026-10-21, docs/desktop-modules.md §24.15): each workspace's Shelves keep their own expanded /
// collapsed state, the focus never changes the layout. Short of width the Shelves fold to their rails once,
// when the second workspace opens (`shouldFoldShelves`), or the other workspace's when the owner expands one
// that does not fit (`newlyExpanded`); otherwise the columns narrow, and a Shelf the columns cannot leave room
// for at their minimum shows as its rail without being stored as collapsed. Filling, the two columns share
// what is left by the owner's last dragged ratio (`split`); while a width is dragged only the two panels
// beside the edge change (`pin` keeps the other column; `fillWidths`), and by content nothing re-centres
// (`groupLead`; an edge moves alone: `oneEdgeWidth`).
// 推挤 (owner 2026-10-23, `pushEdge`): an edge dragged moves only itself — the panel on the side it moves toward
// gives, down to its minimum; dragged on, that panel and everything beyond it slide into the free desktop on that
// side (the panels between keep their widths); with no desktop left there the edge stops. Nothing else changes.
// Where a workspace's Shelves sit beside two workspaces (工作区的 Shelf Rail): 外侧 (the left workspace's at the
// window's left edge, the right one's at the right edge — never between the conversations) or 永远偏右. With
// one workspace the Shelves keep their own sides.
// A workspace folded to its strip (收起一个会话, docs/design/002, lib/convStrips): exactly STRIP_W wide, no Shelves (not
// even a rail), out of the share — filling, the other column takes the rest; by content it keeps its width and the
// desktop shows. Pure; tested (test/workspaceRow.test.ts).
import { CARD_GAP, COLLAPSED_SHELF_WIDTH, RAIL_WIDTH, type ShelfSide } from "./sideLayout";
import { CARD_CHROME, type SingleWidthMode } from "./workSurface";
import { foldHeld } from "./foldHysteresis";

/** 工作区宽度: 智能 (one workspace by content, two fill), by content (centred, the desktop beside) or the whole window. */
export type WorkspaceWidthMode = "smart" | "content" | "fill";
/** How the row is laid out now: 智能 resolved by the number of workspaces. */
export type RowWidthMode = "content" | "fill";
/** 工作区的 Shelf Rail with two workspaces: their outer sides, or each on its workspace's right. */
export type WorkspaceRailPlacement = "outer" | "right";

/** A conversation folded to its strip (px; the Shelf Rail is 48). lib/convStrips re-exports it. */
export const STRIP_W = 44;

/** One Shelf of a workspace as stored: its side, its width (its rail not counted) and whether it is collapsed. */
export interface RowShelf {
  id: string;
  side: ShelfSide;
  width: number;
  collapsed: boolean;
}

export interface RowWorkspace {
  /** The column's content width (px); null = it fills what is left (全宽, 铺满窗口). */
  want: number | null;
  /** The narrowest the column gets before the Shelves give way. */
  min: number;
  /** Its Shelves on screen (the focused workspace: live ones; another: none — see `rail`). */
  shelves: readonly RowShelf[];
  /** Another workspace's Shelf shown as its rail (its Shelf has pages; an empty one shows nothing). */
  rail: boolean;
  /** Folded to its strip (lib/convStrips): STRIP_W wide, its Shelves and rail not drawn, out of the share. */
  strip?: boolean;
  /**
   * 只看 Shelf (lib/shelfOnly): the column is a strip but its Shelves stay, at their own (widened) widths; they show
   * as rails only when the other column could not keep its minimum (with the usual fold slack).
   */
  keepShelves?: boolean;
}

export interface RowInput {
  /** The work area's width (0 = not measured yet: everything as wanted). */
  area: number;
  mode: WorkspaceWidthMode;
  placement: WorkspaceRailPlacement;
  /** Left → right, one or two. */
  workspaces: readonly RowWorkspace[];
  /**
   * Filling two columns: the left column's share of what the Shelves leave (the owner's last dragged ratio,
   * 0–1). Given: the columns get explicit widths (`fillWidths`); absent: both flex (null widths).
   */
  split?: number;
  /** While a width is dragged (filling): this column keeps its width, the other one takes the change. */
  pin?: RowPin | null;
  /**
   * The last layout showed the Shelves as their rails for lack of room (`forced`): they come back only once the
   * row has lib/foldHysteresis `FOLD_HYSTERESIS` px more than the threshold, so a window resized across it does not flap.
   */
  held?: boolean;
}


/** A column that keeps its pixel width while an edge it does not touch is dragged. */
export interface RowPin {
  index: number;
  width: number;
}

export interface RowShelfOut {
  id: string;
  /** Which side of its column it is drawn on. */
  at: ShelfSide;
  expanded: boolean;
  /** Its box in the row (px): width + rail + seam, or the rail's strip. */
  box: number;
  /** Shown as its rail only for lack of room (not stored as collapsed). */
  forced: boolean;
}

export interface RowWorkspaceOut {
  /** The column's width (px); null = flex (it fills its share). */
  width: number | null;
  shelves: RowShelfOut[];
  /** Where another workspace's rail is drawn (two workspaces). */
  railAt: ShelfSide;
}

export interface RowOut {
  /** 工作区宽度 as applied (智能 resolved by the number of workspaces). */
  mode: RowWidthMode;
  workspaces: RowWorkspaceOut[];
  /** Centre the group (by content and nothing fills). */
  centred: boolean;
  /** Every column at its wanted width beside the Shelves as stored fits (false = the row is short of width). */
  fits: boolean;
}

/** The box of an expanded Shelf in the row (its width, its rail, the 8 px seam to its column). */
export const expandedBox = (width: number): number => width + RAIL_WIDTH + CARD_GAP;

/**
 * 工作区宽度 as the row applies it: 智能 = by content with one workspace (its column at its default / dragged
 * width, centred, the desktop around it), filling with two (the columns share what the sidebar, the rails,
 * the expanded Shelf and the tray leave, the column handle between them); the other two as chosen.
 */
export function rowWidthMode(mode: WorkspaceWidthMode, count: number): RowWidthMode {
  if (mode === "smart") return count >= 2 ? "fill" : "content";
  return mode;
}

/** The drag handle between two conversation columns: only when they share the row (filling). */
export function columnHandleShown(mode: WorkspaceWidthMode, count: number): boolean {
  return count >= 2 && rowWidthMode(mode, count) === "fill";
}

/** The side a workspace's Shelves are drawn on: their own with one workspace, else per 工作区的 Shelf Rail. */
export function shelfSideAt(index: number, count: number, placement: WorkspaceRailPlacement, own: ShelfSide): ShelfSide {
  if (count < 2) return own;
  if (placement === "right") return "right";
  return index === 0 ? "left" : "right";
}

/**
 * The row's geometry: each column's width, each Shelf expanded / its rail and where it is drawn, centred or
 * not. By content: everything at its width when it fits (centred); short of width the columns narrow toward
 * their minimum, then the Shelves show as their rails. Filling: the columns share what the Shelves leave; the
 * Shelves show as rails when the columns could not keep their minimum beside them.
 */
export function workspaceRow(input: RowInput): RowOut {
  const n = input.workspaces.length;
  const strips = input.workspaces.filter((w) => w.strip).length;
  if (strips > 0 && (strips < n || input.workspaces.some((w) => w.strip && w.keepShelves))) return withStrips(input);
  const gaps = Math.max(0, n - 1) * CARD_GAP;
  const sideOf = (i: number, own: ShelfSide) => shelfSideAt(i, n, input.placement, own);
  const railAt = (i: number) => shelfSideAt(i, n, input.placement, "right");
  const boxes = (forceRails: boolean) =>
    input.workspaces.map((w) => w.shelves.reduce((sum, x) => sum + (x.collapsed || forceRails ? COLLAPSED_SHELF_WIDTH : expandedBox(x.width)), 0) + (w.rail ? COLLAPSED_SHELF_WIDTH : 0));
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const mode = rowWidthMode(input.mode, n);
  const out = (widths: (number | null)[], forced: boolean, centred: boolean, fits: boolean): RowOut => ({
    mode,
    centred,
    fits,
    workspaces: input.workspaces.map((w, i) => ({
      width: widths[i] ?? null,
      railAt: railAt(i),
      shelves: w.shelves.map((x) => {
        const expanded = !x.collapsed && !forced;
        return { id: x.id, at: sideOf(i, x.side), expanded, box: expanded ? expandedBox(x.width) : COLLAPSED_SHELF_WIDTH, forced: !x.collapsed && forced };
      }),
    })),
  });
  const shelvesNow = sum(boxes(false));
  const mins = sum(input.workspaces.map((w) => w.min));
  const fill = mode === "fill" || input.workspaces.some((w) => w.want === null);
  if (fill) {
    // The columns share the rest; the Shelves give way only below the columns' minimum.
    const forced = input.area > 0 && foldHeld((slack) => input.area - shelvesNow - gaps < mins + slack, !!input.held);
    const fits = input.area <= 0 || !forced;
    // Not even the columns' minimum beside the rails: they share what is left (below their minimum) rather than
    // push the row past the window — nothing ever overlaps or leaves the work area.
    const railed = input.area - sum(boxes(true)) - gaps;
    if (forced && railed < mins) return out(input.workspaces.map(() => Math.max(0, Math.floor(railed / n))), true, false, false);
    if (n === 2 && input.split !== undefined && input.area > 0) {
      const avail = input.area - (forced ? sum(boxes(true)) : shelvesNow) - gaps;
      return out(fillWidths({ avail, split: input.split, mins: input.workspaces.map((w) => w.min), pin: input.pin ?? null }), forced, false, fits);
    }
    return out(input.workspaces.map(() => null), forced, false, fits);
  }
  const wants = input.workspaces.map((w) => w.want!);
  const wanted = sum(wants);
  const room = input.area - shelvesNow - gaps;
  const forced = input.area > 0 && foldHeld((slack) => room < mins + slack, !!input.held);
  if (!forced && (input.area <= 0 || wanted + shelvesNow + gaps <= input.area)) return out(wants, false, true, true);
  // Short of width: the columns narrow toward their minimum (each by its share of what it would give).
  const narrow = (room: number): number[] => {
    const give = wanted - mins;
    if (room >= mins && give > 0) return wants.map((w, i) => Math.floor(input.workspaces[i]!.min + ((w - input.workspaces[i]!.min) * (room - mins)) / give));
    if (room >= mins) return input.workspaces.map((w) => w.min);
    return input.workspaces.map(() => Math.max(0, Math.floor(room / n)));
  };
  if (!forced) return out(narrow(room), false, true, false);
  // Still short: the Shelves show as their rails (not stored as collapsed), the columns narrow in what is left.
  const railed = input.area - sum(boxes(true)) - gaps;
  return out(narrow(railed), true, true, false);
}

/**
 * The row with strips: each strip is STRIP_W (and the gap to its neighbour) taken off the row; the others are laid
 * out alone in what is left, as the row's mode says (filling: the rest is theirs — an explicit width; by content:
 * their own width, centred, the desktop around), their Shelves still on their sides of the two-workspace row.
 */
function withStrips(input: RowInput): RowOut {
  const n = input.workspaces.length;
  const mode = rowWidthMode(input.mode, n);
  const rest = input.workspaces.map((w, i) => ({ w, i })).filter((x) => !x.w.strip);
  // 只看 Shelf: the strip's Shelves stay in the row at their widths (rails when the rest would not keep its minimum).
  const keptBoxes = (rails: boolean) =>
    input.workspaces.reduce((m, w) => m + (w.strip && w.keepShelves ? w.shelves.reduce((k, x) => k + (x.collapsed || rails ? COLLAPSED_SHELF_WIDTH : expandedBox(x.width)), 0) : 0), 0);
  const restMin = rest.reduce((m, x) => m + x.w.min, 0) + Math.max(0, rest.length - 1) * CARD_GAP;
  const stripsTaken = (n - rest.length) * (STRIP_W + CARD_GAP) - (rest.length ? 0 : CARD_GAP);
  const keepForced = input.area > 0 && keptBoxes(false) > 0 && foldHeld((slack) => input.area - stripsTaken - keptBoxes(false) < restMin + slack, !!input.held);
  const taken = stripsTaken + keptBoxes(keepForced);
  const area = input.area > 0 ? Math.max(1, input.area - taken) : 0;
  const sub = rest.length ? workspaceRow({ area, mode, placement: input.placement, workspaces: rest.map((x) => x.w), held: input.held }) : null;
  const railAt = (i: number) => shelfSideAt(i, n, input.placement, "right");
  const workspaces: RowWorkspaceOut[] = input.workspaces.map((w, i) => {
    if (w.strip && w.keepShelves) {
      const shelves = w.shelves.map((x) => {
        const expanded = !x.collapsed && !keepForced;
        return { id: x.id, at: shelfSideAt(i, n, input.placement, x.side), expanded, box: expanded ? expandedBox(x.width) : COLLAPSED_SHELF_WIDTH, forced: !x.collapsed && keepForced };
      });
      return { width: STRIP_W, shelves, railAt: railAt(i) };
    }
    if (w.strip) return { width: STRIP_W, shelves: [], railAt: railAt(i) };
    const j = rest.findIndex((x) => x.i === i);
    const out = sub!.workspaces[j]!;
    const shelves = out.shelves.map((x, k) => ({ ...x, at: shelfSideAt(i, n, input.placement, w.shelves[k]!.side) }));
    // Filling: the rest of the row is this column's (an explicit width, so a Shelf's handle knows its limit).
    const others = shelves.reduce((m, x) => m + x.box, 0) + (w.rail ? COLLAPSED_SHELF_WIDTH : 0) + (rest.length - 1) * CARD_GAP;
    const width = out.width ?? (mode === "fill" && area > 0 ? Math.max(0, Math.floor((area - others) / rest.length)) : null);
    return { width, shelves, railAt: railAt(i) };
  });
  return { mode, workspaces, centred: sub ? sub.centred : mode === "content", fits: (sub ? sub.fits : true) && !keepForced };
}

/**
 * The second workspace opened and the row does not fit with the Shelves as stored: every Shelf on screen folds
 * to its rail, once (stored). Nothing else folds by itself (owner 2026-10-21): not the focus moving, not the
 * window narrowing (the columns narrow, then a Shelf shows as its rail without being stored), not the owner's
 * own expand (that folds the other workspace's: `newlyExpanded`).
 */
export function shouldFoldShelves(prev: { area: number; count: number; fits: boolean } | null, now: { area: number; count: number; fits: boolean }): boolean {
  if (!prev || prev.area <= 0 || now.area <= 0 || now.fits) return false;
  return now.count > prev.count && now.count >= 2;
}

/**
 * The conversations (keys) one of whose Shelves went from collapsed to expanded since `prev` — the owner
 * expanded it (a Shelf's state is per conversation, so a focus change alone never shows up here). A key not in
 * `prev` is new on screen: not an expand.
 */
export function newlyExpanded(prev: Readonly<Record<string, readonly string[]>> | null, now: Readonly<Record<string, readonly string[]>>): string[] {
  if (!prev) return [];
  return Object.keys(now).filter((key) => {
    const before = prev[key];
    return !!before && now[key]!.some((id) => !before.includes(id));
  });
}

/**
 * Two filling columns' widths in `avail` px: by the share (`split` of the left one), each at least its
 * minimum while there is room for both; `pin`: that column keeps its width (an edge it does not touch is being
 * dragged), the other takes the rest — but never below its minimum (the dragged edge stops there). Sum = avail.
 */
export function fillWidths(i: { avail: number; split: number; mins: readonly number[]; pin: RowPin | null }): [number, number] {
  const avail = Math.max(0, Math.floor(i.avail));
  const [m0, m1] = [i.mins[0] ?? 0, i.mins[1] ?? 0];
  if (avail <= m0 + m1) {
    const w0 = Math.floor(avail / 2);
    return [w0, avail - w0];
  }
  const share = Number.isFinite(i.split) ? Math.min(1, Math.max(0, i.split)) : 0.5;
  let w0 = i.pin ? (i.pin.index === 0 ? i.pin.width : avail - i.pin.width) : Math.round(avail * share);
  w0 = Math.round(Math.min(avail - m1, Math.max(m0, w0)));
  return [w0, avail - w0];
}

/** Which column keeps its width while something else changes the row: a Shelf of workspace `ws` (its own column takes it), or the row's left / right edge (the column at the far end keeps it). */
export function pinIndex(change: { shelfOf: number } | { edge: "left" | "right" }): number {
  if ("shelfOf" in change) return change.shelfOf === 0 ? 1 : 0;
  return change.edge === "left" ? 1 : 0;
}

/** One item of the row for `pushEdge`, left to right: a panel, the free desktop (`gap`), or something that only slides (`fixed`: a rail, the seam between columns). */
export interface PushItem {
  w: number;
  /** A panel's narrowest (0 by default; a gap's is 0). */
  min?: number;
  /** A panel's widest (none by default). */
  max?: number;
  /** Free desktop: what a panel at its minimum is pushed into. */
  gap?: boolean;
  /** Keeps its width, slides with what it sits between. */
  fixed?: boolean;
}

/**
 * 推挤 (owner 2026-10-23: 「拉 AB 默认是 A 吃/给 B 空间……B 拉到最小值后还想继续扩大就吃【空】」): the edge between
 * `items[edge]` and `items[edge + 1]` dragged `d` px (right: positive). The item it moves away from grows (the nearest
 * one that is not `fixed`), the one it moves toward gives down to its minimum; dragged on, the nearest gap beyond
 * that one gives (the items between slide); nothing else changes, nothing goes below its minimum, and with neither
 * left the edge stops. Returns the new widths (the sum stays) and how far the edge moved.
 */
export function pushEdge(items: readonly PushItem[], edge: number, d: number): { w: number[]; moved: number } {
  const w = items.map((x) => x.w);
  const n = items.length;
  const dir = d > 0 ? 1 : -1;
  const inRow = (i: number) => i >= 0 && i < n;
  let a = dir > 0 ? edge : edge + 1;
  while (inRow(a) && items[a]!.fixed) a -= dir;
  let b = dir > 0 ? edge + 1 : edge;
  while (inRow(b) && items[b]!.fixed) b += dir;
  if (!d || !inRow(a) || !inRow(b)) return { w, moved: 0 };
  let g = b + dir;
  while (inRow(g) && !items[g]!.gap) g += dir;
  const room = (i: number) => (inRow(i) ? Math.max(0, w[i]! - (items[i]!.min ?? 0)) : 0);
  const take = Math.max(0, (items[a]!.max ?? Number.POSITIVE_INFINITY) - w[a]!);
  const moved = Math.max(0, Math.min(Math.abs(d), take, room(b) + room(g)));
  const fromB = Math.min(moved, room(b));
  w[a] = w[a]! + moved;
  w[b] = w[b]! - fromB;
  if (moved > fromB) w[g] = w[g]! - (moved - fromB);
  return { w, moved: dir * moved };
}

/**
 * By content, a Shelf's edge toward its column dragged (推挤): the column gives what the Shelf takes (`delta` px the
 * Shelf grew) down to its minimum, then it slides on into the free desktop beyond it — the group's left edge moves
 * when that is to the left (the Shelf on the column's right). The other way the Shelf stops at its own minimum and is
 * pushed (`push` px, lib/sideResize) out into the desktop on its side; the column takes that too, and a Shelf on the
 * left takes the group's left edge with it. Returns the column's width and how far the group's left edge moved.
 */
export function seamPush(i: { start: number; min: number; delta: number; push: number; shelfAt: ShelfSide }): { width: number; shift: number } {
  const want = i.start - i.delta + i.push;
  const width = Math.round(Math.max(Math.min(i.min, i.start), want));
  const over = Math.max(0, width - want);
  const back = Math.round(i.shelfAt === "right" ? over : i.push);
  return { width, shift: back ? -back : 0 };
}

/**
 * Where the group starts in a row by content (px of free row before it): centred, or `pinned` (a drag left
 * it there — no re-centring after the release until the window resizes or a workspace opens / closes), kept
 * inside the row.
 */
export function groupLead(i: { area: number; total: number; pinned: number | null }): number {
  const free = Math.max(0, i.area - i.total);
  const lead = i.pinned ?? free / 2;
  return Math.round(Math.min(free, Math.max(0, lead)));
}

/**
 * The work row moved / changed width while a drag outside it went on (the sidebar's or the Settings Shelf's
 * edge): the group stays where it is on screen — its lead follows the row's left edge the other way.
 */
export function shiftedLead(lead: number, rowLeftBefore: number, rowLeftNow: number): number {
  return lead + rowLeftBefore - rowLeftNow;
}

/**
 * A panel's edge dragged by content (owner 2026-10-21, docs/design/007): only that edge follows the pointer, the
 * other one stays — the column moves off centre and stays there. `left` = the column's left edge in row px,
 * `start` its width when the drag started, `before` / `after` px of row taken left / right of it besides the free
 * desktop (a Shelf, a rail). It grows into the desktop on its side up to the panels there; it shrinks to `min`,
 * then (推挤, `pushEdge`) slides into the desktop on the other side, the panels there with it. Returns its width and
 * its new left edge.
 */
export function oneEdgeWidth(i: { edge: "left" | "right"; start: number; dx: number; left: number; before: number; after: number; area: number; min: number }): { width: number; left: number } {
  const items: PushItem[] = [
    { w: Math.max(0, i.left - i.before), gap: true },
    { w: i.before, fixed: true },
    { w: i.start, min: i.min },
    { w: i.after, fixed: true },
    { w: Math.max(0, i.area - i.after - i.left - i.start), gap: true },
  ];
  const { w } = pushEdge(items, i.edge === "right" ? 2 : 1, Math.round(i.dx));
  return { width: w[2]!, left: w[0]! + i.before };
}

/**
 * A conversation column's content width (two workspaces: each column; one: lib/workSurface singleColumnWidth
 * decides): the width dragged at the single column's edges, else 单个对话的默认宽度 — the reading width + the
 * card's border, a percentage of the row shared by the columns, or null (全宽: it fills).
 */
export function columnWant(i: { area: number; count: number; readingWidth: number; mode: SingleWidthMode; pct: number; dragged: number }): number | null {
  if (i.dragged > 0) return i.dragged;
  if (i.mode === "full") return null;
  if (i.mode === "custom") return Math.round((Math.max(0, i.area) * Math.min(100, Math.max(1, i.pct))) / 100 / Math.max(1, i.count));
  return i.readingWidth > 0 ? i.readingWidth + CARD_CHROME : null;
}
