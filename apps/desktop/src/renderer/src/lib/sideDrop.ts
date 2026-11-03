// Drag and drop of panes (docs/desktop-modules.md §24 step 4, §24.12 Shelves; the pointer part is
// lib/sideDnd.ts): what a drag is, what lies under the pointer (a plain-data "hit" the DOM probe fills in),
// the drop target that follows from both (resolveDrop) and the layout change a drop makes (applyToolDrop /
// applyWorkDrop). Drag a pane by its header (or one tab): onto another pane's top / bottom 30 % = a pane
// above / below it, onto its header or the rest of it = a tab of it — on a Shelf that does not allow mixing
// a different kind is refused there and offered as a new pane below instead (允许混排 off); onto a page
// button of a Shelf Rail = into that page (hovering 0.4 s shows it), onto its ＋ = a new page; onto the
// work area's free far left / right edge = a new Shelf there (≤ 2; 只用一个 Shelf: a new page of the one there
// is), an edge with a Shelf = a new page of it.
// Conversation panes are one per column (≤ 2 columns, they only reorder); tools stay on the Shelves (≤ 3
// panes per page, ≤ 4 tool panes on screen). Pure: no DOM, no store — tested on layout JSON. Shell code:
// no feature names.
import type { ItemId } from "../modules/types";
import {
  canAddShelf,
  canJoin,
  canMergePage,
  closeInstances,
  findCard,
  findPage,
  findShelf,
  joinInto,
  locate,
  mergePageInto,
  removePage,
  switchPage,
  MAX_CARDS,
  MAX_SHELF_PAGES,
  moveCardTo,
  movePageTo,
  moveToNewPage,
  moveToNewShelf,
  moveToPage,
  pagesOfShelf,
  pagesOnScreen,
  reorderCard,
  shelfOfPage,
  shelfOnSide,
  shelvesOf,
  splitInstanceTo,
  withShelves,
  type PaneSource,
  type SideCard,
  type SideLayout,
  type SidePage,
} from "./sideLayout";
import { moveConversation, MAX_TOOL_PANES, type PaneLayout } from "./paneLayout";

/** What is being dragged. */
export type SideDrag =
  /** A whole tool pane: its header (icon, empty space). */
  | { type: "card"; cardId: string }
  /** One tool instance: a tab, or the title of a single-instance pane. */
  | { type: "tab"; instanceId: string }
  /** A conversation pane by its header. */
  | { type: "conversation"; paneId: string }
  /** A handle outside the panes (the left gutter's reference card icon): pinned into a column or a new one. `source` = ExternalDragSpec.source. */
  | { type: "external"; source?: string }
  /** A Shelf Rail page button (owner 2026-10-22): the whole page, reordered in its rail or moved to the other Shelf. */
  | { type: "page"; pageId: string };

/** Where on a pane the pointer is: the outer 30 % on a side (nearest side wins), else the centre. */
export type DropZone = "left" | "right" | "top" | "bottom" | "center";

/** A pane's outer band on each side that splits (the rest of it joins as a tab). */
export const EDGE_ZONE = 0.3;

/** What lies under the pointer, as the DOM probe found it. */
export type SideHit =
  /**
   * A pane: a conversation pane (`area: "work"`, its pane id) or a tool pane (`area: "tools"`, its card
   * id). `zone` = where on it ("head" = its header); `half` = the pointer's side of its middle.
   */
  | { at: "pane"; area: "work" | "tools"; id: string; zone: DropZone | "head"; half: "left" | "right" }
  /** The work area's far left / right edge (a new column / Shelf there). */
  | { at: "edge"; side: "left" | "right" }
  /**
   * A page button in a Shelf Rail (§24.12); `half` = the pointer's half of it (a dragged page goes before / after);
   * `zone` (design 038): its middle (a dragged page merges into it) or its top / bottom quarter (before / after).
   */
  | { at: "page"; pageId: string; half?: "top" | "bottom"; zone?: "top" | "middle" | "bottom" }
  /** A Shelf Rail's ＋ (a new page). */
  | { at: "newPage"; shelfId: string }
  /** The drag's own origin (external drags), anywhere else. */
  | { at: "origin" | "outside" | "none" };

export type RefuseWhy =
  /** No room: ≤ 3 panes per page, ≤ 4 tool panes on screen, ≤ 2 Shelves, ≤ 50 pages per Shelf. */
  | "limit"
  /** That page has 3 panes already (a page button). */
  | "pageFull"
  /** 允许混排 is off on that Shelf and the page has no room for a pane of its own either. */
  | "mixing"
  /** Tools stay right of the conversations (the step-3 tool area). */
  | "tools"
  /** A conversation pane stays a column of its own (step 2). */
  | "conversation"
  /** Into the other workspace's Shelf (§24.13): bound to something that conversation does not see (another agent / workspace). */
  | "bound"
  /** Into the other workspace's Shelf: a shared page (the same page in every Shelf; drop it there in this one). */
  | "shared";

export type SideDropTarget =
  /**
   * A tool pane / tab above or below a tool pane (a split of its page). `unmixed`: it was dropped on that
   * pane to join it, but its Shelf does not allow mixing kinds: a pane of its own below instead.
   */
  | { kind: "split"; cardId: string; side: "top" | "bottom"; unmixed?: { kinds: ItemId[] } }
  /** Joins tool pane `cardId` as a tab (its header / centre). */
  | { kind: "merge"; cardId: string; narrow?: boolean }
  /** Into a page of a Shelf (its page button). */
  | { kind: "page"; pageId: string }
  /** A new page of a Shelf (its ＋, or the work-area edge on its side). */
  | { kind: "newPage"; shelfId: string }
  /** A conversation column left / right of another conversation pane. */
  | { kind: "conversation"; near: string; side: "left" | "right" }
  /** A new column at the work area's far edge (a conversation: the first / last conversation column; a tool: a new Shelf on that side). */
  | { kind: "edge"; side: "left" | "right" }
  /** External handle onto a tool column: pinned into it. */
  | { kind: "pin"; pageId: string }
  /** External handle elsewhere in the work area: pinned into a new tool column. */
  | { kind: "new" }
  /** Not accepted here (the label says why). */
  | { kind: "refuse"; why: RefuseWhy }
  /** Accepted, does nothing: the drag's own origin. */
  | { kind: "noop"; why: "origin" }
  /** A dragged page: into Shelf `shelfId`'s rail before page `before` (null: at its end) — lib/sideLayout movePageTo. */
  | { kind: "movePage"; pageId: string; shelfId: string; before: string | null }
  /** A dragged page onto the middle of another page's button / capsule (design 038): its panes join that page — lib/sideLayout mergePageInto. */
  | { kind: "mergePage"; pageId: string; into: string };

/** What the drop rules read: both areas and whether the work area fits another column at its minimum width. */
export interface DropWorld {
  side: SideLayout;
  work: PaneLayout;
  /** Another column fits at the panes' minimum width (minSize, default 280 px): else a new column becomes a tab. */
  roomForColumn: boolean;
}

/** The zone of (x, y) in a pane's box (client px): the nearest side when within its outer EDGE_ZONE, else the centre. */
export function zoneAt(box: { left: number; top: number; width: number; height: number }, x: number, y: number): DropZone {
  const nx = box.width > 0 ? (x - box.left) / box.width : 0.5;
  const ny = box.height > 0 ? (y - box.top) / box.height : 0.5;
  const sides: [DropZone, number][] = [
    ["left", nx],
    ["right", 1 - nx],
    ["top", ny],
    ["bottom", 1 - ny],
  ];
  const near = sides.filter(([, d]) => d < EDGE_ZONE).sort((a, b) => a[1] - b[1])[0];
  return near ? near[0] : "center";
}

/**
 * A dragged page (a Shelf Rail page button, owner 2026-10-22): onto a page button's middle = merged into that page
 * (design 038, ≤ 3 panes together, else refused); its top / bottom quarter (or half, without a zone) = before / after
 * it; onto a rail's ＋ = at the end of that rail. Its own place = nothing; another Shelf with 50 pages = refused. A
 * page goes only into a rail (panes, the work area's edges: no target).
 */
export function pageDropTarget(layout: SideLayout, pageId: string, hit: SideHit): SideDropTarget | null {
  const page = findPage(layout, pageId);
  if (!page?.shelf) return null;
  let shelfId: string;
  let before: string | null;
  if (hit.at === "page") {
    if (hit.pageId === pageId) return { kind: "noop", why: "origin" };
    const on = findPage(layout, hit.pageId);
    if (!on?.shelf) return null;
    // Design 038: its middle = merge (≤ 3 panes together); the top / bottom quarter = before / after, as before.
    if (hit.zone === "middle") return canMergePage(layout, pageId, on.id) ? { kind: "mergePage", pageId, into: on.id } : { kind: "refuse", why: "pageFull" };
    shelfId = on.shelf;
    const rail = layout.pages.filter((p) => p.shelf === shelfId && p.id !== pageId);
    before = hit.half === "bottom" ? (rail[rail.indexOf(on) + 1]?.id ?? null) : on.id;
  } else if (hit.at === "newPage") {
    shelfId = hit.shelfId;
    before = null;
  } else return null;
  if (shelfId !== page.shelf && layout.pages.filter((p) => p.shelf === shelfId).length >= MAX_SHELF_PAGES) return { kind: "refuse", why: "limit" };
  if (movePageTo(layout, pageId, shelfId, before) === layout) return { kind: "noop", why: "origin" };
  return { kind: "movePage", pageId, shelfId, before };
}

/**
 * A page of `from` (the focused conversation's Shelf) dragged onto the other workspace's Shelf Rail `to` (audit
 * 2026-10-23 #1, design 038 §2): the same rules as on its own rail — a page button's middle = merged into it (≤ 3
 * panes together), its top / bottom quarter = before / after it, a rail's ＋ = at its end (≤ 50 pages). A shared page
 * (in every Shelf already) or onto one: refused; `visible(id)` = that conversation sees the instance (else refused:
 * bound to this one). Ids in the target are `to`'s.
 */
export function crossPageTarget(from: SideLayout, to: SideLayout, pageId: string, hit: SideHit, visible: (id: string) => boolean = () => true): SideDropTarget | null {
  const page = findPage(from, pageId);
  if (!page?.shelf) return null;
  let shelfId: string;
  let before: string | null;
  if (hit.at === "page") {
    const on = findPage(to, hit.pageId);
    if (!on?.shelf) return null;
    if (page.shared || on.shared) return { kind: "refuse", why: "shared" };
    if (page.cards.some((c) => c.tabs.some((id) => !visible(id)))) return { kind: "refuse", why: "bound" };
    if (hit.zone === "middle") return page.cards.length > 0 && page.cards.length + on.cards.length <= MAX_CARDS ? { kind: "mergePage", pageId, into: on.id } : { kind: "refuse", why: "pageFull" };
    shelfId = on.shelf;
    const rail = to.pages.filter((p) => p.shelf === shelfId);
    before = hit.half === "bottom" ? (rail[rail.indexOf(on) + 1]?.id ?? null) : on.id;
  } else if (hit.at === "newPage") {
    if (!findShelf(to, hit.shelfId)) return null;
    if (page.shared) return { kind: "refuse", why: "shared" };
    if (page.cards.some((c) => c.tabs.some((id) => !visible(id)))) return { kind: "refuse", why: "bound" };
    shelfId = hit.shelfId;
    before = null;
  } else return null;
  if (to.pages.filter((p) => p.shelf === shelfId).length >= MAX_SHELF_PAGES) return { kind: "refuse", why: "limit" };
  return { kind: "movePage", pageId, shelfId, before };
}

/**
 * Carries out crossPageTarget's `target`: the page leaves `from` (its instances with it, nothing closes: the same
 * instance ids, so nothing remounts) and lands in `to` under fresh page / pane ids past `seq` (ids are unique per
 * conversation only), shown in its Shelf there. Null: nothing moved. Pure.
 */
export function applyCrossPageDrop(from: SideLayout, to: SideLayout, target: SideDropTarget, seq: number): { from: SideLayout; to: SideLayout } | null {
  if (target.kind !== "movePage" && target.kind !== "mergePage") return null;
  const source = withShelves(from);
  const page = findPage(source, target.pageId);
  const base = withShelves(to);
  const shelfId = target.kind === "movePage" ? target.shelfId : findPage(base, target.into)?.shelf;
  if (!page || !shelfId || !findShelf(base, shelfId)) return null;
  let n = Math.max(seq, base.seq, source.seq);
  const cards = page.cards.map((c) => ({ ...c, id: `c${++n}`, tabs: [...c.tabs] }));
  const carried: SidePage = { ...page, id: `p${++n}`, groups: [...page.groups], cards, shelf: shelfId };
  const instances = { ...base.instances };
  for (const c of page.cards) for (const id of c.tabs) if (source.instances[id]) instances[id] = source.instances[id]!;
  // At the end of its rail first, then where the drop puts it.
  let next: SideLayout = withShelves({ ...base, pages: [...base.pages, carried], instances, seq: n });
  if (target.kind === "mergePage") next = mergePageInto(next, carried.id, target.into);
  else {
    if (target.before !== null) next = movePageTo(next, carried.id, shelfId, target.before);
    next = switchPage(next, carried.id);
  }
  if (target.kind === "mergePage" && findPage(next, carried.id)) return null;
  const left = removePage(source, page.id).layout;
  return { from: left, to: next };
}

/** The tool source of a card / tab drag: its card and column (null for other drags or a vanished source). */
function toolSource(layout: SideLayout, drag: SideDrag): { card: SideCard; pageId: string } | null {
  if (drag.type === "card") {
    const at = findCard(layout, drag.cardId);
    return at ? { card: at.card, pageId: at.page.id } : null;
  }
  if (drag.type === "tab") {
    const at = locate(layout, drag.instanceId);
    return at ? { card: at.card, pageId: at.page.id } : null;
  }
  return null;
}

/** The drag takes its whole pane along (a pane, or a pane's only tab): it leaves a hole rather than making a new pane. */
const takesPane = (drag: SideDrag, card: SideCard) => drag.type === "card" || card.tabs.length === 1;

const filledOf = (cards: readonly SideCard[]) => cards.filter((c) => c.tabs.length > 0).length;

/**
 * A tool drag can make a pane on page `pageId` within the limits (§24 限额, §24.12): ≤ 3 panes on the page
 * and, with it in view, ≤ MAX_TOOL_PANES tool panes on screen (the other Shelf's page in view counts).
 */
function fits(layout: SideLayout, drag: SideDrag, src: { card: SideCard; pageId: string }, pageId: string): boolean {
  const page = findPage(layout, pageId);
  if (!page) return false;
  const leaves = takesPane(drag, src.card);
  const own = filledOf(page.cards) + (src.pageId === pageId && leaves ? 0 : 1);
  if (own > MAX_CARDS) return false;
  const shelf = shelfOfPage(layout, pageId);
  const others = pagesOnScreen(layout).filter((p) => shelfOfPage(layout, p.id)?.id !== shelf?.id);
  const leavingOthers = leaves && others.some((p) => p.id === src.pageId) ? 1 : 0;
  return own + others.reduce((n, p) => n + filledOf(p.cards), 0) - leavingOthers <= MAX_TOOL_PANES;
}

/** The card right after `cardId` in its page (null = it is the last). */
function nextCard(layout: SideLayout, cardId: string): string | null {
  const at = findCard(layout, cardId);
  return at?.page.cards[at.cardIndex + 1]?.id ?? null;
}

const toolPaneSource = (drag: SideDrag): PaneSource | null => (drag.type === "card" ? { card: drag.cardId } : drag.type === "tab" ? { instance: drag.instanceId } : null);

/** The tabs a tool drag moves and their kinds. */
function movedTabs(layout: SideLayout, drag: SideDrag, card: SideCard): { ids: string[]; kinds: ItemId[] } {
  const ids = drag.type === "card" ? [...card.tabs] : drag.type === "tab" ? [drag.instanceId] : [];
  return { ids, kinds: [...new Set(ids.map((id) => layout.instances[id]?.kind ?? card.kind))] };
}

/** A new page of `shelfId` for the drag (≤ 50 pages), else refused. */
function newPageOf(layout: SideLayout, shelfId: string): SideDropTarget {
  return pagesOfShelf(layout, shelfId).length < MAX_SHELF_PAGES ? { kind: "newPage", shelfId } : { kind: "refuse", why: "limit" };
}

/**
 * The drop target for `drag` over `hit`, or null when a drop there changes nothing and shows nothing
 * (the drag's own pane, a split that would leave everything where it is, …).
 */
export function resolveDrop(world: DropWorld, drag: SideDrag, hit: SideHit): SideDropTarget | null {
  const layout = withShelves(world.side);
  if (drag.type === "page") return pageDropTarget(layout, drag.pageId, hit);
  if (drag.type === "external") {
    if (hit.at === "origin") return { kind: "noop", why: "origin" };
    if (hit.at === "pane" && hit.area === "tools") {
      const at = findCard(layout, hit.id);
      return at ? { kind: "pin", pageId: at.page.id } : null;
    }
    if (hit.at === "page") return findPage(layout, hit.pageId) ? { kind: "pin", pageId: hit.pageId } : null;
    if (hit.at === "edge" || hit.at === "newPage" || (hit.at === "pane" && hit.area === "work")) return { kind: "new" };
    return null;
  }
  if (drag.type === "conversation") {
    if (hit.at === "edge") {
      return moveConversation(world.work, drag.paneId, { edge: hit.side }) === world.work ? null : { kind: "edge", side: hit.side };
    }
    if (hit.at === "page" || hit.at === "newPage") return { kind: "refuse", why: "conversation" };
    if (hit.at !== "pane") return null;
    if (hit.area === "tools") return { kind: "refuse", why: "conversation" };
    if (hit.id === drag.paneId) return null;
    const side = hit.zone === "left" || hit.zone === "right" ? hit.zone : hit.half;
    return moveConversation(world.work, drag.paneId, { near: hit.id, side }) === world.work ? null : { kind: "conversation", near: hit.id, side };
  }
  const src = toolSource(layout, drag);
  if (!src) return null;
  const alone = takesPane(drag, src.card) && (findPage(layout, src.pageId)?.cards.length ?? 0) === 1;
  if (hit.at === "edge") {
    // §24.12: a side with a Shelf = a new page of it; a free side = a new Shelf there (≤ 2, if it fits);
    // 只用一个 Shelf: a new page of the Shelf there is, whichever edge.
    const there = shelfOnSide(layout, hit.side);
    if (there) return newPageOf(layout, there.id);
    const only = layout.singleShelf ? shelvesOf(layout)[0] : undefined;
    if (only) return newPageOf(layout, only.id);
    if (!canAddShelf(layout) || (!world.roomForColumn && !alone)) return { kind: "refuse", why: "limit" };
    return { kind: "edge", side: hit.side };
  }
  if (hit.at === "page") {
    const page = findPage(layout, hit.pageId);
    if (!page) return null;
    if (src.pageId === page.id && takesPane(drag, src.card)) return null; // its own page: hovering shows it, nothing moves
    if (!fits(layout, drag, src, page.id)) return { kind: "refuse", why: filledOf(page.cards) >= MAX_CARDS ? "pageFull" : "limit" };
    return { kind: "page", pageId: page.id };
  }
  if (hit.at === "newPage") {
    if (!findShelf(layout, hit.shelfId)) return null;
    // The only pane of a page going to a new page of the same Shelf: it would look the same.
    if (alone && shelfOfPage(layout, src.pageId)?.id === hit.shelfId && !findPage(layout, src.pageId)?.kept) return null;
    return newPageOf(layout, hit.shelfId);
  }
  if (hit.at !== "pane") return null;
  if (hit.area === "work") return { kind: "refuse", why: "tools" };
  const at = findCard(layout, hit.id);
  if (!at) return null;
  const own = at.card.id === src.card.id;
  // Its own pane: only a tab of a pane with several tabs can split out of it.
  if (own && takesPane(drag, src.card)) return null;
  const zone = hit.zone === "left" || hit.zone === "right" ? "center" : hit.zone;
  if (zone === "head" || zone === "center") {
    if (own) return null;
    const moved = movedTabs(layout, drag, src.card);
    if (canJoin(layout, at.card.id, moved.kinds, moved.ids)) return { kind: "merge", cardId: at.card.id };
    // 允许混排 off (§24.12): not a tab of a pane of another kind — a pane of its own below it, if the page has room.
    const kinds = [...new Set(at.card.tabs.map((id) => layout.instances[id]?.kind ?? at.card.kind))];
    if (!fits(layout, drag, src, at.page.id)) return { kind: "refuse", why: "mixing" };
    return { kind: "split", cardId: at.card.id, side: "bottom", unmixed: { kinds } };
  }
  const before = zone === "top" ? at.card.id : nextCard(layout, at.card.id);
  if (drag.type === "card" && at.page.id === src.pageId && reorderCard(layout, src.card.id, before) === layout) return null;
  if (!fits(layout, drag, src, at.page.id)) return { kind: "refuse", why: "limit" };
  return { kind: "split", cardId: at.card.id, side: zone };
}

/** The tool area after dropping a tool pane / tab on `target` (other drags and targets leave it unchanged). */
export function applyToolDrop(input: SideLayout, drag: SideDrag, target: SideDropTarget, now: number, orderOf: (kind: ItemId) => number): SideLayout {
  const pane = toolPaneSource(drag);
  if (!pane) return input;
  const layout = withShelves(input);
  switch (target.kind) {
    case "merge":
      return joinInto(layout, pane, target.cardId, now);
    case "split": {
      const at = findCard(layout, target.cardId);
      if (!at) return input;
      const before = target.side === "top" ? target.cardId : nextCard(layout, target.cardId);
      if ("card" in pane) return moveCardTo(layout, pane.card, { page: at.page.id, before: before === pane.card ? nextCard(layout, pane.card) : before }, now, orderOf);
      return splitInstanceTo(layout, pane.instance, at.page.id, before, now, orderOf);
    }
    case "page":
      return moveToPage(layout, pane, target.pageId, now, orderOf);
    case "newPage":
      return moveToNewPage(layout, pane, target.shelfId, now);
    case "edge":
      return moveToNewShelf(layout, pane, target.side, now);
    default:
      return input;
  }
}

/** The work area after dropping a conversation pane on `target` (other drags and targets leave it unchanged). */
export function applyWorkDrop(work: PaneLayout, drag: SideDrag, target: SideDropTarget): PaneLayout {
  if (drag.type !== "conversation") return work;
  if (target.kind === "conversation") return moveConversation(work, drag.paneId, { near: target.near, side: target.side });
  if (target.kind === "edge") return moveConversation(work, drag.paneId, { edge: target.side });
  return work;
}

// ── Between the two workspaces' Shelves (§24.13, both live) ───────────────────────────────────────

/** The page / pane that carries a dragged pane into another conversation's Shelf while the drop rules run. */
export const CARRIER_PAGE = "p:carry";
export const CARRIER_CARD = "c:carry";

/**
 * A pane / tab of `from` (the focused conversation's Shelf) dropped on `to` (the other workspace's Shelf as it
 * shows). The rules are the same as within one Shelf: `to` gets the dragged pane on a page of its own that is not
 * in view (`carried`, `drag` = the same drag there), so resolveDrop / applyToolDrop decide (limits, 允许混排, the
 * page in view) exactly as they do for a pane of its own. With `target`: `to` after the drop (null: nothing moved)
 * and `from` without the pane — the same instance ids, so the instances never remount. `seq`: an id counter past
 * both layouts (new ids made in `to` clash with neither). Pure.
 */
export function applyCrossDrop(
  from: SideLayout,
  to: SideLayout,
  drag: SideDrag,
  target: SideDropTarget | null,
  now: number,
  orderOf: (kind: ItemId) => number,
  seq: number,
): { carried: SideLayout; drag: SideDrag; from: SideLayout; to: SideLayout | null } | null {
  const source = withShelves(from);
  const src = toolSource(source, drag);
  if (!src) return null;
  const ids = drag.type === "card" ? [...src.card.tabs] : drag.type === "tab" ? [drag.instanceId] : [];
  if (!ids.length) return null;
  const base = withShelves(to);
  const shelf = shelvesOf(base)[0];
  if (!shelf) return null;
  const card: SideCard =
    drag.type === "card"
      ? { ...src.card, tabs: [...ids], size: 1, collapsed: false }
      : { id: CARRIER_CARD, kind: source.instances[ids[0]!]?.kind ?? src.card.kind, tabs: [...ids], active: ids[0]!, size: 1, collapsed: false };
  const page: SidePage = { id: CARRIER_PAGE, groups: [...(findPage(source, src.pageId)?.groups ?? [])], cards: [card], shelf: shelf.id, kept: true };
  const instances = { ...base.instances };
  for (const id of ids) {
    const inst = source.instances[id];
    if (inst) instances[id] = inst;
  }
  const carried = withShelves({ ...base, pages: [...base.pages, page], instances, seq: Math.max(seq, base.seq) });
  const carriedDrag: SideDrag = drag.type === "card" ? { type: "card", cardId: card.id } : { type: "tab", instanceId: ids[0]! };
  const left = closeInstances(source, ids);
  if (!target) return { carried, drag: carriedDrag, from: left, to: null };
  let next = applyToolDrop(carried, carriedDrag, target, now, orderOf);
  if (next === carried) return { carried, drag: carriedDrag, from: left, to: null };
  next = withShelves(next);
  const rest = findPage(next, CARRIER_PAGE);
  // The drop did not take the pane out of its carrier: nothing moved.
  if (rest?.cards.some((c) => c.tabs.length > 0)) return { carried, drag: carriedDrag, from: left, to: null };
  if (rest) {
    const pages = next.pages.filter((p) => p.id !== CARRIER_PAGE);
    const shelves = shelvesOf(next).map((x) => (x.active === CARRIER_PAGE ? { ...x, active: pages.find((p) => p.shelf === x.id)?.id ?? null } : x));
    next = withShelves({ ...next, pages, shelves, activePage: next.activePage === CARRIER_PAGE ? (shelves[0]?.active ?? null) : next.activePage });
  }
  return { carried, drag: carriedDrag, from: left, to: next };
}
