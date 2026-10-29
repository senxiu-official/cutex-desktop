// Shelf actions (docs/desktop-modules.md §24.12; canvas-principles-20261020 §6): the Shelf Rail (page
// buttons, ＋, right-click 重命名 / 换图标 / 上移 / 下移 / 删除), the Shelf's ⋯ menu (允许混排, 只用一个 Shelf,
// Shelf Rail 外侧 / 内侧, 收起, 移到另一边, 关闭), collapse to the rail / expand, Alt+1…9, the undo toast of a deleted page / closed Shelf, and the
// read API other parts of the app use for the Shelves' pages (`listShelfPages`, `openShelfPage`: the ⌘K
// quick switcher). Everything goes through the pure reducers of lib/sideLayout. Shell code: names no feature.
import { create } from "zustand";
import { translate } from "../i18n";
import type { Json } from "../modules/types";
import { pageLabel } from "./sideActions";
import { sideRegistry, sideViewNow } from "./sideComponents";
import {
  addShelfPage,
  collapseShelf,
  expandShelf,
  findPage,
  findShelf,
  focusedShelf,
  canMergePage,
  findCard,
  mergePageInto,
  moveShelfToOtherSide,
  movePage,
  pagesOfShelf,
  removePage,
  removeShelf,
  renamePage,
  restoreRemoved,
  setPageIcon,
  setShelfOptions,
  setShelfWidth,
  setSingleShelf,
  shelfLanePages,
  shelfOfPage,
  shelvesOf,
  splitCardOut,
  switchPage,
  visibleCards,
  type PageIcon,
  type RemovedShelfPart,
  type ShelfOptions,
  type ShelfSide,
  type SideViewContext,
} from "./sideLayout";
import { flashCard, setFocusedCard, setMode, updateLayout, useSide } from "./sideLayoutStore";
import { currentWindow, inWindow, type WindowKey } from "./windowScope";

// ── Read API (for the ⌘K quick switcher and other readers) ───────────────────────────────────────

/** One page of a Shelf as `listShelfPages` reports it. */
export interface ShelfPageInfo {
  shelfId: string;
  side: ShelfSide;
  pageId: string;
  /** Its place in its Shelf Rail, 1-based (Alt+n while that Shelf is focused). */
  index: number;
  /** The page's name: the owner's, else made from its panes (the rail tooltip). */
  name: string;
  /** Its rail icon id (lib/sideLayout PAGE_ICONS), null = its first pane's kind icon. */
  icon: PageIcon | null;
  /** The kind of its first pane (for an icon when `icon` is null), null for an empty page. */
  firstKind: string | null;
  /** Pinned (固定, in every conversation): its icon is the pin (lib/shelfIcons). */
  shared: boolean;
  /** It is its Shelf's page in view. */
  inView: boolean;
  /** It is the focused page (Alt+n acts on its Shelf). */
  focused: boolean;
  /** Panes on it the focused agent sees. */
  panes: number;
  /** Its Shelf is collapsed to its Shelf Rail (the page is not on screen). */
  shelfCollapsed: boolean;
}

function viewNow(): SideViewContext | null {
  try {
    return sideViewNow();
  } catch {
    return null; // the module host is not up yet (tests, first frame)
  }
}

/**
 * Every Shelf's rail pages for the focused agent, left Shelf first, rail order. Cheap and synchronous;
 * read it when the switcher opens (subscribe with `subscribeShelfPages` to follow changes).
 */
export function listShelfPages(): ShelfPageInfo[] {
  const { layout } = useSide.getState();
  const ctx = viewNow();
  if (!ctx) return [];
  const out: ShelfPageInfo[] = [];
  for (const shelf of shelvesOf(layout)) {
    shelfLanePages(layout, shelf.id, ctx).forEach((page, k) => {
      let name = page.name ?? translate("side.launcherName");
      try {
        name = pageLabel(page);
      } catch {
        // registry not up: never the internal id
      }
      out.push({
        shelfId: shelf.id,
        side: shelf.side,
        pageId: page.id,
        index: k + 1,
        name,
        icon: page.icon ?? null,
        firstKind: page.cards[0]?.kind ?? null,
        shared: !!page.shared,
        inView: shelf.active === page.id,
        focused: layout.activePage === page.id,
        panes: visibleCards(layout, page, ctx).length,
        shelfCollapsed: shelf.collapsed === true,
      });
    });
  }
  return out;
}

/** Calls `listener` whenever the Shelves' pages may have changed (their layout). Returns the unsubscribe. */
export function subscribeShelfPages(listener: () => void): () => void {
  return useSide.subscribe((s, prev) => {
    if (s.layout !== prev.layout) listener();
  });
}

/** Shows a page: its Shelf expanded (from its rail), the Shelves shown, the page in view and focused. False: no such page. */
export function openShelfPage(pageId: string): boolean {
  if (!findPage(useSide.getState().layout, pageId)) return false;
  const s = useSide.getState();
  if (s.mode?.card) setMode({ kind: s.mode.kind, card: null });
  updateLayout((l) => switchPage(l, pageId));
  return true;
}

// ── Pages ─────────────────────────────────────────────────────────────────────────────────────────

/** Alt+1…9 (lib/sideActions, where the window keys find it). */
export { switchShelfPage } from "./sideActions";

/** The rename / icon popover of a page button (components/side/ShelfRail). */
export const usePagePopover = create<{ pageId: string | null; fresh: boolean }>(() => ({ pageId: null, fresh: false }));

export function editPage(pageId: string, fresh = false): void {
  usePagePopover.setState({ pageId, fresh });
}

export function closePagePopover(): void {
  usePagePopover.setState({ pageId: null, fresh: false });
}

/** The rail's ＋: a new empty page at the end, in view, with its rename popover. Refused (a toast) at 9 pages. */
export function addPage(shelfId: string): string | null {
  let made: string | null = null;
  updateLayout((l) => {
    const r = addShelfPage(l, shelfId);
    made = r.pageId;
    return r.layout;
  });
  if (!made) {
    showShelfToast(translate("shelf.toast.pagesFull"));
    return null;
  }
  editPage(made, true);
  return made;
}

export function renamePageTo(pageId: string, name: string): void {
  updateLayout((l) => renamePage(l, pageId, name));
}

export function setPageIconTo(pageId: string, icon: PageIcon | null): void {
  updateLayout((l) => setPageIcon(l, pageId, icon));
}

/** 上移 / 下移 in the rail. */
export function movePageBy(pageId: string, delta: -1 | 1): void {
  updateLayout((l) => movePage(l, pageId, delta));
}

/**
 * A pane icon in a page's capsule clicked (design 038): the page shows (it may be another one, or the Shelf folded) and
 * that pane takes the focus and flashes.
 */
export function paneIconClick(pageId: string, cardId: string): void {
  const s = useSide.getState();
  const shelf = shelfOfPage(s.layout, pageId);
  if (!shelf || findCard(s.layout, cardId)?.page.id !== pageId) return;
  if (shelf.collapsed || !s.layout.open || shelf.active !== pageId) openShelfPage(pageId);
  setFocusedCard(cardId);
  flashCard(cardId);
}

/** The page above `pageId` in its Shelf's rail (合并到上一页), or null. */
export function pageAbove(pageId: string): string | null {
  const { layout } = useSide.getState();
  const shelf = shelfOfPage(layout, pageId);
  if (!shelf) return null;
  const rail = pagesOfShelf(layout, shelf.id);
  const k = rail.findIndex((p) => p.id === pageId);
  return k > 0 ? rail[k - 1]!.id : null;
}

/** 合并到上一页 (design 038): the page's panes join the page above it (≤ 3 together, else a toast). */
export function mergePageUp(pageId: string): void {
  const above = pageAbove(pageId);
  if (!above) return;
  if (!canMergePage(useSide.getState().layout, pageId, above)) return void showShelfToast(translate("shelf.dnd.mergeFull"));
  updateLayout((l) => mergePageInto(l, pageId, above));
}

/** 拆开 (design 038): a pane of a page with several becomes a page of its own right after it (≤ 9 pages, else a toast). */
export function splitPaneOut(cardId: string): void {
  const before = useSide.getState().layout;
  updateLayout((l) => splitCardOut(l, cardId, Date.now()));
  if (useSide.getState().layout === before && (findCard(before, cardId)?.page.cards.length ?? 0) > 1) showShelfToast(translate("shelf.toast.pagesFull"));
}

/** 删除这一页 (undoable): its panes go with it; their components' onClose runs once the undo is gone. */
export function deletePage(pageId: string): void {
  const { layout } = useSide.getState();
  const page = findPage(layout, pageId);
  if (!page) return;
  const name = pageLabel(page);
  let removed: RemovedShelfPart | null = null;
  updateLayout((l) => {
    const r = removePage(l, pageId);
    removed = r.removed;
    return r.layout;
  });
  const part = removed as RemovedShelfPart | null;
  if (!part) return;
  const panes = part.pages.reduce((n, p) => n + p.page.cards.length, 0);
  offerUndo(part, panes ? translate("shelf.toast.pageDeletedPanes", { name, n: panes }) : translate("shelf.toast.pageDeleted", { name }));
}

// ── Shelves ───────────────────────────────────────────────────────────────────────────────────────

export function setShelfOption(shelfId: string, patch: Partial<ShelfOptions>): void {
  updateLayout((l) => setShelfOptions(l, shelfId, patch));
}

/** 只用一个 Shelf on / off (the ⋯ menu, Settings → 右侧栏). Shelves already there stay. */
export function setSingleShelfNow(on: boolean): void {
  updateLayout((l) => setSingleShelf(l, on));
}

/** 收起 (owner 2026-10-21): the Shelf becomes its Shelf Rail only, a strip in place. */
export function collapseShelfNow(shelfId: string): void {
  const s = useSide.getState();
  const page = s.mode?.card ? findCardPage(s.mode.card) : s.mode ? s.layout.activePage : null;
  if (s.mode && shelfOfPage(s.layout, page)?.id === shelfId) setMode(null);
  updateLayout((l) => collapseShelf(l, shelfId));
}

function findCardPage(cardId: string): string | null {
  for (const page of useSide.getState().layout.pages) if (page.cards.some((c) => c.id === cardId)) return page.id;
  return null;
}

/** A collapsed Shelf expands (its page in view, or `pageId`). */
export function expandShelfNow(shelfId: string, pageId: string | null = null): void {
  updateLayout((l) => expandShelf(l, shelfId, pageId));
}

/** The collapse button at the bottom of a Shelf Rail: collapsed ↔ expanded. */
export function toggleShelfNow(shelfId: string): void {
  const layout = useSide.getState().layout;
  const shelf = findShelf(layout, shelfId);
  if (!shelf) return;
  // A closed tool area's Shelf shows as its rail (Shelf Rail 常驻, §24.12.3): its button expands it.
  if (shelf.collapsed || !layout.open) expandShelfNow(shelfId);
  else collapseShelfNow(shelfId);
}

/**
 * A page button of a Shelf Rail clicked (owner 2026-10-21): on a collapsed Shelf it expands to that page; another
 * page comes into view. The page in view of an expanded Shelf: nothing (owner 2026-10-22; lib/sideLayout railPageClick).
 */
export function railPageClickNow(pageId: string): void {
  const s = useSide.getState();
  const shelf = shelfOfPage(s.layout, pageId);
  if (!shelf) return;
  if (!shelf.collapsed && s.layout.open && shelf.active === pageId) return;
  openShelfPage(pageId);
}

/** 移到另一边. */
export function moveShelfSide(shelfId: string): void {
  updateLayout((l) => moveShelfToOtherSide(l, shelfId));
}

/** A Shelf's width handle released (null: back to the default width, appearance.sidePaneWidth). */
export function commitShelfWidth(shelfId: string, width: number | null): void {
  updateLayout((l) => setShelfWidth(l, shelfId, width));
}

/** 关闭 Shelf (undoable): every page and pane of it goes; their components' onClose runs once the undo is gone. */
export function closeShelf(shelfId: string): void {
  const { layout } = useSide.getState();
  const shelf = findShelf(layout, shelfId);
  if (!shelf) return;
  const panes = pagesOfShelf(layout, shelfId).reduce((n, p) => n + p.cards.length, 0);
  let removed: RemovedShelfPart | null = null;
  const s = useSide.getState();
  if (s.mode) setMode(null);
  updateLayout((l) => {
    const r = removeShelf(l, shelfId);
    removed = r.removed;
    return r.layout;
  });
  const part = removed as RemovedShelfPart | null;
  if (part) offerUndo(part, translate("shelf.toast.shelfClosed", { n: panes }));
}

// ── The undo toast ────────────────────────────────────────────────────────────────────────────────

export interface ShelfToast {
  id: number;
  text: string;
  /** 撤销 (absent: a plain notice). */
  undo?: () => void;
  /** A notice's one action (「去看看」), instead of 撤销. */
  action?: { label: string; run: () => void };
  /** The window it shows in (multi-window P3.5): the one the Shelf change happened in; its undo acts there. */
  win?: WindowKey;
}

/** How long a Shelf toast stays (its undo with it). */
export const SHELF_TOAST_MS = 7000;

export const useShelfToast = create<{ toast: ShelfToast | null }>(() => ({ toast: null }));

let toastSeq = 0;
let toastTimer: ReturnType<typeof setTimeout> | null = null;
/** What happens when the toast goes without its undo (the removed instances' onClose). */
let onExpire: (() => void) | null = null;

function settle(): void {
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = null;
  const run = onExpire;
  onExpire = null;
  run?.();
}

/** A toast at the bottom of the window (one at a time: a new one settles the old one first). */
export function showShelfToast(text: string, undo?: () => void, expire?: () => void): void {
  settle();
  const id = ++toastSeq;
  onExpire = expire ?? null;
  useShelfToast.setState({ toast: { id, text, ...(undo ? { undo } : {}), win: currentWindow() } });
  toastTimer = setTimeout(() => dismissShelfToast(id), SHELF_TOAST_MS);
}

/** A notice with one action (no undo): the action closes the toast. */
export function showShelfNotice(text: string, action: { label: string; run: () => void }): void {
  settle();
  const id = ++toastSeq;
  useShelfToast.setState({ toast: { id, text, action, win: currentWindow() } });
  toastTimer = setTimeout(() => dismissShelfToast(id), SHELF_TOAST_MS);
}

/** The toast goes (its time is up, or its ×): what it offered to undo is final. */
export function dismissShelfToast(id?: number): void {
  const t = useShelfToast.getState().toast;
  if (!t || (id !== undefined && t.id !== id)) return;
  useShelfToast.setState({ toast: null });
  settle();
}

/** The toast's 撤销. */
export function undoShelfToast(): void {
  const t = useShelfToast.getState().toast;
  if (!t?.undo) return;
  onExpire = null;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = null;
  useShelfToast.setState({ toast: null });
  if (t.win) inWindow(t.win, t.undo);
  else t.undo();
}

function offerUndo(part: RemovedShelfPart, text: string): void {
  showShelfToast(
    text,
    () => updateLayout((l) => restoreRemoved(l, part)),
    () => void finalizeRemoved(part),
  );
}

/** The removed instances' components close them for good (their `onClose`: a terminal's process ends). */
async function finalizeRemoved(part: RemovedShelfPart): Promise<void> {
  let registry: ReturnType<typeof sideRegistry>;
  try {
    registry = sideRegistry();
  } catch {
    return;
  }
  for (const [id, inst] of Object.entries(part.instances)) {
    // Back in the layout (an undo raced the timer): nothing to close.
    if (useSide.getState().layout.instances[id]) continue;
    const item = registry.get(inst.kind)?.item;
    if (!item?.onClose) continue;
    try {
      await item.onClose({ id, kind: inst.kind, binding: inst.binding, state: inst.state as Json, pinned: inst.pinned });
    } catch {
      // a failing onClose does not bring the page back
    }
  }
}

/** Before the window goes: a pending undo is final (its onClose runs now). */
export function settleShelfToast(): void {
  if (useShelfToast.getState().toast) useShelfToast.setState({ toast: null });
  settle();
}
