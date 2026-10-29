// Drag and drop of panes, the DOM part (docs/desktop-modules.md §24 step 4; decisions in lib/sideDrop.ts):
// pointer events on the handles (a pane's header, a tab, a conversation pane's header, and handles
// outside the panes), a probe of what lies under the pointer (which pane, which zone of it, or the work
// area's far edge), the drop, and the feedback the overlay (components/side/SideDndLayer.tsx) draws: the
// zone that lights up and a label saying what the drop does. No new dependency, no HTML5 drag events.
// While a drag runs, a shield covers the window (cursor, no stray hovers), the instance layer stops taking
// pointer events (a guest <webview> would swallow them) and Esc cancels before anything else sees the key.
// Shell code: no feature names.
import { create } from "zustand";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { Icon } from "../modules/slots";
import type { ItemId } from "../modules/types";
import { translate, type MessageKey } from "../i18n";
import { sidebarOf, useApp } from "../store";
import { cardName } from "./sideActions";
import { sideRegistry, sideViewNow, specFrom } from "./sideComponents";
import { applyToolDrop, applyWorkDrop, resolveDrop, zoneAt, type SideDrag, type SideDropTarget, type SideHit } from "./sideDrop";
import { DEFAULT_ORDER, findCard, findPage, findShelf, mergePageInto, movePageTo, openLauncherPage, SHELF_PANE_GAP, shelfOfPage, shownCards, switchPage, visibleTabs, type SideLayout } from "./sideLayout";
import { orderForecast, pageForecast, sameBox } from "./dropForecast";
import { arrangementKey } from "./dropUndo";
import { endMorph, inMorphed, morphHit, morphTo, reducedMotion, restRect } from "./dropMorph";
import { movePageToPeer, movePaneToPeer, peerDropResult, peerDropTarget, peerPageDropTarget, peerView, setMode, shelfDropKeys, shelfDropSnapshot, undoShelfDrop, updateLayout, updatePeerView, useSide, type ShelfDropSnapshot } from "./sideLayoutStore";
import { conversationPanes, focusedConversation, paneBinding } from "./paneLayout";
import { setPaneLayout, usePanes } from "./paneStore";
import { roomForColumn } from "./paneRoom";
import { pageLabel } from "./sideActions";
import { showShelfToast } from "./shelves";
import { isElement, ownerWindowOf } from "./ownerWindow";
import { onEveryAppWindow } from "./appWindowSet";

/** Hovering a page button this long while dragging shows that page (§24.12). */
export const PAGE_HOVER_MS = 400;

/** Pointer travel (px) before a press on a handle becomes a drag (a shorter press stays a click). */
export const DRAG_THRESHOLD = 4;
/** The work area's far left / right edge takes a "new column" drop this far in (and a little beyond). */
export const EDGE_BAND = 18;
const EDGE_OUTSIDE = 48;

/** A handle outside the panes (the left gutter's reference card icon): what it shows and what a drop does. */
export interface ExternalDragSpec {
  /** Who drags (the source dims itself while useSideDnd's drag.source is this). */
  source: string;
  icon: Icon;
  title: string;
  /** The ghost's note (default: 引用). */
  note?: string;
  /** Its own place: dropping there does nothing ("原位置"). `el` = the topmost element at (x, y), client px. */
  isOrigin?(el: Element, x: number, y: number): boolean;
  /** Dropped on a tool column or a new one; the caller opens its content there (pageForDrop). */
  onDrop(target: { page: string } | { newPage: true }): void;
}

export interface DragGhost {
  kind: ItemId | null;
  icon: Icon | null;
  title: string;
  note: string;
  count: number;
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * A pane / column the drop moves or resizes, where it ends up: its element (the live preview moves it there,
 * lib/dropMorph) and, for a tool pane, its card (its instances move with it). `self`: the dragged one (its place
 * is the zone; never drawn as a dashed box).
 */
export type DropGhost = Box & { text: string; el?: HTMLElement; card?: { id: string; peer: string | null }; self?: boolean };

/** What the overlay draws for the current target (fixed, client px). */
export interface DropFeedback {
  /** The part of the window the drop takes (a half of a pane, a header, a column, the edge band) with its label inside. */
  zone: (Box & { text: string; tone: "accent" | "tab" | "warn"; round: number; float?: "left" | "right" }) | null;
  /**
   * The other panes / columns the drop moves or resizes (owner 2026-10-23): where each ends up, a light dashed box with
   * its name. The zone itself is where the dragged one lands (lib/dropForecast: the drop's own layout function).
   */
  ghosts?: DropGhost[];
  /** The panes moved live to show the result (lib/dropMorph; prefers-reduced-motion: none — the ghosts show it). */
  morph?: boolean;
  /** A tab bar that refuses the drop (允许混排 off, §24.12): drawn striped. */
  nope?: Box | null;
  /** A label near the pointer (refusals, the drag's own origin). */
  label: { text: string; x: number; y: number; side: "left" | "right"; tone: "refuse" | "neutral" } | null;
}

export interface SideDndState {
  drag: SideDrag | null;
  ghost: DragGhost | null;
  x: number;
  y: number;
  target: SideDropTarget | null;
  /** The target is in the other workspace's Shelf (§24.13: its `convKey`), not the focused one's. */
  peer: string | null;
  feedback: DropFeedback;
  /** The window the drag runs in when it is a desk window (multi-window; the preview layer draws there). */
  doc?: Document;
}

const NO_FEEDBACK: DropFeedback = { zone: null, label: null };

/**
 * The window the last press / drag is in (multi-window: a handle in a desk window drags there — its pointer, its
 * areas, its click guard). Null until the first press: this window.
 */
let dragWin: Window | null = null;
const view = (): Window => dragWin ?? window;

export const useSideDnd = create<SideDndState>(() => ({ drag: null, ghost: null, x: 0, y: 0, target: null, peer: null, feedback: NO_FEEDBACK }));

/** A drag is running (the instance layer drops pointer events). */
export function sideDragging(): boolean {
  return useSideDnd.getState().drag !== null;
}

// ── Probe (DOM → SideHit) ───────────────────────────────────────────────────────────────────────

/** An element's box — at rest: a pane the live preview moved counts where it is in the layout (lib/dropMorph). */
const rectOf = (el: Element): Box => restRect(el);
const inside = (b: Box, x: number, y: number) => x >= b.left && x <= b.left + b.width && y >= b.top && y <= b.top + b.height;

/** The work area (conversation card + tool area). */
function workArea(): HTMLElement | null {
  return view().document.querySelector<HTMLElement>("[data-side-work]");
}

/** The topmost element under the pointer, our own overlay left out. */
function topElement(x: number, y: number): Element | null {
  // A pane moved by the live preview is hit where it rests (it never changes the target by moving under the pointer).
  const moved = morphHit(x, y);
  if (moved) return moved;
  for (const el of view().document.elementsFromPoint(x, y)) if (!el.closest("[data-side-dnd]") && !inMorphed(el)) return el;
  return null;
}

/** A conversation pane's element: its column (several), else the conversation card (one pane). */
function conversationElement(paneId: string): HTMLElement | null {
  return view().document.querySelector<HTMLElement>(`[data-conv-pane="${CSS.escape(paneId)}"]`) ?? (focusedConversation(usePanes.getState().layout) === paneId ? view().document.querySelector<HTMLElement>('[data-focus-region="main"]') : null);
}

/** The pane under `el`: a tool pane, a conversation column, or the conversation card holding one pane. */
function paneUnder(el: Element): { area: "work" | "tools"; id: string; box: Element } | null {
  const card = el.closest<HTMLElement>("[data-side-card]");
  if (card?.dataset.sideCard) return { area: "tools", id: card.dataset.sideCard, box: card };
  // A gap between two tool panes: the pane below's top.
  const gap = el.closest<HTMLElement>("[data-side-gap]");
  if (gap?.dataset.sideGap) {
    const below = view().document.querySelector(`[data-side-card="${CSS.escape(gap.dataset.sideGap)}"]`);
    if (below) return { area: "tools", id: gap.dataset.sideGap, box: below };
  }
  const column = el.closest<HTMLElement>("[data-conv-pane]");
  if (column?.dataset.convPane) return { area: "work", id: column.dataset.convPane, box: column };
  const main = el.closest<HTMLElement>('[data-focus-region="main"]');
  const one = main ? focusedConversation(usePanes.getState().layout) : null;
  return main && one ? { area: "work", id: one, box: main } : null;
}

/** The other workspace's Shelf under (x, y) (§24.13, `data-ws-peer` = its conversation's `convKey`), or null. */
export function peerAt(x: number, y: number): string | null {
  return topElement(x, y)?.closest<HTMLElement>("[data-ws-peer]")?.dataset.wsPeer || null;
}

/** The layout a target's ids are in: the focused Shelf's, or the other workspace's as it shows. */
function layoutFor(peer: string | null): SideLayout {
  const s = useSide.getState();
  const p = peer ? s.peers[peer] : null;
  return p ? peerView(p, s.layout) : s.layout;
}

/**
 * An element of the focused Shelf (`peer` null) or of the other workspace's (`peer`: its key). Page / pane ids are
 * unique within a conversation only: the same id may be on both workspaces' Shelves.
 */
function pick(selector: string, peer: string | null): Element | null {
  for (const el of view().document.querySelectorAll(selector)) {
    const owner = el.closest<HTMLElement>("[data-ws-peer]")?.dataset.wsPeer ?? null;
    if (owner === peer) return el;
  }
  return null;
}

/**
 * Is (x, y) on a Shelf Rail's empty space below its last capsule? `pageBottoms` = the page buttons' bottom edges, `onButton`
 * = the point is on some button (a capsule, the ＋, the fold / ⋯ buttons keep their own meaning). Pure.
 */
export function railEmptyBelow(y: number, pageBottoms: readonly number[], onButton: boolean): boolean {
  return !onButton && (pageBottoms.length === 0 || y > Math.max(...pageBottoms));
}

/** What lies under (x, y) for the drop rules (lib/sideDrop.ts). */
export function probe(x: number, y: number, external: ExternalDragSpec | null): SideHit {
  const el = topElement(x, y);
  // A surface that takes no drops (`data-no-drop`, e.g. a window-level Shelf) is in front: nothing there.
  if (el?.closest("[data-no-drop]")) return { at: "none" };
  // A Shelf Rail's page button or ＋ (§24.12) wins over the work area's edge band it may sit in.
  const pageButton = el?.closest<HTMLElement>("[data-shelf-page]");
  if (pageButton?.dataset.shelfPage) {
    const b = rectOf(pageButton);
    // Design 038: the top / bottom quarter = before / after (a dragged page), the middle = into it.
    const q = b.height / 4;
    const zone = y < b.top + q ? "top" : y > b.top + b.height - q ? "bottom" : "middle";
    return { at: "page", pageId: pageButton.dataset.shelfPage, half: y < b.top + b.height / 2 ? "top" : "bottom", zone };
  }
  const add = el?.closest<HTMLElement>("[data-shelf-add]");
  if (add?.dataset.shelfAdd) return { at: "newPage", shelfId: add.dataset.shelfAdd };
  // Owner 2026-10-23: the empty space at the bottom of a Shelf Rail, below its last capsule, is the ＋ too (same drop, same label).
  const rail = el?.closest<HTMLElement>("[data-shelf-rail]");
  if (rail?.dataset.shelfRail && railEmptyBelow(y, [...rail.querySelectorAll("[data-shelf-page]")].map((b) => b.getBoundingClientRect().bottom), !!el?.closest("button"))) return { at: "newPage", shelfId: rail.dataset.shelfRail };
  const work = workArea();
  if (work) {
    const b = rectOf(work);
    if (y >= b.top && y <= b.top + b.height) {
      if (x <= b.left + EDGE_BAND && x >= b.left - EDGE_OUTSIDE) return { at: "edge", side: "left" };
      if (x >= b.left + b.width - EDGE_BAND && x <= b.left + b.width + EDGE_OUTSIDE) return { at: "edge", side: "right" };
    }
  }
  if (!el) return { at: "none" };
  if (external?.isOrigin?.(el, x, y)) return { at: "origin" };
  const pane = paneUnder(el);
  if (pane) {
    const box = rectOf(pane.box);
    const head = el.closest("[data-side-card-head], [data-pane-header]");
    return { at: "pane", area: pane.area, id: pane.id, zone: head ? "head" : zoneAt(box, x, y), half: x < box.left + box.width / 2 ? "left" : "right" };
  }
  return { at: "outside" };
}

// ── Feedback (target → what the overlay draws) ─────────────────────────────────────────────────

/** A label under the ghost (to the pointer's left near the window's right edge, like the ghost). */
function nearPointer(text: string, x: number, y: number, tone: "refuse" | "neutral"): NonNullable<DropFeedback["label"]> {
  // The ghost spans y + 12 … y + 40.
  return x > view().innerWidth - 240 ? { text, x: x - 14, y: y + 54, side: "left", tone } : { text, x: x + 14, y: y + 54, side: "right", tone };
}

const half = (b: Box, side: "left" | "right" | "top" | "bottom"): Box => {
  switch (side) {
    case "left":
      return { ...b, width: b.width / 2 };
    case "right":
      return { ...b, left: b.left + b.width / 2, width: b.width / 2 };
    case "top":
      return { ...b, height: b.height / 2 };
    case "bottom":
      return { ...b, top: b.top + b.height / 2, height: b.height / 2 };
  }
};

const REFUSE_TEXT: Record<string, MessageKey> = {
  limit: "pane.dnd.refuseLimit",
  tools: "pane.dnd.refuseTools",
  conversation: "pane.dnd.refuseConversation",
  pageFull: "shelf.dnd.pageFull",
  mixing: "shelf.dnd.mixingFull",
  bound: "shelf.dnd.boundElsewhere",
  shared: "shelf.dnd.sharedElsewhere",
};

/** A kind's name for the labels (its title; the id when the registry is not up). */
function kindName(kind: ItemId): string {
  try {
    const entry = sideRegistry().get(kind);
    return entry ? translate(entry.item.titleKey) : kind;
  } catch {
    return kind;
  }
}

/** A rail button's zone is tiny: its label floats beside it, toward the conversations. */
function floatBeside(fb: DropFeedback, el: Element | null): DropFeedback {
  if (!fb.zone || !el) return fb;
  const b = rectOf(el);
  return { ...fb, zone: { ...fb.zone, float: b.left + b.width / 2 > view().innerWidth / 2 ? "left" : "right" } };
}

/** A rail button's box, a little bigger (the zone around it). */
const around = (el: Element): Box => {
  const b = rectOf(el);
  return { left: b.left - 3, top: b.top - 3, width: b.width + 6, height: b.height + 6 };
};

/** A conversation's name (its agent's display name) for the labels. */
function conversationName(paneId: string): string {
  const b = paneBinding(usePanes.getState().layout, paneId);
  if (!b?.sessionId) return "";
  const sidebar = sidebarOf(useApp.getState(), b.hostId);
  return [...(sidebar?.active ?? []), ...(sidebar?.retired ?? [])].find((r) => r.cutexSessionId === b.sessionId)?.displayName ?? b.sessionId;
}

/**
 * A pane dropped into a Shelf page (owner 2026-10-23): the page after applyToolDrop, laid out like SidePageView lays it
 * out — where the dropped pane lands, and dashed boxes for the panes it resizes. Null: the page is not on screen.
 */
function toolForecast(layout: SideLayout, drag: SideDrag, target: SideDropTarget, pageId: string, peer: string | null = null): { zone: Box; ghosts: DropGhost[] } | null {
  const column = pick(`[data-side-column="${CSS.escape(pageId)}"]`, peer);
  if (!column) return null;
  // Into the other workspace's Shelf: what movePaneToPeer computes (the pane carried over, then the same drop rules).
  const cross = peer ? peerDropResult(peer, drag, target, Date.now(), orderOf) : null;
  if (peer && !cross) return null;
  const after = cross ? cross.after : applyToolDrop(layout, drag, target, Date.now(), orderOf);
  const page = findPage(after, pageId);
  if (after === layout || !page) return null;
  const before = new Set(findPage(layout, pageId)?.cards.map((c) => c.id) ?? []);
  const ctx = cross ? cross.ctx : sideViewNow();
  const cards = ctx ? shownCards(after, page, ctx) : page.cards.filter((c) => c.tabs.length > 0);
  const moved = cards.find((c) => (drag.type === "card" && c.id === drag.cardId) || !before.has(c.id));
  if (!moved) return null;
  const registry = sideRegistry();
  const boxes = pageForecast(
    cards.map((c) => ({ id: c.id, size: c.size, collapsed: c.collapsed, minHeight: registry.get(c.kind)?.item.minHeight })),
    rectOf(column),
    SHELF_PANE_GAP,
  );
  const zone = boxes.get(moved.id);
  if (!zone) return null;
  const ghosts = cards.flatMap((c): DropGhost[] => {
    const b = boxes.get(c.id);
    const el = pick(`[data-side-card="${CSS.escape(c.id)}"]`, peer) as HTMLElement | null;
    return b && el && !sameBox(rectOf(el), b) ? [{ ...b, text: translate("pane.dnd.ghost", { name: cardName(c) }), el, card: { id: c.id, peer }, ...(c === moved ? { self: true } : {}) }] : [];
  });
  return { zone, ghosts };
}

/**
 * A conversation column moved (owner 2026-10-23): the order after applyWorkDrop, each column in the place it takes —
 * the dragged one's box, and dashed boxes for the columns that make room. Null: not a plain reorder on screen.
 */
function workForecast(drag: SideDrag, target: SideDropTarget): { zone: Box; ghosts: DropGhost[] } | null {
  if (drag.type !== "conversation") return null;
  const work = usePanes.getState().layout;
  const after = applyWorkDrop(work, drag, target);
  if (after === work) return null;
  const now = conversationPanes(work);
  const rects = new Map<string, Box>();
  for (const id of now) {
    const el = view().document.querySelector(`[data-conv-pane="${CSS.escape(id)}"]`);
    if (el) rects.set(id, rectOf(el));
  }
  const boxes = orderForecast(now, conversationPanes(after), rects);
  const zone = boxes.get(drag.paneId);
  if (!zone) return null;
  const ghosts = now.flatMap((id): DropGhost[] => {
    const b = boxes.get(id);
    const was = rects.get(id);
    const el = view().document.querySelector<HTMLElement>(`[data-conv-pane="${CSS.escape(id)}"]`);
    return b && was && el && !sameBox(was, b) ? [{ ...b, text: translate("pane.dnd.ghost", { name: conversationName(id) }), el, ...(id === drag.paneId ? { self: true } : {}) }] : [];
  });
  return { zone, ghosts };
}

function feedbackFor(target: SideDropTarget | null, drag: SideDrag, hit: SideHit, x: number, y: number, layout: SideLayout = useSide.getState().layout, peer: string | null = null): DropFeedback {
  if (!target) return NO_FEEDBACK;
  const card = (id: string) => pick(`[data-side-card="${CSS.escape(id)}"]`, peer);
  const zone = (box: Box | null, key: MessageKey, vars: Record<string, string> = {}, tone: "accent" | "tab" = "accent", round = 12): DropFeedback =>
    box ? { zone: { ...box, text: translate(key, vars), tone, round }, label: null } : NO_FEEDBACK;
  switch (target.kind) {
    case "split": {
      const el = card(target.cardId);
      // Where it really lands (lib/dropForecast) — in the other workspace's Shelf too (its drop's own result).
      const at = findCard(layout, target.cardId);
      const fc = at ? toolForecast(layout, drag, target, at.page.id, peer) : null;
      if (target.unmixed) {
        // 允许混排 off: the drop lands as a pane below (warned: its tab bar does not take another kind).
        const out = zone(fc?.zone ?? (el ? half(rectOf(el), "bottom") : null), "shelf.dnd.unmixed", { kinds: target.unmixed.kinds.map(kindName).join(translate("shelf.dnd.kindSep")) }, "accent");
        const head = el?.querySelector("[data-side-card-head]");
        return out.zone ? { ...out, zone: { ...out.zone, tone: "warn" as const }, nope: head ? rectOf(head) : null, ghosts: fc?.ghosts } : out;
      }
      return { ...zone(fc?.zone ?? (el ? half(rectOf(el), target.side) : null), target.side === "top" ? "pane.dnd.top" : "pane.dnd.bottom"), ghosts: fc?.ghosts };
    }
    case "page": {
      const el = view().document.querySelector(`[data-shelf-page="${CSS.escape(target.pageId)}"]`);
      const page = findPage(layout, target.pageId);
      return floatBeside(zone(el ? around(el) : null, "shelf.dnd.toPage", { name: page ? pageLabel(page) : "" }, "accent", 11), el);
    }
    case "newPage": {
      const el = view().document.querySelector(`[data-shelf-add="${CSS.escape(target.shelfId)}"]`);
      if (el) return floatBeside(zone(around(el), "shelf.dnd.newPage", {}, "accent", 11), el);
      // The edge on a Shelf's side: the band along that edge.
      const work = workArea();
      const shelf = findShelf(layout, target.shelfId);
      if (!work || !shelf) return NO_FEEDBACK;
      const b = rectOf(work);
      const w = Math.min(b.width * 0.3, 320);
      return zone({ ...b, left: shelf.side === "left" ? b.left : b.left + b.width - w, width: w }, "shelf.dnd.newPage");
    }
    case "merge": {
      const el = card(target.cardId);
      if (!el) return NO_FEEDBACK;
      const head = el.querySelector("[data-side-card-head]");
      const onHead = hit.at === "pane" && hit.zone === "head" && hit.id === target.cardId && head;
      return zone(onHead ? rectOf(head) : rectOf(el), target.narrow ? "pane.dnd.tabNarrow" : "pane.dnd.tab", {}, "tab", onHead ? 9 : 12);
    }
    case "conversation": {
      // The columns trade places (lib/paneLayout moveConversation): the place it takes, not half of the other one.
      const fc = workForecast(drag, target);
      if (fc) return { ...zone(fc.zone, "pane.dnd.here", { name: conversationName(drag.type === "conversation" ? drag.paneId : "") }), ghosts: fc.ghosts };
      const el = conversationElement(target.near);
      return zone(el ? half(rectOf(el), target.side) : null, target.side === "left" ? "pane.dnd.left" : "pane.dnd.right");
    }
    case "edge":
    case "new": {
      const fc = target.kind === "edge" ? workForecast(drag, target) : null;
      if (fc && drag.type === "conversation") return { ...zone(fc.zone, "pane.dnd.here", { name: conversationName(drag.paneId) }), ghosts: fc.ghosts };
      // A conversation goes to the conversations' far edge (the tools stay right of them); a tool to the work area's.
      const work = drag.type === "conversation" ? view().document.querySelector('[data-focus-region="main"]') : workArea();
      if (!work) return NO_FEEDBACK;
      const b = rectOf(work);
      const w = Math.min(b.width * 0.3, 320);
      const side = target.kind === "edge" ? target.side : "right";
      const key: MessageKey = drag.type === "conversation" || target.kind === "new" ? (side === "left" ? "pane.dnd.edgeLeft" : "pane.dnd.edgeRight") : side === "left" ? "shelf.dnd.newShelfLeft" : "shelf.dnd.newShelfRight";
      return zone({ ...b, left: side === "left" ? b.left : b.left + b.width - w, width: w }, key);
    }
    case "pin": {
      const column = view().document.querySelector(`[data-side-column="${CSS.escape(target.pageId)}"]`);
      const page = findPage(layout, target.pageId);
      return zone(column ? rectOf(column) : null, "side.dnd.pin", { name: page ? pageLabel(page) : "" });
    }
    case "refuse": {
      const out: DropFeedback = { zone: null, label: nearPointer(translate(REFUSE_TEXT[target.why]!), x, y, "refuse") };
      // 允许混排 off and no room: the tab bar it was dropped on is striped.
      if (target.why === "mixing" && hit.at === "pane") {
        const head = card(hit.id)?.querySelector("[data-side-card-head]");
        if (head) out.nope = rectOf(head);
      }
      return out;
    }
    case "noop":
      return { zone: null, label: nearPointer(translate("side.dnd.origin"), x, y, "neutral") };
    case "mergePage": {
      // Design 038: the page's capsule it joins, outlined, with what happens beside it.
      const el = pick(`[data-shelf-page="${CSS.escape(target.into)}"]`, peer);
      const page = findPage(layout, target.into);
      return floatBeside(zone(el ? around(el) : null, "shelf.dnd.mergePage", { name: page ? pageLabel(page) : "" }, "accent", 13), el);
    }
    case "movePage": {
      // A dragged page (owner 2026-10-22): an insertion line in the rail where it goes, its label beside it.
      const where = target.before ? pick(`[data-shelf-page="${CSS.escape(target.before)}"]`, peer) : pick(`[data-shelf-add="${CSS.escape(target.shelfId)}"]`, peer);
      if (!where) return NO_FEEDBACK;
      const b = rectOf(where);
      const across = findPage(layout, target.pageId)?.shelf !== target.shelfId;
      const line: Box = { left: b.left - 2, top: b.top - 4, width: b.width + 4, height: 3 };
      return floatBeside(zone(line, across ? "shelf.dnd.movePageShelf" : "shelf.dnd.movePage", {}, "accent", 2), where);
    }
  }
}

// ── The drag ────────────────────────────────────────────────────────────────────────────────────

interface Running {
  drag: SideDrag;
  external: ExternalDragSpec | null;
  /** The pending re-probe (a timer, not a frame: it also runs while the window is not painting). */
  frame: ReturnType<typeof setTimeout> | null;
  /** The latest pointer position the pending re-probe reads. */
  at: { x: number; y: number };
  offLayout: () => void;
  /** The page button hovered (§24.12) and the timer that shows its page after PAGE_HOVER_MS. */
  hover: { pageId: string; timer: ReturnType<typeof setTimeout> } | null;
}

let pending: { x: number; y: number; make: () => SideDrag | null; external: ExternalDragSpec | null } | null = null;
let running: Running | null = null;

const orderOf = (kind: ItemId) => specFrom(sideRegistry(), kind)?.order ?? DEFAULT_ORDER;

function ghostFor(drag: SideDrag, external: ExternalDragSpec | null): DragGhost | null {
  const { layout, tabInfo } = useSide.getState();
  switch (drag.type) {
    case "card": {
      const at = findCard(layout, drag.cardId);
      if (!at) return null;
      const n = visibleTabs(layout, at.card, sideViewNow()).length || at.card.tabs.length;
      return { kind: at.card.kind, icon: sideRegistry().get(at.card.kind)?.item.icon ?? null, title: cardName(at.card), note: translate("pane.dnd.pane"), count: n };
    }
    case "tab": {
      const inst = layout.instances[drag.instanceId];
      if (!inst) return null;
      const entry = sideRegistry().get(inst.kind);
      const title = tabInfo[drag.instanceId]?.title || (entry ? translate(entry.item.titleKey) : inst.kind);
      return { kind: inst.kind, icon: entry?.item.icon ?? null, title, note: translate("side.dnd.tab"), count: 1 };
    }
    case "conversation": {
      const b = paneBinding(usePanes.getState().layout, drag.paneId);
      if (!b?.sessionId) return null;
      const s = useApp.getState();
      const sidebar = sidebarOf(s, b.hostId);
      const row = [...(sidebar?.active ?? []), ...(sidebar?.retired ?? [])].find((r) => r.cutexSessionId === b.sessionId);
      return { kind: null, icon: null, title: row?.displayName ?? b.sessionId, note: translate("pane.dnd.conversation"), count: 1 };
    }
    case "external":
      return external ? { kind: null, icon: external.icon, title: external.title, note: external.note ?? translate("side.dnd.ref"), count: 1 } : null;
    case "page": {
      const page = findPage(layout, drag.pageId);
      if (!page) return null;
      const kind = page.cards[0]?.kind ?? null;
      return { kind, icon: kind ? (sideRegistry().get(kind)?.item.icon ?? null) : null, title: pageLabel(page), note: translate("shelf.dnd.page"), count: page.cards.length || 1 };
    }
  }
}

/** Re-reads what is under the pointer (after a move, or a layout change mid-drag). */
function update(x: number, y: number): void {
  const r = running;
  if (!r) return;
  const hit = probe(x, y, r.external);
  // A pane / tab over the other workspace's Shelf (§24.13, both live): the drop rules run against that Shelf.
  const peer = r.drag.type === "card" || r.drag.type === "tab" ? peerAt(x, y) : null;
  // A dragged page onto the other workspace's Rail (audit #1): the same rules there, against that Shelf (its ids); it
  // does not switch pages on hover, the focus stays.
  const pagePeer = r.drag.type === "page" ? peerAt(x, y) : null;
  if (r.drag.type === "page" && pagePeer) {
    hoverPage(r, null);
    const target = peerPageDropTarget(pagePeer, r.drag.pageId, hit);
    useSideDnd.setState({ x, y, target, peer: pagePeer, feedback: withMorph(feedbackFor(target, r.drag, hit, x, y, layoutFor(pagePeer), pagePeer)) });
    return;
  }
  hoverPage(r, hit.at === "page" && r.drag.type !== "page" ? hit.pageId : null, peer);
  const target = peer ? peerDropTarget(peer, r.drag, hit, roomForColumn()) : resolveDrop({ side: useSide.getState().layout, work: usePanes.getState().layout, roomForColumn: roomForColumn() }, r.drag, hit);
  useSideDnd.setState({ x, y, target, peer, feedback: withMorph(feedbackFor(target, r.drag, hit, x, y, layoutFor(peer), peer)) });
}

/**
 * The live preview (owner 2026-10-23, lib/dropMorph): the panes the drop moves go to where it puts them now; none
 * (another target, nothing to move) — they glide back. prefers-reduced-motion: no motion, the dashed boxes instead.
 */
function withMorph(fb: DropFeedback): DropFeedback {
  if (reducedMotion()) return fb;
  const moves = (fb.ghosts ?? []).flatMap((g) => (g.el ? [{ el: g.el, to: { left: g.left, top: g.top, width: g.width, height: g.height }, ...(g.card ? { card: g.card } : {}) }] : []));
  morphTo(moves);
  return moves.length ? { ...fb, morph: true } : fb;
}

/** A page button hovered for PAGE_HOVER_MS while dragging shows its page (the drop may then go into one of its panes). */
function hoverPage(r: Running, pageId: string | null, peer: string | null = null): void {
  if (r.hover?.pageId === pageId) return;
  if (r.hover) clearTimeout(r.hover.timer);
  r.hover = null;
  if (!pageId) return;
  const layout = layoutFor(peer);
  if (shelfOfPage(layout, pageId)?.active === pageId) return;
  r.hover = {
    pageId,
    timer: setTimeout(() => {
      if (running !== r) return;
      // The other workspace's Shelf shows the page in its own Shelf (the focus stays where it is).
      if (peer) updatePeerView(peer, (l) => (findPage(l, pageId) ? switchPage(l, pageId) : l));
      else updateLayout((l) => switchPage(l, pageId));
    }, PAGE_HOVER_MS),
  };
}

/** Re-probes at most once per ~frame, at the latest position. */
function schedule(x: number, y: number): void {
  const r = running;
  if (!r) return;
  r.at = { x, y };
  if (r.frame !== null) return;
  r.frame = setTimeout(() => {
    r.frame = null;
    if (running === r) update(r.at.x, r.at.y);
  }, 16);
}

function onMove(e: PointerEvent): void {
  if (!running) return;
  if (e.buttons === 0) {
    // The button went up outside the window: no drop.
    finish(true);
    return;
  }
  schedule(e.clientX, e.clientY);
}

function onUp(e: PointerEvent): void {
  if (!running) return;
  e.preventDefault();
  if (running.frame !== null) clearTimeout(running.frame);
  running.frame = null;
  update(e.clientX, e.clientY);
  const { target, peer, ghost } = useSideDnd.getState();
  const r = running;
  // Dropped: the panes keep where the preview put them while the new layout lands there; refused: they glide back.
  endMorph(!!target && target.kind !== "refuse" && target.kind !== "noop");
  finish(true);
  if (!target || target.kind === "refuse" || target.kind === "noop") return;
  if (r.drag.type === "external") {
    if (!r.external) return;
    if (target.kind === "pin") r.external.onDrop({ page: target.pageId });
    else if (target.kind === "new") r.external.onDrop({ newPage: true });
    return;
  }
  if (r.drag.type === "conversation") {
    const drag = r.drag;
    setPaneLayout((l) => applyWorkDrop(l, drag, target));
    return;
  }
  // Every Shelf drop that rearranges gets one 撤销 (audit #6): the arrangement before it, taken now.
  const before = shelfDropSnapshot(peer);
  const name = ghost?.title ?? "";
  if (r.drag.type === "page") {
    if (peer) movePageToPeer(peer, target);
    else if (target.kind === "movePage") updateLayout((l) => movePageTo(l, target.pageId, target.shelfId, target.before));
    else if (target.kind === "mergePage") updateLayout((l) => mergePageInto(l, target.pageId, target.into));
    offerDropUndo(before, translate(target.kind === "mergePage" ? "shelf.toast.dropMerged" : "shelf.toast.dropMoved", { name }));
    return;
  }
  const drag = r.drag;
  // Into the other workspace's Shelf: the same instances move over, the focus stays (§24.13).
  if (peer) movePaneToPeer(peer, drag, target, Date.now(), orderOf);
  else updateLayout((layout) => applyToolDrop(layout, drag, target, Date.now(), orderOf));
  // 允许混排 off (§24.12): say why it became a pane of its own, and where to change that.
  offerDropUndo(before, target.kind === "split" && target.unmixed ? translate("shelf.toast.unmixed") : translate(target.kind === "merge" ? "shelf.toast.dropJoined" : "shelf.toast.dropMoved", { name }));
}

/** The drop changed the arrangement: the toast with its 撤销 (lib/shelves, the 7 s undo of 删除这一页). */
function offerDropUndo(before: ShelfDropSnapshot, text: string): void {
  const after = shelfDropKeys(before);
  // Refused by the layout after all (nothing moved): no toast.
  if (after.live === arrangementKey(before.live) && (!before.peer || after.peer === arrangementKey(before.peer.own))) return;
  showShelfToast(text, () => {
    if (!undoShelfDrop(before, after)) showShelfToast(translate("shelf.toast.dropUndoStale"));
  });
}

function onKey(e: KeyboardEvent): void {
  if (!running || e.key !== "Escape") return;
  // Esc cancels the drag and nothing else (not a popover / menu, not the reference card, not a
  // maximised pane, not the conversation's interrupt).
  e.preventDefault();
  e.stopImmediatePropagation();
  cancelSideDrag();
}

// The Esc chain's first row (lib/escChain.ts): a running drag takes Esc before anything else sees it.
// Window capture listeners run in the order they were added, and some popups close themselves from
// one (a dialog, the goal editor) — so this one is added when the module loads, ahead of every
// listener a component adds on mount, and stays (it does nothing while no drag runs).
// Every app window (a desk window's drag too, multi-window): this window's is added now, a desk's when it opens.
if (typeof window !== "undefined") {
  const stopKeys = onEveryAppWindow((win) => {
    win.addEventListener("keydown", onKey, true);
    return () => win.removeEventListener("keydown", onKey, true);
  });
  import.meta.hot?.dispose(stopKeys);
}

const onBlur = () => cancelSideDrag();

/**
 * The click that follows the pointerup of a drag is not a click on what lies under it. `buttonUp` = the
 * button is already up (a drop); otherwise (Esc, blur) the click comes with the next pointerup.
 */
function swallowClick(buttonUp: boolean): void {
  const win = view();
  const stop = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
  };
  const release = () => setTimeout(() => win.removeEventListener("click", stop, { capture: true }), 0);
  win.addEventListener("click", stop, { capture: true, once: true });
  if (buttonUp) release();
  else {
    win.addEventListener("pointerup", release, { capture: true, once: true });
    // Never longer than a few seconds (the pointerup may never come to this window).
    setTimeout(() => {
      win.removeEventListener("pointerup", release, { capture: true });
      win.removeEventListener("click", stop, { capture: true });
    }, 5000);
  }
}

/** Ends the drag (a drop, if any, follows in the caller). */
function finish(buttonUp = false): void {
  const r = running;
  if (!r) return;
  running = null;
  endMorph(false);
  delete view().document.documentElement.dataset.sideDragging;
  if (r.frame !== null) clearTimeout(r.frame);
  if (r.hover) clearTimeout(r.hover.timer);
  r.offLayout();
  view().removeEventListener("pointermove", onMove, true);
  view().removeEventListener("pointerup", onUp, true);
  view().removeEventListener("pointercancel", onCancel, true);
  view().removeEventListener("blur", onBlur);
  view().document.removeEventListener("selectstart", preventSelect, true);
  swallowClick(buttonUp);
  useSideDnd.setState({ drag: null, ghost: null, target: null, peer: null, feedback: NO_FEEDBACK });
}

const onCancel = () => cancelSideDrag();
const preventSelect = (e: Event) => e.preventDefault();

/** Ends a running drag without dropping (Esc, pointer lost, window blur). */
export function cancelSideDrag(): void {
  finish();
}

function begin(x: number, y: number): void {
  const p = pending;
  clearPending();
  if (!p || running) return;
  const drag = p.make();
  if (!drag) return;
  const ghost = ghostFor(drag, p.external);
  if (!ghost) return;
  // A maximised pane is the only one on screen: nowhere to drop (restore first).
  if (useSide.getState().mode?.card) setMode(null);
  if (usePanes.getState().layout.max) setPaneLayout((l) => ({ ...l, max: null }));
  const offSide = useSide.subscribe((s, prev) => {
    if (s.layout !== prev.layout || s.mode !== prev.mode || s.peers !== prev.peers) schedule(useSideDnd.getState().x, useSideDnd.getState().y);
  });
  const offPanes = usePanes.subscribe((s, prev) => {
    if (s.layout !== prev.layout) schedule(useSideDnd.getState().x, useSideDnd.getState().y);
  });
  running = {
    drag,
    external: p.external,
    frame: null,
    hover: null,
    at: { x, y },
    // A layout change mid-drag moves the targets: probe again.
    offLayout: () => {
      offSide();
      offPanes();
    },
  };
  view().getSelection()?.removeAllRanges();
  // CSS: the instance layer stops taking pointer events (a guest <webview> would swallow the drag).
  view().document.documentElement.dataset.sideDragging = drag.type;
  view().document.addEventListener("selectstart", preventSelect, true);
  view().addEventListener("pointermove", onMove, true);
  view().addEventListener("pointerup", onUp, true);
  view().addEventListener("pointercancel", onCancel, true);
  view().addEventListener("blur", onBlur);
  const doc = view().document;
  useSideDnd.setState({ drag, ghost, x, y, target: null, peer: null, feedback: NO_FEEDBACK, doc: doc === document ? undefined : doc });
  update(x, y);
}

function onPendingMove(e: PointerEvent): void {
  const p = pending;
  if (!p) return;
  if (e.buttons === 0) {
    clearPending();
    return;
  }
  if (Math.hypot(e.clientX - p.x, e.clientY - p.y) >= DRAG_THRESHOLD) begin(e.clientX, e.clientY);
}

function clearPending(): void {
  pending = null;
  view().removeEventListener("pointermove", onPendingMove, true);
  view().removeEventListener("pointerup", clearPending, true);
  view().removeEventListener("pointercancel", clearPending, true);
}

/** Pointer-downs already claimed by an inner handle (a tab inside a draggable header). */
const claimed = new WeakSet<Event>();

function press(e: ReactPointerEvent, make: () => SideDrag | null, external: ExternalDragSpec | null): void {
  if (claimed.has(e.nativeEvent)) return;
  if (e.button !== 0 || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || running) return;
  // A control inside a handle (a tab's ×, a header button) stays a plain button.
  if (isElement(e.target) && e.target.closest("[data-side-nodrag]")) return;
  claimed.add(e.nativeEvent);
  clearPending();
  dragWin = ownerWindowOf(e.currentTarget);
  pending = { x: e.clientX, y: e.clientY, make, external };
  view().addEventListener("pointermove", onPendingMove, true);
  view().addEventListener("pointerup", clearPending, true);
  view().addEventListener("pointercancel", clearPending, true);
}

/** Props for a drag handle (a pane header, a tab, a single pane's title). A short press stays a click. */
export function sideDragHandle(make: () => SideDrag | null): { onPointerDown(e: ReactPointerEvent): void } {
  return { onPointerDown: (e) => press(e, make, null) };
}

/**
 * Props for a handle outside the panes (the reference card's icon): drop on a tool pane = into its
 * column, on the work area elsewhere = a new tool column; its origin = nothing. The spec's onDrop opens
 * the content (pageForDrop does the new-column part).
 */
export function externalDragHandle(spec: () => ExternalDragSpec | null): { onPointerDown(e: ReactPointerEvent): void } {
  return {
    onPointerDown: (e) => {
      const s = spec();
      if (s) press(e, () => ({ type: "external", source: s.source }), s);
    },
  };
}

/**
 * For an external drop: the column to open into — the dropped-on column, or a new (launcher) column that
 * takes the opened component as its first pane. Returns the page id for SideOpenOptions.page.
 */
export function pageForDrop(target: { page: string } | { newPage: true }): string | null {
  if ("page" in target) return target.page;
  let pageId: string | null = null;
  updateLayout((layout) => {
    const made = openLauncherPage(layout);
    pageId = made.pageId;
    return made.layout;
  });
  return pageId;
}
