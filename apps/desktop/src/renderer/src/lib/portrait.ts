// Portrait layout (owner request 2026-10-30, design .claude/previews/portrait/design.md, all 12 recommendations approved):
// on a tall window the work row turns into a stack — the conversation over its Shelf (or swapped), the Shelf Rail
// horizontal between them (components/side/SideArea, its portrait branch), the Tray across the bottom, the sidebar out
// of the flow (hidden by default, shown as an overlay over the stack: components/SidebarPeek).
//
// Each app window decides for itself (a desk on a rotated monitor is portrait while the main window stays landscape):
// `decideOrientation` from that window's size, with hysteresis, under the device-wide setting (Settings → 外观 → 竖屏布局:
// auto / always landscape / always portrait). What the owner sets in portrait — the split, which end the conversation is
// at, the sidebar shown or hidden — is kept per window and apart from landscape, so rotating back restores landscape
// exactly as it was: nothing of the landscape layout is written while a window is portrait.
//
// Measured on the window's root element through lib/syncResize (layout phase: the flip lands in the same synchronous
// commit as the work row's own measure, before paint) — no `@container` (lib/sizeFlags says why).
import { createContext, useContext, useLayoutEffect } from "react";
import { create } from "zustand";
import { useOwnerWindow } from "./ownerContext";
import { observeSync } from "./syncResize";
import { MAIN_WINDOW, useWindowKey, windowStore, type WindowKey } from "./windowScope";
import { setSettingsPortraitHook, useSettingsShelf } from "./settingsShelf";

export type OrientationSetting = "auto" | "landscape" | "portrait";
export type Orientation = "landscape" | "portrait";

/** Auto enters portrait at height ≥ 1.2 × width… */
export const PORTRAIT_ENTER = 1.2;
/** …and leaves it only below 1.05 × (a window dragged around the square does not flap). */
export const PORTRAIT_LEAVE = 1.05;
/** A window this short (CSS px) stays landscape whatever its shape: a stack would leave neither part room. */
export const PORTRAIT_MIN_HEIGHT = 760;

export interface Box {
  width: number;
  height: number;
}

/** This window's orientation now: the setting, else its shape with hysteresis around the last decision. Pure. */
export function decideOrientation(box: Box, setting: OrientationSetting, was: Orientation): Orientation {
  if (setting !== "auto") return setting;
  if (box.width <= 0 || box.height <= 0) return was;
  if (box.height < PORTRAIT_MIN_HEIGHT) return "landscape";
  const ratio = box.height / box.width;
  return was === "portrait" ? (ratio >= PORTRAIT_LEAVE ? "portrait" : "landscape") : ratio >= PORTRAIT_ENTER ? "portrait" : "landscape";
}

/** What the owner set in portrait, per window (landscape keeps its own prefs untouched). */
export interface PortraitPrefs {
  /** The conversation's share of the stack (0–1; the Shelf gets the rest). */
  split: number;
  /** The Shelf above the conversation (default: the conversation on top). */
  swapped: boolean;
  /** The sidebar shown (as an overlay over the stack); default hidden. */
  sidebarShown: boolean;
  /**
   * P4: the left Shelf's share of the band while left and right stand side by side (the handle between them sets it);
   * absent = their landscape widths' ratio (nothing of landscape is written from here).
   */
  band?: number;
}

export const DEFAULT_PORTRAIT: PortraitPrefs = { split: 0.58, swapped: false, sidebarShown: false };

/** Neither part of the stack gets less than this (CSS px): the conversation keeps its composer and a few rows… */
export const STACK_CONVERSATION_MIN = 280;
/** …the Shelf its Rail, a pane header and some content. */
export const STACK_SHELF_MIN = 200;
/** Within this much of the default share a drag snaps there (double-click on the divider goes back to it). */
export const SPLIT_SNAP = 0.02;
/** A step of the divider's arrow keys (Shift: SPLIT_STEP_BIG). */
export const SPLIT_STEP = 0.02;
export const SPLIT_STEP_BIG = 0.1;
/** The gap between the conversation and its Shelf (the divider's height), and the empty / folded Rail's height. */
export const STACK_GAP = 8;
export const STACK_RAIL_H = 40;

/** P3: left and right Shelves stand side by side in the stack's Shelf band while each gets at least this (CSS px)… */
export const BAND_SHELF_MIN = 360;
/** …two workspaces side by side, each its own column (conversation over its Shelves), while each gets this… */
export const STACK_WS_MIN = 520;
/** …and once side by side they fold back only this much below it (a window dragged around the edge does not flap). */
export const STACK_SLACK = 16;

/**
 * The band's two open Shelves' flex weights (left, right): the owner's share if set (the handle between them), else
 * their landscape widths (`widths`). Each box keeps BAND_SHELF_MIN by its own min-width. Pure.
 */
export function bandWeights(share: number | undefined, widths: readonly [number, number]): [number, number] {
  if (share === undefined) return [widths[0], widths[1]];
  return [share, Math.round((1 - share) * 1000) / 1000];
}

/** A left share of the band (`width` px: its two boxes, the gap not counted), kept so both keep BAND_SHELF_MIN. Pure. */
export function clampBand(share: number, width: number): number {
  if (!Number.isFinite(share) || width <= 2 * BAND_SHELF_MIN) return 0.5;
  const lo = BAND_SHELF_MIN / width;
  return Math.round(Math.min(1 - lo, Math.max(lo, share)) * 1000) / 1000;
}

/** Room in the stack (`width` px) for two workspaces side by side (`was`: they are now). Pure. */
export function stackColumns(width: number, was: boolean): boolean {
  const need = 2 * STACK_WS_MIN + STACK_GAP;
  return width >= (was ? need - STACK_SLACK : need);
}

/** A Shelf of the band: `expanded` = open in its layout (else a collapsed one: its rail); `active` = holds the page in focus. */
export interface BandShelf {
  id: string;
  side: "left" | "right";
  expanded: boolean;
  active: boolean;
}

/**
 * The stack's Shelf band (one workspace, or one column): which Shelves show open and which as their rail (upright, at
 * their side of the band). Both open side by side while each gets BAND_SHELF_MIN (`was`: both were); else only the
 * one holding the page in focus (else the right one) — the other shows as its rail, a view only (its layout keeps it
 * expanded; a click on that rail shows it instead). Pure.
 */
export function bandShelves(width: number, shelves: readonly BandShelf[], was: boolean): { open: string[]; rails: string[] } {
  const expanded = shelves.filter((s) => s.expanded);
  const need = 2 * BAND_SHELF_MIN + STACK_GAP;
  const room = width >= (was ? need - STACK_SLACK : need);
  const keep = expanded.length < 2 || room ? expanded : [expanded.find((s) => s.active) ?? expanded.find((s) => s.side === "right") ?? expanded[0]!];
  const open = keep.map((s) => s.id);
  return { open, rails: shelves.filter((s) => !open.includes(s.id)).map((s) => s.id) };
}

/** The rows of the stack's columns (two workspaces side by side): the conversation's share, the divider, the Shelves'. Pure. */
export function stackRows(share: number, swapped: boolean): string {
  const conv = `minmax(${STACK_CONVERSATION_MIN}px, ${Math.round(share * 1000) / 1000}fr)`;
  const shelf = `minmax(${STACK_SHELF_MIN}px, ${Math.round((1 - share) * 1000) / 1000}fr)`;
  return swapped ? `${shelf} ${STACK_GAP}px ${conv}` : `${conv} ${STACK_GAP}px ${shelf}`;
}

/**
 * A share of the stack's two parts together (`total` px, the divider not counted), kept so both keep their minimum,
 * snapped to the default near it. Pure.
 */
export function clampSplit(share: number, total: number): number {
  if (!Number.isFinite(share)) return DEFAULT_PORTRAIT.split;
  const s = Math.abs(share - DEFAULT_PORTRAIT.split) < SPLIT_SNAP ? DEFAULT_PORTRAIT.split : share;
  if (total <= STACK_CONVERSATION_MIN + STACK_SHELF_MIN) return Math.round(Math.min(0.9, Math.max(0.1, s)) * 1000) / 1000;
  const lo = STACK_CONVERSATION_MIN / total;
  const hi = 1 - STACK_SHELF_MIN / total;
  return Math.round(Math.min(hi, Math.max(lo, s)) * 1000) / 1000;
}

export const PORTRAIT_KEY = "cutex-desktop.portrait.v1";

export interface PortraitStored {
  setting: OrientationSetting;
  /** By window key (main / a desk id). */
  windows: Record<WindowKey, PortraitPrefs>;
}

/** Stored prefs, defensively (anything odd falls back to the defaults). */
export function parsePortrait(raw: string | null): PortraitStored {
  const out: PortraitStored = { setting: "auto", windows: {} };
  try {
    const v = JSON.parse(raw ?? "{}") as Record<string, unknown>;
    if (!v || typeof v !== "object" || Array.isArray(v)) return out;
    if (v.setting === "landscape" || v.setting === "portrait" || v.setting === "auto") out.setting = v.setting;
    const wins = v.windows as Record<string, unknown> | undefined;
    if (wins && typeof wins === "object" && !Array.isArray(wins)) {
      for (const [key, e] of Object.entries(wins)) {
        if (!(key === MAIN_WINDOW || /^d[0-9a-f]{12}$/.test(key)) || !e || typeof e !== "object") continue;
        const p = e as Record<string, unknown>;
        out.windows[key] = {
          split: typeof p.split === "number" && p.split > 0 && p.split < 1 ? p.split : DEFAULT_PORTRAIT.split,
          swapped: p.swapped === true,
          sidebarShown: p.sidebarShown === true,
          ...(typeof p.band === "number" && p.band > 0 && p.band < 1 ? { band: p.band } : {}),
        };
      }
    }
  } catch {
    // unreadable: defaults
  }
  return out;
}

const load = (): PortraitStored => (typeof localStorage === "undefined" ? { setting: "auto", windows: {} } : parsePortrait(localStorage.getItem(PORTRAIT_KEY)));

let stored: PortraitStored = load();

function persist(): void {
  try {
    localStorage.setItem(PORTRAIT_KEY, JSON.stringify(stored));
  } catch {
    // storage full: only not remembered
  }
}

/** The device-wide setting (Settings → 外观 → 竖屏布局). */
export const useOrientationSetting = create<{ setting: OrientationSetting }>(() => ({ setting: stored.setting }));

/** One window's portrait state. */
export interface PortraitState {
  orientation: Orientation;
  prefs: PortraitPrefs;
  /** Two workspaces would stand side by side in this window's stack (its measured width, stackColumns; components/side/SideArea sets it). */
  columns: boolean;
}

export const usePortrait = windowStore((key) => create<PortraitState>(() => ({ orientation: "landscape", prefs: stored.windows[key] ?? DEFAULT_PORTRAIT, columns: false })));

/**
 * A Shelf Rail drawn horizontally in the stack (components/side/SideArea's portrait branch): on its Shelf's top edge (the
 * conversation above it) or bottom edge (swapped). Null — every rail in landscape — = the usual vertical rail.
 */
export type RailEdge = "top" | "bottom";
export const RailEdgeContext = createContext<RailEdge | null>(null);

/**
 * P4: a Shelf of the band drawn as its rail only for lack of room (bandShelves; its layout keeps it expanded) — its
 * avatar previews showing it, not folding it (components/side/ShelfRail ShelfAvatar).
 */
export const RoomFoldedContext = createContext(false);

/** The rail edge this Shelf / rail is drawn on (null: vertical, landscape). */
export function useRailEdge(): RailEdge | null {
  return useContext(RailEdgeContext);
}

/** Each window's last measured size (the setting changing decides again from it). */
const boxes = new Map<WindowKey, Box>();

/** This window (key) is laid out as a stack now. */
export function portraitOn(key: WindowKey = MAIN_WINDOW): boolean {
  return usePortrait.of(key).getState().orientation === "portrait";
}

/** The component's window shows two workspaces side by side in its stack now (portrait, room for both columns). */
export function usePortraitColumns(): boolean {
  return usePortrait((s) => s.orientation === "portrait" && s.columns);
}

/** The component's window is portrait now (re-renders when that flips). */
export function usePortraitOn(): boolean {
  return usePortrait((s) => s.orientation === "portrait");
}

/** The window measured again (resize / rotation): its orientation under the setting, with hysteresis. */
export function noteWindowBox(key: WindowKey, box: Box): Orientation {
  boxes.set(key, box);
  const store = usePortrait.of(key);
  const next = decideOrientation(box, useOrientationSetting.getState().setting, store.getState().orientation);
  if (next !== store.getState().orientation) store.setState({ orientation: next });
  return next;
}

export function setOrientationSetting(setting: OrientationSetting): void {
  stored = { ...stored, setting };
  useOrientationSetting.setState({ setting });
  persist();
  // Every window decides again from its last size (one that was never measured stays as it is).
  for (const [key, box] of boxes) noteWindowBox(key, box);
}

/** Changes this window's portrait prefs (kept apart from landscape's). */
export function setPortraitPrefs(key: WindowKey, patch: Partial<PortraitPrefs>): void {
  const store = usePortrait.of(key);
  const prefs = { ...store.getState().prefs, ...patch };
  store.setState({ prefs });
  stored = { ...stored, windows: { ...stored.windows, [key]: prefs } };
  persist();
}

/** The conversation and its Shelf trade places (the divider's ⇅, the Shelf's ⋯ menu, Settings). */
export function swapPortrait(key: WindowKey): void {
  setPortraitPrefs(key, { swapped: !usePortrait.of(key).getState().prefs.swapped });
}

/**
 * Ctrl/⌘+B and the sidebar's own toggles in a portrait window: show / hide its overlay sidebar (the portrait pref; the
 * landscape setting stays as it is). True = handled.
 */
export function togglePortraitSidebar(key: WindowKey): boolean {
  if (!portraitOn(key)) return false;
  setPortraitPrefs(key, { sidebarShown: !usePortrait.of(key).getState().prefs.sidebarShown });
  return true;
}

/**
 * This component's window follows its own size (components/PaneHost, one per app window): measured on its root element
 * in the synchronous resize pass (lib/syncResize), so the flip renders in the same frame as the resize.
 */
export function useWindowOrientation(): void {
  const key = useWindowKey();
  const win = useOwnerWindow();
  useLayoutEffect(() => {
    const measure = () => void noteWindowBox(key, { width: win.innerWidth, height: win.innerHeight });
    measure();
    return observeSync(win.document.documentElement, measure);
  }, [key, win]);
}

// The Settings Shelf opens maximised in a portrait window (P2: beside the stack there is no room for it); its stored
// maximised choice is landscape's and is not changed.
setSettingsPortraitHook(portraitOn);

/** The Settings Shelf is drawn maximised now (the stored choice, or its window is portrait). */
export function useSettingsShelfMaximized(): boolean {
  const win = useSettingsShelf((s) => s.win);
  const portrait = usePortrait.of(win)((s) => s.orientation === "portrait");
  const stored = useSettingsShelf((s) => s.maximized);
  return stored || portrait;
}

/** Tests: forget every window's state and the stored prefs. */
export function resetPortraitForTest(): void {
  stored = { setting: "auto", windows: {} };
  boxes.clear();
  useOrientationSetting.setState({ setting: "auto" });
  for (const key of usePortrait.windows()) usePortrait.of(key).setState({ orientation: "landscape", prefs: DEFAULT_PORTRAIT, columns: false });
}
