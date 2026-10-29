// 最大化 = rule 2 (owner 2026-10-21, docs/design/003-maximize.md): the maximised panel takes every gap of the work
// row — the desktop showing between / beside the cards, and in the fill modes (智能 with two workspaces, 铺满窗口)
// what the other conversation columns give by narrowing to the default reading width — while every other panel
// keeps its width and slides to the side. Two workspaces are one row. A Shelf pane also fills its page
// vertically (the page's other panes show as their title bars). A collapsed Shelf is drawn expanded while it is
// maximised (audit 2026-10-23 #2, §24.16): its stored `collapsed` / `open` never change — the save path writes them as
// they were (`growStoredLayout` / `growStoredMeta`) while the restore point exists; a restore folds it back.
// Real widths (owner 2026-10-23: 「你可以记住旧的方便 restore，但是新的也作为新的参数而不是临时参数」): the row draws the
// maximised geometry once, then stores it as the panels' own widths (components/side/SideArea `bakeGrow`: the single
// column's width, the two columns' widths / share, the Shelf's width) and remembers what they were before (the restore
// point, `GrowRestore`, taken by the hooks). An edge dragged afterwards moves those real widths from where they are
// (no jump back); 还原 (a second click, Esc, Ctrl+Shift+M) writes the remembered widths back, even after drags. The
// button stays pressed while the restore point exists; it is dropped (the layout stays as it is) when the row's set of
// panes changes — a conversation pane or a Shelf comes or goes, the Shelf it expanded is folded (`dropRestorePoint`).
// Something new opening inside a Shelf, a window resize, 独占 / 全屏 coming and going keep it. One at a time; the
// sidebar and the tray take no part.
//   独占 (the ⋯ menus) is the former 「放大」 (lib/paneActions toggleMaximize, lib/panelFull): the panel takes the
//   whole row, the others drawn as rails / strips. 全屏 is unchanged (lib/panelFull).
// State here; the work row (components/side/SideArea) applies it and reports how much each target could take
// (`room`: the 最大化 buttons are greyed at 0). Pure parts tested (test/panelGrow.test.ts). Shell code.
import { create } from "zustand";
import { windowStore } from "./windowScope";
import { CARD_GAP, collapseShelf, findCard, findShelf, setOpen, shelvesOf, type SideLayout } from "./sideLayout";
import type { ShelfMeta } from "./convShelves";
import type { RowOut } from "./workspaceRow";

/** What is maximised: a conversation pane, or a Shelf of a conversation (`card`: one of its panes, which also fills its page). */
export type GrowTarget = { kind: "conv"; paneId: string } | { kind: "shelf"; conv: string | null; shelfId: string; card: string | null };

export interface GrowRoom {
  /** Px each conversation pane would gain. */
  conv: Readonly<Record<string, number>>;
  /** Px a Shelf of the row would gain (the same for every Shelf of it). */
  shelf: number;
}

/** A Shelf drawn expanded for 最大化, and what it was before (collapsed / its tool area closed). */
export interface GrowExpanded {
  conv: string | null;
  shelfId: string;
  collapsed: boolean;
  open: boolean;
}

/** What the panels' widths were before 最大化 (opaque here: the hooks take and write it back). */
export type GrowRestore = unknown;

interface GrowState {
  /** What is maximised — while its restore point exists (the button's pressed state). */
  target: GrowTarget | null;
  /** The row has stored the maximised geometry as the panels' own widths (it draws no growth on top any more). */
  baked: boolean;
  /** The widths before (`GrowHooks.snapshot`), written back by a restore. */
  restore: GrowRestore;
  /** The Shelf the target expanded first (it folds again whenever 最大化 ends). */
  expanded: GrowExpanded | null;
  room: GrowRoom;
}

/** Per app window (multi-window P3, lib/windowScope). */
export const useGrow = windowStore(() => create<GrowState>(() => ({ target: null, baked: false, restore: null, expanded: null, room: { conv: {}, shelf: 0 } })));

// ── Pure ────────────────────────────────────────────────────────────────────────────────────────

export const sameGrow = (a: GrowTarget | null, b: GrowTarget | null): boolean =>
  !!a && !!b && (a.kind === "conv" ? b.kind === "conv" && a.paneId === b.paneId : b.kind === "shelf" && a.conv === b.conv && a.shelfId === b.shelfId && a.card === b.card);

/** Two workspaces' row: who takes what (`ws`: the workspace of the target; `shelfId`: its Shelf, else its column). */
export interface RowGrowInput {
  row: RowOut;
  area: number;
  /** Px of the empty rails (Shelf Rail 常驻) per workspace, counted in the row. */
  empties: readonly number[];
  target: { ws: number; shelfId: string | null } | null;
  /** The fill modes: the other columns narrow to this (the default reading width); null = by content (gaps only). */
  shrinkTo: number | null;
}

const total = (row: RowOut, empties: readonly number[]): number =>
  row.workspaces.reduce((n, w, i) => n + (w.width ?? 0) + w.shelves.reduce((m, x) => m + x.box, 0) + (empties[i] ?? 0), 0) + Math.max(0, row.workspaces.length - 1) * CARD_GAP;

/**
 * Two workspaces: what `target` would gain — the free row (the desktop between and beside the cards) and, filling,
 * what every other column gives above `shrinkTo`. A column with no width of its own (flex) gives nothing.
 */
export function rowGrowRoom(i: Omit<RowGrowInput, "target"> & { target: { ws: number; shelfId: string | null } }): number {
  if (i.row.workspaces.some((w) => w.width === null)) return 0;
  let gain = Math.max(0, i.area - total(i.row, i.empties));
  if (i.shrinkTo !== null) {
    i.row.workspaces.forEach((w, k) => {
      if (k === i.target.ws && i.target.shelfId === null) return;
      gain += Math.max(0, (w.width ?? 0) - i.shrinkTo!);
    });
  }
  return Math.floor(gain);
}

/** The row with `target` maximised (rule 2): it takes `rowGrowRoom`, the other columns narrow to `shrinkTo` (filling), nothing else changes. */
export function growRow(i: RowGrowInput): RowOut {
  const t = i.target;
  if (!t) return i.row;
  const gain = rowGrowRoom({ ...i, target: t });
  if (gain <= 0) return i.row;
  return {
    ...i.row,
    centred: false,
    workspaces: i.row.workspaces.map((w, k) => {
      let width = w.width;
      if (i.shrinkTo !== null && !(k === t.ws && t.shelfId === null) && width !== null && width > i.shrinkTo) width = i.shrinkTo;
      if (k === t.ws && t.shelfId === null && width !== null) width += gain;
      const shelves = k === t.ws && t.shelfId !== null ? w.shelves.map((x) => (x.id === t.shelfId && x.expanded ? { ...x, box: x.box + gain } : x)) : w.shelves;
      return { ...w, width, shelves };
    }),
  };
}

/** One workspace: what its column / one of its Shelves would gain — the free row, and (filling) the column above the reading width. */
export function singleGrowRoom(i: { kind: "conv" | "shelf"; area: number; groupTotal: number; byContent: boolean; column: number; readingW: number }): number {
  const gap = i.byContent ? Math.max(0, i.area - i.groupTotal) : 0;
  if (i.kind === "conv") return Math.floor(gap);
  return Math.floor(gap + (i.byContent ? 0 : Math.max(0, i.column - i.readingW)));
}

/** `layout` with the Shelf 最大化 expanded put back as it was (collapsed, the tool area closed). */
export function unexpand(layout: SideLayout, e: GrowExpanded): SideLayout {
  let l = layout;
  if (e.collapsed && findShelf(l, e.shelfId)) l = collapseShelf(l, e.shelfId);
  if (!e.open) l = setOpen(l, false);
  return l;
}

/** What conversation `conv`'s Shelf is stored as: never the expansion 最大化 draws (`e`: the one in effect, if any). */
export function growStoredLayout(layout: SideLayout, conv: string | null, e: GrowExpanded | null = useGrow.getState().expanded): SideLayout {
  return e && e.conv === conv ? unexpand(layout, e) : layout;
}

/** The same for a remembered conversation's meta (its Shelves' collapsed flags and open). */
export function growStoredMeta(meta: ShelfMeta, conv: string | null, e: GrowExpanded | null = useGrow.getState().expanded): ShelfMeta {
  if (!e || e.conv !== conv) return meta;
  return { ...meta, collapsed: { ...meta.collapsed, [e.shelfId]: e.collapsed || !!meta.collapsed?.[e.shelfId] }, ...(e.open ? {} : { open: false }) };
}

/** A grown pane's page (rule 2 vertically): the other panes show as their title bars. */
export const foldedForGrow = (cardIds: readonly string[], grown: string | null): boolean[] => cardIds.map((id) => grown !== null && cardIds.includes(grown) && id !== grown);

// ── Store side ──────────────────────────────────────────────────────────────────────────────────

/** Hooks into the Shelf store (installed by lib/paneActions: no import cycle through the side store here). */
export interface GrowHooks {
  liveConv(): string | null;
  layout(): SideLayout;
  expand(shelfId: string): void;
  /** Puts the Shelf 最大化 expanded back as it was (the live layout, or that conversation's remembered one). */
  restore(e: GrowExpanded): void;
  /** 独占 / 全屏 on now (they end a 最大化; entering 最大化 ends them). */
  exclusiveOn(): boolean;
  endExclusive(): void;
  /** The panels' widths now (the restore point). */
  snapshot?(): GrowRestore;
  /** Writes a restore point's widths back. */
  restoreWidths?(r: GrowRestore): void;
}
let hooks: GrowHooks | null = null;
export function setGrowHooks(h: GrowHooks | null): void {
  hooks = h;
}

export const growOn = (): boolean => !!useGrow.getState().target;

/** The room the work row reports (the buttons' grey state). */
export function setGrowRoom(room: GrowRoom): void {
  const s = useGrow.getState().room;
  const same = s.shelf === room.shelf && Object.keys(s.conv).length === Object.keys(room.conv).length && Object.entries(room.conv).every(([k, v]) => s.conv[k] === v);
  if (!same) useGrow.setState({ room });
}

/** Whether 最大化 can do anything for the target now (a collapsed Shelf: it expands; a pane: it also fills its page). */
export function canGrow(target: GrowTarget, room: GrowRoom = useGrow.getState().room): boolean {
  if (sameGrow(useGrow.getState().target, target)) return true;
  if (target.kind === "conv") return (room.conv[target.paneId] ?? 0) > 0;
  if (room.shelf > 0) return true;
  const layout = hooks?.layout();
  if (!layout) return false;
  if (findShelf(layout, target.shelfId)?.collapsed || !layout.open) return true;
  if (target.card) {
    const at = findCard(layout, target.card);
    return !!at && at.page.cards.length > 1;
  }
  return false;
}

/** 最大化 / 还原 (the single click of 放大, ⤢, Ctrl+Shift+M, a double-click on a header). */
export function toggleGrow(target: GrowTarget): boolean {
  if (sameGrow(useGrow.getState().target, target)) {
    endGrow();
    return true;
  }
  if (!canGrow(target)) return false;
  endGrow();
  if (hooks?.exclusiveOn()) hooks.endExclusive();
  let expanded: GrowState["expanded"] = null;
  if (target.kind === "shelf" && hooks) {
    const layout = hooks.layout();
    const shelf = findShelf(layout, target.shelfId);
    if (!shelf) return false;
    if (shelf.collapsed || !layout.open) {
      // Recorded first: the expansion's own save already writes the Shelf as it was.
      expanded = { conv: target.conv, shelfId: target.shelfId, collapsed: !!shelf.collapsed, open: layout.open };
      useGrow.setState({ expanded });
      hooks.expand(target.shelfId);
    }
  }
  // The widths before (taken before the row stores the maximised ones: SideArea bakes after this render).
  const restore = hooks?.snapshot?.() ?? null;
  useGrow.setState({ target, expanded, restore, baked: false });
  return true;
}

/** The row stored the maximised geometry as the panels' own widths (components/side/SideArea). */
export function markGrowBaked(): void {
  if (useGrow.getState().target && !useGrow.getState().baked) useGrow.setState({ baked: true });
}

/** A whole Shelf of the live conversation (its ⋯, a double-click on its rail): 最大化 / 还原. */
export function toggleShelfGrow(shelfId: string): boolean {
  return toggleGrow({ kind: "shelf", conv: hooks?.liveConv() ?? null, shelfId, card: null });
}

/** Whether that Shelf is the one maximised now. */
export const shelfGrown = (shelfId: string, s: Pick<GrowState, "target"> = useGrow.getState()): boolean => s.target?.kind === "shelf" && s.target.shelfId === shelfId && s.target.card === null && s.target.conv === (hooks?.liveConv() ?? null);

/** 还原: the widths before written back (even after drags), a Shelf expanded for it folded again. */
export function endGrow(): boolean {
  const { target, expanded, restore, baked } = useGrow.getState();
  if (!target) return false;
  // The record goes after the fold: the fold's save still sees the Shelf as stored.
  useGrow.setState({ target: null, baked: false, restore: null });
  // Not stored yet (ended in the render that drew it): there is nothing to write back.
  if (baked && restore !== null) hooks?.restoreWidths?.(restore);
  if (expanded) hooks?.restore(expanded);
  useGrow.setState({ expanded: null });
  return true;
}

/**
 * The row's set of panes changed (a conversation pane or a Shelf came or went, the Shelf it expanded was folded): the
 * restore point goes, the layout stays as it is — a Shelf expanded for 最大化 stays expanded (stored so from now on).
 */
export function dropRestorePoint(): void {
  if (!useGrow.getState().target) return;
  useGrow.setState({ target: null, baked: false, restore: null, expanded: null });
}


/** What is open in the row: the conversation panes, the live Shelves' pages, panes and tabs (ids). */
export function openIds(panes: readonly string[], layout: SideLayout | null): Set<string> {
  const ids = new Set(panes.map((p) => `w:${p}`));
  if (!layout) return ids;
  for (const x of shelvesOf(layout)) ids.add(`s:${x.id}`);
  for (const p of layout.pages) {
    ids.add(`p:${p.id}`);
    for (const c of p.cards) {
      ids.add(`c:${c.id}`);
      for (const tab of c.tabs) ids.add(`t:${tab}`);
    }
  }
  return ids;
}

/** Something new opened since `before` (an id that was not there): 最大化 ends. */
export const openedSince = (before: ReadonlySet<string>, now: ReadonlySet<string>): boolean => [...now].some((id) => !before.has(id));

/** Tests. */
export function resetGrow(): void {
  useGrow.setState({ target: null, baked: false, restore: null, expanded: null, room: { conv: {}, shelf: 0 } });
}
