// The tool area's state (docs/desktop-modules.md §24; §18 for the parts it keeps): the layout of the
// current view scope (tool columns, panes, instances, overrides — stored per scope as the tool area of
// the pane layout file through lib/paneFile (IndexedDB, lib/paneDb); migrated once from the v1.16
// "cutex-desktop.side"), one for every agent (the per-agent views of §18.5 are gone: shown / hidden and
// the focused column are global; what a pane shows follows its bindings), plus what lives in memory
// only: maximise / fullscreen, the tab infos the launchers sum, reveal counters and the flash. A small
// zustand store of its own (not the 1900-line store.ts); every layout change goes through the pure
// reducers in lib/sideLayout.ts.
import { create } from "zustand";
import type { ItemId, Json } from "../modules/types";
import type { SideTabInfo } from "../modules/slots";
import { agentHost, selectedSidebar, useApp } from "../store";
import { translate } from "../i18n";
import { getUiPrefs } from "./prefs";
import { setStorageFullNotifier } from "./storageFull";
import { migrateSideOnce, pruneConvShelves, readConvShelf, readPanesFile, setStoredShelfRails, singleShelfDefault, takeClosedToolChips, writeConvShelf, writeShelfTemplate } from "./paneFile";
import { conversationPanes, focusedConversation, paneBinding, restoreLayout } from "./paneLayout";
import { convKey, fromTemplate, maxSeq, mergeShared, metaOf, parseConvKey, rebindFollow, renumber, sharedPages, splitShared, templateOf, type ShelfMeta } from "./convShelves";
import { growStoredLayout, growStoredMeta } from "./panelGrow";
import { arrangementKey, undoArrangement } from "./dropUndo";
import { paneScopeOf, usePanes } from "./paneStore";
import { currentWindow, inWindow, isActiveWindow, MAIN_WINDOW, windowStore, type WindowKey } from "./windowScope";
import { applyCrossDrop, applyCrossPageDrop, crossPageTarget, resolveDrop, type SideDrag, type SideDropTarget, type SideHit } from "./sideDrop";
import {
  adoptInstance,
  bindingVisible,
  collapseShelf,
  shelvesOf,
  closeIfEmptied,
  closeInstances,
  dropDeletedAgents,
  emptyLayout,
  findCard,
  findPage,
  findShelf,
  bindingVisible as visibleTo,
  instanceVisible,
  locate,
  prepareForSave,
  restoreInstances,
  setNewShelfRailPlacement,
  setShelfOptions,
  stateSize,
  STATE_LIMIT,
  takeStrays,
  type SideInstance,
  type SideLayout,
} from "./sideLayout";
import type { SideBinding } from "../modules/slots";
import { sideRegistry, sideViewFor, sideViewNow } from "./sideComponents";
import { peekOpen } from "./peekStore";
import { settingsShelfCovers } from "./settingsShelf";
import { scopeFor, scopeKey } from "./workspace";


export interface SideMode {
  kind: "maximised" | "fullscreen";
  /** A single card (card-level ⤢ / ⛶), or null for the page in view. */
  card: string | null;
  /** A whole Shelf (its ⋯ / a double-click on its rail, §24.16): its page in view, collapsed or not. */
  shelf?: string | null;
}

export interface SideStoreState {
  /** View scope key ("host:<id>"; later "group:<id>" / "all"). null until started. */
  scope: string | null;
  layout: SideLayout;
  mode: SideMode | null;
  /** services.side.reveal / focus: Body props `revealed` per instance. */
  revealed: Record<string, number>;
  /** The latest useTab() of every visible instance (page-button badges, tab rows, tooltips). */
  tabInfo: Record<string, SideTabInfo>;
  /** A card (or the page's pill) flashes once after a reveal. */
  flash: { cardId: string | null; pageId: string; nonce: number } | null;
  /** The window is too narrow for both: the side is a drawer (set by the side area's measurement). */
  narrow: boolean;
  /** The card last focused / clicked (Ctrl+Shift+M / Shift+F11 act on it). */
  focusedCard: string | null;
  /** A Shelf's width while its handle is dragged (stored in the layout on release; §24.12). */
  liveWidth: Record<string, number>;
  /**
   * The other workspaces' Shelves (two live workspaces, §24.13): every conversation on screen besides the focused
   * one, by `convKey` — its own Shelf (no shared page: those live in `layout` and follow the focus) and how it
   * shows. Live like the focused one: its instances are mounted, a focus switch only swaps which one is `layout`.
   */
  peers: Record<string, PeerShelf>;
}

/** Another workspace's live Shelf (lib/sideLayoutStore `peers`). */
export interface PeerShelf {
  hostId: string;
  sessionId: string;
  /** Its own pages, panes and instances (ids unique in the scope, like every conversation's). */
  own: SideLayout;
  /** Each Shelf's page in view, collapsed, focused page, shown (lib/convShelves). */
  meta: ShelfMeta;
}

/** One per app window (lib/windowScope, multi-window P3): each window's Shelves follow its own focused conversation. */
export const useSide = windowStore(() => create<SideStoreState>(() => ({
  scope: null,
  layout: emptyLayout(),
  mode: null,
  revealed: {},
  tabInfo: {},
  flash: null,
  narrow: false,
  focusedCard: null,
  liveWidth: {},
  peers: {},
})));

/** A Shelf's width while its handle is dragged (null: the drag ended). */
export function previewShelfWidth(shelfId: string, width: number | null): void {
  const live = { ...useSide.getState().liveWidth };
  if (width === null) delete live[shelfId];
  else live[shelfId] = width;
  useSide.setState({ liveWidth: live });
}

// ── Persistence (the tool area of the pane layout, lib/paneFile) ─────────────────────────────────

/** The debounced save of each window's live Shelf (multi-window P3). */
const saveTimers = new Map<WindowKey, ReturnType<typeof setTimeout>>();

/** The live layout prepared for saving (lib/sideLayout prepareForSave with the registry's persist flags). */
function preparedNow(layout: SideLayout, peer?: { hostId: string; sessionId: string }): SideLayout {
  let ctx: ReturnType<typeof sideViewNow> | null = null;
  try {
    ctx = peer ? sideViewFor(peer.hostId, peer.sessionId) : sideViewNow();
  } catch {
    ctx = null;
  }
  const registry = (() => {
    try {
      return sideRegistry();
    } catch {
      return null;
    }
  })();
  return prepareForSave(layout, {
    persist: (kind) => registry?.get(kind)?.item.persist !== false,
    visible: (id) => (ctx ? instanceVisible(layout, id, ctx) : true),
  });
}

/** Stores the focused conversation's own Shelf and the shared pages (§24.13; no conversation yet: nothing). */
function saveNow(): void {
  saveTimers.delete(currentWindow());
  const { scope } = useSide.getState();
  const conv = curConv();
  if (!scope || !conv) return;
  // A Shelf drawn expanded for 最大化 is stored as it was (lib/panelGrow, audit #2).
  const layout = growStoredLayout(useSide.getState().layout, conv);
  const { own, shared } = splitShared(preparedNow(layout));
  writeConvShelf(scope, conv, own, metaOf(layout), shared);
}

function scheduleSave(): void {
  const key = currentWindow();
  const timer = saveTimers.get(key);
  if (timer) clearTimeout(timer);
  saveTimers.set(
    key,
    setTimeout(() => inWindow(key, saveNow), 400),
  );
}

export function flushSideSave(): void {
  const timer = saveTimers.get(currentWindow());
  if (timer) {
    clearTimeout(timer);
    saveNow();
  }
  for (const key of [...peerTimers.keys()]) savePeerNow(key);
}

// ── The other workspaces' live Shelves (§24.13: both workspaces live side by side) ─────────────────

const peerTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Stores a peer's own Shelf (its shared pages are the focused layout's, stored with it). */
function savePeerNow(key: string): void {
  const timer = peerTimers.get(key);
  if (timer) clearTimeout(timer);
  peerTimers.delete(key);
  const scope = useSide.getState().scope;
  const mem = ownMem.get(key);
  const k = parseConvKey(key);
  if (!scope || !mem || !k) return;
  writeConvShelf(scope, key, preparedNow(growStoredLayout(mem.own, key), k), growStoredMeta(mem.meta, key), null);
}

function schedulePeerSave(key: string): void {
  const timer = peerTimers.get(key);
  if (timer) clearTimeout(timer);
  peerTimers.set(key, setTimeout(() => savePeerNow(key), 400));
}

/**
 * Remembers a conversation's own Shelf (not the live one): in memory, and — when it is on screen as the other
 * workspace — in the store, so its live Shelf redraws. `save`: stored (debounced) too.
 */
function remember(key: string, input: SideLayout, meta: ShelfMeta, save = true): void {
  const own = followHere(key, input);
  ownMem.set(key, { own, meta });
  const s = useSide.getState();
  const peer = s.peers[key];
  if (peer && (peer.own !== own || peer.meta !== meta)) useSide.setState({ peers: { ...s.peers, [key]: { ...peer, own, meta } } });
  if (save) schedulePeerSave(key);
  bumpConv();
}

/** The conversation whose Shelf holds instance `id`: null = the live layout, a `convKey` = a peer, undefined = none. */
export function instanceOwner(id: string): string | null | undefined {
  const s = useSide.getState();
  if (s.layout.instances[id]) return null;
  for (const [key, peer] of Object.entries(s.peers)) if (peer.own.instances[id]) return key;
  return undefined;
}

/** The first instance, in the live layout or another workspace's live Shelf, that `test` accepts (its id). */
export function findInstanceAnywhere(test: (inst: SideInstance, id: string) => boolean): string | null {
  const s = useSide.getState();
  for (const [id, inst] of Object.entries(s.layout.instances)) if (test(inst, id)) return id;
  for (const peer of Object.values(s.peers)) for (const [id, inst] of Object.entries(peer.own.instances)) if (test(inst, id)) return id;
  return null;
}

/**
 * Runs `fn` with peer `key`'s Shelf as the live layout, then gives the live layout back to the conversation that
 * had it (design 017: an open from a pane of the other workspace lands in that pane's Shelf, the focus stays).
 * Both swaps are switchConversation's (same instances, nothing remounts); what the swaps reset on the way —
 * the focused conversation's maximised / full-screen mode and focused card — comes back as it was, and the
 * reveal / flash marks `fn` set stay (instance ids are unique across the conversations). Not a peer: just `fn`.
 */
export function withLiveShelf<T>(key: string, fn: () => T): T {
  const prev = curConv();
  const s = useSide.getState();
  if (!prev || key === prev || !s.peers[key]) return fn();
  const keep = { mode: s.mode, focusedCard: s.focusedCard, revealed: s.revealed, flash: s.flash };
  switchConversation(key);
  try {
    return fn();
  } finally {
    const after = useSide.getState();
    switchConversation(prev);
    // Back only when the swap back happened (it can't fail while both are on screen; never strand the marks).
    if (curConv() === prev) useSide.setState({ mode: keep.mode, focusedCard: keep.focusedCard, revealed: { ...keep.revealed, ...after.revealed }, flash: after.flash ?? keep.flash });
  }
}

/** Instance `id` in the live layout or in a peer's Shelf. */
export function instanceAnywhere(id: string): SideInstance | undefined {
  const s = useSide.getState();
  const live = s.layout.instances[id];
  if (live) return live;
  for (const peer of Object.values(s.peers)) if (peer.own.instances[id]) return peer.own.instances[id];
  return undefined;
}

/** Changes a peer's Shelf as it shows (its own pages with the shared ones); the shared pages are left as they are. */
export function updatePeerView(key: string, fn: (view: SideLayout) => SideLayout): void {
  const s = useSide.getState();
  const peer = s.peers[key];
  if (!peer) return;
  const view = peerView(peer, s.layout);
  const next = fn(view);
  if (next === view) return;
  const { own, meta } = splitShared(next);
  remember(key, { ...own, seq: Math.max(own.seq, peer.own.seq) }, meta);
}

/** Closes instances wherever they are (the live layout, a peer's Shelf), without their components' onClose. */
export function closeInstancesAnywhere(ids: readonly string[]): void {
  const s = useSide.getState();
  const live = ids.filter((id) => s.layout.instances[id]);
  if (live.length) updateLayout((layout) => closeInstances(layout, live));
  for (const [key, peer] of Object.entries(useSide.getState().peers)) {
    const mine = ids.filter((id) => peer.own.instances[id] && !live.includes(id));
    if (mine.length) remember(key, closeInstances(peer.own, mine), peer.meta);
  }
}

// ── An agent's own things go to its own Shelf (owner 2026-10-23) ──────────────────────────────────────

/**
 * The conversation an instance bound to `binding` belongs to when that is not the live one (an agent-bound open of
 * an agent not focused: its own Shelf, never the focused conversation's, where it would not show); null: the live
 * layout (not agent-bound, the focused agent's own, or no conversation live yet).
 */
export function homeConversation(binding: SideBinding): string | null {
  if (binding.kind !== "agent" || !curConv()) return null;
  const key = convKey(binding.hostId, binding.sessionId);
  return key === curConv() ? null : key;
}

/** An id counter past every layout this session holds (instance ids are unique across a scope's conversations). */
function seqAcross(...more: SideLayout[]): number {
  const s = useSide.getState();
  let n = Math.max(s.layout.seq, maxSeq(s.layout));
  for (const p of Object.values(s.peers)) n = Math.max(n, p.own.seq, maxSeq(p.own));
  for (const m of ownMem.values()) n = Math.max(n, m.own.seq, maxSeq(m.own));
  for (const l of more) n = Math.max(n, l.seq, maxSeq(l));
  return n;
}

/** A conversation's own Shelf that is not the live layout: its live Shelf on screen (a peer), else as left / stored. */
function ownOf(key: string): { own: SideLayout; meta: ShelfMeta } | null {
  const s = useSide.getState();
  if (!s.scope || key === curConv()) return null;
  const peer = s.peers[key];
  if (peer) return { own: peer.own, meta: peer.meta };
  const got = ownShelfOf(s.scope, key, seqAcross());
  return { own: got.own, meta: got.meta };
}

/** The first instance of conversation `key`'s own Shelf (not the live one) that `test` accepts. */
export function findInConversation(key: string, test: (inst: SideInstance, id: string) => boolean): { id: string; inst: SideInstance } | null {
  const got = ownOf(key);
  if (!got) return null;
  for (const [id, inst] of Object.entries(got.own.instances)) if (test(inst, id)) return { id, inst };
  return null;
}

/** A new instance id no conversation of the scope uses; the live layout's counter moves past it too. */
export function newInstanceIdFor(key: string): string {
  const got = ownOf(key);
  const n = seqAcross(...(got ? [got.own] : [])) + 1;
  const s = useSide.getState();
  useSide.setState({ layout: { ...s.layout, seq: Math.max(s.layout.seq, n) } });
  return `i${n}`;
}

/**
 * Puts instance `id` into conversation `key`'s own Shelf (not the live one): on screen, that Shelf redraws; else it
 * is there when that conversation is opened (lib/sideLayout adoptInstance: its own pane of that kind, else a page of
 * its own). Same id. Its page; null: no such Shelf (no scope, or `key` is live).
 */
export function adoptIntoConversation(key: string, id: string, inst: SideInstance, now: number, show = false): string | null {
  const got = ownOf(key);
  if (!got) return null;
  const { layout, pageId } = adoptInstance(got.own, id, inst, now, { seq: seqAcross(got.own), show });
  remember(key, layout, got.meta);
  return pageId;
}

/** Closes instances of conversation `key`'s own Shelf (not the live one) without their components' onClose. */
export function closeInConversation(key: string, ids: readonly string[]): void {
  const got = ownOf(key);
  const mine = got ? ids.filter((id) => got.own.instances[id]) : [];
  if (got && mine.length) remember(key, closeInstances(got.own, mine), got.meta);
}

/** Instances of conversations remembered in this session that are not on screen (held ones stay mounted, §18.13). */
export function rememberedInstances(): Record<string, SideInstance> {
  const s = useSide.getState();
  const out: Record<string, SideInstance> = {};
  for (const [key, mem] of ownMem) if (key !== curConv() && !s.peers[key]) Object.assign(out, mem.own.instances);
  return out;
}

/** Ids moved by repairStrays from a Shelf read from storage: restored by their component when their Shelf loads. */
const unrestored = new Set<string>();

/**
 * B (owner 2026-10-23): conversation `key`'s own Shelf with the tabs bound to another agent moved to that agent's own
 * Shelf (same ids). Idempotent: a moved tab is in its own agent's Shelf, never moved again. Logs the count.
 */
function repairStrays(key: string, own: SideLayout, fromStorage: boolean): SideLayout {
  const k = parseConvKey(key);
  if (!k) return own;
  const { own: kept, strays } = takeStrays(own, k.hostId, k.sessionId);
  if (!strays.length) return own;
  const now = Date.now();
  const movedIds: string[] = [];
  for (const { id, inst } of strays) {
    if (inst.binding.kind !== "agent") continue;
    const home = convKey(inst.binding.hostId, inst.binding.sessionId);
    if (adoptIntoConversation(home, id, inst, now) === null) continue;
    if (fromStorage) unrestored.add(id);
    movedIds.push(id);
  }
  const moved = movedIds.length;
  if (!moved) return own;
  console.info(`[shelf] moved ${moved} tab(s) bound to another agent out of ${key}'s Shelf to their own agents' Shelves`);
  return moved === strays.length ? kept : closeInstances(own, movedIds);
}

/** repairStrays on the live conversation's own Shelf (after it was loaded: the conversation it came from is not live now). */
function repairLive(fromStorage: boolean): void {
  const conv = curConv();
  if (!conv) return;
  // The shared pages came along from the conversation before (maybe another host's): follow this one.
  const followed = followHere(conv, useSide.getState().layout, true);
  if (followed !== useSide.getState().layout) useSide.setState({ layout: followed });
  const s = useSide.getState();
  const live = splitShared(s.layout);
  const own = repairStrays(conv, live.own, fromStorage);
  if (own === live.own) return;
  const layout = mergeShared(own, live.shared, live.meta);
  useSide.setState({ layout: { ...layout, seq: Math.max(layout.seq, s.layout.seq) } });
}

/** The shared pages of the live layout, the same object while they do not change (a peer's view merges them). */
let sharedMemo: { sig: string; shared: SideLayout } | null = null;
function sharedOf(live: SideLayout): SideLayout {
  const pages = sharedPages(live);
  if (!pages.length) {
    if (sharedMemo?.sig === "") return sharedMemo.shared;
    sharedMemo = { sig: "", shared: { ...emptyLayout(), seq: live.seq } };
    return sharedMemo.shared;
  }
  const sig = JSON.stringify([pages, shelvesOf(live).filter((x) => pages.some((p) => p.shelf === x.id))]);
  if (sharedMemo?.sig === sig) return sharedMemo.shared;
  sharedMemo = { sig, shared: splitShared(live).shared };
  return sharedMemo.shared;
}

const viewMemo = new WeakMap<PeerShelf, { shared: SideLayout; view: SideLayout }>();

/** A peer's Shelf as it shows: its own pages with the live layout's shared ones (lib/convShelves mergeShared). */
export function peerView(peer: PeerShelf, live: SideLayout): SideLayout {
  const shared = sharedOf(live);
  const hit = viewMemo.get(peer);
  if (hit && hit.shared === shared) return hit.view;
  const view = mergeShared(peer.own, shared, peer.meta);
  viewMemo.set(peer, { shared, view });
  return view;
}

/** The conversations on screen besides the focused one (the pane layout's conversation panes). */
function screenPeers(): { key: string; hostId: string; sessionId: string }[] {
  if (!curConv()) return [];
  const work = usePanes.getState().layout;
  const out: { key: string; hostId: string; sessionId: string }[] = [];
  for (const pane of conversationPanes(work)) {
    const b = paneBinding(work, pane);
    if (!b?.sessionId) continue;
    const key = convKey(b.hostId, b.sessionId);
    if (key !== curConv() && !out.some((x) => x.key === key)) out.push({ key, hostId: b.hostId, sessionId: b.sessionId });
  }
  return out;
}

/** The ids a layout uses (instances, pages, panes, Shelves). */
function idsOf(layout: SideLayout): Set<string> {
  const out = new Set<string>(Object.keys(layout.instances));
  for (const p of layout.pages) {
    out.add(p.id);
    for (const c of p.cards) out.add(c.id);
  }
  for (const x of layout.shelves ?? []) out.add(x.id);
  return out;
}

/** A Shelf's meta after its ids were renumbered. */
function remapMeta(meta: ShelfMeta, map: ReadonlyMap<string, string>): ShelfMeta {
  const keyed = (r: Record<string, string> | undefined) => (r ? Object.fromEntries(Object.entries(r).map(([k, v]) => [map.get(k) ?? k, map.get(v) ?? v])) : r);
  const flags = (r: Record<string, boolean> | undefined) => (r ? Object.fromEntries(Object.entries(r).map(([k, v]) => [map.get(k) ?? k, v])) : r);
  return { ...meta, active: keyed(meta.active), collapsed: flags(meta.collapsed), focus: meta.focus ? (map.get(meta.focus) ?? meta.focus) : meta.focus };
}

/**
 * The peers for the conversations on screen now: the ones already live stay as they are (their instances stay
 * mounted); a new one comes from memory, storage or the default layout (stored instances restore through their
 * components; ids clashing with the live layout are renumbered). The live layout's id counter moves past every
 * peer's ids, so nothing new clashes with them.
 */
function peersFor(scope: string, live: SideLayout, prev: Record<string, PeerShelf>): { peers: Record<string, PeerShelf>; live: SideLayout } {
  const want = screenPeers();
  const next: Record<string, PeerShelf> = {};
  let out = live;
  let changed = Object.keys(prev).length !== want.length;
  for (const w of want) {
    const had = prev[w.key];
    if (had) {
      next[w.key] = had;
      continue;
    }
    changed = true;
    const base = Math.max(out.seq, maxSeq(out));
    const loaded = ownShelfOf(scope, w.key, base);
    let own = loaded.own;
    let meta = loaded.meta;
    if (collapseOnEnter.delete(w.key)) meta = { ...meta, collapsed: Object.fromEntries(shelvesOf(own).map((x) => [x.id, true])) };
    if (!loaded.memory) {
      const taken = idsOf(out);
      if ([...idsOf(own)].some((id) => taken.has(id))) {
        const r = renumber(own, Math.max(base, maxSeq(own)));
        own = r.layout;
        meta = remapMeta(meta, r.map);
      }
      own = withSingleShelf(own, loaded.stored);
      markPending(own);
    }
    ownMem.set(w.key, { own, meta });
    next[w.key] = { hostId: w.hostId, sessionId: w.sessionId, own, meta };
    const top = maxSeq(own);
    if (top > out.seq) out = { ...out, seq: top };
  }
  return { peers: changed ? next : prev, live: out };
}

/**
 * The conversations on screen changed (a second workspace opened / closed, another conversation in it): their
 * Shelves become (or stop being) live peers. Called by the store itself and the work row (components/side/SideArea).
 */
export function syncPeers(): void {
  const s = useSide.getState();
  if (!s.scope) return;
  const { peers, live } = peersFor(s.scope, s.layout, s.peers);
  if (peers === s.peers && live === s.layout) return;
  useSide.setState({ peers, layout: live });
  if (live !== s.layout) scheduleSave();
  restorePending();
}

/** The view context of a peer's conversation (outside React; null before the registry is up). */
function peerCtx(peer: PeerShelf): ReturnType<typeof sideViewNow> | null {
  try {
    return sideViewFor(peer.hostId, peer.sessionId);
  } catch {
    return null;
  }
}

/**
 * Where a pane / tab of the live Shelf would go when dropped on peer `key`'s Shelf (lib/sideDnd; the rules of
 * lib/sideDrop, computed against that Shelf): a pane bound to something the peer's conversation does not see
 * (another agent, another workspace) is refused (it would vanish there), as is a shared page (it is the same
 * page in every Shelf).
 */
export function peerDropTarget(key: string, drag: SideDrag, hit: SideHit, roomForColumn: boolean): SideDropTarget | null {
  const s = useSide.getState();
  const peer = s.peers[key];
  if (!peer || (drag.type !== "card" && drag.type !== "tab")) return null;
  if (hit.at !== "page" && hit.at !== "newPage" && !(hit.at === "pane" && hit.area === "tools")) return null;
  const view = peerView(peer, s.layout);
  const ctx = peerCtx(peer);
  const ids = drag.type === "tab" ? [drag.instanceId] : (findCard(s.layout, drag.cardId)?.card.tabs ?? []);
  if (!ids.length) return null;
  if (ctx && ids.some((id) => s.layout.instances[id] && !visibleTo(s.layout.instances[id]!.binding, ctx))) return { kind: "refuse", why: "bound" };
  const pageOfHit = hit.at === "page" ? findPage(view, hit.pageId) : hit.at === "pane" ? (findCard(view, hit.id)?.page ?? null) : null;
  if (pageOfHit?.shared) return { kind: "refuse", why: "shared" };
  const seq = Math.max(s.layout.seq, maxSeq(s.layout), view.seq, maxSeq(view));
  const carried = applyCrossDrop(s.layout, view, drag, null, 0, () => 500, seq);
  if (!carried) return null;
  return resolveDrop({ side: carried.carried, work: usePanes.getState().layout, roomForColumn }, carried.drag, hit);
}

/**
 * What a pane / tab drop on peer `key`'s Shelf would leave there (the drop preview, lib/dropForecast): that Shelf as
 * it shows now and after the drop (movePaneToPeer's own computation), with its view context. Null: nothing moves.
 */
export function peerDropResult(key: string, drag: SideDrag, target: SideDropTarget, now: number, orderOf: (kind: ItemId) => number): { before: SideLayout; after: SideLayout; ctx: ReturnType<typeof sideViewNow> | null } | null {
  const s = useSide.getState();
  const peer = s.peers[key];
  if (!peer) return null;
  const view = peerView(peer, s.layout);
  const seq = Math.max(s.layout.seq, maxSeq(s.layout), view.seq, maxSeq(view));
  const out = applyCrossDrop(s.layout, view, drag, target, now, orderOf, seq);
  return out?.to ? { before: view, after: out.to, ctx: peerCtx(peer) } : null;
}

/**
 * A page of the live Shelf dragged onto peer `key`'s Shelf Rail (audit #1): lib/sideDrop crossPageTarget against
 * that Shelf as it shows (its ids).
 */
export function peerPageDropTarget(key: string, pageId: string, hit: SideHit): SideDropTarget | null {
  const s = useSide.getState();
  const peer = s.peers[key];
  if (!peer) return null;
  const ctx = peerCtx(peer);
  return crossPageTarget(s.layout, peerView(peer, s.layout), pageId, hit, (id) => !ctx || !s.layout.instances[id] || visibleTo(s.layout.instances[id]!.binding, ctx));
}

/** Moves / merges a page of the live Shelf into peer `key`'s Shelf; the focus stays. Returns whether it moved. */
export function movePageToPeer(key: string, target: SideDropTarget): boolean {
  const s = useSide.getState();
  const peer = s.peers[key];
  if (!peer) return false;
  const view = peerView(peer, s.layout);
  const seq = Math.max(s.layout.seq, maxSeq(s.layout), view.seq, maxSeq(view));
  const out = applyCrossPageDrop(s.layout, view, target, seq);
  if (!out) return false;
  const { own, meta } = splitShared(out.to);
  const peerOwn = { ...own, seq: Math.max(own.seq, out.to.seq) };
  ownMem.set(key, { own: peerOwn, meta });
  let layout = closeIfEmptied(s.layout, out.from, bindingCtx());
  layout = { ...layout, seq: Math.max(layout.seq, peerOwn.seq) };
  const mode = validMode(layout, s.mode);
  const focusedCard = s.focusedCard && findCard(layout, s.focusedCard) ? s.focusedCard : null;
  useSide.setState({ layout, mode, focusedCard, peers: { ...s.peers, [key]: { ...peer, own: peerOwn, meta } } });
  scheduleSave();
  schedulePeerSave(key);
  bumpConv();
  return true;
}

/**
 * Drops a pane / tab of the live Shelf on peer `key`'s Shelf (cross-Shelf drag, §24.13): it leaves the focused
 * conversation's Shelf and lands in the other one's — the same instances (ids), so nothing remounts. The focus
 * stays where it is. Returns whether it moved.
 */
export function movePaneToPeer(key: string, drag: SideDrag, target: SideDropTarget, now: number, orderOf: (kind: ItemId) => number): boolean {
  const s = useSide.getState();
  const peer = s.peers[key];
  if (!peer) return false;
  const view = peerView(peer, s.layout);
  const seq = Math.max(s.layout.seq, maxSeq(s.layout), view.seq, maxSeq(view));
  const out = applyCrossDrop(s.layout, view, drag, target, now, orderOf, seq);
  if (!out?.to) return false;
  const { own, meta } = splitShared(out.to);
  const peerOwn = { ...own, seq: Math.max(own.seq, out.to.seq) };
  ownMem.set(key, { own: peerOwn, meta });
  let layout = closeIfEmptied(s.layout, out.from, bindingCtx());
  layout = { ...layout, seq: Math.max(layout.seq, peerOwn.seq) };
  const mode = validMode(layout, s.mode);
  const focusedCard = s.focusedCard && findCard(layout, s.focusedCard) ? s.focusedCard : null;
  useSide.setState({ layout, mode, focusedCard, peers: { ...s.peers, [key]: { ...peer, own: peerOwn, meta } } });
  scheduleSave();
  schedulePeerSave(key);
  bumpConv();
  return true;
}

// ── 撤销 a Shelf drop (audit #6, lib/dropUndo) ──────────────────────────────────────────────────────

/** What a Shelf drop's 撤销 puts back: the live layout and, for a drop into another workspace's Shelf, that one's own. */
export interface ShelfDropSnapshot {
  conv: string | null;
  live: SideLayout;
  peer: { key: string; own: SideLayout; meta: ShelfMeta } | null;
}

/** The arrangement right after a drop (its undo applies only while nothing has moved since). */
export interface ShelfDropKeys {
  live: string;
  peer: string | null;
}

/** Taken before a drop (`peerKey`: it goes into that workspace's Shelf). */
export function shelfDropSnapshot(peerKey: string | null): ShelfDropSnapshot {
  const s = useSide.getState();
  const peer = peerKey ? s.peers[peerKey] : undefined;
  return { conv: curConv(), live: s.layout, peer: peer && peerKey ? { key: peerKey, own: peer.own, meta: peer.meta } : null };
}

/** The arrangement now (after the drop), for the snapshot's Shelves. */
export function shelfDropKeys(before: ShelfDropSnapshot): ShelfDropKeys {
  const s = useSide.getState();
  const peer = before.peer ? s.peers[before.peer.key] : undefined;
  return { live: arrangementKey(s.layout), peer: peer ? arrangementKey(peer.own) : null };
}

/**
 * 撤销: the arrangement from before the drop, the instances as they are now. False (nothing changes) when the focus
 * moved to another conversation or anything was rearranged since the drop (`after`).
 */
export function undoShelfDrop(before: ShelfDropSnapshot, after: ShelfDropKeys): boolean {
  const s = useSide.getState();
  if (curConv() !== before.conv) return false;
  const peer = before.peer ? s.peers[before.peer.key] : undefined;
  if (before.peer && !peer) return false;
  if (arrangementKey(s.layout) !== after.live || (peer && arrangementKey(peer.own) !== after.peer)) return false;
  const pool = peer ? [s.layout, peer.own] : [s.layout];
  if (before.peer && peer) remember(before.peer.key, undoArrangement(peer.own, before.peer.own, pool), before.peer.meta);
  updateLayout(() => undoArrangement(s.layout, before.live, pool));
  return true;
}

// ── Updates ─────────────────────────────────────────────────────────────────────────────────────

/** Mode after a layout change: gone with its card / column or hidden tool columns (a card mode stays on its card, in any column). */
function validMode(layout: SideLayout, mode: SideMode | null): SideMode | null {
  if (!mode || !layout.open || !findPage(layout, layout.activePage)) return null;
  if (mode.shelf && !mode.card) return findShelf(layout, mode.shelf) ? mode : null;
  if (!mode.card) return mode;
  return findCard(layout, mode.card) ? mode : null;
}

/**
 * The selected agent as the bindings see it (no registry needed: works before modules register): its
 * host is the agent's own (multi-host P1: an agent of another host in the scope opens in place).
 */
function bindingCtx(): { hostId: string; sessionId: string | null; workspaceKey: string | null } {
  const s = useApp.getState();
  const scope = scopeFor(selectedSidebar(s), s.selectedId);
  return { hostId: agentHost(s), sessionId: s.selectedId, workspaceKey: scope ? scopeKey(scope) : null };
}

/**
 * Applies a reducer to the current layout (persisted, debounced). `system`: not the owner's doing (a
 * stored tab its component does not restore): the tool area does not hide for it.
 */
export function updateLayout(fn: (layout: SideLayout) => SideLayout, opts: { system?: boolean } = {}): void {
  const s = useSide.getState();
  const changed = fn(s.layout);
  if (changed === s.layout) return;
  // A pane / page brought over from another host's conversation: its file tree follows this one.
  const conv = curConv();
  const next = conv ? followHere(conv, changed) : changed;
  const layout = opts.system ? next : closeIfEmptied(s.layout, next, bindingCtx());
  const mode = validMode(layout, s.mode);
  const focusedCard = s.focusedCard && findCard(layout, s.focusedCard) ? s.focusedCard : null;
  useSide.setState({ layout, mode, focusedCard });
  scheduleSave();
}

/**
 * Another agent focused (§24: one layout for every agent): the tool columns stay as they are, their
 * panes show what the new agent's bindings see; a maximised / full-screen card the agent cannot see ends.
 */
function switchAgent(): void {
  const s = useSide.getState();
  if (!s.mode?.card) return;
  const at = findCard(s.layout, s.mode.card);
  const ctx = bindingCtx();
  const sees = !!at && at.card.tabs.some((id) => {
    const inst = s.layout.instances[id];
    return !!inst && bindingVisible(inst.binding, ctx);
  });
  if (!sees) useSide.setState({ mode: null });
}

export function setMode(mode: SideMode | null): void {
  const s = useSide.getState();
  useSide.setState({ mode: mode ? validMode(s.layout, mode) : null });
}

export function setInstanceStateNow(id: string, state: Json, v: number): void {
  if (import.meta.env?.DEV && stateSize(state) > STATE_LIMIT) {
    console.warn(`[side] state of ${id} is over ${STATE_LIMIT} chars: kept in memory, not persisted`);
  }
  const owner = instanceOwner(id);
  if (owner) {
    // An instance of the other workspace's live Shelf: kept there (§24.13).
    const peer = useSide.getState().peers[owner]!;
    const inst = peer.own.instances[id]!;
    remember(owner, { ...peer.own, instances: { ...peer.own.instances, [id]: { ...inst, state, v } } }, peer.meta);
    return;
  }
  updateLayout((layout) => {
    const inst = layout.instances[id];
    return inst ? { ...layout, instances: { ...layout.instances, [id]: { ...inst, state, v } } } : layout;
  });
}

export function reportTabInfo(id: string, info: SideTabInfo | null): void {
  const current = useSide.getState().tabInfo;
  const old = current[id];
  if (!info) {
    if (!old) return;
    const next = { ...current };
    delete next[id];
    useSide.setState({ tabInfo: next });
    return;
  }
  if (old && old.title === info.title && old.tooltip === info.tooltip && !!old.busy === !!info.busy && (old.attention ?? 0) === (info.attention ?? 0) && !!old.unread === !!info.unread) return;
  useSide.setState({ tabInfo: { ...current, [id]: info } });
}

export function bumpRevealed(id: string): void {
  const revealed = useSide.getState().revealed;
  useSide.setState({ revealed: { ...revealed, [id]: (revealed[id] ?? 0) + 1 } });
}

export function flashInstance(id: string): void {
  const at = locate(useSide.getState().layout, id);
  if (at) useSide.setState({ flash: { cardId: at.card.id, pageId: at.page.id, nonce: Date.now() + Math.random() } });
}

/** Flash a card (its page button too when that page is not in view). */
export function flashCard(cardId: string): void {
  const at = findCard(useSide.getState().layout, cardId);
  if (at) useSide.setState({ flash: { cardId, pageId: at.page.id, nonce: Date.now() + Math.random() } });
}

export function setFocusedCard(cardId: string | null): void {
  if (useSide.getState().focusedCard !== cardId) useSide.setState({ focusedCard: cardId });
}

export function setNarrow(narrow: boolean): void {
  if (useSide.getState().narrow !== narrow) useSide.setState({ narrow });
}

/** A maximised conversation pane (§24 step 4; lib/paneActions installs the hooks, the work area is not this store's). */
let workMax: { maximised(): boolean; restore(): void } = { maximised: () => false, restore: () => {} };
export function setWorkMaximised(hooks: { maximised(): boolean; restore(): void }): void {
  workMax = hooks;
}

/** A pane is maximised: a conversation pane, or the tool area's maximised / full-screen mode. */
export function paneMaximised(): boolean {
  return !!useSide.getState().mode || workMax.maximised();
}

/** Full screen of a panel (§24.16; lib/panelFull installs the hooks): on, and its exit (back to the layout before). */
let fullHooks: { on(): boolean; exit(): void } = { on: () => false, exit: () => {} };
export function setFullscreenHooks(hooks: { on(): boolean; exit(): void }): void {
  fullHooks = hooks;
}

/** Ends a maximised pane of either area (Esc); full screen first goes back to exactly what was before it. Returns whether there was one. */
export function restorePaneMaximised(): boolean {
  if (fullHooks.on()) {
    fullHooks.exit();
    return true;
  }
  const had = paneMaximised();
  if (useSide.getState().mode) setMode(null);
  if (workMax.maximised()) workMax.restore();
  return had;
}

/** A tool opens / reveals in view: a maximised conversation pane (which covers the tool area) is restored first. */
export function uncoverTools(): void {
  if (workMax.maximised()) workMax.restore();
}

/** Esc chain (§19): the reference card, a maximised pane or a right-side layer is in front — the conversation's Esc must not interrupt. */
export function sideLayersActive(): boolean {
  const s = useSide.getState();
  return peekOpen() || !!s.mode || workMax.maximised() || (s.narrow && s.layout.open && getUiPrefs().sideNarrow === "overlay") || windowLayerActive();
}

/** A window-level layer in front of the conversation's Esc: the Settings Shelf maximised, a live edit (在主界面调整). */
function windowLayerActive(): boolean {
  return settingsShelfCovers() || !!useApp.getState().customize;
}

// ── Restore (component `restore`, dormant instances) ───────────────────────────────────────────

/** Instance ids loaded from storage whose component has not restored them yet (module off / not registered). */
const pendingBy = new Map<WindowKey, Set<string>>();
/** The current window's ids waiting for their component's restore (multi-window P3). */
function pendingNow(): Set<string> {
  const key = currentWindow();
  let set = pendingBy.get(key);
  if (!set) {
    set = new Set<string>();
    pendingBy.set(key, set);
  }
  return set;
}

function restorePending(): void {
  if (!pendingNow().size) return;
  let registry: ReturnType<typeof sideRegistry>;
  try {
    registry = sideRegistry();
  } catch {
    return;
  }
  const restore = (inst: SideInstance, id: string): { state: Json; v: number } | null | "keep" => {
      if (!pendingNow().has(id)) return "keep";
      const entry = registry.get(inst.kind);
      if (!entry) return "keep";
      pendingNow().delete(id);
      unrestored.delete(id);
      const item = entry.item;
      const version = item.stateVersion ?? 1;
      if (item.persist === false) return null;
      try {
        if (item.restore) {
          const state = item.restore(inst.state, inst.v);
          return state === null ? null : { state, v: version };
        }
      } catch {
        return null;
      }
      return inst.v === version ? { state: inst.state, v: version } : null;
  };
  updateLayout((layout) => restoreInstances(layout, restore), { system: true });
  // The other workspaces' live Shelves restore the same way (§24.13).
  for (const [key, peer] of Object.entries(useSide.getState().peers)) {
    const own = restoreInstances(peer.own, restore);
    if (own !== peer.own) remember(key, own, peer.meta);
  }
  // Ids no longer in any layout need no restore.
  for (const id of [...pendingNow()]) if (instanceOwner(id) === undefined) pendingNow().delete(id);
}

// ── Scope ───────────────────────────────────────────────────────────────────────────────────────

/** v1.10 releaseHold discard of a card in a scope not loaded now: closed when that scope loads (memory only). */
const closeOnLoad = new Map<string, Set<string>>();

/** Closes instances of `scope` without their components' onClose (the caller is the component itself): now, or when that scope loads. */
export function closeInstancesIn(scope: string, ids: readonly string[]): void {
  if (!ids.length) return;
  if (useSide.getState().scope === scope) {
    closeInstancesAnywhere(ids);
    return;
  }
  const set = closeOnLoad.get(scope) ?? new Set<string>();
  for (const id of ids) set.add(id);
  closeOnLoad.set(scope, set);
}

let firstLoad = true;

// ── A Shelf per conversation (§24.13, lib/convShelves) ──────────────────────────────────────────

/**
 * The conversation whose Shelf is live in each window (`convKey`; null: none focused yet — the live layout belongs to no
 * one). Multi-window P3: per window, read / written in the current one (lib/windowScope).
 */
const currentConvs = new Map<WindowKey, string | null>();
const curConv = (): string | null => currentConvs.get(currentWindow()) ?? null;
const setCurConv = (key: string | null): void => void currentConvs.set(currentWindow(), key);

/**
 * Own Shelves of conversations not focused now, as they were left in this session (with the instances that
 * are not stored: transient previews, `persist: false`). Stored copies are read when one is not here.
 */
const ownMem = new Map<string, { own: SideLayout; meta: ShelfMeta }>();

/** Conversations whose Shelf collapses to its rail once it is loaded (side by side without the room, §24.13). */
const collapseOnEnter = new Set<string>();

/** Bumped when a conversation's own Shelf changes outside the live layout (the other workspace's rail reads it). */
export const useConvShelfVersion = create<{ n: number }>(() => ({ n: 0 }));
const bumpConv = () => useConvShelfVersion.setState((s) => ({ n: s.n + 1 }));

/** The conversation whose Shelf the tool area shows now (`convKey`), or null. */
export function liveConversation(): string | null {
  return curConv();
}

/** Tests: forget which conversation is live and the Shelves remembered in memory. */
export function resetConvShelves(): void {
  setCurConv(null);
  ownMem.clear();
  collapseOnEnter.clear();
  for (const timer of peerTimers.values()) clearTimeout(timer);
  peerTimers.clear();
  useSide.setState({ peers: {} });
}

/** The scope's 只用一个 Shelf default for a layout that has no choice of its own. */
function withSingleShelf(layout: SideLayout, stored: boolean): SideLayout {
  return { ...layout, singleShelf: layout.singleShelf ?? (stored ? false : singleShelfDefault()) };
}

/** The ids a layout read from storage holds: their components restore them (`restorePending`). */
function markPending(layout: SideLayout, fromMemory: ReadonlySet<string> = new Set()): void {
  for (const id of Object.keys(layout.instances)) if (!fromMemory.has(id)) pendingNow().add(id);
}

/** A conversation's own Shelf: as left in this session, else as stored, else a copy of the default layout. */
function ownShelfOf(scope: string, key: string, seq: number): { own: SideLayout; meta: ShelfMeta; memory: boolean; stored: boolean } {
  const mem = ownMem.get(key);
  if (mem) return { ...mem, own: followHere(key, mem.own), memory: true, stored: true };
  const read = readConvShelf(scope, key);
  if (read.own) return { own: followHere(key, read.own, true), meta: read.meta, memory: false, stored: true };
  // The default layout's file tree / changes follow this conversation, on its host.
  return { own: followHere(key, withSingleShelf(fromTemplate(read.template, seq), !!read.template)), meta: {}, memory: false, stored: false };
}

/** Kinds whose registered default binding is `follow` (before the registry is up: none — the repair runs on every load). */
function followsNow(kind: string): boolean {
  try {
    return sideRegistry().get(kind as ItemId)?.item.defaultBinding === "follow";
  } catch {
    return false;
  }
}

/**
 * Conversation `key`'s layout with its follow-the-agent panes on its own host (convShelves rebindFollow). `log`: a
 * repair of what was stored (said once per conversation load with the count).
 */
function followHere(key: string, layout: SideLayout, log = false): SideLayout {
  const k = parseConvKey(key);
  if (!k) return layout;
  const fixed = rebindFollow(layout, k.hostId, followsNow);
  if (log && fixed.count) console.info(`[shelf] ${fixed.count} file tree / changes / 成果库 tab(s) of ${key} now follow its own host`);
  return fixed.layout;
}

/**
 * Another conversation's own Shelf without making it live (the rail of the workspace that has no focus):
 * memory, storage, or what it would get from the default layout. Shared pages not included.
 */
export function peekConvShelf(key: string): SideLayout | null {
  const scope = useSide.getState().scope;
  if (!scope) return null;
  if (key === curConv()) return splitShared(useSide.getState().layout).own;
  return ownShelfOf(scope, key, useSide.getState().layout.seq).own;
}

/**
 * Another conversation's Shelf as it shows (owner 2026-10-21: the workspace without the focus keeps its own
 * expanded / collapsed state on screen): its own pages with the shared ones, each Shelf's page in view,
 * collapsed, width, shown — what it gets when it is focused. The live layout for the focused conversation.
 */
export function peekConvView(key: string): SideLayout | null {
  const s = useSide.getState();
  if (!s.scope) return null;
  if (key === curConv()) return s.layout;
  const { own, meta } = ownShelfOf(s.scope, key, s.layout.seq);
  const folded = collapseOnEnter.has(key) ? { ...meta, collapsed: Object.fromEntries(shelvesOf(own).map((x) => [x.id, true])) } : meta;
  return mergeShared(own, splitShared(s.layout).shared, folded);
}

/** Collapses every Shelf of a conversation (now when live, else when it is loaded next). */
/**
 * Another conversation's remembered Shelf state (its meta: collapsed flags, open) edited — lib/panelGrowStart puts
 * back a Shelf 最大化 drew expanded after the focus moved on. The live conversation / one not remembered: nothing.
 */
export function editConvMeta(key: string, fn: (meta: ShelfMeta) => ShelfMeta): void {
  if (key === curConv()) return;
  const mem = ownMem.get(key);
  if (mem) remember(key, mem.own, fn(mem.meta), !!useSide.getState().peers[key]);
}

export function collapseConvShelves(key: string): void {
  if (key === curConv()) {
    updateLayout((l) => shelvesOf(l).reduce((acc, x) => collapseShelf(acc, x.id), l));
    return;
  }
  const mem = ownMem.get(key);
  if (mem) {
    remember(key, mem.own, { ...mem.meta, collapsed: Object.fromEntries(shelvesOf(mem.own).map((x) => [x.id, true])) }, !!useSide.getState().peers[key]);
  } else {
    collapseOnEnter.add(key);
    bumpConv();
  }
}

/** The conversation focused when the scope loads: the selection, else the stored work area's focused pane. */
function initialConv(scope: string): string | null {
  const s = useApp.getState();
  if (isActiveWindow(currentWindow()) && s.selectedId) return convKey(agentHost(s), s.selectedId);
  const live = usePanes.getState();
  const work = live.scope === scope ? live.layout : restoreLayout(readPanesFile().layouts[scope]);
  const focused = work ? focusedConversation(work) : null;
  const b = work && focused ? paneBinding(work, focused) : null;
  return b?.sessionId ? convKey(b.hostId, b.sessionId) : null;
}

function loadScope(scope: string): void {
  if (useSide.getState().scope === scope) return;
  flushSideSave();
  migrateSideOnce();
  // #7: stored tool chips went back into their Shelves; the ones that could not were closed — said once.
  const closedChips = takeClosedToolChips();
  if (closedChips > 0) setTimeout(() => useApp.getState().notify(translate("pane.chipsClosed", { n: closedChips }), "info"), 0);
  ownMem.clear();
  collapseOnEnter.clear();
  const key = initialConv(scope);
  const read = readConvShelf(scope, key);
  let layout: SideLayout;
  if (key && read.own) layout = mergeShared(read.own, read.shared ?? emptyLayout(), read.meta);
  else {
    // No conversation's Shelf stored (or none focused yet): the default layout with the shared pages.
    const base = withSingleShelf(fromTemplate(read.template, Math.max(read.template ? maxSeq(read.template) : 0, read.shared ? maxSeq(read.shared) : 0)), !!read.template);
    layout = mergeShared(base, read.shared ?? emptyLayout());
  }
  layout = withSingleShelf(layout, !!read.own || !!read.template);
  layout = { ...layout, seq: Math.max(layout.seq, windowSeqBase(currentWindow())) };
  setCurConv(key);
  if (firstLoad && !getUiPrefs().sideRestore) layout = { ...emptyLayout(), overrides: layout.overrides, seq: layout.seq, singleShelf: layout.singleShelf };
  firstLoad = false;
  const discarded = closeOnLoad.get(scope);
  if (discarded) {
    closeOnLoad.delete(scope);
    layout = closeInstances(layout, [...discarded].filter((id) => layout.instances[id]));
  }
  pendingNow().clear();
  markPending(layout);
  for (const timer of peerTimers.values()) clearTimeout(timer);
  peerTimers.clear();
  useSide.setState({ scope, layout, mode: null, revealed: {}, tabInfo: {}, flash: null, focusedCard: null, peers: {} });
  repairLive(true);
  syncPeers();
  restorePending();
  bumpConv();
}

/**
 * The focused conversation changed (§24.13): its Shelf becomes the live tool area. The shared pages leave
 * the old conversation's Shelf (kept as it is, in memory and stored) and join the new one's, which comes back
 * as it was — or, never focused before, starts as a copy of the default layout. A conversation focused while
 * the live layout belonged to none (start, the first agent) takes that layout as its own when it has none.
 */
export function switchConversation(key: string | null): void {
  const s = useSide.getState();
  if (!s.scope || !key || key === curConv()) return;
  const timer = saveTimers.get(currentWindow());
  if (timer) {
    clearTimeout(timer);
    saveTimers.delete(currentWindow());
  }
  const scope = s.scope;
  const live = splitShared(s.layout);
  // The conversation coming in may be the other workspace's live Shelf: its own Shelf is the peer's as it is now.
  if (s.peers[key]) {
    const t = peerTimers.get(key);
    if (t) clearTimeout(t);
    peerTimers.delete(key);
    savePeerNow(key);
  }
  const was = curConv();
  if (was) {
    ownMem.set(was, { own: live.own, meta: live.meta });
    const stored = growStoredLayout(s.layout, was);
    const prepared = splitShared(preparedNow(stored));
    writeConvShelf(scope, was, prepared.own, splitShared(stored).meta, prepared.shared);
  }
  const seq = Math.max(s.layout.seq, maxSeq(s.layout));
  const next = ownShelfOf(scope, key, seq);
  let own = next.own;
  let meta = next.meta;
  if (!curConv() && !next.stored) {
    // The layout nobody owned (shown before any conversation was focused) is this conversation's now.
    own = live.own;
    meta = live.meta;
  }
  if (collapseOnEnter.delete(key)) meta = { ...meta, collapsed: Object.fromEntries(shelvesOf(own).map((x) => [x.id, true])) };
  ownMem.delete(key);
  let layout = mergeShared({ ...own, seq: Math.max(own.seq, seq) }, live.shared, meta);
  layout = withSingleShelf(layout, next.stored);
  const memory = new Set<string>([...Object.keys(live.shared.instances), ...(next.memory || (!curConv() && !next.stored) ? Object.keys(own.instances) : [])]);
  for (const id of Object.keys(own.instances)) if (unrestored.delete(id)) memory.delete(id);
  const fromStorage = !next.memory;
  setCurConv(key);
  markPending(layout, memory);
  // The workspace that had the focus is still on screen: its Shelf stays live, as the other workspace's (same
  // instances, so nothing remounts — §24.13). Set in the same update as the live layout.
  const peerPrev = { ...s.peers };
  delete peerPrev[key];
  const { peers, live: withPeers } = peersFor(scope, layout, peerPrev);
  layout = withPeers;
  for (const id of [...pendingNow()]) if (!layout.instances[id] && !Object.values(peers).some((p) => p.own.instances[id])) pendingNow().delete(id);
  useSide.setState({ layout, mode: null, revealed: {}, flash: null, focusedCard: null, peers });
  repairLive(fromStorage);
  restorePending();
  scheduleSave();
  bumpConv();
}

/**
 * Settings → Shelf Rail 在 Shelf 的 外侧 / 内侧 (owner 2026-10-21): every Shelf — the live one, the ones other
 * conversations left in this session, every stored one — and every new one gets the placement (each Shelf's ⋯
 * can still change its own afterwards).
 */
export function setEveryShelfRail(placement: "outer" | "inner"): void {
  setNewShelfRailPlacement(placement);
  updateLayout((l) => shelvesOf(l).reduce((acc, x) => setShelfOptions(acc, x.id, { railPlacement: placement }), l));
  for (const [key, mem] of [...ownMem]) remember(key, shelvesOf(mem.own).reduce((acc, x) => setShelfOptions(acc, x.id, { railPlacement: placement }), mem.own), mem.meta, false);
  flushSideSave();
  setStoredShelfRails(placement);
  bumpConv();
}

/** The focused conversation's Shelf as it is now becomes the default layout new conversations copy (Shelf ⋯). */
export function saveShelfAsDefault(): void {
  const { scope, layout } = useSide.getState();
  if (scope) writeShelfTemplate(scope, templateOf(preparedNow(layout)));
}

/** Forgets the Shelves of conversations whose agent is gone (`known` lists a host's agents; once per list). */
function pruneGone(scope: string, hostId: string, known: ReadonlySet<string>): void {
  const gone = (key: string) => {
    const k = parseConvKey(key);
    return !!k && k.hostId === hostId && !known.has(k.sessionId);
  };
  for (const key of [...ownMem.keys()]) if (gone(key)) ownMem.delete(key);
  if (pruneConvShelves(scope, gone)) bumpConv();
}

const scopeOf = (hostId: string) => paneScopeOf(hostId, currentWindow());

/**
 * Where a window's Shelf ids start (multi-window P3): a desk's own pages / panes / instances get ids far from the main
 * window's and the other desks' — a conversation's Shelf moving between windows keeps its ids, and the instance layers
 * of two windows never meet the same id.
 */
export function windowSeqBase(key: WindowKey): number {
  if (key === MAIN_WINDOW) return 0;
  return 10_000_000 + (parseInt(key.slice(1, 7), 16) % 1000) * 100_000;
}

// localStorage full (lib/storageFull): one plain notice per run.
setStorageFullNotifier(() => useApp.getState().notify(translate("storage.localFull"), "error"));

const started = new Set<WindowKey>();
let lastPrune = 0;

/** Starts the side store once (App): loads the active host's layout and follows host / agent / module changes. */
export function startSideStore(subscribeModules: (listener: () => void) => () => void, key: WindowKey = MAIN_WINDOW): () => void {
  if (started.has(key)) return () => {};
  started.add(key);
  inWindow(key, () => loadScope(scopeOf(useApp.getState().hosts?.active ?? "local")));
  const offApp = useApp.subscribe((s, prev) => inWindow(key, () => {
    const host = s.hosts?.active ?? "local";
    if (host !== (prev.hosts?.active ?? "local")) loadScope(scopeOf(host));
    // The selection is the active window's (multi-window P3): another window's Shelf stays its focused conversation's.
    if (isActiveWindow(key) && (s.selectedId !== prev.selectedId || s.selectedHost !== prev.selectedHost)) {
      // §24.13: the focused conversation's own Shelf (no agent focused: the Shelf stays as it is).
      if (s.selectedId) switchConversation(convKey(agentHost(s), s.selectedId));
      switchAgent();
    }
    if (s.sidebar && s.sidebar !== prev.sidebar) {
      const sidebar = s.sidebar;
      const known = new Set([...sidebar.active, ...sidebar.retired].map((r) => r.cutexSessionId));
      updateLayout((layout) => dropDeletedAgents(layout, host, (id) => known.has(id)));
      // The other workspace's live Shelf too (§24.13).
      for (const [key, peer] of Object.entries(useSide.getState().peers)) {
        const own = dropDeletedAgents(peer.own, host, (id) => known.has(id));
        if (own !== peer.own) remember(key, own, peer.meta);
      }
      const scope = useSide.getState().scope;
      // Only a complete list of the host in view says an agent is gone (not one leaving archived / hidden agents
      // out, not one read across a host switch): a pruned Shelf is gone for good.
      if (scope && !sidebar.partial && host === (prev.hosts?.active ?? "local") && Date.now() - lastPrune > 60_000) {
        lastPrune = Date.now();
        pruneGone(scope, host, known);
      }
    }
  }));
  // §24.13: the conversations on screen decide which Shelves are live besides the focused one. Another window's
  // focused conversation changing (a jump focused another of its columns) makes that one its live Shelf.
  const offPanes = usePanes.of(key).subscribe((s, prev) =>
    inWindow(key, () => {
      if (s.layout === prev.layout) return;
      if (!isActiveWindow(key)) {
        const focused = focusedConversation(s.layout);
        const b = focused ? paneBinding(s.layout, focused) : null;
        if (b?.sessionId) switchConversation(convKey(b.hostId, b.sessionId));
      }
      syncPeers();
    }),
  );
  const offModules = subscribeModules(() => inWindow(key, () => restorePending()));
  const onUnload = () => inWindow(key, () => flushSideSave());
  window.addEventListener("beforeunload", onUnload);
  return () => {
    started.delete(key);
    inWindow(key, () => flushSideSave());
    offApp();
    offPanes();
    offModules();
    window.removeEventListener("beforeunload", onUnload);
  };
}
