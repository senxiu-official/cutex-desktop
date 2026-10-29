// A Shelf per conversation (docs/desktop-modules.md §24.13; canvas principles §7, owner 2026-10-21: 「Shelf 按对话记」
// overturns 「布局全局一份」). Each conversation (host + session) keeps its own tool area — its Shelves, pages,
// panes, the page in view, collapsed, widths; a page marked 在所有对话中显示 (`shared`) is in every conversation's
// Shelf — one instance of it, which moves with the focus. A conversation without a Shelf of its own starts from
// the default layout (the template: the global Shelf before v5, or what the owner set as the default since),
// copied with new ids — only the panes that follow the focused conversation (a file tree, changes …) come along;
// a pane bound to one agent or holding one host thing (a browser tab) belongs to the Shelf it was opened in.
//
// The live tool area (lib/sideLayoutStore) is always the focused conversation's Shelf with the shared pages in
// it. Switching conversations takes the shared pages out (`splitShared`), keeps the rest as the old
// conversation's own Shelf, and puts them into the next one's (`mergeShared`), whose page in view / collapsed
// state come back as they were (`ShelfMeta`). Ids stay unique across all conversations of a scope (one id
// counter, `seq`), so a shared page never clashes with a page of the conversation it moves into. Pure.
import { emptyLayout, findPage, removePage, restoreRemoved, shelvesOf, withShelves, type RemovedShelfPart, type Shelf, type SideCard, type SideInstance, type SideLayout, type SidePage } from "./sideLayout";

/** A conversation's key (host + session; the same session id on two hosts is two agents). */
export const convKey = (hostId: string, sessionId: string): string => `${hostId}|${sessionId}`;

export function parseConvKey(key: string): { hostId: string; sessionId: string } | null {
  const at = key.indexOf("|");
  if (at <= 0 || at === key.length - 1) return null;
  return { hostId: key.slice(0, at), sessionId: key.slice(at + 1) };
}

/** At most this many conversations keep a stored Shelf per scope (the least recently used go first). */
export const MAX_CONV_SHELVES = 120;

/**
 * What a conversation's Shelf shows besides its pages, kept with it while the shared pages are elsewhere:
 * each Shelf's page in view and whether it is collapsed, the focused page, shown or not. A shared page in view
 * comes back in view when the shared pages return.
 */
export interface ShelfMeta {
  active?: Record<string, string>;
  collapsed?: Record<string, boolean>;
  focus?: string | null;
  open?: boolean;
}

export function metaOf(layout: SideLayout): ShelfMeta {
  const active: Record<string, string> = {};
  const collapsed: Record<string, boolean> = {};
  for (const shelf of shelvesOf(layout)) {
    if (shelf.active) active[shelf.id] = shelf.active;
    collapsed[shelf.id] = !!shelf.collapsed;
  }
  return { active, collapsed, focus: layout.activePage, open: layout.open };
}

/** The shared pages of a layout, rail order. */
export const sharedPages = (layout: SideLayout): SidePage[] => withShelves(layout).pages.filter((p) => p.shared);

/** The pages without the shared ones (its own), plus the shared pages as a layout of their own. */
export interface SplitShelf {
  own: SideLayout;
  /** Only the shared pages (with their Shelves' sides and options), or an empty layout. */
  shared: SideLayout;
  meta: ShelfMeta;
}

/** Removes `ids` one by one (each a RemovedShelfPart, rail order kept). */
function takePages(layout: SideLayout, ids: readonly string[]): { rest: SideLayout; parts: RemovedShelfPart[] } {
  let rest = withShelves(layout);
  const parts: RemovedShelfPart[] = [];
  for (const id of ids) {
    const r = removePage(rest, id);
    if (!r.removed) continue;
    rest = r.layout;
    parts.push(r.removed);
  }
  return { rest, parts };
}

/** Puts removed parts into `into`: into the Shelf on their side when it has one (else a new Shelf there). */
function putParts(into: SideLayout, parts: readonly RemovedShelfPart[]): SideLayout {
  let out = into;
  for (const part of parts) {
    const there = shelvesOf(out).find((x) => x.side === part.shelf.side);
    out = restoreRemoved(out, there && there.id !== part.shelf.id ? { ...part, shelf: { ...part.shelf, id: there.id } } : part);
  }
  return out;
}

/** The shared pages out of the live layout: the conversation's own Shelf and the shared part. */
export function splitShared(layout: SideLayout): SplitShelf {
  const meta = metaOf(layout);
  const ids = sharedPages(layout).map((p) => p.id);
  if (!ids.length) return { own: layout, shared: { ...emptyLayout(), seq: layout.seq }, meta };
  const { rest, parts } = takePages(layout, ids);
  // What the conversation showed comes back from `meta` (removing a page moves its Shelf's view on).
  let shared: SideLayout = { ...emptyLayout(), seq: layout.seq };
  shared = putParts(shared, parts);
  return { own: { ...rest, seq: layout.seq }, shared: { ...shared, open: true }, meta };
}

/** The ids of pages, panes, instances (and, `shelves`, Shelves) a layout uses. */
const ids = (layout: SideLayout, shelves = true): Set<string> => {
  const out = new Set<string>(Object.keys(layout.instances));
  for (const p of layout.pages) {
    out.add(p.id);
    for (const c of p.cards) out.add(c.id);
  }
  if (shelves) for (const x of layout.shelves ?? []) out.add(x.id);
  for (const c of layout.chips ?? []) out.add(c.card.id);
  return out;
};

/** The highest id number a layout uses (its `seq` may lag behind after a merge). */
export function maxSeq(layout: SideLayout): number {
  let n = layout.seq;
  for (const id of ids(layout)) {
    const k = Number(id.slice(1));
    if (Number.isFinite(k)) n = Math.max(n, k);
  }
  return n;
}

/**
 * A conversation's own Shelf with the shared pages in it again (each into the Shelf on its side, a new Shelf
 * there when it has none), then what it showed (`meta`): each Shelf's page in view and collapsed state, the
 * focused page, shown or hidden. Shared ids that would clash with its own get new ones (never with one id
 * counter, `seq`; a hand-made or older layout could). `seq` of the result covers both.
 */
export function mergeShared(own: SideLayout, shared: SideLayout, meta: ShelfMeta = {}): SideLayout {
  const pages = sharedPages(shared);
  let base: SideLayout = { ...withShelves(own), seq: Math.max(maxSeq(own), maxSeq(shared)) };
  if (pages.length) {
    let src = shared;
    // A Shelf id in both is the same Shelf (the shared page came from it): not a clash.
    const taken = ids(base, false);
    if ([...ids(shared, false)].some((id) => taken.has(id))) src = renumber(shared, base.seq).layout;
    base = { ...base, seq: Math.max(base.seq, maxSeq(src)) };
    const { parts } = takePages(src, sharedPages(src).map((p) => p.id));
    base = putParts(base, parts);
  }
  return applyMeta(base, meta, own);
}

function applyMeta(input: SideLayout, meta: ShelfMeta, own: SideLayout): SideLayout {
  const layout = withShelves(input);
  const shelves: Shelf[] = shelvesOf(layout).map((x) => {
    const next: Shelf = { ...x, options: { ...x.options } };
    const want = meta.active?.[x.id];
    if (want && findPage(layout, want)?.shelf === x.id) next.active = want;
    const c = meta.collapsed?.[x.id];
    if (c === true) next.collapsed = true;
    else if (c === false) delete next.collapsed;
    return next;
  });
  let activePage = layout.activePage;
  if (meta.focus !== undefined && meta.focus !== null && findPage(layout, meta.focus)) activePage = meta.focus;
  else if (!findPage(layout, activePage)) activePage = shelves.find((x) => !x.collapsed)?.active ?? shelves[0]?.active ?? null;
  // Shown as the conversation left it; one that had no pages shows the shared pages it got.
  const open = layout.pages.length > 0 && (own.pages.length ? (meta.open ?? own.open) : true);
  return withShelves({ ...layout, shelves, activePage, open });
}

/**
 * The same layout with every id new, from `seq` on (pages p…, panes c…, instances i…, Shelves s…). Overrides,
 * the focused page and each Shelf's page in view follow their pages. Chips are not copied.
 */
export function renumber(input: SideLayout, seq: number): { layout: SideLayout; map: Map<string, string> } {
  const layout = withShelves(input);
  let n = seq;
  const map = new Map<string, string>();
  const fresh = (id: string) => {
    let to = map.get(id);
    if (!to) {
      n += 1;
      to = `${id[0]}${n}`;
      map.set(id, to);
    }
    return to;
  };
  const instances: Record<string, SideInstance> = {};
  for (const [id, inst] of Object.entries(layout.instances)) instances[fresh(id)] = { ...inst };
  const shelves = shelvesOf(layout).map((x) => ({ ...x, options: { ...x.options }, id: fresh(x.id) }));
  const pages: SidePage[] = layout.pages.map((p) => ({
    ...p,
    id: fresh(p.id),
    groups: p.groups.map((g) => (g.startsWith("user:") ? `user:${fresh(p.id)}` : g)),
    ...(p.shelf ? { shelf: fresh(p.shelf) } : {}),
    cards: p.cards.map((c): SideCard => ({ ...c, id: fresh(c.id), tabs: c.tabs.map((t) => map.get(t) ?? t), active: c.active ? (map.get(c.active) ?? null) : null })),
  }));
  for (const x of shelves) x.active = x.active ? (map.get(x.active) ?? null) : null;
  const overrides: SideLayout["overrides"] = {};
  for (const [kind, ov] of Object.entries(layout.overrides)) {
    const page = map.get(ov.page);
    if (page) overrides[kind] = { ...ov, page, groups: ov.groups.map((g) => (g.startsWith("user:") ? `user:${page}` : g)) };
  }
  const out: SideLayout = { ...layout, pages, instances, shelves, overrides, activePage: layout.activePage ? (map.get(layout.activePage) ?? null) : null, seq: n };
  delete out.chips;
  return { layout: out, map };
}

/**
 * A new conversation's Shelf from the default layout (`template`, its own pages only): its Shelves (sides,
 * widths, options), pages (names, icons, groups) and panes, new ids from `seq` on. Only instances `keep` says
 * travel (default: the ones that follow the focused conversation); a pane left without tabs goes, a page left
 * without panes too (unless the owner made it). Null / empty template: an empty, closed Shelf.
 */
export function fromTemplate(template: SideLayout | null, seq: number, keep: (inst: SideInstance) => boolean = (inst) => inst.binding.kind === "follow"): SideLayout {
  if (!template || !template.pages.length) return { ...emptyLayout(), seq, ...(template?.singleShelf !== undefined ? { singleShelf: template.singleShelf } : {}) };
  const t = withShelves(template);
  const dropIds = new Set(Object.entries(t.instances).filter(([, inst]) => !keep(inst)).map(([id]) => id));
  const instances: Record<string, SideInstance> = {};
  for (const [id, inst] of Object.entries(t.instances)) if (!dropIds.has(id)) instances[id] = { ...inst, pinned: inst.pinned };
  const pages = t.pages
    .filter((p) => !p.shared)
    .map((p) => ({ ...p, cards: p.cards.map((c) => ({ ...c, tabs: c.tabs.filter((x) => !dropIds.has(x)) })).filter((c) => c.tabs.length > 0) }))
    .map((p) => ({ ...p, cards: p.cards.map((c) => ({ ...c, active: c.active && c.tabs.includes(c.active) ? c.active : (c.tabs[0] ?? null) })) }))
    .filter((p) => p.cards.length > 0 || p.kept);
  if (!pages.length) return { ...emptyLayout(), seq, ...(t.singleShelf !== undefined ? { singleShelf: t.singleShelf } : {}) };
  // Shelves without a page left go; each one left shows a page it still has.
  const shelves = shelvesOf(t)
    .filter((x) => pages.some((p) => p.shelf === x.id))
    .map((x) => ({ ...x, options: { ...x.options }, active: pages.some((p) => p.id === x.active && p.shelf === x.id) ? x.active : pages.find((p) => p.shelf === x.id)!.id }));
  for (const p of pages) {
    const sum = p.cards.reduce((a, c) => a + c.size, 0);
    if (sum > 0) p.cards = p.cards.map((c) => ({ ...c, size: c.size / sum }));
  }
  const used = new Set(pages.flatMap((p) => p.cards.flatMap((c) => c.tabs)));
  for (const id of Object.keys(instances)) if (!used.has(id)) delete instances[id];
  const copy: SideLayout = { ...t, pages, shelves, instances, activePage: pages.some((p) => p.id === t.activePage) ? t.activePage : (shelves[0]?.active ?? null), open: t.open };
  delete copy.chips;
  return renumber(copy, seq).layout;
}

/**
 * A conversation's layout with every follow-the-agent instance (file tree, changes, 成果库 … — binding `follow`) bound
 * to that conversation's host (owner 2026-10-23: a file tree is never 「empty for this agent」). A follow binding carries
 * the host it was opened on, and only that host's conversations see it; one copied from the default layout or another
 * conversation's Shelf (another host's) was hidden here — counted as 「别处」. `follows(kind)`: a kind that follows now
 * but was stored with a project binding (成果库 until 2026-10-23, `workspace`) moves to `follow` too.
 * Pure, idempotent; `count` = changed.
 */
export function rebindFollow(layout: SideLayout, hostId: string, follows?: (kind: string) => boolean): { layout: SideLayout; count: number } {
  let instances: Record<string, SideInstance> | null = null;
  let count = 0;
  for (const [id, inst] of Object.entries(layout.instances)) {
    const was = inst.binding.kind === "workspace" && follows?.(inst.kind) === true;
    if (!was && (inst.binding.kind !== "follow" || inst.binding.hostId === hostId)) continue;
    (instances ??= { ...layout.instances })[id] = { ...inst, binding: { kind: "follow", hostId } };
    count++;
  }
  return instances ? { layout: { ...layout, instances }, count } : { layout, count };
}

/** The part of a layout every new conversation copies: its own pages (no shared page, no chip). */
export function templateOf(layout: SideLayout): SideLayout {
  const { own } = splitShared(layout);
  const out = { ...own };
  delete out.chips;
  return out;
}
