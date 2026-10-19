// The tool panes' layout model (docs/desktop-modules.md §24, superseding §18's pages; RFC
// right-panel-rfc-20261009 §3–§5): the right-most columns of the window's pane layout. A "page" is now
// a tool COLUMN (all of them on screen side by side, no page switcher), a "card" a PANE of that column
// (≤ 3 rows, then tabs), a tab an instance. The pure `place()` decides where an opened component goes
// (tools go into the right-most column, split down to 3 rows, then tabs of its bottom pane), and the
// reducers the shell runs on user actions. One layout per view scope for every agent (§18.5's
// per-agent views are gone, owner 2026-10-20): what a pane shows follows the bindings. No React, no
// store, no feature names: every function takes a layout and returns a new one (the input is never
// mutated), so tests build layouts as JSON. lib/paneLayout.ts stores it inside the pane layout JSON.
import type { SideBinding, SidePageCandidate, SidePlacement } from "../modules/slots";
import type { ItemId, Json } from "../modules/types";
import { MAX_ROWS, MAX_TOOL_COLUMNS, MAX_TOOL_PANES } from "./paneLayout";

/** Tool columns (former pages; §24 限额). */
export const MAX_PAGES = MAX_TOOL_COLUMNS;
/** Panes (former cards) per tool column; more → tabs of the bottom pane. */
export const MAX_CARDS = MAX_ROWS;
/** Pages a stored v1.16 side layout may have had (read once, folded into one column by `foldPages`). */
export const LEGACY_MAX_PAGES = 9;
/** The dedupe key of a singleton component (one instance per binding). */
export const SINGLETON_KEY = "∅";
export const CARD_HEADER = 36;
export const CARD_GAP = 8;
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
  return { open: false, activePage: null, pages: [], instances: {}, overrides: {}, seq: 0 };
}

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

/** Cards (tool panes) in the whole layout (a card emptied mid-reducer does not count). */
export const cardCount = (layout: SideLayout): number => layout.pages.reduce((n, p) => n + filled(p.cards), 0);

/** A new card fits on `page`: fewer than 3 in the column and fewer than MAX_TOOL_PANES tool panes in all (§24 限额). */
export function roomForCard(layout: SideLayout, page: SidePage): boolean {
  return filled(page.cards) < MAX_CARDS && cardCount(layout) < MAX_TOOL_PANES;
}

/** The right-most tool column (tools go there, §24), or null without columns. */
export function rightmostPage(layout: SideLayout): SidePage | null {
  return layout.pages[layout.pages.length - 1] ?? null;
}

// ── place() (§18.6) ─────────────────────────────────────────────────────────────────────────

export interface SidePlaceRequest {
  kind: ItemId;
  binding: SideBinding;
  key: string | null; // dedupe key (singleton → SINGLETON_KEY)
  transient: boolean;
  page?: string; // explicit target (opts.page)
  activePage: string | null;
  columnOpen: boolean;
}

export type SidePlaceDecision =
  | { op: "activate"; instance: string }
  | { op: "replace"; instance: string }
  | {
      op: "insert";
      page: { id: string } | { new: { groups: string[]; index: number } };
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
export function place(layout: SideLayout, req: SidePlaceRequest, spec: PlaceSpec, orderOf: (kind: ItemId) => number = () => DEFAULT_ORDER): SidePlaceDecision {
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
  // 3. the page
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
      // §24: no new column for a kind of its own any more — the focused column ("active-page") or the
      // right-most one; a new column only when there is none yet.
      via = "otherwise";
      const active = req.columnOpen ? findPage(layout, req.activePage) : null;
      const target = (spec.otherwise === "active-page" ? active : null) ?? rightmostPage(layout);
      pick = target ? { id: target.id } : { new: [spec.home] };
    }
  }
  if ("new" in pick && layout.pages.length >= MAX_PAGES) {
    const fallback = rightmostPage(layout)!;
    pick = { id: fallback.id };
    via = "limit";
  }
  if ("new" in pick) {
    return { op: "insert", page: { new: { groups: pick.new, index: layout.pages.length } }, card: { new: { index: 0, share: spec.share } }, via };
  }
  const page = findPage(layout, pick.id)!;
  // 4. the pane: an existing pane of this kind (the freshest of several) gets a new tab
  const same = freshestCard(layout, page.cards.filter((c) => cardHolds(layout, c, req.kind)));
  if (same) return { op: "insert", page: { id: page.id }, card: { id: same.id }, via };
  if (roomForCard(layout, page)) {
    return { op: "insert", page: { id: page.id }, card: { new: { index: newCardIndex(page.cards, spec.order, orderOf), share: spec.share } }, via };
  }
  // 5. a full column (3 panes, or MAX_TOOL_PANES in all): another column's pane of this kind; else a new
  // pane in another column with room; else a tab of this column's bottom pane (§24: then tabs).
  for (const other of layout.pages) {
    if (other === page) continue;
    const otherSame = freshestCard(layout, other.cards.filter((c) => cardHolds(layout, c, req.kind)));
    if (otherSame) return { op: "insert", page: { id: other.id }, card: { id: otherSame.id }, via: "limit" };
  }
  for (const other of layout.pages) {
    if (other !== page && roomForCard(layout, other)) {
      return { op: "insert", page: { id: other.id }, card: { new: { index: newCardIndex(other.cards, spec.order, orderOf), share: spec.share } }, via: "limit" };
    }
  }
  return { op: "insert", page: { id: page.id }, card: { id: page.cards[page.cards.length - 1]!.id }, via: "limit" };
}

// ── Mutation helpers (on a draft copy) ────────────────────────────────────────────────────────

/** A copy whose pages / cards / tab arrays / maps can be changed in place (instances are replaced, never edited). */
function draft(layout: SideLayout): SideLayout {
  return {
    ...layout,
    pages: layout.pages.map((p) => ({ ...p, groups: [...p.groups], cards: p.cards.map((c) => ({ ...c, tabs: [...c.tabs] })) })),
    instances: { ...layout.instances },
    overrides: { ...layout.overrides },
  };
}

function nextId(d: SideLayout, prefix: "p" | "c" | "i"): string {
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

function newPage(d: SideLayout, groups: string[], index = d.pages.length): SidePage {
  const page: SidePage = { id: nextId(d, "p"), groups: [...new Set(groups)], cards: [] };
  d.pages.splice(Math.max(0, Math.min(index, d.pages.length)), 0, page);
  return page;
}

/** Removes an instance from its card (the instance record stays). */
function detach(d: SideLayout, id: string): void {
  for (const page of d.pages) {
    for (const card of page.cards) {
      const k = card.tabs.indexOf(id);
      if (k < 0) continue;
      card.tabs.splice(k, 1);
      if (card.active === id) card.active = card.tabs[Math.min(k, card.tabs.length - 1)] ?? null;
      return;
    }
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
 * The limits (§24 限额): a column with more than 3 panes merges its bottom ones into the third (tabs);
 * more than MAX_TOOL_PANES panes in all → the right-most column with ≥ 2 panes merges its bottom pane up.
 */
function fitLimits(d: SideLayout): void {
  for (const page of d.pages) {
    while (page.cards.length > MAX_CARDS) mergeCardInto(page, page.cards[page.cards.length - 1]!, page.cards[page.cards.length - 2]!);
  }
  while (cardCount(d) > MAX_TOOL_PANES) {
    const page = [...d.pages].reverse().find((p) => p.cards.length >= 2);
    if (!page) break;
    mergeCardInto(page, page.cards[page.cards.length - 1]!, page.cards[page.cards.length - 2]!);
  }
}

/**
 * Drops empty cards and pages (an empty page survives only while it is the page in view: the launcher),
 * renormalises card sizes, keeps the limits, keeps `activePage` on a neighbour, closes the column when nothing is left.
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
  const order = d.pages.map((p) => p.id);
  d.pages = d.pages.filter((p) => p.cards.length > 0 || (p.launcher && p.id === d.activePage));
  if (!findPage(d, d.activePage)) {
    const k = d.activePage ? order.indexOf(d.activePage) : -1;
    d.activePage = d.pages[Math.min(Math.max(k - 1, 0), d.pages.length - 1)]?.id ?? null;
  }
  if (!d.pages.length) {
    d.activePage = null;
    d.open = false;
  }
}

/** Switch the page in view; a launcher page (empty) left behind is dropped. */
function setActivePage(d: SideLayout, pageId: string | null): void {
  const old = findPage(d, d.activePage);
  d.activePage = pageId;
  if (old && old.id !== pageId && !old.cards.length) d.pages = d.pages.filter((p) => p !== old);
  if (!findPage(d, pageId)) d.activePage = d.pages[0]?.id ?? null;
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
  if (d.activePage !== at.page.id) setActivePage(d, at.page.id);
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
    else page = newPage(d, decision.page.new.groups, decision.page.new.index);
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

/** New launcher page (empty, in view; dropped when left without content). Refused at MAX_PAGES. */
export function openLauncherPage(layout: SideLayout): { layout: SideLayout; pageId: string | null } {
  const existing = layout.pages.find((p) => !p.cards.length);
  if (existing) return { layout: { ...switchPage(layout, existing.id), open: true }, pageId: existing.id };
  if (layout.pages.length >= MAX_PAGES) return { layout, pageId: null };
  const d = draft(layout);
  const page = newPage(d, []);
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

// ── Close ─────────────────────────────────────────────────────────────────────────────────────

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
  d.activePage = d.activePage === pageId ? null : d.activePage;
  d.pages = d.pages.filter((p) => p.id !== pageId);
  if (!d.activePage && d.pages.length) d.activePage = d.pages[0]!.id;
  if (!d.pages.length) d.open = false;
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
  // No room for another tool column (§24 限额).
  if ("newPage" in target && layout.pages.length >= MAX_PAGES) return layout;
  const d = draft(layout);
  detach(d, instanceId);
  let page: SidePage;
  if ("newPage" in target) {
    page = newPage(d, []);
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

/** A dragged page dropped on another pill's top / bottom edge: page-button order changes. Not an override. */
export function reorderPage(layout: SideLayout, pageId: string, targetId: string, after: boolean): SideLayout {
  if (pageId === targetId) return layout;
  const from = layout.pages.findIndex((p) => p.id === pageId);
  if (from < 0 || !findPage(layout, targetId)) return layout;
  const pages = [...layout.pages];
  const [page] = pages.splice(from, 1);
  const k = pages.findIndex((p) => p.id === targetId);
  pages.splice(after ? k + 1 : k, 0, page!);
  if (pages.every((p, k2) => p === layout.pages[k2])) return layout;
  return { ...layout, pages };
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
  if ("newPage" in target && layout.pages.length >= MAX_PAGES) return layout; // no room for another tool column (§24)
  let page: SidePage;
  if ("newPage" in target) {
    page = newPage(d, []);
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

export function movePage(layout: SideLayout, pageId: string, delta: -1 | 1): SideLayout {
  const k = layout.pages.findIndex((p) => p.id === pageId);
  const to = k + delta;
  if (k < 0 || to < 0 || to >= layout.pages.length) return layout;
  const pages = [...layout.pages];
  const [page] = pages.splice(k, 1);
  pages.splice(to, 0, page!);
  return { ...layout, pages };
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
 * 重置右栏布局: clears overrides, page names, order, sizes and collapse; replays the live instances
 * (lastActiveAt, oldest first) with the declared rules. Nothing is closed. Deterministic.
 */
export function resetLayout(layout: SideLayout, specOf: SpecOf, now: number): SideLayout {
  const live = Object.keys(layout.instances)
    .filter((id) => locate(layout, id))
    .sort((a, b) => layout.instances[a]!.lastActiveAt - layout.instances[b]!.lastActiveAt || (a < b ? -1 : a > b ? 1 : 0));
  let d: SideLayout = { ...layout, pages: [], overrides: {}, activePage: null, instances: { ...layout.instances } };
  const wasOpen = layout.open;
  for (const id of live) d = replaceExisting(d, id, specOf, now, false);
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
 * How a page shows in the page buttons: "shown" (has cards visible to the current agent), "hidden"
 * (nothing for this agent: other agents' content or dormant instances — it leaves the lane, RFC §13
 * D27′), "launcher" (empty page).
 */
export type PageVisibility = "shown" | "hidden" | "launcher";

export function pageVisibility(layout: SideLayout, page: SidePage, ctx: SideViewContext): PageVisibility {
  if (!page.cards.length) return "launcher";
  return visibleCards(layout, page, ctx).length ? "shown" : "hidden";
}

/** Pages that get a page button / a Ctrl+Shift+n slot, in order: shown pages, and the launcher page while in view. */
export function lanePages(layout: SideLayout, ctx: SideViewContext): SidePage[] {
  return layout.pages.filter((p) => {
    const v = pageVisibility(layout, p, ctx);
    return v === "shown" || (v === "launcher" && p.id === layout.activePage);
  });
}

/** The page in view (when it has nothing for this agent: the first lane page; null when none). */
export function pageInView(layout: SideLayout, ctx: SideViewContext): SidePage | null {
  const page = findPage(layout, layout.activePage);
  return page && pageVisibility(layout, page, ctx) !== "hidden" ? page : lanePages(layout, ctx)[0] ?? null;
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

/** A change took the focused agent's last content away: the tool columns hide (the next open shows them again). */
export function closeIfEmptied(prev: SideLayout, next: SideLayout, ctx: BindingCtx): SideLayout {
  if (!next.open || !hasContentFor(prev, ctx) || hasContentFor(next, ctx)) return next;
  const active = findPage(next, next.activePage);
  if (active && !active.cards.length) return next; // a launcher page the user opened
  return { ...next, open: false };
}

/**
 * The tool columns on screen (§24): every column with something for the focused agent, and the
 * launcher column while it is the focused one. A maximised / full-screen column: that one; a card: its
 * column with that card only. Nothing to show (the tool area is open with no pane at all): the empty state.
 */
export function columnsOnScreen(layout: SideLayout, ctx: SideViewContext, mode: { card: string | null } | null): { page: SidePage; only: string | null }[] {
  const pages = lanePages(layout, ctx);
  if (mode?.card) {
    const at = findCard(layout, mode.card);
    return at ? [{ page: at.page, only: mode.card }] : [];
  }
  if (mode) {
    const page = findPage(layout, layout.activePage);
    if (page && pages.includes(page)) return [{ page, only: null }];
  }
  return pages.map((page) => ({ page, only: null }));
}

/** The tool area shows: open, and either a column for this agent or nothing placed at all (the empty state with the launchers). */
export function toolAreaShown(layout: SideLayout, ctx: SideViewContext): boolean {
  return layout.open && (lanePages(layout, ctx).length > 0 || !layout.pages.some((p) => p.cards.length > 0));
}

/**
 * The tool columns on screen for this agent (§24): the open layout's columns with something it can see,
 * and the launcher column while it is the focused one. Empty when the columns are hidden.
 */
export function shownPages(layout: SideLayout, ctx: SideViewContext): SidePage[] {
  return layout.open ? lanePages(layout, ctx) : [];
}

/** The layout within the limits (§24 限额; the same object when it already is). */
export function fitLayout(layout: SideLayout): SideLayout {
  if (cardCount(layout) <= MAX_TOOL_PANES && layout.pages.every((p) => p.cards.length <= MAX_CARDS)) return layout;
  const d = draft(layout);
  fitLimits(d);
  return d;
}

/**
 * v1.16 → v1.17 (§24 迁移): the pages of an old side layout as ONE tool column. `keep` (the focused
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
 * by their sizes, each at least its min height; when there is no room the bottom ones fold first.
 */
export function cardHeights(cards: readonly { size: number; collapsed: boolean; minHeight?: number }[], total: number): CardBox[] {
  const n = cards.length;
  if (!n) return [];
  if (n === 1) return [{ folded: false, height: Math.max(0, total) }];
  const room = Math.max(0, total - CARD_GAP * (n - 1));
  const folded = cards.map((c) => c.collapsed);
  if (folded.every(Boolean)) folded[0] = false; // keep one open: the page would be all headers
  for (;;) {
    const open = cards.map((_, k) => k).filter((k) => !folded[k]);
    const left = room - CARD_HEADER * (n - open.length);
    const sum = open.reduce((a, k) => a + Math.max(cards[k]!.size, 0.0001), 0);
    const fits = open.every((k) => (left * Math.max(cards[k]!.size, 0.0001)) / sum >= (cards[k]!.minHeight ?? MIN_CARD_HEIGHT));
    if (fits || open.length <= 1) {
      return cards.map((c, k) => (folded[k] ? { folded: true, height: CARD_HEADER } : { folded: false, height: open.length <= 1 ? Math.max(CARD_HEADER, left) : (left * Math.max(c.size, 0.0001)) / sum }));
    }
    folded[open[open.length - 1]!] = true; // the bottom expanded card folds first
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

// ── Geometry (§18.3 widths, narrow windows) ─────────────────────────────────────────────────────

/** The work area (conversation card + right side) cannot hold both minimums: the side becomes a drawer. */
export function isNarrow(workAreaWidth: number): boolean {
  return workAreaWidth < MIN_CONVERSATION + MIN_SIDE;
}

/** Width of the open right side (its 8 px seam included) for the stored width in a work area of `room` px. */
export function sideWidth(stored: number, room: number, narrow: boolean): number {
  if (narrow) return Math.max(0, Math.min(stored, room - DRAWER_MARGIN));
  return Math.round(Math.max(MIN_SIDE, Math.min(stored, room - MIN_CONVERSATION - CARD_GAP)));
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
      if (!isRecord(p) || typeof p.id !== "string" || !/^p\d+$/.test(p.id) || seen.has(p.id) || out.pages.length >= LEGACY_MAX_PAGES) continue;
      seen.add(p.id);
      bump(p.id);
      const page: SidePage = { id: p.id, groups: Array.isArray(p.groups) ? [...new Set(p.groups.filter((g): g is string => typeof g === "string" && g.length > 0 && g.length <= 100))] : [], cards: [] };
      if (typeof p.name === "string" && p.name.trim()) page.name = p.name.trim().slice(0, 80);
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
      if (page.cards.length) out.pages.push(page);
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
  if (opts.legacy) return out;
  return out.pages.length > MAX_PAGES ? foldPages(out, out.activePage) : fitLayout(out);
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
  d.pages = d.pages.filter((p) => p.cards.length > 0);
  if (!findPage(d, d.activePage)) d.activePage = d.pages[0]?.id ?? null;
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
