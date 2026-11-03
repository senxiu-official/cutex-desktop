// The tool panes' layout model (docs/desktop-modules.md §24, §24.12 Shelves; RFC right-panel-rfc-20261009
// §3–§5): the Shelves left / right of the conversation columns. A Shelf (≤ 2 on screen, one per side) has
// pages (≤ 9, switched with its Shelf Rail; one page in view per Shelf); a page stacks ≤ 3 panes (the
// former "cards") top to bottom; a pane holds tabs (instances). The engine still calls pages "pages" and
// panes "cards": a page belongs to one Shelf (`SidePage.shelf`), its order in the rail is its order in
// `pages`. The pure `place()` decides where an opened component goes (the right Shelf's page in view,
// split down to 3 panes, then tabs — or, on a Shelf that does not allow mixing, a new page), and the
// reducers the shell runs on user actions. One layout per view scope for every agent (§18.5's per-agent
// views are gone, owner 2026-10-20): what a pane shows follows the bindings. No React, no store, no feature
// names: every function takes a layout and returns a new one (the input is never mutated), so tests build
// layouts as JSON. lib/paneLayout.ts stores it inside the pane layout JSON (v2: `shelves`).
import type { SideBinding, SidePageCandidate, SidePlacement } from "../modules/slots";
import type { ItemId, Json } from "../modules/types";
import { MAX_ROWS, MAX_STORED_CHIPS, MAX_TOOL_COLUMNS, MAX_TOOL_PANES } from "./paneLayout";
import { foldHeld } from "./foldHysteresis";
import { MAX_SHELF_PAGES } from "./shelfLimits";
export { MAX_SHELF_PAGES } from "./shelfLimits";

/** Shelves on screen (§24.12: one per side of the conversation columns). */
export const MAX_SHELVES = MAX_TOOL_COLUMNS;
/** Pages in all (every Shelf full). */
export const MAX_PAGES = MAX_SHELVES * MAX_SHELF_PAGES;
/** Panes (former cards) per page; more → tabs of the bottom pane. */
export const MAX_CARDS = MAX_ROWS;
/** Pages a stored v1.16 side layout may have had (= a Shelf's pages). */
export const LEGACY_MAX_PAGES = 9;
/** The Shelf Rail's width (page buttons; outer or inner edge of its Shelf). */
export const RAIL_WIDTH = 40;
/** The page icons a page can carry (lucide names the rail maps; absent = its first pane's kind icon). */
export const PAGE_ICONS = ["layers", "headphones", "file", "globe", "prompt", "list-todo", "bot", "users", "check", "image", "chart", "star", "folder", "code", "flag", "book", "home", "bell", "grid", "sun", "inbox", "square"] as const;
export type PageIcon = (typeof PAGE_ICONS)[number];
/** The dedupe key of a singleton component (one instance per binding). */
export const SINGLETON_KEY = "∅";
export const CARD_HEADER = 36;
export const CARD_GAP = 8;
/**
 * Between two panes of a Shelf page: the standard gap (Rail look A, owner 2026-10-23: each pane its own rounded card
 * on the Rail; components/side/shelfCard.css). Was a 1 px line inside one card (design 009) — the lower pane then
 * read as laid over the upper one.
 */
export const SHELF_PANE_GAP = CARD_GAP;
export const MIN_CARD_HEIGHT = 120;
/** The vertical page-button lane at the window's right edge (column closed, ≥ 2 pages, 保留页按钮). */
export const LANE_WIDTH = 44;
/** Below MIN_CONVERSATION + MIN_SIDE of work area the right side becomes a drawer over the conversation. */
export const MIN_CONVERSATION = 360;
export const MIN_SIDE = 260;
export const DRAWER_MARGIN = 48;
/** Persistence limits (§18.11). */
export const STATE_LIMIT = 4096;
export const MAX_INSTANCES = 200;
export const MAX_OVERRIDES = 100;
export const DEFAULT_ORDER = 500;
export const DEFAULT_MIN_HEIGHT = MIN_CARD_HEIGHT;
/** Prefix of the page group a user-made page carries (moved to a new page). */
export const USER_GROUP = "user:";

export interface SideCard {
  id: string;
  /**
   * The pane's home kind (the kind it was made for: its declared order, min height, menu name). Its
   * tabs are of that kind, except when a full column took another kind's tab in its bottom pane (§24).
   */
  kind: ItemId;
  /** Instance ids, tab order. */
  tabs: string[];
  active: string | null;
  /** Share of the page height (the page's cards sum to 1). */
  size: number;
  collapsed: boolean;
}

export interface SidePage {
  id: string;
  /** Page groups (placement rules match them). */
  groups: string[];
  /** User-given name; generated from the cards otherwise. */
  name?: string;
  /** Top → bottom. Empty only for the launcher page while it is in view. */
  cards: SideCard[];
  /** A page made by 新页面 that has not received a card yet (in memory only). */
  launcher?: boolean;
  /** The Shelf it belongs to (§24.12; absent / unknown in a stored or hand-made layout: the right Shelf). */
  shelf?: string;
  /** Its rail icon (one of PAGE_ICONS; absent = its first pane's kind icon). */
  icon?: PageIcon;
  /** Made by the owner (the rail's ＋, a drop on ＋): stays, empty or not, until deleted. */
  kept?: boolean;
  /**
   * 在所有对话中显示 (canvas principles §7, owner 2026-10-21): a shared page — one instance of it, in every
   * conversation's Shelf (it moves with the focus; lib/convShelves). Absent = this conversation's own page.
   */
  shared?: boolean;
}

export type ShelfSide = "left" | "right";

export interface ShelfOptions {
  /** 允许混排: a pane's tab bar may hold tabs of different kinds (off: a different kind becomes a pane of its own). */
  allowMixing: boolean;
  /** Where its Shelf Rail sits: on the window side ("outer") or next to the conversations ("inner"). */
  railPlacement: "outer" | "inner";
}

/**
 * A Shelf (§24.12, owner 2026-10-20; the right side's pages, back): a column of pages left or right of
 * the conversation columns, one page in view, switched with its Shelf Rail.
 */
export interface Shelf {
  id: string;
  side: ShelfSide;
  /** Its own width (px, its rail not included); absent = appearance.sidePaneWidth (Settings). */
  width?: number;
  /** The page in view. */
  active: string | null;
  options: ShelfOptions;
  /**
   * 收起 (owner 2026-10-21): only its Shelf Rail shows, a strip in place on its outer edge (its page and
   * panes off screen, its pages and badges on the rail); absent = expanded. Stored before as `chip` (a whole
   * Shelf in the tray, file v3), read as collapsed.
   */
  collapsed?: boolean;
}

export interface SideInstance {
  kind: ItemId;
  binding: SideBinding;
  /** Dedupe key (SINGLETON_KEY for singletons, null = never reused). */
  key: string | null;
  state: Json;
  /** The component's stateVersion when `state` was written. */
  v: number;
  pinned: boolean;
  lastActiveAt: number;
}

/**
 * A collapsed pane (step 4, a chip in the tray): the card itself and where it goes back — its column
 * (id, groups, name, index: the column may be gone by then) and the panes above / below it then.
 */
export interface SideChip {
  card: SideCard;
  /** Its page then (`shelf` / `side`: the page's Shelf and its side; `index`: its place in the rail). */
  page: { id: string; groups: string[]; name?: string; index: number; shelf?: string; side?: ShelfSide };
  above: string | null;
  below: string | null;
  /** When it was collapsed (the tray's order). */
  at: number;
}

export interface SideOverride {
  page: string;
  groups: string[];
  at: number;
}

export interface SideLayout {
  /** The tool columns are shown (one switch for every agent: the title-bar toggle, Ctrl+Alt+B). */
  open: boolean;
  /** The focused tool column (last opened into / clicked): page modes, the 「active」 placement candidate. */
  activePage: string | null;
  /** The tool columns, left → right (the last one is the right-most). */
  pages: SidePage[];
  instances: Record<string, SideInstance>;
  /** User overrides per component kind (§18.7). */
  overrides: Record<string, SideOverride>;
  /** Id counter: ids are never reused, so an override never points at an unrelated new page. */
  seq: number;
  /** Collapsed panes (step 4), oldest first; absent = none. Their instances stay in `instances`. */
  chips?: SideChip[];
  /**
   * The Shelves (§24.12), at most one per side. Absent (a hand-made or older layout): every page is the
   * right Shelf's (mixing off, like every Shelf since 2026-10-20). The engine keeps it consistent (`shelvesOf`).
   */
  shelves?: Shelf[];
  /**
   * 只用一个 Shelf (单一 Shelf 模式, owner 2026-10-20): no second Shelf is made — an edge drop adds a page to
   * the Shelf there is, 移到另一边 still works. Shelves already there stay. Absent = off (an existing layout).
   */
  singleShelf?: boolean;
}

/** A component's placement with the defaults filled in (what place() reads). */
export interface PlaceSpec {
  home: string;
  prefer: readonly SidePageCandidate[];
  otherwise: "new-page" | "active-page";
  order: number;
  share: number | null;
}

export function placeSpec(p: SidePlacement): PlaceSpec {
  const share = typeof p.share === "number" && Number.isFinite(p.share) ? Math.min(0.85, Math.max(0.15, p.share)) : null;
  return {
    home: p.home,
    prefer: p.prefer ?? [{ group: p.home }],
    otherwise: p.otherwise ?? "new-page",
    order: p.order ?? DEFAULT_ORDER,
    share,
  };
}

export function emptyLayout(): SideLayout {
  return { open: false, activePage: null, pages: [], instances: {}, overrides: {}, seq: 0, shelves: [] };
}

/** A new Shelf's options: mixing off (a pane holds one kind) — every Shelf, one made from an older layout too (owner 2026-10-20). */
/** Where a new Shelf's rail goes (Settings → Shelf Rail 在 Shelf 的, lib/sideLayoutStore setEveryShelfRail). */
let newRailPlacement: ShelfOptions["railPlacement"] = "outer";
export function setNewShelfRailPlacement(placement: ShelfOptions["railPlacement"]): void {
  newRailPlacement = placement;
}
export const defaultShelfOptions = (): ShelfOptions => ({ allowMixing: false, railPlacement: newRailPlacement });

/** How many Shelves the layout may have: 1 in 单一 Shelf 模式, else MAX_SHELVES. */
export const shelfLimit = (layout: Pick<SideLayout, "singleShelf">): number => (layout.singleShelf ? 1 : MAX_SHELVES);

/** Another Shelf may be made (fewer than `shelfLimit`). */
export const canAddShelf = (layout: SideLayout): boolean => shelvesOf(layout).length < shelfLimit(layout);

// ── Lookups ─────────────────────────────────────────────────────────────────────────────────

export function sameBinding(a: SideBinding, b: SideBinding): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "follow":
      return b.kind === "follow" && a.hostId === b.hostId;
    case "agent":
      return b.kind === "agent" && a.hostId === b.hostId && a.sessionId === b.sessionId;
    case "workspace":
      return b.kind === "workspace" && a.hostId === b.hostId && a.key === b.key;
    case "host":
      return b.kind === "host" && a.hostId === b.hostId;
  }
}

export interface InstanceLocation {
  page: SidePage;
  card: SideCard;
  pageIndex: number;
  cardIndex: number;
}

export function locate(layout: SideLayout, instanceId: string): InstanceLocation | null {
  for (let p = 0; p < layout.pages.length; p++) {
    const page = layout.pages[p]!;
    for (let c = 0; c < page.cards.length; c++) {
      const card = page.cards[c]!;
      if (card.tabs.includes(instanceId)) return { page, card, pageIndex: p, cardIndex: c };
    }
  }
  return null;
}

export function findCard(layout: SideLayout, cardId: string): { page: SidePage; card: SideCard; pageIndex: number; cardIndex: number } | null {
  for (let p = 0; p < layout.pages.length; p++) {
    const page = layout.pages[p]!;
    const c = page.cards.findIndex((x) => x.id === cardId);
    if (c >= 0) return { page, card: page.cards[c]!, pageIndex: p, cardIndex: c };
  }
  return null;
}

export function findPage(layout: SideLayout, pageId: string | null | undefined): SidePage | null {
  return pageId ? layout.pages.find((p) => p.id === pageId) ?? null : null;
}

// ── Shelves (§24.12) ──────────────────────────────────────────────────────────────────────────────

const SIDE_ORDER: Record<ShelfSide, number> = { left: 0, right: 1 };
export const otherSide = (side: ShelfSide): ShelfSide => (side === "left" ? "right" : "left");

/** The Shelves are what the engine keeps: every page in one existing Shelf, ≤ 9 each, one per side, each with its page in view. */
function shelvesConsistent(layout: SideLayout): boolean {
  const shelves = layout.shelves;
  if (!shelves) return layout.pages.length === 0;
  if (shelves.length > MAX_SHELVES || new Set(shelves.map((x) => x.side)).size !== shelves.length) return false;
  const count = new Map<string, number>();
  for (const sh of shelves) count.set(sh.id, 0);
  if (count.size !== shelves.length) return false;
  for (const p of layout.pages) {
    if (!p.shelf || !count.has(p.shelf)) return false;
    count.set(p.shelf, count.get(p.shelf)! + 1);
  }
  for (const sh of shelves) {
    const n = count.get(sh.id)!;
    if (!n || n > MAX_SHELF_PAGES || findPage(layout, sh.active)?.shelf !== sh.id) return false;
  }
  return true;
}

const normalised = new WeakMap<SideLayout, SideLayout>();

/** The layout with consistent Shelves (the same object when it already is; a hand-made / older one: a fixed copy). */
export function withShelves(layout: SideLayout): SideLayout {
  if (shelvesConsistent(layout)) return layout;
  let fixed = normalised.get(layout);
  if (!fixed) {
    fixed = draft(layout);
    normalised.set(layout, fixed);
  }
  return fixed;
}

/** The Shelves, left first. */
export function shelvesOf(layout: SideLayout): Shelf[] {
  return withShelves(layout).shelves ?? [];
}

export function findShelf(layout: SideLayout, shelfId: string | null | undefined): Shelf | null {
  return shelfId ? shelvesOf(layout).find((x) => x.id === shelfId) ?? null : null;
}

export function shelfOnSide(layout: SideLayout, side: ShelfSide): Shelf | null {
  return shelvesOf(layout).find((x) => x.side === side) ?? null;
}

/** The Shelf a page belongs to. */
export function shelfOfPage(layout: SideLayout, pageId: string | null | undefined): Shelf | null {
  const L = withShelves(layout);
  return findShelf(L, findPage(L, pageId)?.shelf);
}

/** A Shelf's pages, rail order. */
export function pagesOfShelf(layout: SideLayout, shelfId: string): SidePage[] {
  const L = withShelves(layout);
  return L.pages.filter((p) => p.shelf === shelfId);
}

/** The Shelf the keys and the launchers act on: the focused page's, else the right one, else any. */
export function focusedShelf(layout: SideLayout): Shelf | null {
  return shelfOfPage(layout, layout.activePage) ?? shelfOnSide(layout, "right") ?? shelvesOf(layout)[0] ?? null;
}

/** Where tools go by default (§24.12): the right Shelf (else the left one). */
export function defaultShelf(layout: SideLayout): Shelf | null {
  return shelfOnSide(layout, "right") ?? shelfOnSide(layout, "left");
}

/** The default Shelf's page in view (tools go there, §24), or null without Shelves. */
export function rightmostPage(layout: SideLayout): SidePage | null {
  const L = withShelves(layout);
  const shelf = defaultShelf(L);
  return shelf ? findPage(L, shelf.active) : (L.pages[L.pages.length - 1] ?? null);
}

/** The pages in view of the expanded Shelves (a collapsed one shows only its rail), left first: what the limits count. */
export function pagesOnScreen(layout: SideLayout): SidePage[] {
  const L = withShelves(layout);
  return shelvesOf(L).flatMap((x) => {
    const page = !x.collapsed ? findPage(L, x.active) : null;
    return page ? [page] : [];
  });
}

/** The page's Shelf allows mixing kinds in one pane (no Shelf: it does not, like a new Shelf). */
export function mixingAllowed(layout: SideLayout, pageId: string | null | undefined): boolean {
  return shelfOfPage(layout, pageId)?.options.allowMixing ?? false;
}

/** The kinds of a card's tabs (its home kind when it has none). */
export function cardKinds(layout: SideLayout, card: SideCard, except: readonly string[] = []): Set<ItemId> {
  const kinds = new Set<ItemId>();
  for (const id of card.tabs) if (!except.includes(id)) kinds.add(layout.instances[id]?.kind ?? card.kind);
  return kinds;
}

/**
 * Tabs of `kinds` may join `card` (§24.12 允许混排): its Shelf allows mixing, or the card would still hold
 * one kind only (the moved tabs `except` leave it first).
 */
export function canJoin(layout: SideLayout, cardId: string, kinds: readonly ItemId[], except: readonly string[] = []): boolean {
  const at = findCard(layout, cardId);
  if (!at) return false;
  if (mixingAllowed(layout, at.page.id)) return true;
  const all = cardKinds(layout, at.card, except);
  for (const k of kinds) all.add(k);
  return all.size <= 1;
}

/** The instance with the latest lastActiveAt among `ids` (null when empty). */
function mostRecent(layout: SideLayout, ids: readonly string[]): string | null {
  let best: string | null = null;
  for (const id of ids) {
    const at = layout.instances[id]?.lastActiveAt ?? -Infinity;
    if (best === null || at > (layout.instances[best]?.lastActiveAt ?? -Infinity)) best = id;
  }
  return best;
}

/** Of several same-kind cards, the one whose active tab was used most recently (§18.4). */
function freshestCard(layout: SideLayout, cards: readonly SideCard[]): SideCard | null {
  let best: SideCard | null = null;
  let bestAt = -Infinity;
  for (const card of cards) {
    const at = card.active ? layout.instances[card.active]?.lastActiveAt ?? -Infinity : -Infinity;
    if (best === null || at > bestAt) {
      best = card;
      bestAt = at;
    }
  }
  return best;
}

/** The card is `kind`'s: made for it, or holding one of its tabs (a full column's bottom pane, §24). */
export function cardHolds(layout: SideLayout, card: SideCard, kind: ItemId): boolean {
  return card.kind === kind || card.tabs.some((id) => layout.instances[id]?.kind === kind);
}

const filled = (cards: readonly SideCard[]) => cards.filter((c) => c.tabs.length > 0).length;

/** The pages in view of the other Shelves on screen (raw: works on a draft mid-reducer; no Shelves = one Shelf). */
function otherPagesOnScreen(layout: SideLayout, page: SidePage): SidePage[] {
  const shelves = layout.shelves ?? [];
  return shelves.flatMap((x) => (!x.collapsed && x.id !== page.shelf ? layout.pages.filter((p) => p.id === x.active && p !== page) : []));
}

/** Tool panes on screen: the pages in view of the Shelves on screen (a card emptied mid-reducer does not count). */
export const cardCount = (layout: SideLayout): number => pagesOnScreen(layout).reduce((n, p) => n + filled(p.cards), 0);

/**
 * A new card fits on `page`: fewer than 3 on the page and, with the page in view, fewer than
 * MAX_TOOL_PANES tool panes on screen (§24 限额; the other Shelf's page in view counts, hidden pages do not).
 */
export function roomForCard(layout: SideLayout, page: SidePage): boolean {
  const own = filled(page.cards);
  return own < MAX_CARDS && own + otherPagesOnScreen(layout, page).reduce((n, p) => n + filled(p.cards), 0) < MAX_TOOL_PANES;
}

// ── place() (§18.6) ─────────────────────────────────────────────────────────────────────────

export interface SidePlaceRequest {
  kind: ItemId;
  binding: SideBinding;
  key: string | null; // dedupe key (singleton → SINGLETON_KEY)
  transient: boolean;
  page?: string; // explicit target (opts.page)
  /** The source's Shelf, without requesting a split on its page. */
  shelf?: string;
  activePage: string | null;
  columnOpen: boolean;
  /** The work area fits another tool column at the panes' minimum width (step 4 minSize; default true): else no new column — a tab instead. */
  roomForColumn?: boolean;
}

export type SidePlaceDecision =
  | { op: "activate"; instance: string }
  | { op: "replace"; instance: string }
  | {
      op: "insert";
      /** An existing page, or a new one: in Shelf `shelf` (absent: a new Shelf on the right). */
      page: { id: string } | { new: { groups: string[]; index: number; shelf?: string } };
      card: { id: string } | { new: { index: number; share: number | null; collapsed?: boolean } };
      via: "explicit" | "override" | "rule" | "otherwise" | "limit";
    };

type InsertDecision = Extract<SidePlaceDecision, { op: "insert" }>;
type PagePick = { id: string } | { new: string[] };

/** Index of a new card of `order` in `cards`: after the last card whose declared order ≤ order (visual order). */
export function newCardIndex(cards: readonly SideCard[], order: number, orderOf: (kind: ItemId) => number): number {
  let index = 0;
  cards.forEach((card, k) => {
    if (orderOf(card.kind) <= order) index = k + 1;
  });
  return index;
}

/**
 * Where an opened instance goes. Pure: reads the layout, returns a decision (the reducer executes
 * it). Ignores binding visibility (the layout's shape is the same for every agent). `orderOf` gives
 * the declared order of other kinds (new-card position); unknown kinds count as DEFAULT_ORDER.
 */
export function place(input: SideLayout, req: SidePlaceRequest, spec: PlaceSpec, orderOf: (kind: ItemId) => number = () => DEFAULT_ORDER): SidePlaceDecision {
  const layout = withShelves(input);
  const placed = (id: string) => !!locate(layout, id);
  // 1. reuse: same kind + binding + key
  if (req.key !== null) {
    for (const [id, inst] of Object.entries(layout.instances)) {
      if (inst.kind === req.kind && inst.key === req.key && sameBinding(inst.binding, req.binding) && placed(id)) return { op: "activate", instance: id };
    }
  }
  // 2. transient: replace an unpinned instance of the same kind + binding in place
  if (req.transient) {
    for (const [id, inst] of Object.entries(layout.instances)) {
      if (inst.kind === req.kind && !inst.pinned && sameBinding(inst.binding, req.binding) && placed(id)) return { op: "replace", instance: id };
    }
  }
  // Normal opens never split a populated page. Kind declarations and stored placement hints
  // still decide the fallback at the sanity limit; an explicit page remains an intentional target.
  if (!findPage(layout, req.page)) {
    const holding = layout.pages.filter((p) => !p.shared && p.cards.some((c) => cardHolds(layout, c, req.kind)));
    const samePage = holding.find((p) => p.id === req.activePage) ?? holding[0];
    if (samePage) {
      const card = freshestCard(layout, samePage.cards.filter((c) => cardHolds(layout, c, req.kind)))!;
      return { op: "insert", page: { id: samePage.id }, card: { id: card.id }, via: "rule" };
    }
    const active = findPage(layout, req.activePage);
    if (active && !active.shared && active.cards.length === 0) {
      return { op: "insert", page: { id: active.id }, card: { new: { index: 0, share: spec.share } }, via: "rule" };
    }
    const shelf = findShelf(layout, req.shelf) ?? defaultShelf(layout);
    const own = shelf ? pagesOfShelf(layout, shelf.id) : [];
    if (!shelf || own.length < MAX_SHELF_PAGES) {
      const index = own.length ? layout.pages.indexOf(own[own.length - 1]!) + 1 : layout.pages.length;
      return { op: "insert", page: { new: { groups: [spec.home], index, ...(shelf ? { shelf: shelf.id } : {}) } }, card: { new: { index: 0, share: spec.share } }, via: "otherwise" };
    }
  }
  // 3. explicit target, or the existing placement rules at the sanity limit
  let pick: PagePick | null = null;
  let via: InsertDecision["via"] = "rule";
  const explicit = findPage(layout, req.page);
  if (explicit) {
    pick = { id: explicit.id };
    via = "explicit";
  } else if (layout.overrides[req.kind]) {
    const ov = layout.overrides[req.kind]!;
    via = "override";
    const page = findPage(layout, ov.page) ?? layout.pages.find((p) => p.groups.some((g) => ov.groups.includes(g)));
    pick = page ? { id: page.id } : { new: [...ov.groups] };
  } else {
    for (const candidate of spec.prefer) {
      let hit: SidePage | null = null;
      if (candidate === "active") hit = req.columnOpen ? findPage(layout, req.activePage) : null;
      else if ("group" in candidate) hit = layout.pages.find((p) => p.groups.includes(candidate.group)) ?? null;
      else hit = layout.pages.find((p) => p.cards.some((c) => cardHolds(layout, c, candidate.containing))) ?? null;
      if (hit) {
        pick = { id: hit.id };
        via = "rule";
        break;
      }
    }
    if (!pick) {
      via = "otherwise";
      if (spec.otherwise === "active-page") {
        // The focused page, else the right Shelf's page in view; a new page (and Shelf) only when there is none yet.
        const active = req.columnOpen ? findPage(layout, req.activePage) : null;
        const target = active ?? rightmostPage(layout);
        pick = target ? { id: target.id } : { new: [spec.home] };
      } else {
        // Design 038 (owner 2026-10-23): "new-page" (the default, every page kind) — a page already holding a pane of
        // this kind (it gets a tab and shows), else a page of its own at full height; never a silent split of the
        // page in view.
        const holding = layout.pages.filter((p) => !p.shared && p.cards.some((c) => cardHolds(layout, c, req.kind)));
        const hit = holding.find((p) => p.id === req.activePage) ?? holding[0];
        pick = hit ? { id: hit.id } : { new: [spec.home] };
      }
    }
  }
  // §24.13: a shared page (在所有对话中显示) only takes what is opened into it on purpose (an explicit page, the
  // owner's override); anything else goes onto a page of the conversation's own.
  if ("id" in pick && via !== "explicit" && via !== "override" && findPage(layout, pick.id)?.shared) {
    const shelf = shelfOfPage(layout, pick.id);
    const own = shelf ? pagesOfShelf(layout, shelf.id).filter((p) => !p.shared && roomForCard(layout, p)) : [];
    const page = own.find((p) => p.cards.some((c) => cardHolds(layout, c, req.kind))) ?? own[0];
    pick = page ? { id: page.id } : { new: [spec.home] };
  }
  if ("new" in pick) {
    // A new page goes into the default Shelf (its rail has room for ≤ 50); without any Shelf, a new right Shelf.
    const shelf = defaultShelf(layout);
    if (!shelf) return { op: "insert", page: { new: { groups: pick.new, index: layout.pages.length } }, card: { new: { index: 0, share: spec.share } }, via };
    const own = pagesOfShelf(layout, shelf.id);
    if (own.length < MAX_SHELF_PAGES) {
      return { op: "insert", page: { new: { groups: pick.new, index: layout.pages.indexOf(own[own.length - 1]!) + 1, shelf: shelf.id } }, card: { new: { index: 0, share: spec.share } }, via };
    }
    pick = { id: shelf.active! };
    via = "limit";
  }
  const page = findPage(layout, pick.id)!;
  // 4. the pane: an existing pane of this kind (the freshest of several) gets a new tab
  const same = freshestCard(layout, page.cards.filter((c) => cardHolds(layout, c, req.kind)));
  if (same) return { op: "insert", page: { id: page.id }, card: { id: same.id }, via };
  if (roomForCard(layout, page)) {
    return { op: "insert", page: { id: page.id }, card: { new: { index: newCardIndex(page.cards, spec.order, orderOf), share: spec.share } }, via };
  }
  // 5. a full page (3 panes, or MAX_TOOL_PANES on screen): a pane of this kind on the other Shelf's page in
  // view, else on another page of this Shelf; else a new pane on the other Shelf's page in view if it has
  // room; else — a Shelf that allows mixing — a tab of this page's bottom pane, or — one that does not — a
  // new page of this Shelf (§24.12; a Shelf with 50 pages: the bottom pane's tab after all).
  const shelf = findShelf(layout, page.shelf);
  const shown = pagesOnScreen(layout).filter((p) => p !== page);
  const ownOthers = shelf ? pagesOfShelf(layout, shelf.id).filter((p) => p !== page) : [];
  for (const other of [...shown, ...ownOthers]) {
    const otherSame = freshestCard(layout, other.cards.filter((c) => cardHolds(layout, c, req.kind)));
    if (otherSame) return { op: "insert", page: { id: other.id }, card: { id: otherSame.id }, via: "limit" };
  }
  for (const other of shown) {
    if (roomForCard(layout, other)) {
      return { op: "insert", page: { id: other.id }, card: { new: { index: newCardIndex(other.cards, spec.order, orderOf), share: spec.share } }, via: "limit" };
    }
  }
  if (shelf && !shelf.options.allowMixing && pagesOfShelf(layout, shelf.id).length < MAX_SHELF_PAGES) {
    return { op: "insert", page: { new: { groups: [spec.home], index: layout.pages.indexOf(page) + 1, shelf: shelf.id } }, card: { new: { index: 0, share: spec.share } }, via: "limit" };
  }
  return { op: "insert", page: { id: page.id }, card: { id: page.cards[page.cards.length - 1]!.id }, via: "limit" };
}

// ── Mutation helpers (on a draft copy) ────────────────────────────────────────────────────────

/** A copy whose pages / cards / tab arrays / maps can be changed in place (instances are replaced, never edited). */
function draft(layout: SideLayout): SideLayout {
  const d: SideLayout = {
    ...layout,
    pages: layout.pages.map((p) => ({ ...p, groups: [...p.groups], cards: p.cards.map((c) => ({ ...c, tabs: [...c.tabs] })) })),
    instances: { ...layout.instances },
    overrides: { ...layout.overrides },
  };
  if (layout.chips) d.chips = layout.chips.map((c) => ({ ...c, card: { ...c.card, tabs: [...c.card.tabs] }, page: { ...c.page, groups: [...c.page.groups] } }));
  d.shelves = (layout.shelves ?? []).map((x) => ({ ...x, options: { ...x.options } }));
  // A hand-made or older layout (no Shelves): its pages become the right Shelf's.
  if (!shelvesConsistent(d)) fixShelves(d, new Map());
  return d;
}

function nextId(d: SideLayout, prefix: "p" | "c" | "i" | "s"): string {
  d.seq += 1;
  return `${prefix}${d.seq}`;
}

function normalise(cards: SideCard[]): void {
  const total = cards.reduce((a, c) => a + (Number.isFinite(c.size) && c.size > 0 ? c.size : 0), 0);
  if (!cards.length) return;
  if (total <= 0) {
    for (const c of cards) c.size = 1 / cards.length;
    return;
  }
  for (const c of cards) c.size = (Number.isFinite(c.size) && c.size > 0 ? c.size : 0) / total;
}

function addCard(d: SideLayout, page: SidePage, kind: ItemId, index: number, share: number | null): SideCard {
  const n = page.cards.length;
  const card: SideCard = { id: nextId(d, "c"), kind, tabs: [], active: null, size: 1, collapsed: false };
  if (n) {
    const sh = share ?? 1 / (n + 1);
    normalise(page.cards);
    for (const c of page.cards) c.size *= 1 - sh;
    card.size = sh;
  }
  page.cards.splice(Math.max(0, Math.min(index, n)), 0, card);
  return card;
}

function addTab(card: SideCard, id: string): void {
  if (card.tabs.includes(id)) return;
  const k = card.active ? card.tabs.indexOf(card.active) : -1;
  card.tabs.splice(k < 0 ? card.tabs.length : k + 1, 0, id);
  card.active = id;
}

function newPage(d: SideLayout, groups: string[], index = d.pages.length, shelf?: string): SidePage {
  const page: SidePage = { id: nextId(d, "p"), groups: [...new Set(groups)], cards: [] };
  if (shelf) page.shelf = shelf;
  d.pages.splice(Math.max(0, Math.min(index, d.pages.length)), 0, page);
  return page;
}

/** A new Shelf on `side` (mixing off), kept in side order. */
function makeShelf(d: SideLayout, side: ShelfSide): Shelf {
  const shelf: Shelf = { id: nextId(d, "s"), side, active: null, options: defaultShelfOptions() };
  d.shelves = [...(d.shelves ?? []), shelf].sort((a, b) => SIDE_ORDER[a.side] - SIDE_ORDER[b.side]);
  return shelf;
}

/** Index in `pages` right after a Shelf's last page (its end in the rail). */
function shelfEnd(d: SideLayout, shelfId: string): number {
  let at = -1;
  d.pages.forEach((p, k) => {
    if (p.shelf === shelfId) at = k;
  });
  return at < 0 ? d.pages.length : at + 1;
}

/**
 * Makes a draft's Shelves consistent (in place): at most one Shelf per side (≤ MAX_SHELVES); a page with no
 * (known) Shelf joins the right one — made when missing (the layout predates Shelves; in 单一 Shelf 模式 the
 * Shelf there is, whatever its side);
 * beyond the sanity limit a Shelf's extra pages fold into its last; a Shelf without pages goes; each Shelf's page in
 * view exists (else its neighbour in `before`'s rail order, else its first page).
 */
function fixShelves(d: SideLayout, before: Map<string, string[]>): void {
  const out: Shelf[] = [];
  for (const shelf of d.shelves ?? []) {
    if (out.length >= MAX_SHELVES || out.some((o) => o.id === shelf.id)) continue;
    if (out.some((o) => o.side === shelf.side)) {
      if (out.some((o) => o.side === otherSide(shelf.side))) continue;
      shelf.side = otherSide(shelf.side);
    }
    out.push(shelf);
  }
  d.shelves = out;
  for (const page of d.pages) {
    if (page.shelf && d.shelves.some((o) => o.id === page.shelf)) continue;
    const home = d.shelves.find((o) => o.side === "right") ?? (d.shelves.length >= shelfLimit(d) ? d.shelves[d.shelves.length - 1]! : makeShelf(d, "right"));
    page.shelf = home.id;
  }
  for (const shelf of d.shelves) {
    const own = d.pages.filter((p) => p.shelf === shelf.id);
    if (own.length <= MAX_SHELF_PAGES) continue;
    const into = own[MAX_SHELF_PAGES - 1]!;
    for (const extra of own.slice(MAX_SHELF_PAGES)) {
      for (const card of extra.cards) into.cards.push(card);
      into.groups = [...new Set([...into.groups, ...extra.groups])];
      for (const [kind, ov] of Object.entries(d.overrides)) if (ov.page === extra.id) d.overrides[kind] = { ...ov, page: into.id };
      if (shelf.active === extra.id) shelf.active = into.id;
    }
    const gone = new Set(own.slice(MAX_SHELF_PAGES));
    d.pages = d.pages.filter((p) => !gone.has(p));
    normalise(into.cards);
  }
  d.shelves = d.shelves.filter((x) => d.pages.some((p) => p.shelf === x.id)).sort((a, b) => SIDE_ORDER[a.side] - SIDE_ORDER[b.side]);
  for (const shelf of d.shelves) {
    const own = d.pages.filter((p) => p.shelf === shelf.id);
    if (shelf.active && own.some((p) => p.id === shelf.active)) continue;
    const order = before.get(shelf.id) ?? [];
    const k = shelf.active ? order.indexOf(shelf.active) : -1;
    const near = k >= 0 ? [...order.slice(0, k).reverse(), ...order.slice(k + 1)].find((id) => own.some((p) => p.id === id)) : undefined;
    shelf.active = near ?? own.find((p) => p.id === d.activePage)?.id ?? own[0]!.id;
  }
}

/** Removes an instance from its card, or from a chip's card (the instance record stays). */
function detach(d: SideLayout, id: string): void {
  for (const card of [...d.pages.flatMap((p) => p.cards), ...(d.chips ?? []).map((c) => c.card)]) {
    const k = card.tabs.indexOf(id);
    if (k < 0) continue;
    card.tabs.splice(k, 1);
    if (card.active === id) card.active = card.tabs[Math.min(k, card.tabs.length - 1)] ?? null;
    return;
  }
}

/** A pane none of whose tabs is of its home kind any more takes its first tab's kind (its order, name and min height follow). */
function rehome(d: SideLayout, card: SideCard): void {
  if (!card.tabs.length || card.tabs.some((id) => d.instances[id]?.kind === card.kind)) return;
  const kind = d.instances[card.tabs[0]!]?.kind;
  if (kind) card.kind = kind;
}

/** `card`'s tabs join `into` (the pane above it); `card` leaves its page (sizes renormalised). */
function mergeCardInto(page: SidePage, card: SideCard, into: SideCard): void {
  for (const id of card.tabs) if (!into.tabs.includes(id)) into.tabs.push(id);
  if (!into.active) into.active = card.active ?? into.tabs[0] ?? null;
  page.cards = page.cards.filter((c) => c !== card);
  normalise(page.cards);
}

/**
 * The limits (§24 限额, §24.12): a page with more than 3 panes merges its bottom ones into the third (tabs).
 * The MAX_TOOL_PANES on screen are kept where panes are added (place, drops, a chip back), not here: a page
 * switch never merges anything.
 */
function fitLimits(d: SideLayout): void {
  for (const page of d.pages) {
    while (page.cards.length > MAX_CARDS) mergeCardInto(page, page.cards[page.cards.length - 1]!, page.cards[page.cards.length - 2]!);
  }
}

/**
 * Drops empty cards and pages (an empty page survives while it is its Shelf's page in view — the launcher —
 * or when the owner made it, `kept`), renormalises card sizes, keeps the limits and the Shelves consistent,
 * keeps `activePage` (the focused page) on a neighbour, closes the tool area when nothing is left.
 */
function cleanup(d: SideLayout): void {
  for (const page of d.pages) {
    const before = page.cards.length;
    page.cards = page.cards.filter((c) => c.tabs.length > 0);
    for (const c of page.cards) if (!c.active || !c.tabs.includes(c.active)) c.active = c.tabs[0] ?? null;
    for (const c of page.cards) rehome(d, c);
    if (page.cards.length !== before) normalise(page.cards);
  }
  fitLimits(d);
  if (d.chips) {
    d.chips = d.chips.filter((c) => c.card.tabs.length > 0);
    for (const c of d.chips) {
      if (!c.card.active || !c.card.tabs.includes(c.card.active)) c.card.active = c.card.tabs[0] ?? null;
      rehome(d, c.card);
    }
    if (!d.chips.length) delete d.chips;
  }
  const order = d.pages.map((p) => p.id);
  const rails = new Map<string, string[]>();
  for (const p of d.pages) if (p.shelf) rails.set(p.shelf, [...(rails.get(p.shelf) ?? []), p.id]);
  const inView = (p: SidePage) => (d.shelves ?? []).some((x) => x.id === p.shelf && x.active === p.id) || (!p.shelf && p.id === d.activePage);
  d.pages = d.pages.filter((p) => p.cards.length > 0 || p.kept || (p.launcher && inView(p)));
  fixShelves(d, rails);
  if (!findPage(d, d.activePage)) {
    const k = d.activePage ? order.indexOf(d.activePage) : -1;
    const near = k >= 0 ? [...order.slice(0, k).reverse(), ...order.slice(k + 1)].find((id) => findPage(d, id)) : undefined;
    const shelf = findShelfRaw(d, findPage(d, near)?.shelf) ?? d.shelves?.find((x) => x.side === "right") ?? d.shelves?.[0];
    d.activePage = shelf?.active ?? d.pages[0]?.id ?? null;
  } else {
    // The focused page is its Shelf's page in view.
    const shelf = findShelfRaw(d, findPage(d, d.activePage)!.shelf);
    if (shelf && shelf.active !== d.activePage) d.activePage = shelf.active;
  }
  if (!d.pages.length) {
    d.activePage = null;
    d.open = false;
  }
}

/** A Shelf of a draft by id (no normalising). */
function findShelfRaw(d: SideLayout, id: string | null | undefined): Shelf | null {
  return id ? d.shelves?.find((x) => x.id === id) ?? null : null;
}

/**
 * Switch the page in view of its Shelf and focus it; a launcher page (empty, not kept) its Shelf leaves
 * behind is dropped. A collapsed Shelf expands.
 */
function setActivePage(d: SideLayout, pageId: string | null): void {
  const page = findPage(d, pageId);
  if (!page) {
    if (!findPage(d, d.activePage)) d.activePage = d.shelves?.[0]?.active ?? d.pages[0]?.id ?? null;
    return;
  }
  const shelf = findShelfRaw(d, page.shelf);
  const old = shelf ? findPage(d, shelf.active) : findPage(d, d.activePage);
  d.activePage = page.id;
  if (shelf) {
    shelf.active = page.id;
    delete shelf.collapsed;
  }
  if (old && old !== page && !old.cards.length && !old.kept) d.pages = d.pages.filter((p) => p !== old);
}

function touch(d: SideLayout, id: string, now: number): void {
  const inst = d.instances[id];
  if (inst) d.instances[id] = { ...inst, lastActiveAt: now };
}

function setOverride(d: SideLayout, kind: ItemId, page: SidePage, now: number): void {
  d.overrides[kind] = { page: page.id, groups: [...page.groups], at: now };
  const keys = Object.keys(d.overrides);
  if (keys.length > MAX_OVERRIDES) {
    const oldest = keys.sort((a, b) => d.overrides[a]!.at - d.overrides[b]!.at).slice(0, keys.length - MAX_OVERRIDES);
    for (const k of oldest) delete d.overrides[k];
  }
}

/** Show an instance: open the column, switch to its page, expand its card, make it the active tab. */
function revealIn(d: SideLayout, id: string): void {
  const at = locate(d, id);
  if (!at) return;
  at.card.active = id;
  at.card.collapsed = false;
  d.open = true;
  setActivePage(d, at.page.id);
}

// ── Open ──────────────────────────────────────────────────────────────────────────────────────

export interface SideOpenInput {
  kind: ItemId;
  binding: SideBinding;
  key: string | null;
  state: Json;
  v: number;
  pinned: boolean;
}

export interface SideApplied {
  layout: SideLayout;
  instanceId: string;
  pageId: string | null;
  reused: boolean;
}

/**
 * Executes a place() decision. `activate` updates the state (init(params, previous) result) and
 * touches; `replace` swaps the unpinned transient instance for a new id in the same tab slot (the
 * Body remounts); `insert` creates the page / card / tab. `reveal` opens the column on the result.
 * `existing` re-places an instance that already has an id (restore default, reset) instead of creating one.
 */
export function applyOpen(layout: SideLayout, decision: SidePlaceDecision, input: SideOpenInput, now: number, opts: { reveal: boolean; existing?: string; home?: string; keepActive?: boolean }): SideApplied {
  const d = draft(layout);
  // Background open (keepActive): the target card keeps showing the tab it showed (if it had one).
  const shownBefore = new Map(d.pages.flatMap((p) => p.cards.map((c) => [c.id, c.active] as const)));
  let id: string;
  let reused = false;
  if (decision.op === "activate") {
    id = decision.instance;
    reused = true;
    const old = d.instances[id]!;
    d.instances[id] = { ...old, state: input.state, v: input.v, pinned: old.pinned || input.pinned, lastActiveAt: now };
    const at = locate(d, id);
    if (at) at.card.active = id;
  } else if (decision.op === "replace") {
    const old = decision.instance;
    id = nextId(d, "i");
    const at = locate(d, old);
    if (at) {
      at.card.tabs[at.card.tabs.indexOf(old)] = id;
      at.card.active = id;
    }
    delete d.instances[old];
    d.instances[id] = { kind: input.kind, binding: input.binding, key: input.key, state: input.state, v: input.v, pinned: input.pinned, lastActiveAt: now };
  } else {
    let page: SidePage;
    if ("id" in decision.page) page = findPage(d, decision.page.id)!;
    else {
      // A new page in its Shelf; without one (or a Shelf that is gone), a new Shelf: the right side, else the
      // free one (单一 Shelf 模式 with a Shelf: that one).
      const n = decision.page.new;
      const room = d.shelves!.length < shelfLimit(d);
      const free: ShelfSide | null = !room ? null : !d.shelves!.some((x) => x.side === "right") ? "right" : !d.shelves!.some((x) => x.side === "left") ? "left" : null;
      const shelf = findShelfRaw(d, n.shelf) ?? (free ? makeShelf(d, free) : (d.shelves!.find((x) => x.side === "right") ?? d.shelves![0]!));
      page = newPage(d, n.groups, findShelfRaw(d, n.shelf) ? n.index : shelfEnd(d, shelf.id), shelf.id);
    }
    // A launcher page takes the first component's group so later rules can find it.
    if (!page.groups.length) page.groups = [opts.home ?? `${USER_GROUP}${page.id}`];
    delete page.launcher;
    // An override whose page is gone follows the page it landed on (same groups, new id).
    const ov = d.overrides[input.kind];
    if (decision.via === "override" && ov && ov.page !== page.id) d.overrides[input.kind] = { ...ov, page: page.id };
    let card = "id" in decision.card ? page.cards.find((c) => c.id === (decision.card as { id: string }).id) ?? null : null;
    if (!card) {
      const n = decision.card as { new: { index: number; share: number | null; collapsed?: boolean } };
      card = addCard(d, page, input.kind, n.new.index, n.new.share);
      if (n.new.collapsed) card.collapsed = true;
    }
    id = opts.existing ?? nextId(d, "i");
    if (opts.existing && d.instances[id]) d.instances[id] = { ...d.instances[id]!, lastActiveAt: now };
    else d.instances[id] = { kind: input.kind, binding: input.binding, key: input.key, state: input.state, v: input.v, pinned: input.pinned, lastActiveAt: now };
    addTab(card, id);
  }
  if (opts.keepActive) {
    const at = locate(d, id);
    const before = at ? shownBefore.get(at.card.id) : null;
    if (at && before && before !== id && at.card.tabs.includes(before)) at.card.active = before;
  } else if (opts.reveal) revealIn(d, id);
  // (A background open leaves the focus where it was, even none.)
  if (!shelvesConsistent(d)) fixShelves(d, new Map());
  return { layout: d, instanceId: id, pageId: locate(d, id)?.page.id ?? null, reused };
}

/** Groups a launcher page gets when it receives its first card (place() skips groupless pages for rules). */
export function adoptGroups(layout: SideLayout, pageId: string, groups: readonly string[]): SideLayout {
  const page = findPage(layout, pageId);
  if (!page || page.groups.length) return layout;
  const d = draft(layout);
  findPage(d, pageId)!.groups = [...groups];
  return d;
}

// ── Simple reducers ───────────────────────────────────────────────────────────────────────────

export function setOpen(layout: SideLayout, open: boolean): SideLayout {
  if (layout.open === open) return layout;
  return { ...layout, open };
}

export function switchPage(layout: SideLayout, pageId: string): SideLayout {
  if (!findPage(layout, pageId)) return layout;
  const d = draft(layout);
  d.open = true;
  setActivePage(d, pageId);
  return d;
}

export function activateTab(layout: SideLayout, instanceId: string, now: number): SideLayout {
  const d = draft(layout);
  const at = locate(d, instanceId);
  if (!at) return layout;
  at.card.active = instanceId;
  touch(d, instanceId, now);
  return d;
}

export function revealInstance(layout: SideLayout, instanceId: string, now: number): SideLayout {
  if (!locate(layout, instanceId)) return layout;
  const d = draft(layout);
  revealIn(d, instanceId);
  touch(d, instanceId, now);
  return d;
}

export function setInstanceState(layout: SideLayout, instanceId: string, state: Json, v: number): SideLayout {
  const inst = layout.instances[instanceId];
  if (!inst) return layout;
  return { ...layout, instances: { ...layout.instances, [instanceId]: { ...inst, state, v } } };
}

export function pinInstance(layout: SideLayout, instanceId: string, pinned = true): SideLayout {
  const inst = layout.instances[instanceId];
  if (!inst || inst.pinned === pinned) return layout;
  return { ...layout, instances: { ...layout.instances, [instanceId]: { ...inst, pinned } } };
}

export function setCollapsed(layout: SideLayout, cardId: string, collapsed: boolean): SideLayout {
  const d = draft(layout);
  const at = findCard(d, cardId);
  if (!at || at.card.collapsed === collapsed) return layout;
  at.card.collapsed = collapsed;
  return d;
}

export function renamePage(layout: SideLayout, pageId: string, name: string | null): SideLayout {
  const d = draft(layout);
  const page = findPage(d, pageId);
  if (!page) return layout;
  const trimmed = name?.trim().slice(0, 80);
  if (trimmed) page.name = trimmed;
  else delete page.name;
  return d;
}

/**
 * New launcher page (empty, in view; dropped when left without content) in Shelf `shelfId` (default: the
 * focused Shelf; none yet: a new right Shelf). Refused at MAX_SHELF_PAGES pages in that Shelf.
 */
export function openLauncherPage(layout: SideLayout, shelfId?: string): { layout: SideLayout; pageId: string | null } {
  const L = withShelves(layout);
  const target = findShelf(L, shelfId) ?? focusedShelf(L);
  const existing = L.pages.find((p) => !p.cards.length && !p.kept && (!target || p.shelf === target.id));
  if (existing) return { layout: { ...switchPage(L, existing.id), open: true }, pageId: existing.id };
  if (target && pagesOfShelf(L, target.id).length >= MAX_SHELF_PAGES) return { layout, pageId: null };
  const d = draft(L);
  const shelf = findShelfRaw(d, target?.id) ?? makeShelf(d, "right");
  const page = newPage(d, [], shelfEnd(d, shelf.id), shelf.id);
  page.launcher = true;
  d.open = true;
  setActivePage(d, page.id);
  return { layout: d, pageId: page.id };
}

/** Card heights in a page: sizes as shares of 1 (the user dragged a gap handle). */
export function setCardSizes(layout: SideLayout, pageId: string, sizes: Readonly<Record<string, number>>): SideLayout {
  const d = draft(layout);
  const page = findPage(d, pageId);
  if (!page) return layout;
  for (const c of page.cards) if (typeof sizes[c.id] === "number" && sizes[c.id]! > 0) c.size = sizes[c.id]!;
  normalise(page.cards);
  return d;
}

/** Double-click on a gap handle: equal split of the expanded cards. */
export function equalizeCards(layout: SideLayout, pageId: string): SideLayout {
  const d = draft(layout);
  const page = findPage(d, pageId);
  if (!page) return layout;
  for (const c of page.cards) c.size = 1 / page.cards.length;
  return d;
}

/**
 * A conversation's own Shelf (`own`: no shared pages) with tabs bound to another agent — before 2026-10-23 an agent's
 * open landed in the focused conversation's Shelf, where it never showed: those tabs taken out (`strays`, to go to
 * their own agents' Shelves, adoptInstance). Pages and tabs on shared pages are left alone. Pure; idempotent.
 */
export function takeStrays(own: SideLayout, hostId: string, sessionId: string): { own: SideLayout; strays: { id: string; inst: SideInstance }[] } {
  const strays: { id: string; inst: SideInstance }[] = [];
  const cards = [...own.pages.filter((p) => !p.shared).flatMap((p) => p.cards), ...(own.chips ?? []).map((c) => c.card)];
  for (const card of cards) {
    for (const id of card.tabs) {
      const inst = own.instances[id];
      const b = inst?.binding;
      if (inst && b?.kind === "agent" && (b.hostId !== hostId || b.sessionId !== sessionId) && !strays.some((x) => x.id === id)) strays.push({ id, inst });
    }
  }
  return strays.length ? { own: closeInstances(own, strays.map((x) => x.id)), strays } : { own, strays };
}

// ── Close ─────────────────────────────────────────────────────────────────────────────────────

/**
 * An instance that belongs in this conversation's Shelf arrives from elsewhere (owner 2026-10-23: an agent's own open, or
 * a tab that was put in another conversation's Shelf — lib/sideLayoutStore adoptIntoConversation): it joins the first
 * pane of its kind on a page of this conversation's own (not a shared page), as a tab behind the one in view; with no
 * such pane, a page of its own at the end of the first Shelf. Same instance id (nothing remounts). `seq`: an id
 * counter past every layout involved. `show`: its page becomes its Shelf's page in view. Pure.
 */
export function adoptInstance(input: SideLayout, id: string, inst: SideInstance, now: number, opts: { seq?: number; show?: boolean } = {}): { layout: SideLayout; pageId: string } {
  const d = draft(withShelves(input));
  d.seq = Math.max(d.seq, opts.seq ?? 0);
  d.instances[id] = inst;
  let page = d.pages.find((p) => !p.shared && p.cards.some((c) => c.kind === inst.kind && c.tabs.length > 0)) ?? null;
  let card = page?.cards.find((c) => c.kind === inst.kind && c.tabs.length > 0) ?? null;
  if (!page || !card) {
    const shelf = (d.shelves ?? []).find((x) => x.side === "right") ?? d.shelves?.[0] ?? makeShelf(d, "right");
    const full = d.pages.filter((p) => p.shelf === shelf.id).length >= MAX_SHELF_PAGES;
    // A full Shelf: a pane of its own on the Shelf's page in view instead of one more page.
    page = (full ? findPage(d, shelf.active) : null) ?? newPage(d, [inst.kind], d.pages.length, shelf.id);
    card = full && !roomForCard(d, page) && page.cards.length
      ? page.cards[page.cards.length - 1]!
      : addCard(d, page, inst.kind, page.cards.length, null);
    if (!shelf.active) shelf.active = page.id;
    if (!d.activePage) d.activePage = page.id;
  }
  if (!card.tabs.includes(id)) {
    // Behind the tab in view (a background arrival); the only tab is the active one.
    if (card.active) card.tabs.push(id);
    else addTab(card, id);
  }
  touch(d, id, now);
  if (opts.show) {
    const shelf = (d.shelves ?? []).find((x) => x.id === page!.shelf);
    if (shelf) shelf.active = page.id;
  }
  return { layout: d, pageId: page.id };
}

export function closeInstances(layout: SideLayout, ids: readonly string[]): SideLayout {
  if (!ids.length) return layout;
  const d = draft(layout);
  for (const id of ids) {
    detach(d, id);
    delete d.instances[id];
  }
  cleanup(d);
  return d;
}

export function cardInstances(layout: SideLayout, cardId: string): string[] {
  return [...(findCard(layout, cardId)?.card.tabs ?? [])];
}

export function pageInstances(layout: SideLayout, pageId: string): string[] {
  return findPage(layout, pageId)?.cards.flatMap((c) => c.tabs) ?? [];
}

/** Leaves a launcher page (empty) by closing it: switch to a neighbour. */
export function dropEmptyPage(layout: SideLayout, pageId: string): SideLayout {
  const page = findPage(layout, pageId);
  if (!page || page.cards.length) return layout;
  const d = draft(layout);
  const rails = new Map<string, string[]>();
  for (const p of d.pages) if (p.shelf) rails.set(p.shelf, [...(rails.get(p.shelf) ?? []), p.id]);
  d.pages = d.pages.filter((p) => p.id !== pageId);
  fixShelves(d, rails);
  if (!findPage(d, d.activePage)) d.activePage = findShelfRaw(d, page.shelf)?.active ?? d.shelves?.[0]?.active ?? null;
  if (!d.pages.length) {
    d.activePage = null;
    d.open = false;
  }
  return d;
}

// ── User overrides: move, split, merge, reorder, restore, reset (§18.7) ─────────────────────────

export type MoveTarget = { page: string } | { newPage: true };

/** Where a moved instance goes inside the target page (drag and drop, P1b). */
export interface InstanceMoveOptions {
  /** Join this card (same kind; may be on the instance's own page: two same-kind cards). */
  card?: string;
  /** A new card of the instance's kind, even when the page has one (dropped between cards / at a pill's insertion point). */
  newCard?: boolean;
  /** A new card goes right above this card (null / omitted: its declared order, or the bottom with `newCard`). */
  before?: string | null;
}

/** Index of `before` in `cards` (missing / null → the end). */
function indexBefore(cards: readonly SideCard[], before: string | null | undefined): number {
  const k = before ? cards.findIndex((c) => c.id === before) : -1;
  return k < 0 ? cards.length : k;
}

/**
 * Moves one instance (tab menu 移到页 ▸, a dragged tab): into the target page's same-kind card (the
 * freshest; `opts.card` picks one), else a new card at its declared order (`opts.before` / `newCard`:
 * at that spot). Remembers the kind → page override when the page changes. The new-page target gets
 * the group `user:<pageId>`.
 */
export function moveInstance(layout: SideLayout, instanceId: string, target: MoveTarget, now: number, orderOf: (kind: ItemId) => number, opts: InstanceMoveOptions = {}): SideLayout {
  const from = locate(layout, instanceId);
  const inst = layout.instances[instanceId];
  if (!from || !inst) return layout;
  const samePage = "page" in target && target.page === from.page.id;
  if (samePage && !opts.card && !opts.newCard) return layout;
  if (opts.card === from.card.id) return layout;
  // The only tab of the only card going to a new page: it would look exactly the same.
  if ("newPage" in target && from.page.cards.length === 1 && from.card.tabs.length === 1) return layout;
  // No room for another page in its Shelf (§24.12: ≤ 50).
  const fromShelf = shelfOfPage(layout, from.page.id);
  if ("newPage" in target && fromShelf && pagesOfShelf(layout, fromShelf.id).length >= MAX_SHELF_PAGES) return layout;
  const d = draft(withShelves(layout));
  detach(d, instanceId);
  let page: SidePage;
  if ("newPage" in target) {
    page = newPage(d, [], fromShelf ? shelfEnd(d, fromShelf.id) : d.pages.length, fromShelf?.id);
    page.groups = [`${USER_GROUP}${page.id}`];
  } else {
    const found = findPage(d, target.page);
    if (!found) return layout;
    page = found;
  }
  if (!page.groups.length) page.groups = [`${USER_GROUP}${page.id}`];
  delete page.launcher;
  let card: SideCard | null = null;
  if (opts.card) {
    card = page.cards.find((c) => c.id === opts.card && cardHolds(d, c, inst.kind)) ?? null;
    if (!card) return layout; // a dragged tab joins a pane of its kind only
  } else if (!opts.newCard) card = freshestCard(d, page.cards.filter((c) => cardHolds(d, c, inst.kind)));
  // A full column (§24): the tab joins its bottom pane (or the pane at the drop spot).
  if (!card && page.cards.length && !roomForCard(d, page)) card = (opts.before ? page.cards.find((c) => c.id === opts.before) : null) ?? page.cards[page.cards.length - 1]!;
  if (!card) {
    const index = opts.newCard || opts.before !== undefined ? indexBefore(page.cards, opts.before) : newCardIndex(page.cards, orderOf(inst.kind), orderOf);
    card = addCard(d, page, inst.kind, index, null);
  }
  addTab(card, instanceId);
  card.collapsed = false;
  touch(d, instanceId, now);
  if (!samePage) setOverride(d, inst.kind, page, now);
  d.open = true;
  setActivePage(d, page.id);
  cleanup(d);
  return d;
}

/**
 * A tab dropped between two cards (拆到新卡片 at a spot): a new card of its kind above `before`
 * (null = bottom) on `pageId`. The only tab of its card on the same page = the card moves there.
 * Same page: no override; another page: the kind's override follows (a move).
 */
export function splitInstanceTo(layout: SideLayout, instanceId: string, pageId: string, before: string | null, now: number, orderOf: (kind: ItemId) => number): SideLayout {
  const from = locate(layout, instanceId);
  if (!from) return layout;
  if (from.page.id === pageId && from.card.tabs.length === 1) return reorderCard(layout, from.card.id, before);
  return moveInstance(layout, instanceId, { page: pageId }, now, orderOf, { newCard: true, before });
}

/** Moves a card inside its page: right above `before` (null = the bottom). No override (same page). */
export function reorderCard(layout: SideLayout, cardId: string, before: string | null): SideLayout {
  const at = findCard(layout, cardId);
  if (!at || before === cardId) return layout;
  if (before && !at.page.cards.some((c) => c.id === before)) return layout;
  const order = at.page.cards.map((c) => c.id);
  const d = draft(layout);
  const page = findPage(d, at.page.id)!;
  const [card] = page.cards.splice(at.cardIndex, 1);
  page.cards.splice(indexBefore(page.cards, before), 0, card!);
  if (page.cards.every((c, k) => c.id === order[k])) return layout;
  return d;
}

/**
 * A dragged card dropped at a spot: its own page → reorder; another page → the card moves there,
 * right above `before` (null = the bottom; a same-kind card there takes its tabs); a new page →
 * moveCard (a single-card page stays as it is).
 */
export function moveCardTo(layout: SideLayout, cardId: string, target: { page: string; before: string | null } | { newPage: true }, now: number, orderOf: (kind: ItemId) => number): SideLayout {
  const at = findCard(layout, cardId);
  if (!at) return layout;
  if ("newPage" in target) return moveCard(layout, cardId, target, now, orderOf);
  if (target.page === at.page.id) return reorderCard(layout, cardId, target.before);
  const page = findPage(layout, target.page);
  if (!page) return layout;
  return moveCard(layout, cardId, { page: target.page }, now, orderOf, indexBefore(page.cards, target.before));
}

/** A dragged page dropped on another page button's top / bottom edge (same Shelf): the rail order changes. Not an override. */
export function reorderPage(input: SideLayout, pageId: string, targetId: string, after: boolean): SideLayout {
  const layout = withShelves(input);
  if (pageId === targetId || findPage(layout, pageId)?.shelf !== findPage(layout, targetId)?.shelf) return input;
  const from = layout.pages.findIndex((p) => p.id === pageId);
  if (from < 0 || !findPage(layout, targetId)) return layout;
  const pages = [...layout.pages];
  const [page] = pages.splice(from, 1);
  const k = pages.findIndex((p) => p.id === targetId);
  pages.splice(after ? k + 1 : k, 0, page!);
  if (pages.every((p, k2) => p === layout.pages[k2])) return layout;
  return { ...layout, pages };
}

/**
 * A Shelf Rail page button dragged (owner 2026-10-22): the page goes to Shelf `shelfId` before page `before` (null:
 * at the end of that Shelf's rail). The same Shelf = the rail order changes (what shows stays); another Shelf (≤ 9
 * pages there) = the page moves with its panes and shows there, and a Shelf left without pages goes. Unchanged
 * (its own place, a full Shelf): the same layout object.
 */
export function movePageTo(input: SideLayout, pageId: string, shelfId: string, before: string | null): SideLayout {
  const layout = withShelves(input);
  const page = findPage(layout, pageId);
  const to = findShelf(layout, shelfId);
  if (!page || !to || before === pageId) return input;
  const across = page.shelf !== to.id;
  if (across && layout.pages.filter((p) => p.shelf === to.id).length >= MAX_SHELF_PAGES) return input;
  if (before !== null && findPage(layout, before)?.shelf !== to.id) return input;
  const rails = new Map(shelvesOf(layout).map((x) => [x.id, layout.pages.filter((p) => p.shelf === x.id).map((p) => p.id)] as const));
  const d = draft(layout);
  const k = d.pages.findIndex((p) => p.id === pageId);
  const [moved] = d.pages.splice(k, 1);
  moved!.shelf = to.id;
  let at = before === null ? -1 : d.pages.findIndex((p) => p.id === before);
  if (at < 0) {
    let last = -1;
    d.pages.forEach((p, i) => p.shelf === to.id && (last = i));
    at = last < 0 ? d.pages.length : last + 1;
  }
  d.pages.splice(at, 0, moved!);
  if (!across) return d.pages.every((p, i) => p.id === layout.pages[i]?.id) ? input : d;
  fixShelves(d, rails);
  d.open = true;
  setActivePage(d, pageId);
  return d;
}

/** 拆到新卡片: the tab becomes its own card of the same kind right below, same page. No override. */
export function splitInstance(layout: SideLayout, instanceId: string, now: number): SideLayout {
  const from = locate(layout, instanceId);
  if (!from || from.card.tabs.length < 2 || !roomForCard(layout, from.page)) return layout;
  const d = draft(layout);
  const at = locate(d, instanceId)!;
  detach(d, instanceId);
  const card = addCard(d, at.page, d.instances[instanceId]?.kind ?? at.card.kind, at.cardIndex + 1, null);
  addTab(card, instanceId);
  touch(d, instanceId, now);
  return d;
}

/**
 * Moves a whole card (card menu 移到页 ▸ / 移到新页面 / 上移 / 下移). To another page: a same-kind
 * card there takes its tabs, else the card goes in at its declared order (or `index`). Remembers the
 * override for the card's kind when it changes page.
 */
export function moveCard(layout: SideLayout, cardId: string, target: MoveTarget | { delta: -1 | 1 }, now: number, orderOf: (kind: ItemId) => number, index?: number): SideLayout {
  const from = findCard(layout, cardId);
  if (!from) return layout;
  const d = draft(layout);
  const src = findCard(d, cardId)!;
  if ("delta" in target) {
    const k = src.cardIndex + target.delta;
    if (k < 0 || k >= src.page.cards.length) return layout;
    src.page.cards.splice(src.cardIndex, 1);
    src.page.cards.splice(k, 0, src.card);
    return d;
  }
  if ("page" in target && target.page === src.page.id) return layout;
  if ("newPage" in target && src.page.cards.length < 2) return layout; // a single-card page: nothing would change
  if ("newPage" in target && src.page.shelf && d.pages.filter((p) => p.shelf === src.page.shelf).length >= MAX_SHELF_PAGES) return layout; // its Shelf is at the sanity page limit (§24.12)
  let page: SidePage;
  if ("newPage" in target) {
    page = newPage(d, [], src.page.shelf ? shelfEnd(d, src.page.shelf) : d.pages.length, src.page.shelf);
    page.groups = [`${USER_GROUP}${page.id}`];
  } else {
    const found = findPage(d, target.page);
    if (!found) return layout;
    page = found;
  }
  if (!page.groups.length) page.groups = [`${USER_GROUP}${page.id}`];
  delete page.launcher;
  src.page.cards.splice(src.cardIndex, 1);
  normalise(src.page.cards);
  const same = freshestCard(d, page.cards.filter((c) => cardHolds(d, c, src.card.kind)));
  if (same) {
    for (const id of src.card.tabs) addTab(same, id);
    same.active = src.card.active ?? same.active;
    same.collapsed = false;
  } else {
    const n = page.cards.length;
    if (n) {
      for (const c of page.cards) c.size *= n / (n + 1);
      src.card.size = 1 / (n + 1);
    } else src.card.size = 1;
    src.card.collapsed = false;
    const at = index ?? newCardIndex(page.cards, orderOf(src.card.kind), orderOf);
    page.cards.splice(Math.max(0, Math.min(at, n)), 0, src.card);
  }
  setOverride(d, src.card.kind, page, now);
  d.open = true;
  setActivePage(d, page.id);
  cleanup(d);
  return d;
}

/** 合并到 ▸: the source page's cards are appended to the target; groups united; overrides re-pointed. */
export function mergePages(layout: SideLayout, fromId: string, intoId: string): SideLayout {
  if (fromId === intoId) return layout;
  const d = draft(layout);
  const from = findPage(d, fromId);
  const into = findPage(d, intoId);
  if (!from || !into) return layout;
  const n = into.cards.length;
  const m = from.cards.length;
  normalise(into.cards);
  normalise(from.cards);
  for (const c of into.cards) c.size *= n / (n + m || 1);
  for (const c of from.cards) c.size *= m / (n + m || 1);
  into.cards.push(...from.cards);
  into.groups = [...new Set([...into.groups, ...from.groups])];
  delete into.launcher;
  for (const [kind, ov] of Object.entries(d.overrides)) if (ov.page === fromId) d.overrides[kind] = { ...ov, page: intoId, groups: [...into.groups] };
  d.pages = d.pages.filter((p) => p !== from);
  d.open = true;
  setActivePage(d, intoId);
  cleanup(d);
  return d;
}

/** Design 038: page `fromId` can merge into `intoId` (another page, ≤ MAX_CARDS panes together). */
export function canMergePage(layout: SideLayout, fromId: string, intoId: string): boolean {
  const from = findPage(layout, fromId);
  const into = findPage(layout, intoId);
  return !!from && !!into && from !== into && from.cards.length > 0 && from.cards.length + into.cards.length <= MAX_CARDS;
}

/**
 * A whole page dropped on another page's capsule, or 合并到上一页 (design 038): `intoId` gains its panes below its
 * own and shows; the dragged page goes (a Shelf left without pages goes too). More than MAX_CARDS panes together:
 * unchanged (the drop is refused before).
 */
export function mergePageInto(input: SideLayout, fromId: string, intoId: string): SideLayout {
  const layout = withShelves(input);
  if (!canMergePage(layout, fromId, intoId)) return input;
  const d = draft(layout);
  const from = findPage(d, fromId)!;
  const into = findPage(d, intoId)!;
  // The moved panes keep their heights among themselves; together they take their share of the new page.
  const n = into.cards.length;
  const m = from.cards.length;
  normalise(into.cards);
  normalise(from.cards);
  for (const c of into.cards) c.size *= n / (n + m);
  for (const c of from.cards) c.size *= m / (n + m);
  into.cards.push(...from.cards);
  from.cards = [];
  from.kept = false;
  into.groups = [...new Set([...into.groups, ...from.groups])];
  delete into.launcher;
  for (const [kind, ov] of Object.entries(d.overrides)) if (ov.page === fromId) d.overrides[kind] = { ...ov, page: intoId, groups: [...into.groups] };
  d.pages = d.pages.filter((p) => p !== from);
  d.open = true;
  setActivePage(d, intoId);
  cleanup(d);
  return d;
}

/**
 * 拆开 (design 038): pane `cardId` of a page with several becomes a page of its own right after it (kept, in view).
 * Unchanged for a page's only pane or a Shelf with MAX_SHELF_PAGES pages.
 */
export function splitCardOut(input: SideLayout, cardId: string, now: number): SideLayout {
  const layout = withShelves(input);
  const at = findCard(layout, cardId);
  if (!at || at.page.cards.length < 2 || !at.page.shelf || pagesOfShelf(layout, at.page.shelf).length >= MAX_SHELF_PAGES) return input;
  const d = draft(layout);
  const src = findCard(d, cardId)!;
  src.page.cards.splice(src.cardIndex, 1);
  normalise(src.page.cards);
  const page = newPage(d, [], d.pages.indexOf(src.page) + 1, src.page.shelf);
  page.groups = [`${USER_GROUP}${page.id}`];
  page.kept = true;
  src.card.size = 1;
  src.card.collapsed = false;
  page.cards.push(src.card);
  if (src.card.active) touch(d, src.card.active, now);
  setOverride(d, src.card.kind, page, now);
  d.open = true;
  setActivePage(d, page.id);
  cleanup(d);
  return d;
}

/** 上移 / 下移 in the Shelf Rail: the page swaps with its neighbour in its Shelf. */
export function movePage(input: SideLayout, pageId: string, delta: -1 | 1): SideLayout {
  const layout = withShelves(input);
  const page = findPage(layout, pageId);
  if (!page) return input;
  const rail = layout.pages.filter((p) => p.shelf === page.shelf);
  const k = rail.indexOf(page);
  const other = rail[k + delta];
  if (!other) return input;
  const pages = [...layout.pages];
  const a = pages.indexOf(page);
  const b = pages.indexOf(other);
  pages[a] = other;
  pages[b] = page;
  return { ...layout, pages };
}

// ── Chips, joins and new columns (step 4, docs/desktop-modules.md §24) ─────────────────────────────

/** The chip of a collapsed card (null: none). */
export function findChip(layout: SideLayout, cardId: string): SideChip | null {
  return layout.chips?.find((c) => c.card.id === cardId) ?? null;
}

/** The chip holding an instance (null: none, or the instance is placed). */
export function locateChip(layout: SideLayout, instanceId: string): SideChip | null {
  return layout.chips?.find((c) => c.card.tabs.includes(instanceId)) ?? null;
}

/** A chip holding the instance an open would reuse (same kind, dedupe key and binding): that open restores the chip. */
export function chipHolding(layout: SideLayout, kind: ItemId, key: string | null, binding: SideBinding): SideChip | null {
  if (key === null) return null;
  return (
    layout.chips?.find((c) =>
      c.card.tabs.some((id) => {
        const inst = layout.instances[id];
        return !!inst && inst.kind === kind && inst.key === key && sameBinding(inst.binding, binding);
      }),
    ) ?? null
  );
}

/** A card's last use: its tabs' latest lastActiveAt (LRU). */
export const cardLastUsed = (layout: SideLayout, card: SideCard): number => Math.max(0, ...card.tabs.map((t) => layout.instances[t]?.lastActiveAt ?? 0));

/** Takes a card out of its column into a new chip (on a draft); false when there is no such card. */
function chipOut(d: SideLayout, cardId: string, now: number): boolean {
  const at = findCard(d, cardId);
  if (!at) return false;
  const { page, cardIndex: k } = at;
  d.chips = [
    ...(d.chips ?? []),
    {
      card: { ...at.card, tabs: [...at.card.tabs], collapsed: false },
      page: { id: page.id, groups: [...page.groups], ...(page.name ? { name: page.name } : {}), index: d.pages.filter((p) => p.shelf === page.shelf).indexOf(page), ...(page.shelf ? { shelf: page.shelf } : {}), ...(findShelfRaw(d, page.shelf) ? { side: findShelfRaw(d, page.shelf)!.side } : {}) },
      above: page.cards[k - 1]?.id ?? null,
      below: page.cards[k + 1]?.id ?? null,
      at: now,
    },
  ];
  page.cards.splice(k, 1);
  normalise(page.cards);
  return true;
}

/**
 * @deprecated #7 (owner 2026-10-21): tool panes no longer go to the tray — the pane header's 「—」 offers
 * 移到另一页 / 关闭 instead and nothing in the app calls this. Kept so tests can make a (stored) chip.
 */
export function collapseCard(layout: SideLayout, cardId: string, now: number): SideLayout {
  if (!findCard(layout, cardId)) return layout;
  const d = draft(layout);
  chipOut(d, cardId, now);
  cleanup(d);
  return d;
}

/** A page is on screen now: its Shelf's page in view, the Shelf expanded, the tool area open. */
function pageShown(d: SideLayout, page: SidePage): boolean {
  const shelf = findShelfRaw(d, page.shelf);
  return d.open && !!shelf && !shelf.collapsed && shelf.active === page.id;
}

/**
 * Puts a chip's card back into its Shelf (on a draft; the chip already taken out of `d.chips`) without pushing
 * anything out (#7: nothing goes to the tray any more): into its page, between the panes it had above / below,
 * when that page has room (≤ 3 panes; on screen, ≤ MAX_TOOL_PANES too); its page gone: re-made at its old place
 * in its Shelf; full: a new page of its Shelf. Its Shelf gone: the Shelf on its side, else a new Shelf there
 * (room for one), else the right one. That Shelf at MAX_SHELF_PAGES (or no Shelf at all): null.
 * `reveal`: its page comes into view (when that fits on screen) and the tool area opens.
 */
function reopenChip(d: SideLayout, chip: SideChip, now: number, reveal: boolean, roomForShelf = true): SidePage | null {
  const card: SideCard = { ...chip.card, tabs: [...chip.card.tabs], collapsed: false };
  if (!card.tabs.length) return null;
  const own = (x: Shelf) => d.pages.filter((p) => p.shelf === x.id);
  const shelves = d.shelves ?? [];
  let page = findPage(d, chip.page.id);
  let shelf = page ? findShelfRaw(d, page.shelf) : findShelfRaw(d, chip.page.shelf);
  if (!page && !shelf) {
    // Its Shelf is gone (e.g. every pane of it went to the tray): the Shelf on its side, else a new one there
    // when there is room for another Shelf (and the width for it: `roomForShelf`), else the right one.
    const side = chip.page.side ?? "right";
    shelf = shelves.find((x) => x.side === side) ?? (shelves.length < shelfLimit(d) && (roomForShelf || !d.pages.length) ? makeShelf(d, side) : (shelves.find((x) => x.side === "right") ?? shelves[0] ?? null));
  }
  const fits = (p: SidePage) => filled(p.cards) < MAX_CARDS && (!pageShown(d, p) || roomForCard(d, p));
  let neighbours = true;
  if (page && !fits(page)) {
    page = null;
    neighbours = false;
  } else if (!page && shelf && own(shelf).length < MAX_SHELF_PAGES) {
    const made: SidePage = { id: chip.page.id, groups: [...chip.page.groups], cards: [], shelf: shelf.id, ...(chip.page.name ? { name: chip.page.name } : {}) };
    const rail = own(shelf);
    const before = rail[Math.min(chip.page.index, rail.length)];
    d.pages.splice(before ? d.pages.indexOf(before) : shelfEnd(d, shelf.id), 0, made);
    page = made;
  }
  if (!page) {
    if (!shelf || own(shelf).length >= MAX_SHELF_PAGES) return null;
    page = newPage(d, [], shelfEnd(d, shelf.id), shelf.id);
    page.groups = [`${USER_GROUP}${page.id}`];
    page.kept = true;
    neighbours = false;
  }
  const show = reveal && (pageShown(d, page) || roomForCard(d, page));
  const above = neighbours && chip.above ? page.cards.findIndex((c) => c.id === chip.above) : -1;
  const below = neighbours && chip.below ? page.cards.findIndex((c) => c.id === chip.below) : -1;
  const index = above >= 0 ? above + 1 : below >= 0 ? below : page.cards.length;
  const n = page.cards.length;
  if (n) {
    normalise(page.cards);
    for (const c of page.cards) c.size *= n / (n + 1);
    card.size = 1 / (n + 1);
  } else card.size = 1;
  page.cards.splice(index, 0, card);
  delete page.launcher;
  if (card.active) touch(d, card.active, now);
  const home = findShelfRaw(d, page.shelf);
  if (home && !findPage(d, home.active)) home.active = page.id;
  if (show) {
    d.open = true;
    setActivePage(d, page.id);
  }
  return page;
}

/**
 * A (stored) tool chip opened again — e.g. an open that would reuse an instance it holds: the card goes back
 * into its Shelf (`reopenChip`: its page, else a page of its Shelf; nothing is pushed out to the tray) and its
 * page comes into view. Unchanged when it cannot go back (its Shelf gone / full of pages).
 */
export function restoreCard(layout: SideLayout, cardId: string, now: number, opts: { roomForColumn?: boolean } = {}): SideLayout {
  const chip = findChip(layout, cardId);
  if (!chip) return layout;
  const d = draft(layout);
  d.chips = d.chips!.filter((c) => c.card.id !== cardId);
  if (!chip.card.tabs.length) {
    cleanup(d);
    return d;
  }
  if (!reopenChip(d, chip, now, true, opts.roomForColumn !== false)) return layout;
  cleanup(d);
  return d;
}

/**
 * #7 (owner 2026-10-21), once per stored layout: tool panes are no longer chips in the tray. Every chip goes
 * back into its Shelf, oldest first, without changing what is in view (`reopenChip`); one that cannot (its
 * Shelf gone, the Shelf at MAX_SHELF_PAGES) is closed with its instances. `closed`: how many were closed.
 */
export function resolveChips(layout: SideLayout, now: number): { layout: SideLayout; closed: number } {
  if (!layout.chips?.length) return { layout, closed: 0 };
  const d = draft(layout);
  const chips = [...d.chips!].sort((a, b) => a.at - b.at);
  delete d.chips;
  let closed = 0;
  for (const chip of chips) {
    if (!chip.card.tabs.length || reopenChip(d, chip, now, false)) continue;
    closed++;
    for (const id of chip.card.tabs) delete d.instances[id];
  }
  cleanup(d);
  return { layout: d, closed };
}

/** What a step-4 drag moves: a whole pane (card) or one tab (instance). */
export type PaneSource = { card: string } | { instance: string };

/** The tabs a source moves and the one it shows. */
function sourceTabs(layout: SideLayout, src: PaneSource): { ids: string[]; active: string | null; kind: ItemId; from: InstanceLocation | null } | null {
  if ("card" in src) {
    const at = findCard(layout, src.card);
    return at ? { ids: [...at.card.tabs], active: at.card.active, kind: at.card.kind, from: { ...at } } : null;
  }
  const inst = layout.instances[src.instance];
  const from = locate(layout, src.instance);
  return inst && from ? { ids: [src.instance], active: src.instance, kind: inst.kind, from } : null;
}

/**
 * A pane or tab dropped on another pane's header / centre (step 4: 合并为标签页): its tabs join that pane,
 * whatever their kind; the moved active tab shows. Unchanged when the target is the source itself.
 */
export function joinInto(layout: SideLayout, src: PaneSource, targetCardId: string, now: number): SideLayout {
  const target = findCard(layout, targetCardId);
  const moved = sourceTabs(layout, src);
  if (!target || !moved || ("card" in src && src.card === targetCardId)) return layout;
  if (moved.ids.every((id) => target.card.tabs.includes(id))) return layout;
  const d = draft(layout);
  for (const id of moved.ids) detach(d, id);
  const at = findCard(d, targetCardId)!;
  for (const id of moved.ids) addTab(at.card, id);
  at.card.active = moved.active ?? moved.ids[0]!;
  at.card.collapsed = false;
  touch(d, at.card.active, now);
  if (moved.from && moved.from.page.id !== at.page.id) setOverride(d, moved.kind, at.page, now);
  d.open = true;
  setActivePage(d, at.page.id);
  cleanup(d);
  return d;
}

/**
 * A pane or tab dropped on the work area's free left / right edge (§24.12): a new Shelf there (mixing off)
 * with one page holding it. Unchanged when that side has a Shelf already, at `shelfLimit` (MAX_SHELVES; 1 in
 * 单一 Shelf 模式), or when the source is gone (the drop is refused / made a new page before).
 */
export function moveToNewShelf(input: SideLayout, src: PaneSource, side: ShelfSide, now: number): SideLayout {
  const layout = withShelves(input);
  const moved = sourceTabs(layout, src);
  if (!moved?.from || shelfOnSide(layout, side) || !canAddShelf(layout)) return input;
  const d = draft(layout);
  let card: SideCard;
  if ("card" in src) {
    const at = findCard(d, src.card)!;
    at.page.cards.splice(at.cardIndex, 1);
    normalise(at.page.cards);
    card = at.card;
  } else {
    detach(d, src.instance);
    card = { id: nextId(d, "c"), kind: moved.kind, tabs: [src.instance], active: src.instance, size: 1, collapsed: false };
  }
  const shelf = makeShelf(d, side);
  const page = newPage(d, [], d.pages.length, shelf.id);
  page.groups = [`${USER_GROUP}${page.id}`];
  card.size = 1;
  card.collapsed = false;
  page.cards.push(card);
  if (card.active) touch(d, card.active, now);
  setOverride(d, moved.kind, page, now);
  d.open = true;
  setActivePage(d, page.id);
  cleanup(d);
  return d;
}

/** The work area's edge, as before Shelves (step 4): a new Shelf on that side. */
export function moveToNewColumn(layout: SideLayout, src: PaneSource, to: { edge: ShelfSide }, now: number): SideLayout {
  return moveToNewShelf(layout, src, to.edge, now);
}

/**
 * A pane or tab dropped on a page button (§24.12): it goes to that page — a pane as a new pane at its
 * declared order (or into a pane of its kind), a tab as a tab of a pane of its kind, else a new pane.
 * The page comes into view. Unchanged when the page is full (the drop is refused before) or its own.
 */
export function moveToPage(input: SideLayout, src: PaneSource, pageId: string, now: number, orderOf: (kind: ItemId) => number): SideLayout {
  const layout = withShelves(input);
  const page = findPage(layout, pageId);
  const moved = sourceTabs(layout, src);
  if (!page || !moved?.from) return input;
  if ("card" in src) return moved.from.page.id === pageId ? input : moveCard(layout, src.card, { page: pageId }, now, orderOf);
  if (moved.from.page.id === pageId && moved.from.card.tabs.length === 1) return input;
  return moveInstance(layout, src.instance, { page: pageId }, now, orderOf, moved.from.page.id === pageId ? { newCard: true, before: null } : {});
}

/**
 * A pane or tab dropped on a Shelf Rail's ＋ (or an occupied work-area edge): a new page (kept, at the end of
 * the rail) holding it, in view. Unchanged at MAX_SHELF_PAGES pages.
 */
export function moveToNewPage(input: SideLayout, src: PaneSource, shelfId: string, now: number): SideLayout {
  const layout = withShelves(input);
  const moved = sourceTabs(layout, src);
  if (!moved?.from || !findShelf(layout, shelfId) || pagesOfShelf(layout, shelfId).length >= MAX_SHELF_PAGES) return input;
  const d = draft(layout);
  let card: SideCard;
  if ("card" in src) {
    const at = findCard(d, src.card)!;
    at.page.cards.splice(at.cardIndex, 1);
    normalise(at.page.cards);
    card = at.card;
  } else {
    detach(d, src.instance);
    card = { id: nextId(d, "c"), kind: moved.kind, tabs: [src.instance], active: src.instance, size: 1, collapsed: false };
  }
  const page = newPage(d, [], shelfEnd(d, shelfId), shelfId);
  page.groups = [`${USER_GROUP}${page.id}`];
  page.kept = true;
  card.size = 1;
  card.collapsed = false;
  page.cards.push(card);
  if (card.active) touch(d, card.active, now);
  setOverride(d, moved.kind, page, now);
  d.open = true;
  setActivePage(d, page.id);
  cleanup(d);
  return d;
}

/** The spec of a kind for re-placing (restore default / reset); null = unknown now (dormant: stays put). */
export type SpecOf = (kind: ItemId) => PlaceSpec | null;

function replaceExisting(d: SideLayout, id: string, specOf: SpecOf, now: number, reveal: boolean): SideLayout {
  const inst = d.instances[id]!;
  const spec = specOf(inst.kind) ?? placeSpec({ home: "workspace" });
  const without: SideLayout = { ...d, instances: { ...d.instances } };
  delete without.instances[id];
  const orderOf = (kind: ItemId) => specOf(kind)?.order ?? DEFAULT_ORDER;
  const decision = place(without, { kind: inst.kind, binding: inst.binding, key: inst.key, transient: false, activePage: d.activePage, columnOpen: d.open }, spec, orderOf);
  if (decision.op !== "insert") return d; // cannot happen: the instance was removed from the lookup
  const lastActiveAt = inst.lastActiveAt;
  const applied = applyOpen(d, decision, { ...inst }, now, { reveal, existing: id, home: spec.home });
  const out = applied.layout;
  out.instances[id] = { ...out.instances[id]!, lastActiveAt };
  return out;
}

/** 恢复默认位置: forget the kind's override and re-place this instance by the declared rules. */
export function restoreDefault(layout: SideLayout, instanceId: string, specOf: SpecOf, now: number): SideLayout {
  const inst = layout.instances[instanceId];
  if (!inst || !locate(layout, instanceId)) return layout;
  let d = draft(layout);
  delete d.overrides[inst.kind];
  detach(d, instanceId);
  cleanup(d);
  d.instances[instanceId] = inst; // cleanup never drops instance records
  d = replaceExisting(d, instanceId, specOf, now, true);
  return d;
}

/**
 * 组件默认位置 → 恢复默认 (settings): forget a kind's override; its placed instances go back by the
 * declared rules (oldest first). No override and nothing placed: unchanged.
 */
export function restoreKindDefault(layout: SideLayout, kind: ItemId, specOf: SpecOf, now: number): SideLayout {
  const ids = Object.keys(layout.instances)
    .filter((id) => layout.instances[id]!.kind === kind && locate(layout, id))
    .sort((a, b) => layout.instances[a]!.lastActiveAt - layout.instances[b]!.lastActiveAt || (a < b ? -1 : a > b ? 1 : 0));
  if (!ids.length) {
    if (!layout.overrides[kind]) return layout;
    const overrides = { ...layout.overrides };
    delete overrides[kind];
    return { ...layout, overrides };
  }
  let d = layout;
  for (const id of ids) d = restoreDefault(d, id, specOf, now);
  return d;
}

/**
 * 重置 Shelf 布局: clears overrides, page names, order, sizes and collapse; replays the live instances
 * (lastActiveAt, oldest first) with the declared rules. Nothing is closed. Deterministic.
 */
export function resetLayout(layout: SideLayout, specOf: SpecOf, now: number): SideLayout {
  const live = Object.keys(layout.instances)
    .filter((id) => locate(layout, id))
    .sort((a, b) => layout.instances[a]!.lastActiveAt - layout.instances[b]!.lastActiveAt || (a < b ? -1 : a > b ? 1 : 0));
  // Shelves too (§24.12): everything goes back into one right Shelf, which keeps the right Shelf's options and width.
  const right = shelfOnSide(layout, "right") ?? shelvesOf(layout)[0];
  let d: SideLayout = { ...layout, pages: [], shelves: [], overrides: {}, activePage: null, instances: { ...layout.instances } };
  const wasOpen = layout.open;
  let seeded = false;
  for (const id of live) {
    d = replaceExisting(d, id, specOf, now, false);
    // The first replay made the Shelf: it takes the right Shelf's options before the rest is placed.
    const made = d.shelves?.[0];
    if (made && right && !seeded) {
      made.options = { ...right.options };
      if (right.width !== undefined) made.width = right.width;
      seeded = true;
    }
  }
  const shelf = d.shelves?.[0];
  if (shelf) shelf.active = d.pages[0]?.id ?? null;
  d.activePage = d.pages[0]?.id ?? null;
  d.open = wasOpen && d.pages.length > 0;
  // re-placing kept lastActiveAt; the active tab of each card = its most recent instance
  for (const page of d.pages) for (const card of page.cards) card.active = mostRecent(d, card.tabs);
  return d;
}

// ── Visibility (§18.5) ────────────────────────────────────────────────────────────────────────

export interface SideViewContext {
  hostId: string;
  /** The selected agent (null: none). */
  sessionId: string | null;
  /** scopeKey of the selected agent's workspace (null: none). */
  workspaceKey: string | null;
  /** The component is registered and its module is available (else its instances are dormant). */
  available(kind: ItemId): boolean;
  /** The bound agent lacks the component's agent feature. */
  lacks?(kind: ItemId, sessionId: string | null): boolean;
}

export function bindingVisible(binding: SideBinding, ctx: Pick<SideViewContext, "hostId" | "sessionId" | "workspaceKey">): boolean {
  switch (binding.kind) {
    case "follow":
      return binding.hostId === ctx.hostId && ctx.sessionId !== null;
    case "agent":
      return binding.hostId === ctx.hostId && binding.sessionId === ctx.sessionId;
    case "workspace":
      return binding.hostId === ctx.hostId && ctx.workspaceKey !== null && binding.key === ctx.workspaceKey;
    case "host":
      return binding.hostId === ctx.hostId;
  }
}

/** The agent / host a binding resolves to for the Body (§18.5). */
export function resolveBinding(binding: SideBinding, ctx: Pick<SideViewContext, "hostId" | "sessionId">): { hostId: string | null; sessionId: string | null } {
  switch (binding.kind) {
    case "follow":
      return { hostId: binding.hostId, sessionId: binding.hostId === ctx.hostId ? ctx.sessionId : null };
    case "agent":
      return { hostId: binding.hostId, sessionId: binding.sessionId };
    case "workspace":
    case "host":
      return { hostId: binding.hostId, sessionId: binding.hostId === ctx.hostId ? ctx.sessionId : null };
  }
}

export function dormant(layout: SideLayout, instanceId: string, ctx: SideViewContext): boolean {
  const inst = layout.instances[instanceId];
  return !inst || !ctx.available(inst.kind);
}

export function instanceVisible(layout: SideLayout, instanceId: string, ctx: SideViewContext): boolean {
  const inst = layout.instances[instanceId];
  if (!inst || !ctx.available(inst.kind) || !bindingVisible(inst.binding, ctx)) return false;
  const session = resolveBinding(inst.binding, ctx).sessionId;
  return !ctx.lacks?.(inst.kind, session);
}

export function visibleTabs(layout: SideLayout, card: SideCard, ctx: SideViewContext): string[] {
  return card.tabs.filter((id) => instanceVisible(layout, id, ctx));
}

/** The tab a card shows: its active tab when visible, else its most recently used visible tab. */
export function shownTab(layout: SideLayout, card: SideCard, ctx: SideViewContext): string | null {
  const tabs = visibleTabs(layout, card, ctx);
  if (card.active && tabs.includes(card.active)) return card.active;
  return mostRecent(layout, tabs);
}

export function visibleCards(layout: SideLayout, page: SidePage, ctx: SideViewContext): SideCard[] {
  return page.cards.filter((c) => visibleTabs(layout, c, ctx).length > 0);
}

/**
 * The panes a page draws for `ctx` (its layout). A page the owner made (`kept`) or a shared one keeps its layout for
 * every agent (owner 2026-10-23: 「用户开的你不想动，那保持布局」): every pane stays where it is — one with nothing for this
 * agent shows as an empty slot of its kind (components/side/EmptySlot), its size kept. Other pages (made by
 * placement): the panes with something for this agent, as before. A pane whose tabs are all dormant (their module
 * off / not registered) is left out on either: it had its height there and nothing drawn in it (a hole, no gap;
 * fix/shelf-split-collapsed); it is back where it was once its module is.
 */
export function shownCards(layout: SideLayout, page: SidePage, ctx: SideViewContext): SideCard[] {
  return page.kept || page.shared ? page.cards.filter((c) => c.tabs.some((id) => !dormant(layout, id, ctx))) : visibleCards(layout, page, ctx);
}

/**
 * A page as its rail button shows it (owner 2026-10-23: 「胶囊显示的就是打开后看到的」): only the panes it draws for
 * `ctx` (`shownCards`), so its icon and name say what opens — a page made by placement whose file tree is empty here
 * reads 「浏览器」, not 「文件 · 浏览器」; a page the owner made or shared keeps its empty slots (they show). A name /
 * icon the owner chose wins (`pageName`, lib/shelfIcons `pageIcon`). The same object when nothing is left out.
 */
export function pageAsShown(layout: SideLayout, page: SidePage, ctx: SideViewContext): SidePage {
  const cards = shownCards(layout, page, ctx);
  return cards.length === page.cards.length ? page : { ...page, cards };
}
/**
 * How a page shows in the page buttons: "shown" (has cards visible to the current agent), "hidden"
 * (nothing for this agent: other agents' content or dormant instances — it leaves the lane, RFC §13
 * D27′), "launcher" (empty page).
 */
export type PageVisibility = "shown" | "hidden" | "launcher";

export function pageVisibility(layout: SideLayout, page: SidePage, ctx: SideViewContext): PageVisibility {
  if (!page.cards.length) return "launcher";
  return visibleCards(layout, page, ctx).length ? "shown" : "hidden";
}

/**
 * A Shelf's pages that get a button in its Shelf Rail (Alt+n), rail order: pages with something for this
 * agent, the pages the owner made or shared (kept / shared, even empty or with other agents' content only), and a launcher
 * page while it is the Shelf's page in view.
 */
export function shelfLanePages(input: SideLayout, shelfId: string, ctx: SideViewContext): SidePage[] {
  const layout = withShelves(input);
  const shelf = findShelf(layout, shelfId);
  return layout.pages.filter((p) => {
    if (p.shelf !== shelfId) return false;
    if (p.kept || p.shared) return true;
    const v = pageVisibility(layout, p, ctx);
    return v === "shown" || (v === "launcher" && p.id === shelf?.active);
  });
}

/** Every Shelf's rail pages, left Shelf first (Ctrl+Shift+n counted them before Shelves). */
export function lanePages(input: SideLayout, ctx: SideViewContext): SidePage[] {
  const layout = withShelves(input);
  return shelvesOf(layout).flatMap((x) => shelfLanePages(layout, x.id, ctx));
}

/** A Shelf's page in view for this agent (its page in view when in its rail, else its first rail page; null: nothing). */
export function shelfPageInView(input: SideLayout, shelfId: string, ctx: SideViewContext): SidePage | null {
  const layout = withShelves(input);
  const lane = shelfLanePages(layout, shelfId, ctx);
  const active = findShelf(layout, shelfId)?.active;
  return lane.find((p) => p.id === active) ?? lane[0] ?? null;
}

/** The focused Shelf's page in view (when it has nothing for this agent: the first rail page of any Shelf; null when none). */
export function pageInView(input: SideLayout, ctx: SideViewContext): SidePage | null {
  const layout = withShelves(input);
  const focused = focusedShelf(layout);
  return (focused ? shelfPageInView(layout, focused.id, ctx) : null) ?? lanePages(layout, ctx)[0] ?? null;
}

// ── Content per agent (the views of §18.5 are gone, §24: one layout for every agent) ─────────────────

type BindingCtx = Pick<SideViewContext, "hostId" | "sessionId" | "workspaceKey">;

/**
 * A page holds something for this agent: a placed instance whose binding it sees. By binding only
 * (dormant instances count): modules may still be registering.
 */
export function pageHasContentFor(layout: SideLayout, page: SidePage, ctx: BindingCtx): boolean {
  return page.cards.some((c) =>
    c.tabs.some((id) => {
      const inst = layout.instances[id];
      return !!inst && bindingVisible(inst.binding, ctx);
    }),
  );
}

export function hasContentFor(layout: SideLayout, ctx: BindingCtx): boolean {
  return layout.pages.some((p) => pageHasContentFor(layout, p, ctx));
}

/** A change took the focused agent's last content away: the Shelves hide (the next open shows them again). */
export function closeIfEmptied(prev: SideLayout, next: SideLayout, ctx: BindingCtx): SideLayout {
  if (!next.open || !hasContentFor(prev, ctx) || hasContentFor(next, ctx)) return next;
  if (next.pages.some((p) => p.kept || !p.cards.length)) return next; // a page the owner made / a launcher page
  return { ...next, open: false };
}

/** One Shelf on screen: the page it shows (`only`: one card of it, maximised). */
export interface ShelfOnScreen {
  shelf: Shelf;
  page: SidePage;
  only: string | null;
}

/**
 * The Shelves on screen (§24.12), left first: each expanded Shelf with a rail page for the focused
 * agent shows its page in view. A maximised / full-screen page: that one; a card: its page with that card
 * only. Nothing to show (the tool area is open with no pane at all): the empty state.
 */
export function columnsOnScreen(input: SideLayout, ctx: SideViewContext, mode: { card: string | null; shelf?: string | null } | null): ShelfOnScreen[] {
  const layout = withShelves(input);
  if (mode?.card) {
    const at = findCard(layout, mode.card);
    const shelf = at ? findShelf(layout, at.page.shelf) : null;
    return at && shelf ? [{ shelf, page: at.page, only: mode.card }] : [];
  }
  if (mode?.shelf) {
    // A whole Shelf maximised / full screen (§24.16): its page in view, whether it is collapsed or not.
    const shelf = findShelf(layout, mode.shelf);
    const page = shelf ? shelfPageInView(layout, shelf.id, ctx) : null;
    return shelf && page ? [{ shelf, page, only: null }] : [];
  }
  const shown = shelvesOf(layout).flatMap((shelf) => {
    if (shelf.collapsed) return [];
    const page = shelfPageInView(layout, shelf.id, ctx);
    return page ? [{ shelf, page, only: null }] : [];
  });
  if (mode) {
    const focused = shown.find((x) => x.page.id === layout.activePage) ?? shown[shown.length - 1];
    return focused ? [focused] : [];
  }
  return shown;
}

/**
 * The collapsed Shelves (§24.12, owner 2026-10-21), left first: each with a rail page for the focused agent
 * shows as its Shelf Rail only, a strip in place (`page`: its page in view, not drawn). Not while a page /
 * pane is maximised or full screen.
 */
export function railsOnScreen(input: SideLayout, ctx: SideViewContext): ShelfOnScreen[] {
  const layout = withShelves(input);
  if (!layout.open) return [];
  return shelvesOf(layout).flatMap((shelf) => {
    if (!shelf.collapsed) return [];
    const page = shelfPageInView(layout, shelf.id, ctx);
    return page ? [{ shelf, page, only: null }] : [];
  });
}

/** The tool area shows: open, and either a Shelf for this agent or nothing placed at all (the empty state with the launchers). */
export function toolAreaShown(layout: SideLayout, ctx: SideViewContext): boolean {
  return layout.open && (columnsOnScreen(layout, ctx, null).length > 0 || !layout.pages.some((p) => p.cards.length > 0 || p.kept));
}

/** The pages on screen for this agent (each Shelf's page in view). Empty when the Shelves are hidden. */
export function shownPages(layout: SideLayout, ctx: SideViewContext): SidePage[] {
  return layout.open ? columnsOnScreen(layout, ctx, null).map((x) => x.page) : [];
}

/** The layout within the limits (§24 限额; the same object when it already is). */
export function fitLayout(layout: SideLayout): SideLayout {
  if (layout.pages.every((p) => p.cards.length <= MAX_CARDS) && shelvesConsistent(layout)) return layout;
  const d = draft(layout);
  fitLimits(d);
  return d;
}

/**
 * v1.16 → v1.17 (§24 迁移, no longer used since Shelves §24.12 keep the pages): the pages of an old side layout as ONE tool column. `keep` (the focused
 * agent's page in view; else the active page, else the first) stays; the other pages' cards follow in
 * page order — into a pane of their kind there, else as new panes while the column has room, else as
 * tabs of its bottom pane. Instances (params / state) are all kept; groups united; overrides re-pointed.
 */
export function foldPages(layout: SideLayout, keep: string | null): SideLayout {
  if (layout.pages.length <= 1) return fitLayout(layout);
  const d = draft(layout);
  const target = findPage(d, keep) ?? findPage(d, d.activePage) ?? d.pages.find((p) => p.cards.length) ?? d.pages[0]!;
  for (const other of d.pages) {
    if (other === target) continue;
    for (const card of other.cards) {
      const same = freshestCard(d, target.cards.filter((c) => cardHolds(d, c, card.kind)));
      if (same) {
        for (const id of card.tabs) same.tabs.push(id);
      } else if (target.cards.length < MAX_CARDS) {
        target.cards.push({ ...card, size: 1 / (target.cards.length + 1), collapsed: false });
        normalise(target.cards);
      } else {
        const bottom = target.cards[target.cards.length - 1]!;
        for (const id of card.tabs) bottom.tabs.push(id);
      }
    }
    target.groups = [...new Set([...target.groups, ...other.groups])];
  }
  for (const [kind, ov] of Object.entries(d.overrides)) if (ov.page !== target.id) d.overrides[kind] = { ...ov, page: target.id, groups: [...target.groups] };
  d.pages = [target];
  delete target.launcher;
  d.activePage = target.id;
  fitLimits(d);
  fixShelves(d, new Map());
  return d;
}

// ── Shelf reducers (§24.12: the Shelf Rail, the ⋯ menu, page buttons) ───────────────────────────────

/** ＋ in a Shelf Rail: a new empty page at the end of the rail (kept; named / with an icon when given), in view. Null at MAX_SHELF_PAGES. */
export function addShelfPage(input: SideLayout, shelfId: string, opts: { name?: string | null; icon?: PageIcon | null } = {}): { layout: SideLayout; pageId: string | null } {
  const layout = withShelves(input);
  if (!findShelf(layout, shelfId) || pagesOfShelf(layout, shelfId).length >= MAX_SHELF_PAGES) return { layout: input, pageId: null };
  const d = draft(layout);
  const page = newPage(d, [], shelfEnd(d, shelfId), shelfId);
  page.groups = [`${USER_GROUP}${page.id}`];
  page.kept = true;
  const name = opts.name?.trim().slice(0, 80);
  if (name) page.name = name;
  if (opts.icon) page.icon = opts.icon;
  d.open = true;
  setActivePage(d, page.id);
  return { layout: d, pageId: page.id };
}

/** A new Shelf on a free side with one empty page (kept), in view. Null when that side has a Shelf or `shelfLimit` are made. */
export function addShelf(input: SideLayout, side: ShelfSide): { layout: SideLayout; shelfId: string | null; pageId: string | null } {
  const layout = withShelves(input);
  if (shelfOnSide(layout, side) || !canAddShelf(layout)) return { layout: input, shelfId: null, pageId: null };
  const d = draft(layout);
  const shelf = makeShelf(d, side);
  const page = newPage(d, [], d.pages.length, shelf.id);
  page.groups = [`${USER_GROUP}${page.id}`];
  page.kept = true;
  d.open = true;
  setActivePage(d, page.id);
  return { layout: d, shelfId: shelf.id, pageId: page.id };
}

/** 换图标: the page's rail icon (null = its first pane's kind icon). */
export function setPageIcon(layout: SideLayout, pageId: string, icon: PageIcon | null): SideLayout {
  const page = findPage(layout, pageId);
  if (!page || (page.icon ?? null) === icon) return layout;
  const d = draft(layout);
  const p = findPage(d, pageId)!;
  if (icon) p.icon = icon;
  else delete p.icon;
  return d;
}

/** 在所有对话中显示 on / off (a page button's menu; §24.13): the page is shared by every conversation's Shelf, or this one's again. */
export function setPageShared(layout: SideLayout, pageId: string, shared: boolean): SideLayout {
  const page = findPage(layout, pageId);
  if (!page || !!page.shared === shared) return layout;
  const d = draft(layout);
  const p = findPage(d, pageId)!;
  if (shared) p.shared = true;
  else delete p.shared;
  return d;
}

function editShelf(input: SideLayout, shelfId: string, fn: (shelf: Shelf, d: SideLayout) => boolean): SideLayout {
  const layout = withShelves(input);
  if (!findShelf(layout, shelfId)) return input;
  const d = draft(layout);
  return fn(findShelfRaw(d, shelfId)!, d) ? d : input;
}

/** The ⋯ menu's 允许混排 / Shelf Rail 外侧·内侧. Panes that already mix kinds stay as they are. */
export function setShelfOptions(layout: SideLayout, shelfId: string, patch: Partial<ShelfOptions>): SideLayout {
  return editShelf(layout, shelfId, (shelf) => {
    const next = { ...shelf.options, ...patch };
    if (next.allowMixing === shelf.options.allowMixing && next.railPlacement === shelf.options.railPlacement) return false;
    shelf.options = next;
    return true;
  });
}

/**
 * 只用一个 Shelf on / off (the ⋯ menu, Settings → 右侧栏). Turning it on moves nothing: Shelves already
 * there stay (closing one leaves one); only no new one is made.
 */
export function setSingleShelf(layout: SideLayout, on: boolean): SideLayout {
  if ((layout.singleShelf === true) === on && layout.singleShelf !== undefined) return layout;
  return { ...layout, singleShelf: on };
}

/** A Shelf's own width (its width handle; null = back to appearance.sidePaneWidth). */
export function setShelfWidth(layout: SideLayout, shelfId: string, width: number | null): SideLayout {
  return editShelf(layout, shelfId, (shelf) => {
    const w = width === null ? undefined : Math.round(width);
    if (shelf.width === w) return false;
    if (w === undefined) delete shelf.width;
    else shelf.width = w;
    return true;
  });
}

/** 移到另一边: the Shelf moves to the other side of the conversations (unchanged while that side has one). */
export function moveShelfToOtherSide(layout: SideLayout, shelfId: string): SideLayout {
  return editShelf(layout, shelfId, (shelf, d) => {
    const to = otherSide(shelf.side);
    if (d.shelves!.some((x) => x.side === to)) return false;
    shelf.side = to;
    d.shelves!.sort((a, b) => SIDE_ORDER[a.side] - SIDE_ORDER[b.side]);
    return true;
  });
}

/**
 * 收起 (owner 2026-10-21; its ⋯ menu, its rail's collapse button, Esc in it, its page in view clicked): the
 * Shelf becomes its Shelf Rail only, a strip in place (its pages, panes and instances stay; the conversation
 * columns get the width). The focus moves to the other Shelf when that one is expanded.
 */
export function collapseShelf(layout: SideLayout, shelfId: string): SideLayout {
  return editShelf(layout, shelfId, (shelf, d) => {
    if (shelf.collapsed) return false;
    shelf.collapsed = true;
    if (findPage(d, d.activePage)?.shelf === shelf.id) {
      const other = d.shelves!.find((x) => x.id !== shelf.id && !x.collapsed);
      if (other) d.activePage = other.active;
    }
    return true;
  });
}

/**
 * A collapsed Shelf expands (its collapse button; a page button on its rail = `pageId`, that page in view):
 * the Shelves shown, the page focused.
 */
export function expandShelf(layout: SideLayout, shelfId: string, pageId: string | null = null): SideLayout {
  return editShelf(layout, shelfId, (shelf, d) => {
    const page = pageId ? findPage(d, pageId) : null;
    if (page && page.shelf !== shelf.id) return false;
    const show = page?.id ?? shelf.active;
    if (!shelf.collapsed && d.open && d.activePage === show && shelf.active === show) return false;
    d.open = true;
    if (show && findPage(d, show)) setActivePage(d, show);
    delete shelf.collapsed;
    return true;
  });
}

/**
 * A page button of a Shelf Rail clicked (owner 2026-10-21): on a collapsed Shelf it expands to that page; on an
 * expanded one another page comes into view. Its page in view: nothing (owner 2026-10-22: collapsing by clicking
 * it again was too easy to do by accident — the collapse button, ⋯ → 收起, the header's Shelf button and Esc do it).
 */
export function railPageClick(layout: SideLayout, pageId: string): SideLayout {
  const shelf = shelfOfPage(layout, pageId);
  if (!shelf) return layout;
  if (!shelf.collapsed && layout.open && shelf.active === pageId) return layout;
  return expandShelf(layout, shelf.id, pageId);
}

/** Collapsed ↔ expanded (the collapse button at the bottom of a Shelf Rail). */
export function toggleShelfCollapsed(layout: SideLayout, shelfId: string): SideLayout {
  const shelf = findShelf(layout, shelfId);
  if (!shelf) return layout;
  return shelf.collapsed ? expandShelf(layout, shelfId) : collapseShelf(layout, shelfId);
}

/** What 删除这一页 / 关闭 Shelf took away, for 撤销 (the instances' onClose waits until the undo is no longer offered). */
export interface RemovedShelfPart {
  shelf: Shelf;
  /** The pages with their places in `pages` then. */
  pages: { page: SidePage; index: number }[];
  instances: Record<string, SideInstance>;
  /** The whole Shelf went (关闭 Shelf, or its last page). */
  whole: boolean;
  /** The page in view of the Shelf then. */
  active: string | null;
  /** A removed page was the focused page. */
  focused: boolean;
}

function removeParts(input: SideLayout, shelfId: string, pageIds: readonly string[] | null): { layout: SideLayout; removed: RemovedShelfPart | null } {
  const layout = withShelves(input);
  const shelf = findShelf(layout, shelfId);
  if (!shelf) return { layout: input, removed: null };
  const own = pagesOfShelf(layout, shelfId);
  const gone = pageIds ? own.filter((p) => pageIds.includes(p.id)) : own;
  if (!gone.length) return { layout: input, removed: null };
  const whole = gone.length === own.length;
  const instances: Record<string, SideInstance> = {};
  for (const page of gone) for (const card of page.cards) for (const id of card.tabs) if (layout.instances[id]) instances[id] = layout.instances[id]!;
  const removed: RemovedShelfPart = {
    shelf: { ...shelf, options: { ...shelf.options } },
    pages: gone.map((page) => ({ page: { ...page, groups: [...page.groups], cards: page.cards.map((c) => ({ ...c, tabs: [...c.tabs] })) }, index: layout.pages.indexOf(page) })),
    instances,
    whole,
    active: shelf.active,
    focused: gone.some((p) => p.id === layout.activePage),
  };
  const d = draft(layout);
  const rails = new Map<string, string[]>([[shelfId, own.map((p) => p.id)]]);
  const ids = new Set(gone.map((p) => p.id));
  d.pages = d.pages.filter((p) => !ids.has(p.id));
  for (const id of Object.keys(instances)) delete d.instances[id];
  fixShelves(d, rails);
  if (!findPage(d, d.activePage)) d.activePage = findShelfRaw(d, shelfId)?.active ?? d.shelves?.find((x) => !x.collapsed)?.active ?? d.shelves?.[0]?.active ?? null;
  if (!d.pages.length) {
    d.activePage = null;
    d.open = false;
  }
  return { layout: d, removed };
}

/** 删除这一页 (a page button's menu): the page and its panes go (its Shelf's last page: the Shelf goes). Undo: `restoreRemoved`. */
export function removePage(layout: SideLayout, pageId: string): { layout: SideLayout; removed: RemovedShelfPart | null } {
  const shelf = shelfOfPage(layout, pageId);
  return shelf ? removeParts(layout, shelf.id, [pageId]) : { layout, removed: null };
}

/** 关闭 Shelf (its ⋯ menu): every page and pane of it goes. Undo: `restoreRemoved`. */
export function removeShelf(layout: SideLayout, shelfId: string): { layout: SideLayout; removed: RemovedShelfPart | null } {
  return removeParts(layout, shelfId, null);
}

/**
 * 撤销 of a removed page / Shelf: its pages, panes and instances come back where they were (the Shelf on its
 * side, else the free side, else into the Shelf on its side — beyond the sanity limit folded into the last page).
 */
export function restoreRemoved(input: SideLayout, removed: RemovedShelfPart): SideLayout {
  const d = draft(withShelves(input));
  let shelf = findShelfRaw(d, removed.shelf.id);
  if (!shelf) {
    const taken = (side: ShelfSide) => d.shelves!.some((x) => x.side === side);
    const side = d.shelves!.length >= shelfLimit(d) ? null : !taken(removed.shelf.side) ? removed.shelf.side : !taken(otherSide(removed.shelf.side)) && d.shelves!.length < shelfLimit(d) ? otherSide(removed.shelf.side) : null;
    if (side) {
      shelf = { ...removed.shelf, options: { ...removed.shelf.options }, side, active: null };
      delete shelf.collapsed;
      d.shelves = [...d.shelves!, shelf].sort((a, b) => SIDE_ORDER[a.side] - SIDE_ORDER[b.side]);
    } else shelf = d.shelves!.find((x) => x.side === removed.shelf.side) ?? d.shelves![0]!;
  }
  for (const [id, inst] of Object.entries(removed.instances)) if (!d.instances[id]) d.instances[id] = inst;
  for (const { page, index } of removed.pages) {
    if (findPage(d, page.id)) continue;
    const copy: SidePage = { ...page, groups: [...page.groups], cards: page.cards.map((c) => ({ ...c, tabs: c.tabs.filter((t) => d.instances[t]) })).filter((c) => c.tabs.length), shelf: shelf.id };
    d.pages.splice(Math.min(index, d.pages.length), 0, copy);
  }
  const back = removed.pages.map((x) => x.page.id);
  const show = (removed.active && back.includes(removed.active) ? removed.active : null) ?? back[0] ?? null;
  d.open = true;
  if (show && findPage(d, show)) {
    shelf.active = show;
    delete shelf.collapsed;
    if (removed.focused || removed.whole) d.activePage = show;
  }
  cleanup(d);
  return d;
}

// ── Heights (§18.4) ───────────────────────────────────────────────────────────────────────────

export interface CardBox {
  /** Header only (collapsed by the user or folded for lack of room). */
  folded: boolean;
  height: number;
}

/**
 * Pixel heights of a page's visible cards in `total` px (gaps of CARD_GAP between them). One card
 * takes everything (no collapse). Collapsed cards get the header; the expanded ones share the rest
 * by their sizes, each at least its min height (a card whose share is under its min gets its min, the
 * room taken from the others by their sizes). A card folds for lack of room only when the expanded
 * cards' minimums do not fit; then the bottom ones fold first (owner 2026-10-27, fix/shelf-collapse-again:
 * a share under the min used to fold the card although the page had room — a gap dragged to its limit
 * folded the pane at once, a shorter window folded a pane that had 200 px).
 */
export function cardHeights(cards: readonly { size: number; collapsed: boolean; minHeight?: number }[], total: number, gap = CARD_GAP): CardBox[] {
  const n = cards.length;
  if (!n) return [];
  if (n === 1) return [{ folded: false, height: Math.max(0, total) }];
  const room = Math.max(0, total - gap * (n - 1));
  const folded = cards.map((c) => c.collapsed);
  if (folded.every(Boolean)) folded[0] = false; // keep one open: the page would be all headers
  const minOf = (k: number) => cards[k]!.minHeight ?? MIN_CARD_HEIGHT;
  for (;;) {
    const open = cards.map((_, k) => k).filter((k) => !folded[k]);
    const left = room - CARD_HEADER * (n - open.length);
    // Half a pixel of slack: shares stored at a min (a gap dragged to its limit) come back a hair under it.
    if (open.length > 1 && open.reduce((a, k) => a + minOf(k), 0) > left + 0.5) {
      folded[open[open.length - 1]!] = true; // the bottom expanded card folds first
      continue;
    }
    const heights = new Map<number, number>();
    if (open.length <= 1) for (const k of open) heights.set(k, Math.max(CARD_HEADER, left));
    else {
      // Shares of what is left; a card under its min is held at its min and the others share the rest, until none is under.
      const held = new Set<number>();
      for (;;) {
        const free = open.filter((k) => !held.has(k));
        const rest = left - [...held].reduce((a, k) => a + minOf(k), 0);
        const sum = free.reduce((a, k) => a + Math.max(cards[k]!.size, 0.0001), 0);
        const under = free.filter((k) => (rest * Math.max(cards[k]!.size, 0.0001)) / sum < minOf(k));
        if (!under.length || under.length === free.length) {
          for (const k of held) heights.set(k, minOf(k));
          for (const k of free) heights.set(k, (Math.max(0, rest) * Math.max(cards[k]!.size, 0.0001)) / sum);
          break;
        }
        for (const k of under) held.add(k);
      }
    }
    return cards.map((_, k) => (folded[k] ? { folded: true, height: CARD_HEADER } : { folded: false, height: heights.get(k)! }));
  }
}

/** Shares after dragging the gap between cards a and b (indices into `sizes`) by `dy` px of `room` px. */
export function dragGap(sizes: readonly number[], a: number, b: number, dy: number, room: number, minShare: number): number[] {
  const out = [...sizes];
  const total = out[a]! + out[b]!;
  const delta = room > 0 ? dy / room : 0;
  const na = Math.min(total - minShare, Math.max(minShare, out[a]! + delta));
  out[a] = na;
  out[b] = total - na;
  return out;
}

/**
 * Stored sizes that open folded card `f` (collapsed, or folded for lack of room by cardHeights) at `want` px, the
 * room taken from the open card `donor`; the other open cards keep their heights. `want` is clamped to [f's min,
 * what the donor can give down to its min]; null when that is not even f's min (the page is too short) or nothing
 * is measured yet. Pass f's and every open card's result to setCardSizes (and clear f's collapsed).
 */
export function unfoldSizes(cards: readonly { size: number }[], boxes: readonly CardBox[], f: number, donor: number, want: number, mins: { f: number; donor: number }): number[] | null {
  const open = boxes.map((_, k) => k).filter((k) => !boxes[k]!.folded);
  if (!boxes[f]?.folded || !open.includes(donor)) return null;
  const sum = open.reduce((a, k) => a + Math.max(cards[k]!.size, 0.0001), 0);
  const px = open.reduce((a, k) => a + boxes[k]!.height, 0);
  if (px <= 0 || sum <= 0) return null;
  // +1 px: cardHeights compares against the min with floats; a share exactly at the min could fold again.
  const room = boxes[donor]!.height + boxes[f]!.height - (mins.donor + 1);
  const h = Math.min(Math.max(want, mins.f + 1), room);
  if (h < mins.f + 1) return null;
  const unit = sum / px;
  // The open cards' shares as drawn (one held at its min by cardHeights is drawn taller than its share).
  const out = cards.map((c, k) => (open.includes(k) ? boxes[k]!.height * unit : c.size));
  out[f] = h * unit;
  out[donor] = (boxes[donor]!.height + boxes[f]!.height - h) * unit;
  return out;
}

// ── Geometry (§18.3 widths, narrow windows) ─────────────────────────────────────────────────────

/** What the conversations and the tool area each need at least (step 4 minSize: every column ≥ its minimum width). */
export interface FrameMins {
  conversation: number;
  side: number;
}

const DEFAULT_MINS: FrameMins = { conversation: MIN_CONVERSATION, side: MIN_SIDE };

/** The work area (conversation card + right side) cannot hold both minimums: the side becomes a drawer. */
export function isNarrow(workAreaWidth: number, mins: FrameMins = DEFAULT_MINS): boolean {
  return workAreaWidth < mins.conversation + mins.side;
}

/** Width of the open right side (its 8 px seam included) for the stored width in a work area of `room` px. */
export function sideWidth(stored: number, room: number, narrow: boolean, mins: FrameMins = DEFAULT_MINS): number {
  if (narrow) return Math.max(0, Math.min(stored, room - DRAWER_MARGIN));
  return Math.round(Math.max(mins.side, Math.min(stored, room - mins.conversation - CARD_GAP)));
}


/** A collapsed Shelf's box in the row (§24.12, owner 2026-10-21): its rail and the 8 px seam to the conversations. */
export const COLLAPSED_SHELF_WIDTH = RAIL_WIDTH + CARD_GAP;

export interface ShelfRowInput {
  /** The work area's width (0 = not measured yet). */
  areaWidth: number;
  /** The left Shelf: expanded (`width`: its width with its rail), collapsed, or none. */
  left: { collapsed: false; width: number } | { collapsed: true } | null;
  /** The right Shelf: expanded (it goes through lib/sideFrame), collapsed, or none. */
  right: "expanded" | "collapsed" | null;
  /** The conversations' minimum width together. */
  conversationMin: number;
  /** A tool page / pane is maximised or full screen (the left Shelf is not in the row then). */
  layered: boolean;
  /** The expanded left Shelf was off the row for lack of room: it comes back with lib/foldHysteresis's slack. */
  leftWasOut?: boolean;
}

export interface ShelfRow {
  /** The expanded left Shelf stays in the row (else it leaves the screen until the window is wide enough). */
  leftFits: boolean;
  /** Width the left Shelf takes from the row (expanded: width + seam; collapsed: COLLAPSED_SHELF_WIDTH). */
  leftTaken: number;
  /** Width a collapsed right Shelf takes from the row. */
  rightRail: number;
  /** What the conversations and the expanded right Shelf share (lib/sideFrame's areaWidth). */
  rightRoom: number;
}

/**
 * The work area's row (§24.12): [left Shelf][conversations][right Shelf]. A collapsed Shelf is its rail only,
 * the conversations get the rest; an expanded left Shelf stays while the conversations keep their minimum
 * beside it (and beside the right Shelf's). Pure; tested.
 */
export function shelfRow(i: ShelfRowInput): ShelfRow {
  const rightRail = i.right === "collapsed" ? COLLAPSED_SHELF_WIDTH : 0;
  const left = i.left;
  const need = i.conversationMin + (i.right === "expanded" ? MIN_SIDE : 0);
  const short = (slack: number) => !!left && !left.collapsed && i.areaWidth - left.width - CARD_GAP - rightRail < need + slack;
  const leftFits = !!left && !left.collapsed && !i.layered && (i.areaWidth === 0 || !foldHeld(short, !!i.leftWasOut));
  const leftTaken = left && !left.collapsed ? (leftFits ? left.width + CARD_GAP : 0) : left && !i.layered ? COLLAPSED_SHELF_WIDTH : 0;
  return { leftFits, leftTaken, rightRail, rightRoom: Math.max(0, i.areaWidth - leftTaken - rightRail) };
}
/**
 * The minimums of `conversations` conversation columns (`conversationW` px each) and `tools` tool columns
 * (`toolW` px each) — step 4 minSize: two conversations beside two tool columns no longer squeeze each other
 * below them; the tool area becomes the drawer first. One of each: today's MIN_CONVERSATION / MIN_SIDE.
 */
export function frameMins(conversations: number, tools: number, conversationW: number, toolW: number): FrameMins {
  return {
    conversation: conversations <= 1 ? MIN_CONVERSATION : conversations * conversationW,
    side: tools <= 1 ? MIN_SIDE : tools * toolW + (tools - 1) * CARD_GAP + CARD_GAP,
  };
}

// ── Names ─────────────────────────────────────────────────────────────────────────────────────

/** A page's name: the user's, else the first two card names + "+n" (distinct names). */
export function pageName(page: SidePage, cardName: (card: SideCard) => string, launcherName: string): string {
  if (page.name) return page.name;
  if (!page.cards.length) return launcherName;
  const names: string[] = [];
  for (const card of page.cards) {
    const name = cardName(card);
    if (name && !names.includes(name)) names.push(name);
  }
  return names.slice(0, 2).join(" · ") + (names.length > 2 ? ` +${names.length - 2}` : "");
}

// ── Persistence (§18.11) ──────────────────────────────────────────────────────────────────────

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const ITEM_ID = /^[^\s.]+\.[^\s]+$/;

/** `layoutHost`: the layout's host — a v1.4 `follow` without a host is that host's (one-way, v1.5). */
function parseBinding(raw: unknown, layoutHost: string): SideBinding | null {
  if (!isRecord(raw)) return null;
  const str = (v: unknown) => (typeof v === "string" && v.length > 0 && v.length <= 400 ? v : null);
  switch (raw.kind) {
    case "follow":
      return { kind: "follow", hostId: str(raw.hostId) ?? layoutHost };
    case "agent": {
      const hostId = str(raw.hostId);
      const sessionId = str(raw.sessionId);
      return hostId && sessionId ? { kind: "agent", hostId, sessionId } : null;
    }
    case "workspace": {
      const hostId = str(raw.hostId);
      const key = str(raw.key);
      return hostId && key ? { kind: "workspace", hostId, key } : null;
    }
    case "host": {
      const hostId = str(raw.hostId);
      return hostId ? { kind: "host", hostId } : null;
    }
    default:
      return null;
  }
}

function isJson(v: unknown, depth = 0): v is Json {
  if (depth > 20) return false;
  if (v === null || typeof v === "string" || typeof v === "boolean") return true;
  if (typeof v === "number") return Number.isFinite(v);
  if (Array.isArray(v)) return v.every((x) => isJson(x, depth + 1));
  if (isRecord(v)) return Object.values(v).every((x) => isJson(x, depth + 1));
  return false;
}

/**
 * Untrusted stored JSON → a valid layout (bad parts dropped, never throws). `hostId`: the layout's host
 * (§18.11 key). `legacy`: a v1.16 side layout (up to 9 pages, kept as they are for `foldPages`);
 * otherwise more than MAX_PAGES columns fold into the active one and the limits are applied.
 */
export function sanitizeLayout(raw: unknown, hostId = "local", opts: { legacy?: boolean } = {}): SideLayout {
  const out = emptyLayout();
  if (!isRecord(raw)) return out;
  const seen = new Set<string>();
  let maxSeq = typeof raw.seq === "number" && Number.isFinite(raw.seq) ? Math.max(0, Math.floor(raw.seq)) : 0;
  const bump = (id: string) => {
    const n = Number(id.slice(1));
    if (Number.isFinite(n)) maxSeq = Math.max(maxSeq, n);
  };
  if (isRecord(raw.instances)) {
    for (const [id, v] of Object.entries(raw.instances)) {
      if (!/^i\d+$/.test(id) || !isRecord(v) || typeof v.kind !== "string" || !ITEM_ID.test(v.kind)) continue;
      const binding = parseBinding(v.binding, hostId);
      if (!binding) continue;
      out.instances[id] = {
        kind: v.kind as ItemId,
        binding,
        key: typeof v.key === "string" ? v.key.slice(0, 2000) : null,
        state: isJson(v.state) ? v.state : null,
        v: typeof v.v === "number" && Number.isFinite(v.v) ? v.v : 1,
        pinned: v.pinned === true,
        lastActiveAt: typeof v.lastActiveAt === "number" && Number.isFinite(v.lastActiveAt) ? v.lastActiveAt : 0,
      };
      bump(id);
    }
  }
  if (Array.isArray(raw.pages)) {
    for (const p of raw.pages) {
      if (!isRecord(p) || typeof p.id !== "string" || !/^p\d+$/.test(p.id) || seen.has(p.id) || out.pages.length >= MAX_PAGES) continue;
      seen.add(p.id);
      bump(p.id);
      const page: SidePage = { id: p.id, groups: Array.isArray(p.groups) ? [...new Set(p.groups.filter((g): g is string => typeof g === "string" && g.length > 0 && g.length <= 100))] : [], cards: [] };
      if (typeof p.name === "string" && p.name.trim()) page.name = p.name.trim().slice(0, 80);
      if (typeof p.shelf === "string" && /^s\d+$/.test(p.shelf)) page.shelf = p.shelf;
      if (typeof p.icon === "string" && (PAGE_ICONS as readonly string[]).includes(p.icon)) page.icon = p.icon as PageIcon;
      if (p.kept === true) page.kept = true;
      if (p.shared === true) page.shared = true;
      if (Array.isArray(p.cards)) {
        for (const c of p.cards) {
          if (!isRecord(c) || typeof c.id !== "string" || !/^c\d+$/.test(c.id) || seen.has(c.id) || typeof c.kind !== "string" || !Array.isArray(c.tabs)) continue;
          const tabs: string[] = [];
          for (const t of c.tabs) {
            // A pane's tabs are of its kind, or (a full column's bottom pane, §24) of any kind.
            if (typeof t !== "string" || seen.has(t) || !out.instances[t]) continue;
            seen.add(t);
            tabs.push(t);
          }
          if (!tabs.length) continue;
          seen.add(c.id);
          bump(c.id);
          page.cards.push({
            id: c.id,
            kind: c.kind as ItemId,
            tabs,
            active: typeof c.active === "string" && tabs.includes(c.active) ? c.active : tabs[0]!,
            size: typeof c.size === "number" && Number.isFinite(c.size) && c.size > 0 ? c.size : 1,
            collapsed: c.collapsed === true,
          });
        }
      }
      normalise(page.cards);
      if (page.cards.length || page.kept) out.pages.push(page);
    }
  }
  // Shelves (§24.12): one per side; a page naming an unknown Shelf joins the right one (fixShelves).
  if (Array.isArray(raw.shelves)) {
    for (const x of raw.shelves) {
      if (!isRecord(x) || typeof x.id !== "string" || !/^s\d+$/.test(x.id) || (x.side !== "left" && x.side !== "right")) continue;
      if (out.shelves!.some((o) => o.id === x.id || o.side === x.side)) continue;
      bump(x.id);
      const o = isRecord(x.options) ? x.options : {};
      const shelf: Shelf = {
        id: x.id,
        side: x.side,
        active: typeof x.active === "string" ? x.active : null,
        options: { allowMixing: o.allowMixing === true, railPlacement: o.railPlacement === "inner" ? "inner" : "outer" },
      };
      if (typeof x.width === "number" && Number.isFinite(x.width) && x.width >= 160 && x.width <= 4000) shelf.width = Math.round(x.width);
      // `chip` (file v3: the whole Shelf in the tray) reads as collapsed to its rail.
      if (x.collapsed === true || (typeof x.chip === "number" && Number.isFinite(x.chip))) shelf.collapsed = true;
      out.shelves!.push(shelf);
    }
  }
  // Chips (step 4): collapsed cards with their way back.
  if (Array.isArray(raw.chips)) {
    const ref = (v: unknown) => (typeof v === "string" && /^c\d+$/.test(v) ? v : null);
    for (const c of raw.chips) {
      if ((out.chips?.length ?? 0) >= MAX_STORED_CHIPS) break;
      if (!isRecord(c) || !isRecord(c.card) || !isRecord(c.page)) continue;
      const card = c.card;
      const pg = c.page;
      if (typeof card.id !== "string" || !/^c\d+$/.test(card.id) || seen.has(card.id) || typeof card.kind !== "string" || !Array.isArray(card.tabs)) continue;
      if (typeof pg.id !== "string" || !/^p\d+$/.test(pg.id)) continue;
      const tabs: string[] = [];
      for (const t of card.tabs) {
        if (typeof t !== "string" || seen.has(t) || !out.instances[t]) continue;
        seen.add(t);
        tabs.push(t);
      }
      if (!tabs.length) continue;
      seen.add(card.id);
      bump(card.id);
      bump(pg.id);
      const groups = Array.isArray(pg.groups) ? [...new Set(pg.groups.filter((g): g is string => typeof g === "string" && g.length > 0 && g.length <= 100))] : [];
      const index = typeof pg.index === "number" && Number.isInteger(pg.index) && pg.index >= 0 ? Math.min(pg.index, LEGACY_MAX_PAGES) : 0;
      (out.chips ??= []).push({
        card: { id: card.id, kind: card.kind as ItemId, tabs, active: typeof card.active === "string" && tabs.includes(card.active) ? card.active : tabs[0]!, size: 1, collapsed: false },
        page: { id: pg.id, groups, ...(typeof pg.name === "string" && pg.name.trim() ? { name: pg.name.trim().slice(0, 80) } : {}), index, ...(typeof pg.shelf === "string" && /^s\d+$/.test(pg.shelf) ? { shelf: pg.shelf } : {}), ...(pg.side === "left" || pg.side === "right" ? { side: pg.side } : {}) },
        above: ref(c.above),
        below: ref(c.below),
        at: typeof c.at === "number" && Number.isFinite(c.at) ? c.at : 0,
      });
    }
  }
  // instances without a card are dropped
  for (const id of Object.keys(out.instances)) if (!seen.has(id)) delete out.instances[id];
  if (isRecord(raw.overrides)) {
    for (const [kind, v] of Object.entries(raw.overrides)) {
      if (!ITEM_ID.test(kind) || !isRecord(v) || typeof v.page !== "string" || !Array.isArray(v.groups)) continue;
      out.overrides[kind] = { page: v.page, groups: v.groups.filter((g): g is string => typeof g === "string"), at: typeof v.at === "number" ? v.at : 0 };
    }
  }
  out.activePage = typeof raw.activePage === "string" && findPage(out, raw.activePage) ? raw.activePage : out.pages[0]?.id ?? null;
  out.open = raw.open === true && out.pages.length > 0;
  out.seq = maxSeq;
  if (typeof raw.singleShelf === "boolean") out.singleShelf = raw.singleShelf;
  if (opts.legacy) return out;
  // Shelves made consistent (an older layout: its pages become the right Shelf's, mixing off), limits kept.
  const d = draft(out);
  fitLimits(d);
  const rails = new Map<string, string[]>();
  fixShelves(d, rails);
  if (!findPage(d, d.activePage)) d.activePage = d.shelves?.find((x) => x.side === "right")?.active ?? d.shelves?.[0]?.active ?? null;
  else if (findShelfRaw(d, findPage(d, d.activePage)!.shelf)?.active !== d.activePage) d.activePage = findShelfRaw(d, findPage(d, d.activePage)!.shelf)?.active ?? d.activePage;
  return d;
}

export interface SaveOptions {
  /** false: the component's instances live in memory only (persist: false). */
  persist(kind: ItemId): boolean;
  /** Visible now (the LRU cut drops invisible ones first). */
  visible?(instanceId: string): boolean;
}

/** Serialized size of a state, in UTF-16 code units (close enough to bytes for the 4 KiB limit). */
export function stateSize(state: Json): number {
  try {
    return JSON.stringify(state)?.length ?? 0;
  } catch {
    return Infinity;
  }
}

/**
 * The layout as stored: without in-memory instances (persist: false, state over STATE_LIMIT), the
 * cards / pages they leave empty, the oldest invisible instances beyond MAX_INSTANCES and the
 * oldest overrides beyond MAX_OVERRIDES. An empty page (launcher) is never stored.
 */
export function prepareForSave(layout: SideLayout, opts: SaveOptions): SideLayout {
  const drop = new Set<string>();
  for (const [id, inst] of Object.entries(layout.instances)) {
    if (!opts.persist(inst.kind) || stateSize(inst.state) > STATE_LIMIT) drop.add(id);
  }
  const kept = Object.keys(layout.instances).filter((id) => !drop.has(id));
  if (kept.length > MAX_INSTANCES) {
    const order = [...kept].sort((a, b) => {
      const va = opts.visible?.(a) ? 1 : 0;
      const vb = opts.visible?.(b) ? 1 : 0;
      return va - vb || layout.instances[a]!.lastActiveAt - layout.instances[b]!.lastActiveAt;
    });
    for (const id of order.slice(0, kept.length - MAX_INSTANCES)) drop.add(id);
  }
  const d = draft(layout);
  for (const id of drop) {
    detach(d, id);
    delete d.instances[id];
  }
  for (const page of d.pages) {
    page.cards = page.cards.filter((c) => c.tabs.length > 0);
    for (const c of page.cards) {
      if (!c.active || !c.tabs.includes(c.active)) c.active = c.tabs[0] ?? null;
      rehome(d, c);
    }
    normalise(page.cards);
  }
  const rails = new Map<string, string[]>();
  for (const p of d.pages) if (p.shelf) rails.set(p.shelf, [...(rails.get(p.shelf) ?? []), p.id]);
  d.pages = d.pages.filter((p) => p.cards.length > 0 || p.kept);
  if (d.chips) {
    d.chips = d.chips.filter((c) => c.card.tabs.length > 0);
    for (const c of d.chips) {
      if (!c.card.active || !c.card.tabs.includes(c.card.active)) c.card.active = c.card.tabs[0] ?? null;
      rehome(d, c.card);
    }
    if (!d.chips.length) delete d.chips;
  }
  fixShelves(d, rails);
  if (!findPage(d, d.activePage)) d.activePage = d.shelves?.[0]?.active ?? d.pages[0]?.id ?? null;
  if (!d.pages.length) d.open = false;
  const keys = Object.keys(d.overrides);
  if (keys.length > MAX_OVERRIDES) {
    for (const k of keys.sort((a, b) => d.overrides[a]!.at - d.overrides[b]!.at).slice(0, keys.length - MAX_OVERRIDES)) delete d.overrides[k];
  }
  return d;
}

/**
 * Restores stored instances through their components (§18.11): `restore` returns the state, or
 * null to drop the tab; "keep" = unknown / not registered yet (stays dormant, untouched).
 */
export function restoreInstances(layout: SideLayout, restore: (inst: SideInstance, id: string) => { state: Json; v: number } | null | "keep"): SideLayout {
  const drop: string[] = [];
  const instances = { ...layout.instances };
  let changed = false;
  for (const [id, inst] of Object.entries(layout.instances)) {
    const result = restore(inst, id);
    if (result === "keep") continue;
    changed = true;
    if (result === null) drop.push(id);
    else instances[id] = { ...inst, state: result.state, v: result.v };
  }
  if (!changed) return layout;
  return closeInstances({ ...layout, instances }, drop);
}

/** Drops instances bound to agents that no longer exist (deleted; archived agents stay). */
export function dropDeletedAgents(layout: SideLayout, hostId: string, exists: (sessionId: string) => boolean): SideLayout {
  const gone = Object.entries(layout.instances)
    .filter(([, inst]) => inst.binding.kind === "agent" && inst.binding.hostId === hostId && !exists(inst.binding.sessionId))
    .map(([id]) => id);
  return closeInstances(layout, gone);
}

// ── Step-3 backup → pages again (§24.12 迁移) ─────────────────────────────────────────────────────────

/**
 * The v1.16 right side's pages (the step-3 backup, `cutex-desktop.side.v1-backup`, sanitised with
 * `{ legacy: true }`) back as pages of the right Shelf of `current` (the folded tool area): each old page
 * again, in its old order, with its name and groups, its panes as they were (kind, tab order, active tab,
 * height, folded), holding the instances that are still there (same id, kind, dedupe key and binding —
 * moved out of the folded column). The column the fold kept stays where the old page was. Instances the
 * owner closed since are not brought back; when NONE of the backup's instances is in `current` (the scope
 * was never folded from it) every old page comes back whole with its instances (new ids). Pages beyond 9
 * fold into the last page; the right Shelf keeps its options (one made here: mixing off, like every new Shelf). Pure.
 */
export function restoreLegacyPages(current: SideLayout, legacy: SideLayout): SideLayout {
  const legacyPages = legacy.pages.filter((p) => p.cards.length);
  if (!legacyPages.length) return current;
  const d = draft(withShelves(current));
  const same = (id: string): boolean => {
    const a = d.instances[id];
    const b = legacy.instances[id];
    return !!a && !!b && a.kind === b.kind && a.key === b.key && sameBinding(a.binding, b.binding);
  };
  const legacyIds = legacyPages.flatMap((p) => p.cards.flatMap((c) => c.tabs));
  const matched = legacyIds.filter(same);
  const fresh = matched.length === 0;
  let shelf = d.shelves!.find((x) => x.side === "right") ?? null;
  if (!shelf) shelf = d.shelves!.length < shelfLimit(d) ? makeShelf(d, "right") : d.shelves![0]!;
  const restored: SidePage[] = [];
  for (const old of legacyPages) {
    const base = findPage(d, old.id);
    const page: SidePage = base ?? { id: old.id, groups: [], cards: [], shelf: shelf.id };
    if (!base) {
      const n = Number(page.id.slice(1));
      if (Number.isFinite(n)) d.seq = Math.max(d.seq, n);
    }
    page.groups = [...new Set([...page.groups, ...old.groups])];
    if (old.name && !page.name) page.name = old.name;
    const cards: SideCard[] = [];
    for (const card of old.cards) {
      const tabs: string[] = [];
      let active = card.active;
      for (const id of card.tabs) {
        if (fresh) {
          const inst = legacy.instances[id];
          if (!inst) continue;
          const nid = nextId(d, "i");
          d.instances[nid] = { ...inst };
          tabs.push(nid);
          if (card.active === id) active = nid;
        } else if (same(id)) {
          detach(d, id);
          tabs.push(id);
        }
      }
      if (!tabs.length) continue;
      const taken = d.pages.some((p) => p.cards.some((c) => c.id === card.id)) || cards.some((c) => c.id === card.id);
      cards.push({ id: taken || fresh ? nextId(d, "c") : card.id, kind: card.kind, tabs, active: active && tabs.includes(active) ? active : tabs[0]!, size: card.size, collapsed: card.collapsed });
    }
    if (base) {
      // The kept column: its own panes back first, then what is left of the fold (other pages' leftovers).
      base.cards = [...cards, ...base.cards.filter((c) => c.tabs.length > 0)];
    } else if (cards.length) {
      page.cards = cards;
    } else continue;
    normalise(page.cards);
    restored.push(page);
  }
  // The rail: the old pages in their old order, then the Shelf's other pages as they were.
  const ids = new Set(restored.map((p) => p.id));
  const others = d.pages.filter((p) => !ids.has(p.id));
  const rest = others.filter((p) => p.shelf === shelf!.id);
  const elsewhere = others.filter((p) => p.shelf !== shelf!.id);
  for (const p of restored) p.shelf = shelf.id;
  d.pages = [...elsewhere, ...restored, ...rest];
  // The old overrides point at their old pages again (where those pages are back).
  for (const [kind, ov] of Object.entries(legacy.overrides)) if (ids.has(ov.page)) d.overrides[kind] = { ...ov };
  if (!findPage(d, shelf.active)) shelf.active = restored[0]?.id ?? null;
  if (!findPage(d, d.activePage)) d.activePage = shelf.active;
  cleanup(d);
  return d;
}
