// Drag and drop on the right side, the DOM part (RFC right-panel-rfc-20261009 §3.7; decisions in
// lib/sideDrop.ts): pointer events on the handles (card icon, pill icon, pill grip, tab / single
// title, and handles outside the side; pills live in the vertical lane while the column is closed and
// in the horizontal tab row at its top while it is open — the probe reads either along its axis), a probe of what lies under the pointer, the drop, and the
// feedback the overlay (components/side/SideDndLayer.tsx, SideDropOutside.tsx) draws. No new
// dependency, no HTML5 drag events. While a drag runs, a shield covers the window (cursor, no stray
// hovers), the instance layer stops taking pointer events (a guest <webview> would swallow them) and
// Esc cancels before anything else sees the key. Shell code: no feature names.
import { create } from "zustand";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { Icon } from "../modules/slots";
import type { ItemId } from "../modules/types";
import { translate } from "../i18n";
import { cardName, pageLabel } from "./sideActions";
import { sideRegistry, sideViewNow, specFrom } from "./sideComponents";
import { applyDrop, resolveDrop, type PillAxis, type SideDrag, type SideDropTarget, type SideHit } from "./sideDrop";
import { DEFAULT_ORDER, findCard, findPage, locate, openLauncherPage, switchPage, visibleCards, visibleTabs } from "./sideLayout";
import { setMode, updateLayout, useSide } from "./sideLayoutStore";

/** Pointer travel (px) before a press on a handle becomes a drag (a shorter press stays a click). */
export const DRAG_THRESHOLD = 4;
/** Hovering another page's pill with a card / tab this long switches the column to that page. */
export const HOVER_SWITCH_MS = 600;
/** The left-edge "new page" band reaches this far into the column. */
export const EDGE_BAND = 24;
/** Gaps between cards take drops this far above / below their 8 px. */
const GAP_SLOP = 6;

/** A handle outside the side (the left gutter's reference card icon): what it shows and what a drop does. */
export interface ExternalDragSpec {
  /** Who drags (the source dims itself while useSideDnd's drag.source is this). */
  source: string;
  icon: Icon;
  title: string;
  /** The ghost's note (default: 引用). */
  note?: string;
  /** Its own place: dropping there does nothing ("原位置"). `el` = the topmost element at (x, y), client px. */
  isOrigin?(el: Element, x: number, y: number): boolean;
  /** Dropped on a page (pill / column) or a new page; the caller opens its content there (openAtDrop). */
  onDrop(target: { page: string } | { newPage: true }): void;
}

export type DragGhost =
  | { shape: "chip"; kind: ItemId | null; icon: Icon | null; title: string; note: string; count: number }
  | { shape: "page"; kinds: ItemId[]; title: string; note: string };

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** What the overlay draws for the current target (fixed, client px). */
export interface DropFeedback {
  /** Insertion line (pill icons, page reorder, card spot, gap). */
  line: Box | null;
  /** A short label beside the target ("移到「…」"); side = which side of `x` it extends to. */
  label: { text: string; x: number; y: number; side: "left" | "right" } | null;
  /** The left-edge band and the "新页" chip in it at the pointer's height. */
  band: (Box & { chipY: number }) | null;
  /** The "新页" ghost following the pointer in the lane / tab row between the pills. */
  laneGhost: { x: number; y: number } | null;
  /** Over the conversation (new page), the composer (later: quote) or the origin (unchanged). */
  outside: (Box & { ui: "new" | "neutral" | "future"; text: string; sub: string | null }) | null;
  /** Outline of a column (an external handle pinned into the page in view). */
  column: Box | null;
}

export interface SideDndState {
  drag: SideDrag | null;
  ghost: DragGhost | null;
  x: number;
  y: number;
  target: SideDropTarget | null;
  feedback: DropFeedback;
}

const NO_FEEDBACK: DropFeedback = { line: null, label: null, band: null, laneGhost: null, outside: null, column: null };

export const useSideDnd = create<SideDndState>(() => ({ drag: null, ghost: null, x: 0, y: 0, target: null, feedback: NO_FEEDBACK }));

/** A drag is running (the instance layer drops pointer events, the lane shows its "新页" slot). */
export function sideDragging(): boolean {
  return useSideDnd.getState().drag !== null;
}

// ── Probe (DOM → SideHit) ───────────────────────────────────────────────────────────────────────

const rectOf = (el: Element): Box => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
};
const inside = (b: Box, x: number, y: number, slopX = 0, slopY = 0) => x >= b.left - slopX && x <= b.left + b.width + slopX && y >= b.top - slopY && y <= b.top + b.height + slopY;

function sideBox(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-side-box]");
}

function sideColumn(): HTMLElement | null {
  return sideBox()?.querySelector<HTMLElement>("[data-side-column]") ?? null;
}

/** The left-edge band: the seam plus EDGE_BAND px into the column's cards (null when the column is closed). */
function edgeBand(): Box | null {
  const box = sideBox();
  const col = sideColumn();
  if (!box || !col) return null;
  const b = rectOf(box);
  const c = rectOf(col);
  return { left: b.left, top: c.top, width: Math.max(0, c.left + EDGE_BAND - b.left), height: c.height };
}

/** The pills' containers: the vertical lane (column closed) and the tab row's tab list (column open). */
const PILL_ROWS = "[data-side-lane], [data-side-strip-tabs]";

/** A pill's axis: "x" in the tab row, "y" in the vertical lane. */
function pillAxis(pill: Element): PillAxis {
  return pill.closest("[data-side-strip]") ? "x" : "y";
}

/** The topmost element under the pointer, our own overlay left out. */
function topElement(x: number, y: number): Element | null {
  for (const el of document.elementsFromPoint(x, y)) if (!el.closest("[data-side-dnd]")) return el;
  return null;
}

/** What lies under (x, y) for the drop rules (lib/sideDrop.ts). */
export function probe(x: number, y: number, external: ExternalDragSpec | null): SideHit {
  const el = topElement(x, y);
  if (!el) return { at: "none" };
  const box = el.closest<HTMLElement>("[data-side-box]");
  if (box) {
    const pill = el.closest<HTMLElement>("[data-side-pill]");
    if (pill?.dataset.sidePill) {
      const axis = pillAxis(pill);
      const r = rectOf(pill);
      const icons = [...pill.querySelectorAll<HTMLElement>("[data-side-pill-card]")].map((i) => {
        const ir = rectOf(i);
        return axis === "x" ? { cardId: i.dataset.sidePillCard!, start: ir.left, end: ir.left + ir.width } : { cardId: i.dataset.sidePillCard!, start: ir.top, end: ir.top + ir.height };
      });
      return axis === "x"
        ? { at: "pill", pageId: pill.dataset.sidePill, axis, start: r.left, size: r.width, icons }
        : { at: "pill", pageId: pill.dataset.sidePill, axis, start: r.top, size: r.height, icons };
    }
    if (el.closest("[data-side-tail]")) return { at: "tail" };
    if (el.closest(PILL_ROWS)) return { at: "lane" };
    const band = edgeBand();
    if (band && inside(band, x, y)) return { at: "edge" };
    for (const gap of box.querySelectorAll<HTMLElement>("[data-side-gap-page]")) {
      if (inside(rectOf(gap), x, y, 0, GAP_SLOP)) return { at: "gap", pageId: gap.dataset.sideGapPage!, before: gap.dataset.sideGap || null };
    }
    const head = el.closest<HTMLElement>("[data-side-card-head]");
    if (head?.dataset.sideCardHead) {
      const r = rectOf(head);
      return { at: "head", cardId: head.dataset.sideCardHead, top: r.top, height: r.height };
    }
    const column = el.closest<HTMLElement>("[data-side-column]");
    if (column?.dataset.sideColumn) return { at: "column", pageId: column.dataset.sideColumn };
    return { at: "side" };
  }
  if (external?.isOrigin?.(el, x, y)) return { at: "origin" };
  if (el.closest(".side-col-composer, [data-composer]")) return { at: "composer" };
  return { at: "outside" };
}

/** The visible part of the main card (conversation / page): a floating side or drawer covers its right. */
function mainCardBox(): Box | null {
  const main = document.querySelector<HTMLElement>('[data-focus-region="main"]');
  if (!main) return null;
  const m = rectOf(main);
  const box = sideBox();
  let right = m.left + m.width;
  if (box) {
    const b = rectOf(box);
    if (b.left < right && b.left + b.width > m.left && b.width > 0) right = Math.min(right, b.left - 2);
  }
  return right - m.left > 40 ? { ...m, width: right - m.left } : null;
}

// ── Feedback (target → what the overlay draws) ─────────────────────────────────────────────────

const pageName = (pageId: string) => {
  const page = findPage(useSide.getState().layout, pageId);
  return page ? pageLabel(page) : "";
};

function labelBeside(el: Element | null, y: number): { x: number; y: number; side: "left" | "right" } | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.left > 240 ? { x: r.left - 8, y, side: "left" } : { x: r.right + 8, y, side: "right" };
}

/** A label under the ghost (to the pointer's left near the window's right edge, like the ghost). */
function nearPointer(text: string, x: number, y: number): NonNullable<DropFeedback["label"]> {
  // The ghost spans y + 12 … y + 40.
  return x > window.innerWidth - 240 ? { text, x: x - 14, y: y + 54, side: "left" } : { text, x: x + 14, y: y + 54, side: "right" };
}

function feedbackFor(target: SideDropTarget | null, drag: SideDrag, x: number, y: number): DropFeedback {
  if (!target) return NO_FEEDBACK;
  const fb: DropFeedback = { ...NO_FEEDBACK };
  const label = (text: string, el: Element | null, ly = y) => {
    const at = labelBeside(el, ly);
    if (at) fb.label = { text, ...at };
  };
  /**
   * Under an element of the tab row (at `lx`, default its left / right edge), extending away from the
   * window's right edge; low enough to clear the ghost (pointer y + 12 … + 40).
   */
  const labelUnder = (text: string, el: Element | null, lx?: number) => {
    if (!el) return;
    const r = el.getBoundingClientRect();
    const ly = Math.max(r.bottom, y + 40) + 14;
    fb.label = r.right > window.innerWidth - 240 ? { text, x: lx ?? r.right, y: ly, side: "left" } : { text, x: lx ?? r.left, y: ly, side: "right" };
  };
  switch (target.kind) {
    case "pill": {
      const pill = document.querySelector<HTMLElement>(`[data-side-pill="${CSS.escape(target.pageId)}"]`);
      const r = pill ? rectOf(pill) : null;
      const across = !!pill && pillAxis(pill) === "x";
      const name = pageName(target.pageId);
      // In the tab row the label goes under the pill (beside it would cover the next tabs).
      const say = (text: string, ly = y) => (across ? labelUnder(text, pill) : label(text, pill, ly));
      if (target.op === "insert") {
        // Lane: a horizontal line between two icons; tab row: a vertical one.
        if (r) fb.line = across ? { left: target.line - 1, top: r.top + 3, width: 2, height: r.height - 6 } : { left: r.left + 3, top: target.line - 1, width: r.width - 6, height: 2 };
        say(translate(target.own ? "side.dnd.reorder" : "side.dnd.moveTo", { name }), across ? y : target.line);
      } else if (target.op === "join") {
        // The kind's name (终端), not the card's active tab (终端 1).
        const card = findCard(useSide.getState().layout, target.cardId)?.card;
        const entry = card ? sideRegistry().get(card.kind) : undefined;
        say(translate("side.dnd.joinCard", { page: name, card: entry ? translate(entry.item.titleKey) : card ? cardName(card) : "" }));
      } else if (target.op === "before" || target.op === "after") {
        if (r) {
          const first = target.op === "before";
          fb.line = across
            ? { left: first ? r.left - 4 : r.left + r.width + 2, top: r.top - 2, width: 2, height: r.height + 4 }
            : { left: r.left - 2, top: first ? r.top - 4 : r.top + r.height + 2, width: r.width + 4, height: 2 };
        }
        say(translate(target.op === "before" ? "side.dnd.before" : "side.dnd.after", { name }));
      } else say(translate(target.op === "merge" ? "side.dnd.merge" : "side.dnd.pin", { name }));
      break;
    }
    case "new": {
      if (target.via === "edge") {
        const band = edgeBand();
        if (band) fb.band = { ...band, chipY: Math.max(band.top + 17, Math.min(band.top + band.height - 17, y)) };
        if (target.unchanged) label(translate("side.dnd.unchanged"), sideColumn(), y);
      } else if (target.via === "lane") {
        const row = document.querySelector(PILL_ROWS);
        const r = row ? rectOf(row) : null;
        const text = translate(target.unchanged ? "side.dnd.unchanged" : "side.dnd.outside");
        if (row?.matches("[data-side-strip-tabs]")) {
          // The tab row: the ghost follows the pointer along it.
          if (r) fb.laneGhost = { x: Math.max(r.left + 17, Math.min(r.left + r.width - 17, x)), y: r.top + r.height / 2 };
          labelUnder(text, row, x);
        } else {
          if (r) fb.laneGhost = { x: r.left + r.width / 2, y: Math.max(r.top + 17, Math.min(r.top + r.height - 17, y)) };
          label(text, row, y);
        }
      } else if (target.via === "tail") {
        const tail = document.querySelector("[data-side-tail]");
        const text = translate(target.unchanged ? "side.dnd.unchanged" : "side.dnd.outside");
        if (tail?.closest("[data-side-strip]")) labelUnder(text, tail);
        else label(text, tail, y);
      } else {
        const main = mainCardBox();
        if (main) {
          fb.outside = target.unchanged
            ? { ...main, ui: "neutral", text: translate("side.dnd.unchanged"), sub: null }
            : { ...main, ui: "new", text: translate("side.dnd.outside"), sub: translate(drag.type === "external" ? "side.dnd.outsidePin" : "side.dnd.outsideMove") };
        }
      }
      break;
    }
    case "head": {
      const head = document.querySelector<HTMLElement>(`[data-side-card-head="${CSS.escape(target.cardId)}"]`);
      const card = head?.closest<HTMLElement>("[data-side-card]");
      if (target.op === "join") {
        label(translate("side.dnd.joinThis"), head, y);
        break;
      }
      if (card) {
        const r = rectOf(card);
        fb.line = { left: r.left + 10, top: target.op === "above" ? r.top - 5 : r.top + r.height + 3, width: r.width - 20, height: 2 };
      }
      const own = drag.type === "card" && findCard(useSide.getState().layout, drag.cardId)?.page.id === findCard(useSide.getState().layout, target.cardId)?.page.id;
      label(translate(own ? "side.dnd.reorder" : "side.dnd.moveHere"), head, y);
      break;
    }
    case "gap": {
      const gap = document.querySelector<HTMLElement>(`[data-side-gap-page="${CSS.escape(target.pageId)}"][data-side-gap="${CSS.escape(target.before ?? "")}"]`);
      if (gap) {
        const r = rectOf(gap);
        fb.line = { left: r.left + 10, top: r.top + r.height / 2 - 1, width: r.width - 20, height: 2 };
      }
      const layout = useSide.getState().layout;
      const at = drag.type === "tab" ? locate(layout, drag.instanceId) : null;
      const from = at ? at.page.id : drag.type === "card" ? findCard(layout, drag.cardId)?.page.id : null;
      // A card's only tab moves the card: a reorder, not a split.
      const split = !!at && at.card.tabs.length > 1;
      label(translate(split && from === target.pageId ? "side.dnd.split" : from === target.pageId ? "side.dnd.reorder" : "side.dnd.moveHere"), gap, y);
      break;
    }
    case "column": {
      const col = sideColumn();
      if (col) fb.column = rectOf(col);
      label(translate("side.dnd.pin", { name: pageName(target.pageId) }), col, y);
      break;
    }
    case "refuse":
      fb.label = nearPointer(translate("side.dnd.refuse"), x, y);
      break;
    case "noop": {
      if (target.why === "composer") {
        const composer = document.querySelector(".side-col-composer, [data-composer]");
        if (composer) fb.outside = { ...rectOf(composer), ui: "future", text: translate("side.dnd.composer"), sub: null };
      } else fb.label = nearPointer(translate("side.dnd.origin"), x, y);
      break;
    }
  }
  return fb;
}

// ── The drag ────────────────────────────────────────────────────────────────────────────────────

interface Running {
  drag: SideDrag;
  external: ExternalDragSpec | null;
  edgeArmed: boolean;
  /** The pending re-probe (a timer, not a frame: it also runs while the window is not painting). */
  frame: ReturnType<typeof setTimeout> | null;
  /** The latest pointer position the pending re-probe reads. */
  at: { x: number; y: number };
  hover: { pageId: string; timer: ReturnType<typeof setTimeout> } | null;
  /** The column before a hover switch (a cancelled drag changes nothing: it goes back). */
  before: { activePage: string | null; open: boolean } | null;
  offLayout: () => void;
}

let pending: { x: number; y: number; make: () => SideDrag | null; external: ExternalDragSpec | null } | null = null;
let running: Running | null = null;

const orderOf = (kind: ItemId) => specFrom(sideRegistry(), kind)?.order ?? DEFAULT_ORDER;

function ghostFor(drag: SideDrag, external: ExternalDragSpec | null): DragGhost | null {
  const { layout, tabInfo } = useSide.getState();
  const registry = sideRegistry();
  const ctx = sideViewNow();
  switch (drag.type) {
    case "card": {
      const at = findCard(layout, drag.cardId);
      if (!at) return null;
      const n = visibleTabs(layout, at.card, ctx).length || at.card.tabs.length;
      return { shape: "chip", kind: at.card.kind, icon: registry.get(at.card.kind)?.item.icon ?? null, title: cardName(at.card), note: translate("side.dnd.card"), count: n };
    }
    case "tab": {
      const inst = layout.instances[drag.instanceId];
      if (!inst) return null;
      const entry = registry.get(inst.kind);
      const title = tabInfo[drag.instanceId]?.title || (entry ? translate(entry.item.titleKey) : inst.kind);
      return { shape: "chip", kind: inst.kind, icon: entry?.item.icon ?? null, title, note: translate("side.dnd.tab"), count: 1 };
    }
    case "page": {
      const page = findPage(layout, drag.pageId);
      if (!page) return null;
      const cards = visibleCards(layout, page, ctx);
      return { shape: "page", kinds: (cards.length ? cards : page.cards).slice(0, 5).map((c) => c.kind), title: pageLabel(page), note: translate("side.dnd.page") };
    }
    case "external":
      return external ? { shape: "chip", kind: null, icon: external.icon, title: external.title, note: external.note ?? translate("side.dnd.ref"), count: 1 } : null;
  }
}

function clearHover(r: Running): void {
  if (r.hover) clearTimeout(r.hover.timer);
  r.hover = null;
}

/** Re-reads what is under the pointer (after a move, or a layout change mid-drag). */
function update(x: number, y: number): void {
  const r = running;
  if (!r) return;
  const band = edgeBand();
  if (!r.edgeArmed && (!band || !inside(band, x, y, 4, 4))) r.edgeArmed = true;
  const { layout, mode } = useSide.getState();
  const hit = probe(x, y, r.external);
  const target = resolveDrop(layout, r.drag, hit, hit.at === "pill" && hit.axis === "x" ? x : y, { edgeArmed: r.edgeArmed, outside: !mode });
  useSideDnd.setState({ x, y, target, feedback: feedbackFor(target, r.drag, x, y) });
  // Hovering another page's pill with a card / tab / external handle switches the column to it.
  const hoverPage = target?.kind === "pill" && r.drag.type !== "page" ? target.pageId : null;
  const shown = layout.open && layout.activePage === hoverPage;
  if (!hoverPage || shown) clearHover(r);
  else if (r.hover?.pageId !== hoverPage) {
    clearHover(r);
    r.hover = {
      pageId: hoverPage,
      timer: setTimeout(() => {
        if (running !== r) return;
        r.hover = null;
        if (!r.before) {
          const { activePage, open } = useSide.getState().layout;
          r.before = { activePage, open };
        }
        if (useSide.getState().mode?.card) setMode(null);
        updateLayout((l) => switchPage(l, hoverPage));
      }, HOVER_SWITCH_MS),
    };
  }
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
    finish(true, false);
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
  const { target } = useSideDnd.getState();
  const r = running;
  finish(true, !!target && target.kind !== "refuse" && target.kind !== "noop" && !(target.kind === "new" && target.unchanged));
  if (!target) return;
  if (r.drag.type === "external") {
    if (!r.external) return;
    if (target.kind === "pill") r.external.onDrop({ page: target.pageId });
    else if (target.kind === "column") r.external.onDrop({ page: target.pageId });
    else if (target.kind === "new") r.external.onDrop({ newPage: true });
    return;
  }
  updateLayout((layout) => applyDrop(layout, r.drag, target, Date.now(), orderOf));
}

function onKey(e: KeyboardEvent): void {
  if (!running || e.key !== "Escape") return;
  // Esc cancels the drag and nothing else (not a popover / menu, not the reference card, not the
  // side's restore, not the conversation's interrupt).
  e.preventDefault();
  e.stopImmediatePropagation();
  cancelSideDrag();
}

// The Esc chain's first row (lib/escChain.ts): a running drag takes Esc before anything else sees it.
// Window capture listeners run in the order they were added, and some popups close themselves from
// one (a dialog, the goal editor) — so this one is added when the module loads, ahead of every
// listener a component adds on mount, and stays (it does nothing while no drag runs).
if (typeof window !== "undefined") {
  window.addEventListener("keydown", onKey, true);
  import.meta.hot?.dispose(() => window.removeEventListener("keydown", onKey, true));
}

const onBlur = () => cancelSideDrag();

/**
 * The click that follows the pointerup of a drag is not a click on what lies under it (a pill would
 * close the column). `buttonUp` = the button is already up (a drop); otherwise (Esc, blur) the click
 * comes with the next pointerup.
 */
function swallowClick(buttonUp: boolean): void {
  const stop = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
  };
  const release = () => setTimeout(() => window.removeEventListener("click", stop, { capture: true }), 0);
  window.addEventListener("click", stop, { capture: true, once: true });
  if (buttonUp) release();
  else {
    window.addEventListener("pointerup", release, { capture: true, once: true });
    // Never longer than a few seconds (the pointerup may never come to this window).
    setTimeout(() => {
      window.removeEventListener("pointerup", release, { capture: true });
      window.removeEventListener("click", stop, { capture: true });
    }, 5000);
  }
}

/** Ends the drag. `dropped` = a drop follows; otherwise a hover switch is undone (nothing changes). */
function finish(buttonUp = false, dropped = false): void {
  const r = running;
  if (!r) return;
  running = null;
  const before = r.before;
  if (before && !dropped) {
    updateLayout((l) => {
      const back = before.activePage && findPage(l, before.activePage) ? switchPage(l, before.activePage) : l;
      return back.open === before.open ? back : { ...back, open: before.open };
    });
  }
  delete document.documentElement.dataset.sideDragging;
  clearHover(r);
  if (r.frame !== null) clearTimeout(r.frame);
  r.offLayout();
  window.removeEventListener("pointermove", onMove, true);
  window.removeEventListener("pointerup", onUp, true);
  window.removeEventListener("pointercancel", onCancel, true);
  window.removeEventListener("blur", onBlur);
  document.removeEventListener("selectstart", preventSelect, true);
  swallowClick(buttonUp);
  useSideDnd.setState({ drag: null, ghost: null, target: null, feedback: NO_FEEDBACK });
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
  const band = edgeBand();
  const col = sideColumn();
  running = {
    drag,
    external: p.external,
    // A drag that starts inside the column's left-edge strip (a card's icon sits there) must leave the
    // band once first; one from a pill (the lane, or the tab row above the cards) has it at once.
    edgeArmed: !band || !inside(band, p.x, p.y, 4, 4) || (!!col && (p.x < rectOf(col).left || p.y < rectOf(col).top)),
    frame: null,
    at: { x, y },
    hover: null,
    before: null,
    // A layout change mid-drag (the hover switch) moves the targets: probe again.
    offLayout: useSide.subscribe((s, prev) => {
      if (s.layout !== prev.layout || s.mode !== prev.mode) {
        const { x: cx, y: cy } = useSideDnd.getState();
        schedule(cx, cy);
      }
    }),
  };
  window.getSelection()?.removeAllRanges();
  // CSS: the instance layer stops taking pointer events (a guest <webview> would swallow the drag).
  document.documentElement.dataset.sideDragging = drag.type;
  document.addEventListener("selectstart", preventSelect, true);
  window.addEventListener("pointermove", onMove, true);
  window.addEventListener("pointerup", onUp, true);
  window.addEventListener("pointercancel", onCancel, true);
  window.addEventListener("blur", onBlur);
  useSideDnd.setState({ drag, ghost, x, y, target: null, feedback: NO_FEEDBACK });
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
  window.removeEventListener("pointermove", onPendingMove, true);
  window.removeEventListener("pointerup", clearPending, true);
  window.removeEventListener("pointercancel", clearPending, true);
}

function press(e: ReactPointerEvent, make: () => SideDrag | null, external: ExternalDragSpec | null): void {
  if (e.button !== 0 || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || running) return;
  // A control inside a handle (a tab's ×) stays a plain button.
  if (e.target instanceof Element && e.target.closest("[data-side-nodrag]")) return;
  clearPending();
  pending = { x: e.clientX, y: e.clientY, make, external };
  window.addEventListener("pointermove", onPendingMove, true);
  window.addEventListener("pointerup", clearPending, true);
  window.addEventListener("pointercancel", clearPending, true);
}

/** Props for a drag handle inside the side (card icon, pill icon / grip, tab, single title). A short press stays a click. */
export function sideDragHandle(make: () => SideDrag | null): { onPointerDown(e: ReactPointerEvent): void } {
  return { onPointerDown: (e) => press(e, make, null) };
}

/**
 * Props for a handle outside the side (§3.7 last row: the reference card's icon): drop on a pill /
 * the column = that page, on a "new page" target = a new page; its origin = nothing. The spec's
 * onDrop opens the content (openAtDrop does the new-page part).
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
 * For an external drop: the page to open into — the dropped-on page, or a new (launcher) page that
 * takes the opened component as its first card. Returns the page id for SideOpenOptions.page.
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
