// Drag and drop on the right side (docs/desktop-modules.md §18.7; RFC right-panel-rfc-20261009 §3.4,
// §3.7): what a drag is, what lies under the pointer (a plain-data "hit" the DOM probe in
// lib/sideDnd.ts fills in), the drop target that follows from both (resolveDrop) and the layout
// change a drop makes (applyDrop). Pure: no DOM, no store — the §3.7 table is tested on layout JSON.
// Shell code: no feature names.
import type { ItemId } from "../modules/types";
import {
  cardCount,
  findCard,
  findPage,
  locate,
  mergePages,
  moveCard,
  moveCardTo,
  moveInstance,
  reorderCard,
  reorderPage,
  splitInstanceTo,
  MAX_CARDS,
  MAX_PAGES,
  type SideCard,
  type SideLayout,
} from "./sideLayout";
import { MAX_TOOL_PANES } from "./paneLayout";

/** What is being dragged (§3.7: three handles inside the side, plus a handle from outside it). */
export type SideDrag =
  /** A whole card: its category icon, or its icon in a page button. */
  | { type: "card"; cardId: string }
  /** One instance: a tab, or the title of a single-instance card. */
  | { type: "tab"; instanceId: string }
  /** A whole page: the grip strip on its pill's left edge. */
  | { type: "page"; pageId: string }
  /** A handle outside the side (the left gutter's reference card icon): pinned into a page or a new page. `source` = ExternalDragSpec.source. */
  | { type: "external"; source?: string };

/**
 * A pill's icons along its axis (client px; top → bottom in the vertical lane, left → right in the
 * tab row): the insertion point is read from them.
 */
export interface PillIconRect {
  cardId: string;
  start: number;
  end: number;
}

/** A page button's axis: "y" = the vertical lane (column closed), "x" = the tab row at the column's top. */
export type PillAxis = "x" | "y";

/** What lies under the pointer, as the DOM probe found it (most specific first). */
export type SideHit =
  /** A page button; `start` / `size` / `icons` along `axis` (the pointer position passed to resolveDrop is along it too). */
  | { at: "pill"; pageId: string; axis: PillAxis; start: number; size: number; icons: readonly PillIconRect[] }
  /** The lane / tab row outside the pills, the "+" after the last pill, or the band along the column's left edge. */
  | { at: "lane" | "tail" | "edge" }
  /** A card's header (upper / lower half by `y`). */
  | { at: "head"; cardId: string; top: number; height: number }
  /** The gap between two cards of the page in view; `before` = the card below it. */
  | { at: "gap"; pageId: string; before: string | null }
  /** Elsewhere on the column of the page in view (a card body, an empty state). */
  | { at: "column"; pageId: string }
  /** Inside the side area but on nothing that takes a drop. */
  | { at: "side" }
  /** Outside the side: the composer, the drag's own origin (external drags), anywhere else. */
  | { at: "composer" | "origin" | "outside" }
  | { at: "none" };

export type NewPageVia = "lane" | "tail" | "edge" | "outside";

export type SideDropTarget =
  /** Card / tab onto a pill: a new card right above `before` (null = bottom); `line` = the insertion line along the pill's axis. */
  | { kind: "pill"; pageId: string; op: "insert"; before: string | null; line: number; own: boolean }
  /** Card / tab onto a pill whose page has a card of the same kind: joins that card (its icon lights up). */
  | { kind: "pill"; pageId: string; op: "join"; cardId: string }
  /** Page grip onto a pill: centre = merge, the leading / trailing edge (top / bottom, left / right) = reorder. */
  | { kind: "pill"; pageId: string; op: "merge" | "before" | "after" }
  /** External handle onto a pill: pinned into that page. */
  | { kind: "pill"; pageId: string; op: "pin" }
  /** A new page; `unchanged` = the card / tab is its page's only content (dropping changes nothing). */
  | { kind: "new"; via: NewPageVia; unchanged: boolean }
  /** Card onto another card's header: above / below it (same page = reorder, else a move). */
  | { kind: "head"; cardId: string; op: "above" | "below" }
  /** Tab onto a card of the same kind: joins its tab bar. */
  | { kind: "head"; cardId: string; op: "join" }
  /** Tab (or card) into a gap between cards: a new card there (a tab = split, a card = moved there). */
  | { kind: "gap"; pageId: string; before: string | null }
  /** External handle onto the column: pinned into the page in view. */
  | { kind: "column"; pageId: string }
  /** Not accepted here (a tab over another kind's card: one kind per tab bar; v1.17: no room — a full column, the panes' or columns' limit). */
  | { kind: "refuse" }
  /** Accepted, does nothing: the composer (later: quote into the message), the drag's own origin. */
  | { kind: "noop"; why: "composer" | "origin" };

export interface ResolveOptions {
  /** The left-edge band counts only after the pointer has left it once (a card handle sits inside it). */
  edgeArmed: boolean;
  /** Drops outside the side (new page) are offered: not while maximised / full screen. */
  outside: boolean;
}

/** A pill's page-reorder bands: the leading / trailing 28 % (along its axis) reorder, the middle merges. */
export const PILL_EDGE = 0.28;

/** The card / tab is its page's only content: a new page would look exactly the same (D67 ★: any single-card page). */
export function aloneOnPage(layout: SideLayout, drag: SideDrag): boolean {
  if (drag.type === "card") return (findCard(layout, drag.cardId)?.page.cards.length ?? 0) === 1;
  if (drag.type === "tab") {
    const at = locate(layout, drag.instanceId);
    return !!at && at.page.cards.length === 1 && at.card.tabs.length === 1;
  }
  return false;
}

/**
 * v1.17 (§24 限额): a card / tab drag can make a pane in `pageId` (null: a new column) — ≤ 3 panes per
 * column, ≤ MAX_TOOL_PANES in all, ≤ MAX_PAGES columns. A whole card (or a card's only tab) moves its
 * pane; any other tab makes one more.
 */
function fitsInto(layout: SideLayout, drag: SideDrag, src: { card: SideCard; pageId: string }, pageId: string | null): boolean {
  const leaves = drag.type === "card" || src.card.tabs.length === 1;
  const total = cardCount(layout) + (leaves ? 0 : 1);
  if (total > MAX_TOOL_PANES) return false;
  if (pageId === null) return layout.pages.length < MAX_PAGES || (leaves && (findPage(layout, src.pageId)?.cards.length ?? 0) === 1);
  const page = findPage(layout, pageId);
  if (!page) return false;
  return page.cards.length + (src.pageId === pageId && leaves ? 0 : 1) <= MAX_CARDS;
}

/** The kind and own card of a card / tab drag (null for page / external drags or a vanished source). */
function source(layout: SideLayout, drag: SideDrag): { kind: ItemId; card: SideCard; pageId: string } | null {
  if (drag.type === "card") {
    const at = findCard(layout, drag.cardId);
    return at ? { kind: at.card.kind, card: at.card, pageId: at.page.id } : null;
  }
  if (drag.type === "tab") {
    const at = locate(layout, drag.instanceId);
    return at ? { kind: at.card.kind, card: at.card, pageId: at.page.id } : null;
  }
  return null;
}

/**
 * Insertion point among a pill's icons for the pointer at `pos` (along the pill's axis): the card
 * before which it goes and where the insertion line sits (a horizontal line in the lane, a vertical
 * one between two icons in the tab row).
 */
export function pillInsertion(hit: { start: number; size: number; icons: readonly PillIconRect[] }, pos: number): { before: string | null; line: number } {
  const icons = hit.icons;
  let k = icons.length;
  for (let j = 0; j < icons.length; j++) {
    if (pos < (icons[j]!.start + icons[j]!.end) / 2) {
      k = j;
      break;
    }
  }
  const before = k < icons.length ? icons[k]!.cardId : null;
  const line = k < icons.length ? icons[k]!.start - 0.5 : icons.length ? icons[icons.length - 1]!.end + 0.5 : hit.start + hit.size / 2;
  return { before, line };
}

/** A page grip over a pill at `pos` (along its axis): reorder before / after it, or merge into it. */
export function pillPageOp(hit: { start: number; size: number }, pos: number): "before" | "after" | "merge" {
  const f = hit.size > 0 ? (pos - hit.start) / hit.size : 0.5;
  return f < PILL_EDGE ? "before" : f > 1 - PILL_EDGE ? "after" : "merge";
}

/** The card right after `cardId` on its page (null = it is the last). */
function nextCard(layout: SideLayout, cardId: string): string | null {
  const at = findCard(layout, cardId);
  return at?.page.cards[at.cardIndex + 1]?.id ?? null;
}

/** The freshest card of `kind` on a page other than `except` (a tab joins it; null = none). */
function sameKindCard(layout: SideLayout, pageId: string, kind: ItemId, except: string | null): SideCard | null {
  const page = findPage(layout, pageId);
  if (!page) return null;
  let best: SideCard | null = null;
  let bestAt = -Infinity;
  for (const card of page.cards) {
    if (card.kind !== kind || card.id === except) continue;
    const at = card.active ? (layout.instances[card.active]?.lastActiveAt ?? -Infinity) : -Infinity;
    if (!best || at > bestAt) {
      best = card;
      bestAt = at;
    }
  }
  return best;
}

/**
 * The drop target for `drag` over `hit`, or null when a drop there changes nothing and shows nothing
 * (the drag's own place, a page grip off the pills, …). §3.7's table, row by row. `pos` = the
 * pointer's y, except over a pill: its position along the pill's axis (x in the tab row).
 */
export function resolveDrop(layout: SideLayout, drag: SideDrag, hit: SideHit, pos: number, opts: ResolveOptions): SideDropTarget | null {
  const src = source(layout, drag);
  if ((drag.type === "card" || drag.type === "tab") && !src) return null;
  if (drag.type === "page" && !findPage(layout, drag.pageId)) return null;
  const movable = drag.type === "card" || drag.type === "tab" || drag.type === "external";
  const newPage = (via: NewPageVia): SideDropTarget | null => {
    if (!movable) return null;
    const unchanged = aloneOnPage(layout, drag);
    if (!unchanged && src && !fitsInto(layout, drag, src, null)) return { kind: "refuse" };
    return { kind: "new", via, unchanged };
  };
  /** A target that makes a pane in `pageId`, or the refusal when the limits leave no room there. */
  const fit = (pageId: string, target: SideDropTarget): SideDropTarget => (src && !fitsInto(layout, drag, src, pageId) ? { kind: "refuse" } : target);
  switch (hit.at) {
    case "pill": {
      const page = findPage(layout, hit.pageId);
      if (!page) return null;
      if (drag.type === "page") {
        if (drag.pageId === page.id) return null;
        const op = pillPageOp(hit, pos);
        if (op !== "merge" && reorderPage(layout, drag.pageId, page.id, op === "after") === layout) return null;
        return { kind: "pill", pageId: page.id, op };
      }
      if (drag.type === "external") return { kind: "pill", pageId: page.id, op: "pin" };
      const { kind, card, pageId } = src!;
      const own = pageId === page.id;
      if (drag.type === "tab" || !own) {
        // One kind per tab bar: a page that has a card of this kind takes the tab / card into it.
        const same = sameKindCard(layout, page.id, kind, card.id);
        if (same) return { kind: "pill", pageId: page.id, op: "join", cardId: same.id };
        if (drag.type === "tab" && own) return null; // its own card is the only one of its kind here
      }
      const { before, line } = pillInsertion(hit, pos);
      if (drag.type === "card" && own && reorderCard(layout, card.id, before) === layout) return null;
      return fit(page.id, { kind: "pill", pageId: page.id, op: "insert", before, line, own });
    }
    case "lane":
    case "tail":
      return newPage(hit.at);
    case "edge":
      return opts.edgeArmed ? newPage("edge") : null;
    case "head": {
      const at = findCard(layout, hit.cardId);
      if (!at) return null;
      if (drag.type === "external") return { kind: "column", pageId: at.page.id };
      if (drag.type === "page") return null;
      const { kind, card } = src!;
      if (drag.type === "tab") {
        if (at.card.id === card.id) return null; // its own card
        return at.card.kind === kind ? { kind: "head", cardId: at.card.id, op: "join" } : { kind: "refuse" };
      }
      if (at.card.id === card.id) return null;
      const op = pos < hit.top + hit.height / 2 ? "above" : "below";
      const before = op === "above" ? at.card.id : nextCard(layout, at.card.id);
      if (at.page.id === src!.pageId && reorderCard(layout, card.id, before) === layout) return null;
      return fit(at.page.id, { kind: "head", cardId: at.card.id, op });
    }
    case "gap": {
      if (!findPage(layout, hit.pageId)) return null;
      if (drag.type === "external") return { kind: "column", pageId: hit.pageId };
      if (drag.type === "page") return null;
      const { card, pageId } = src!;
      if (pageId === hit.pageId) {
        // A gap next to the dragged card (or a single-tab card's own spot) changes nothing.
        const single = drag.type === "card" || card.tabs.length === 1;
        if (single && reorderCard(layout, card.id, hit.before) === layout) return null;
      }
      return fit(hit.pageId, { kind: "gap", pageId: hit.pageId, before: hit.before });
    }
    case "column":
      return drag.type === "external" && findPage(layout, hit.pageId) ? { kind: "column", pageId: hit.pageId } : null;
    case "composer":
      return movable && opts.outside ? { kind: "noop", why: "composer" } : null;
    case "origin":
      return drag.type === "external" ? { kind: "noop", why: "origin" } : null;
    case "outside":
      return opts.outside ? newPage("outside") : null;
    default:
      return null;
  }
}

/**
 * The layout after dropping `drag` on `target` (external drags and no-ops leave it unchanged: the
 * caller pins the external content itself). Uses the same reducers as the menus (lib/sideLayout).
 */
export function applyDrop(layout: SideLayout, drag: SideDrag, target: SideDropTarget, now: number, orderOf: (kind: ItemId) => number): SideLayout {
  if (target.kind === "noop" || target.kind === "refuse" || drag.type === "external") return layout;
  if (target.kind === "new" && target.unchanged) return layout;
  switch (drag.type) {
    case "page":
      if (target.kind !== "pill") return layout;
      if (target.op === "merge") return mergePages(layout, drag.pageId, target.pageId);
      if (target.op === "before" || target.op === "after") return reorderPage(layout, drag.pageId, target.pageId, target.op === "after");
      return layout;
    case "card": {
      const id = drag.cardId;
      switch (target.kind) {
        case "pill":
          if (target.op === "insert") return moveCardTo(layout, id, { page: target.pageId, before: target.before }, now, orderOf);
          if (target.op === "join") return moveCard(layout, id, { page: target.pageId }, now, orderOf);
          return layout;
        case "new":
          return moveCard(layout, id, { newPage: true }, now, orderOf);
        case "head": {
          const at = findCard(layout, target.cardId);
          if (!at || target.op === "join") return layout;
          const before = target.op === "above" ? target.cardId : nextCard(layout, target.cardId);
          return moveCardTo(layout, id, { page: at.page.id, before: before === id ? nextCard(layout, id) : before }, now, orderOf);
        }
        case "gap":
          return moveCardTo(layout, id, { page: target.pageId, before: target.before }, now, orderOf);
        default:
          return layout;
      }
    }
    case "tab": {
      const id = drag.instanceId;
      switch (target.kind) {
        case "pill":
          if (target.op === "insert") return moveInstance(layout, id, { page: target.pageId }, now, orderOf, { before: target.before });
          if (target.op === "join") return moveInstance(layout, id, { page: target.pageId }, now, orderOf, { card: target.cardId });
          return layout;
        case "new":
          return moveInstance(layout, id, { newPage: true }, now, orderOf);
        case "head": {
          const at = findCard(layout, target.cardId);
          if (!at || target.op !== "join") return layout;
          return moveInstance(layout, id, { page: at.page.id }, now, orderOf, { card: target.cardId });
        }
        case "gap":
          return splitInstanceTo(layout, id, target.pageId, target.before, now, orderOf);
        default:
          return layout;
      }
    }
  }
}
