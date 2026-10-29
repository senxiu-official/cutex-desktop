// The Settings Shelf (owner 2026-10-21; docs/desktop-modules.md §24.14): Settings is one special, global
// Shelf — not per conversation, at most one — on the left by default, between the sidebar card and the work
// area (owner 2026-10-21: the window bar's host / sidebar group stays over the sidebar), full height of the
// work row, beside the real UI (so a change is seen where it happens). It can move to the other side, be
// dragged wider and be maximised over the whole work row (= the old full-window Settings). One card: the
// settings categories are its left column (owner 2026-10-21: merged, not a rail card of its own), the
// category pages beside it; panes are never dropped into it (it carries `data-no-drop`, which the drag
// probes of lib/sideDnd and lib/workspaces honour).
// State only (no React, no store import): `open`, the page params (`tab` + Profiles sub-page), and the
// local layout — side, width, maximised, the nav's names — remembered per device. Layouts stored before the
// left default (no `v`) move to the left once (an explicit 移到右边 could not be told from the old default);
// widths stored before v3 (the page card alone) under the new minimum are raised once to the default.
import { create } from "zustand";
import type { PageParams } from "../modules/types";
import { isElement } from "./ownerWindow";
import { queryAppWindows } from "./appWindowSet";
import { currentWindow, MAIN_WINDOW, windowStore, type WindowKey } from "./windowScope";

export type SettingsShelfSide = "left" | "right";

/**
 * Default width of the Settings Shelf's one card (px): the category nav (~200) and the page (~560). Owner
 * 2026-10-21: a normal width, the nav inside the card (not a rail card of its own).
 */
export const SETTINGS_SHELF_DEFAULT_W = 760;
/** The narrowest the card is dragged (px); in a window too small for it and a conversation it takes what's left of the row. */
export const SETTINGS_SHELF_MIN_W = 640;
/** What the work row keeps beside the Shelf while it is not maximised (px): a conversation column. */
export const SETTINGS_SHELF_ROW_KEEP = 420;
/** The category nav inside the card (px): icon + name rows, or folded to the icons. */
export const SETTINGS_NAV_NAMED_W = 200;
export const SETTINGS_NAV_ICONS_W = 48;
/** A card narrower than this folds its nav to the icons whatever the owner chose (px). */
export const SETTINGS_NAV_FOLD_UNDER = 560;
/** Maximised: the wide nav with the group names (the old full-window Settings). */
export const SETTINGS_NAV_W = 208;
/** The stored layout's version: 2 = the left default; 3 = `width` is the whole card (nav + page), ≥ SETTINGS_SHELF_MIN_W. */
const LAYOUT_V = 3;

const KEY = "cutex-desktop.settingsShelf";

export interface SettingsShelfState {
  open: boolean;
  /** `tab` (the category page) and the Profiles sub-page (`profile` / `create`). */
  params: PageParams;
  side: SettingsShelfSide;
  /** The card's width (px, nav + page), the owner's drag; clamped to the row when drawn (`settingsShelfWidth`). */
  width: number;
  maximized: boolean;
  /** The nav shows the category names (icons only when off, or when the card is too narrow). Stored as `railLabels`. */
  railLabels: boolean;
  /** The app window it opened in (multi-window P3, owner 2026-10-27: Settings opens in the window it is asked in). */
  win: WindowKey;
}

interface Stored {
  v?: unknown;
  side?: unknown;
  width?: unknown;
  maximized?: unknown;
  railLabels?: unknown;
}

type Layout = Pick<SettingsShelfState, "side" | "width" | "maximized" | "railLabels">;

/**
 * The stored layout (pure). Left by default; a layout stored before the left default (no `v`) moves to the
 * left once — the old default saved its "right" with every width / maximise, so an explicit choice can't be
 * told apart (owner 2026-10-21: then all of them). Before v3 `width` was the page card beside a rail card
 * (default 600): a width under the new minimum is raised once to the new default (owner 2026-10-21: a
 * normal width). `migrated`: write the result back (once).
 */
export function parseSettingsShelfLayout(raw: unknown): { layout: Layout; migrated: boolean } {
  const r: Stored = raw && typeof raw === "object" ? (raw as Stored) : {};
  const current = r.v === LAYOUT_V;
  const stored = typeof r.width === "number" && Number.isFinite(r.width) ? Math.round(r.width) : SETTINGS_SHELF_DEFAULT_W;
  const width = stored >= SETTINGS_SHELF_MIN_W ? stored : current ? SETTINGS_SHELF_MIN_W : SETTINGS_SHELF_DEFAULT_W;
  const migrated = !current && Object.keys(r).length > 0;
  const side: SettingsShelfSide = (current || r.v === 2) && r.side === "right" ? "right" : "left";
  return { layout: { side, width, maximized: r.maximized === true, railLabels: r.railLabels !== false }, migrated };
}

function load(): Layout {
  let raw: unknown = {};
  try {
    raw = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? "{}");
  } catch {
    raw = {};
  }
  const { layout, migrated } = parseSettingsShelfLayout(raw);
  if (migrated) write(layout);
  return layout;
}

function write(l: Layout): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify({ v: LAYOUT_V, side: l.side, width: l.width, maximized: l.maximized, railLabels: l.railLabels }));
  } catch {
    // storage full / unavailable: the layout is only not remembered
  }
}

function save(s: SettingsShelfState): void {
  write(s);
}

export const useSettingsShelf = create<SettingsShelfState>(() => ({ open: false, params: { tab: "general" }, win: MAIN_WINDOW, ...load() }));

function update(patch: Partial<SettingsShelfState>, persist = false): void {
  useSettingsShelf.setState(patch);
  if (persist) save(useSettingsShelf.getState());
}

/** Opens the Shelf on a page (an open Shelf switches page; side / width / maximised stay as they were). */
export function openSettingsShelf(params: PageParams): void {
  update({ open: true, params: { ...params }, win: currentWindow() });
}

/** Closes the Shelf (its layout is kept for next time). */
export function closeSettingsShelf(): void {
  if (useSettingsShelf.getState().open) update({ open: false });
}

/** The page params without a sub-page (a host switch: Profiles of another host). */
export function resetSettingsSubPage(): void {
  const s = useSettingsShelf.getState();
  if (s.open) update({ params: { tab: s.params.tab ?? "general" } });
}

/** 移到左边 / 右边. */
export function moveSettingsShelf(side?: SettingsShelfSide): void {
  const s = useSettingsShelf.getState();
  update({ side: side ?? (s.side === "right" ? "left" : "right") }, true);
}

export function setSettingsShelfMaximized(on: boolean): void {
  if (useSettingsShelf.getState().maximized !== on) update({ maximized: on }, true);
}

export function toggleSettingsShelfMaximized(): void {
  setSettingsShelfMaximized(!useSettingsShelf.getState().maximized);
}

/** 显示分类名称 / 只显示图标 on the nav (remembered). */
export function setSettingsRailLabels(on: boolean): void {
  if (useSettingsShelf.getState().railLabels !== on) update({ railLabels: on }, true);
}

/**
 * The card's width while an edge is dragged (its own inner edge, or the sidebar's edge beside it: checklist #38,
 * only the two panels beside an edge change); null = the stored one. Memory only.
 */
export const useSettingsShelfLive = create<{ width: number | null }>(() => ({ width: null }));
export function setSettingsShelfLive(width: number | null): void {
  const w = width === null ? null : Math.max(SETTINGS_SHELF_MIN_W, Math.round(width));
  if (useSettingsShelfLive.getState().width !== w) useSettingsShelfLive.setState({ width: w });
}

/** The Settings Shelf sits between the sidebar card and the work row now (open, on the left, beside the docked sidebar, not maximised). */
export function settingsBesideSidebar(): HTMLElement | null {
  const s = useSettingsShelf.getState();
  if (!s.open || s.maximized || s.side !== "left" || typeof document === "undefined") return null;
  return queryAppWindows<HTMLElement>("[data-settings-shelf][data-settings-in-slot]");
}

/** The owner's width (a released drag, arrow keys, double-click = default). */
export function setSettingsShelfWidth(width: number): void {
  update({ width: Math.max(SETTINGS_SHELF_MIN_W, Math.round(width)) }, true);
}

/**
 * The card's width drawn in a work row of `rowWidth` (pure): the owner's width, but the row keeps `keep`
 * (SETTINGS_SHELF_ROW_KEEP for a conversation; more while its Shelf is expanded, `settingsRowKeep`) beside it,
 * never under SETTINGS_SHELF_MIN_W. A row too small for both: the card keeps its minimum (the conversation beside
 * it gets the rest and collapses by its own narrow rules — its Shelf a drawer; the Shelf is not maximised behind
 * the owner's back), and never more than the row itself.
 */
export function settingsShelfWidth(stored: number, rowWidth: number, keep: number = SETTINGS_SHELF_ROW_KEEP): number {
  const w = Math.max(SETTINGS_SHELF_MIN_W, stored);
  if (!(rowWidth > 0)) return w;
  return Math.min(rowWidth, Math.max(SETTINGS_SHELF_MIN_W, Math.min(w, rowWidth - keep)));
}

/**
 * What the work row needs beside the card now (px; 0 = a conversation only): the conversation and its expanded
 * Shelf at their minimum widths (components/side/SideArea). Owner 2026-10-24: with the card wide, expanding the
 * conversation's Shelf drew it as the narrow-window drawer over the conversation — now the card gives that room
 * (down to its minimum) and the Shelf opens in the row; only a row too small even then gets the drawer.
 */
export const useSettingsRowNeed = create<{ need: number }>(() => ({ need: 0 }));
export function setSettingsRowNeed(px: number): void {
  const need = Math.max(0, Math.round(px));
  if (useSettingsRowNeed.getState().need !== need) useSettingsRowNeed.setState({ need });
}
/**
 * What the row keeps beside the card in a row of `rowWidth`: what the work row says it needs (`useSettingsRowNeed`) when the
 * card can give that much at its minimum, else a conversation (the card does not shrink for a drawer that comes anyway).
 */
export function settingsRowKeep(need: number, rowWidth: number): number {
  if (need <= SETTINGS_SHELF_ROW_KEEP) return SETTINGS_SHELF_ROW_KEEP;
  return rowWidth > 0 && rowWidth - SETTINGS_SHELF_MIN_W < need ? SETTINGS_SHELF_ROW_KEEP : need;
}

/**
 * The card drawn beside the work row (pure): its width, and the nav inside it — the names while the owner
 * wants them and the card is at least SETTINGS_NAV_FOLD_UNDER wide, else the icons.
 */
export function settingsShelfLayout(stored: number, rowWidth: number, labels: boolean, keep: number = SETTINGS_SHELF_ROW_KEEP): { card: number; nav: number; named: boolean } {
  const card = settingsShelfWidth(stored, rowWidth, keep);
  const named = labels && card >= SETTINGS_NAV_FOLD_UNDER;
  return { card, nav: named ? SETTINGS_NAV_NAMED_W : SETTINGS_NAV_ICONS_W, named };
}

/** Where the Shelf's left placement goes: the slot between the sidebar card and the work area (components/PaneHost). */
export const useSettingsShelfSlot = windowStore(() => create<{ left: HTMLElement | null }>(() => ({ left: null })));

/** The Shelf is in front of everything (maximised): Esc closes it wherever the focus is; the conversation's Esc stands back. */
export function settingsShelfCovers(): boolean {
  const s = useSettingsShelf.getState();
  return s.open && s.maximized;
}

/** The element is inside the Settings Shelf. */
export function inSettingsShelf(target: EventTarget | null): boolean {
  return typeof Element !== "undefined" && isElement(target) && !!target.closest("[data-settings-shelf]");
}

/** Test seam: forget the remembered layout and close. */
export function resetSettingsShelfForTest(): void {
  try {
    globalThis.localStorage?.removeItem(KEY);
  } catch {
    // ignore
  }
  useSettingsShelf.setState({ open: false, params: { tab: "general" }, side: "left", width: SETTINGS_SHELF_DEFAULT_W, maximized: false, railLabels: true });
}
