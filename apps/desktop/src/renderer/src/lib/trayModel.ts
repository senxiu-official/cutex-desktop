// The tray's pure rules (canvas principles §7, owner 2026-10-21; components/ChipTray): where the tray of
// shortcuts is drawn, which edge of the window's work area it is docked to, and the desktop layer's
// geometry. The tray is a light dock of pinned shortcuts (`pane.desktop` Dock) plus the tool panes
// collapsed with 「—」, a panel docked at the bottom (default), top, left or right edge of the work area
// (vertical on the left / right; outside the sidebar card and the Shelves, at the window's edge):
//   托盘常驻 (default on)      → a low strip in its own band of the layout ("docked"): the panes shrink by
//                               the band, nothing overlaps them
//   托盘常驻 off, desktop shown → the same band ("docked": nothing in front to cover)
//   托盘常驻 off, panes in front → a small pill in a thin band at that edge ("handle"); hovering it, a click
//                               or Ctrl/⌘+J reveals the dock over the panes ("overlay", never pushes them)
//                               and it hides again after use
// With a pin list (`pane.desktop` Dock) the tray is there even when empty (「＋ 固定」 and a hint); without one,
// only collapsed tool panes make a tray.
// Unit-tested in test/tray.test.ts. Shell code: names no feature.

/** The `owner` of a menu opened from the tray (lib/contextMenu openMenuAbove): a revealed tray stays while it is open. */
export const TRAY_MENU_OWNER = "tray";

export type TrayPlacement = "none" | "docked" | "handle" | "overlay";

export const TRAY_EDGES = ["bottom", "top", "left", "right"] as const;
export type TrayEdge = (typeof TRAY_EDGES)[number];

/** Left / right: the dock runs top to bottom. */
export const trayVertical = (edge: TrayEdge): boolean => edge === "left" || edge === "right";

export interface TrayInput {
  /** Something to show: pinned shortcuts or collapsed tool panes. */
  items: number;
  /** A full-window page (设置) is open, or the Settings Shelf is maximised over the row: no tray. */
  fullWindow: boolean;
  /** 托盘常驻: always a strip in its own band. */
  persistent: boolean;
  /** The desktop layer is on screen (not covered by panes). */
  desktopOn: boolean;
  /** Revealed by the handle / the shortcut (only matters while auto-hidden and covered). */
  revealed: boolean;
  /**
   * Something keeps a pin list (the `pane.desktop` item has a Dock): the tray is there even with nothing in
   * it — empty, it offers 「＋ 固定」 (owner 2026-10-21: an empty tray was never drawn, so it was never seen).
   * False (no such item, e.g. its module is off): only collapsed tool panes make a tray.
   */
  canPin?: boolean;
}

export function trayPlacement(i: TrayInput): TrayPlacement {
  if (i.fullWindow || (i.items <= 0 && !i.canPin)) return "none";
  if (i.persistent || i.desktopOn) return "docked";
  return i.revealed ? "overlay" : "handle";
}

/** The dock's thickness (its items: 40 px + padding; the avatars are 32 px, owner 2026-10-23). */
export const TRAY_DOCK_PX = 48;
/** 「托盘两排」 (lib/trayPrefs): each further row of items (40 px + the 2 px gap). */
export const TRAY_ROW_PX = 42;
/** The dock's thickness with `rows` rows of items. */
export function trayDockPx(rows: number): number {
  return TRAY_DOCK_PX + (Math.max(1, rows) - 1) * TRAY_ROW_PX;
}
/** The docked strip's band in the layout: the dock + the gap on its window side (the cards keep their own 8 px). */
export const TRAY_BAND_PX = TRAY_DOCK_PX + 8;
/** Auto-hidden: the handle's band (the pill and its hit area) — the panes shrink by this little only. */
export const TRAY_HANDLE_PX = 14;

/** The band the tray takes from the work area at its edge (px); the panes get the rest — nothing overlaps them. */
export function trayBand(placement: TrayPlacement, rows = 1): number {
  if (placement === "docked") return TRAY_BAND_PX + trayDockPx(rows) - TRAY_DOCK_PX;
  // Revealed over the panes: the handle's band stays (the panes do not move).
  if (placement === "handle" || placement === "overlay") return TRAY_HANDLE_PX;
  return 0;
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * The work area left to the panes beside the tray's band (`frame`: the window's work area under the title
 * bar). Pure; the layout (components/ChipTray TrayFrame, flex) does the same.
 */
export function paneArea(frame: Rect, edge: TrayEdge, band: number): Rect {
  switch (edge) {
    case "bottom":
      return { ...frame, bottom: frame.bottom - band };
    case "top":
      return { ...frame, top: frame.top + band };
    case "left":
      return { ...frame, left: frame.left + band };
    case "right":
      return { ...frame, right: frame.right - band };
  }
}

/** Dragging the tray by its grip: the edge of the work area nearest to the pointer (its drop zone lights up). */
export function trayDropEdge(pointer: { x: number; y: number }, frame: Rect): TrayEdge {
  const w = Math.max(1, frame.right - frame.left);
  const h = Math.max(1, frame.bottom - frame.top);
  // Relative distances, so a wide window does not favour top / bottom.
  const d: Record<TrayEdge, number> = {
    bottom: (frame.bottom - pointer.y) / h,
    top: (pointer.y - frame.top) / h,
    left: (pointer.x - frame.left) / w,
    right: (frame.right - pointer.x) / w,
  };
  return TRAY_EDGES.reduce((best, e) => (d[e] < d[best] ? e : best), "bottom" as TrayEdge);
}

/** The grip moves this far (px) before a drag starts (a click opens the 停靠在… menu). */
export const TRAY_DRAG_THRESHOLD = 5;

/** The pointer rests this long on the handle before the tray comes up (crossing it to the OS taskbar does nothing). */
export const TRAY_EDGE_DWELL_MS = 140;
/** Revealed by the handle: the pointer has this long to go into it before it hides again. */
export const TRAY_EDGE_GRACE_MS = 1500;
/** After the pointer leaves a revealed tray, it hides after this. */
export const TRAY_HIDE_MS = 700;
/** A tray revealed by the shortcut that is never used hides after this. */
export const TRAY_IDLE_MS = 4000;

/** The Ctrl/⌘+J shortcut (no Shift / Alt): show / hide the tray over the panes. */
export function isTrayKey(e: Pick<KeyboardEvent, "code" | "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">): boolean {
  return matchesCommand("tray", e);
}

/** Arrow keys between the dock's items: ←/→ on a horizontal dock, ↑/↓ on a vertical one. */
export function trayArrowStep(key: string, vertical: boolean): -1 | 1 | 0 {
  if (key === (vertical ? "ArrowUp" : "ArrowLeft")) return -1;
  if (key === (vertical ? "ArrowDown" : "ArrowRight")) return 1;
  return 0;
}

// ── The desktop layer's geometry ─────────────────────────────────────────────────────────────────

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * The 编辑主页 panel's width (a card of the work row over the desktop's right side): it covers the desktop's side
 * column (286 px + the content's 24 px right padding, modules/home/Desktop) — flush with the row's edge, a
 * narrower card left a sliver of 需要你 / 用量 showing beside it.
 */
export const DESK_PANEL_W = 312;
/** The gap between the desktop's edge and what floats on it. */
export const DESK_FLOAT_GAP = 12;
/** The room the desktop's content leaves at its bottom for a tray floating over it (contract 1.20 `tray`; the shell's tray now has its own band). */
export const DESK_TRAY_ROOM = 64;

export interface DeskGeometry {
  /** The layer itself, in the work area (stage): always all of it — behind the conversation panes and the Shelves. */
  layer: Insets;
  /** The 编辑主页 panel floating over it (null: not editing). */
  panel: (Insets & { width: number }) | null;
  /** Padding of the desktop's scrolling content (the tray floats over its bottom). */
  content: Insets;
}

/**
 * The desktop is the bottom layer: what floats over it (the edit panel, the tray) never changes its box;
 * only its content keeps clear of the tray, and the panel sits over the right side as a card.
 */
export function deskGeometry(opts: { editing: boolean; tray: "desktop" | "none" }): DeskGeometry {
  // A card of the work row (checklist #16, owner 2026-10-21): flush with the layer's top, right and bottom — the
  // row's own 8 px from the window, the same top and bottom as the sidebar card and the Shelves.
  const panel = opts.editing ? { top: 0, right: 0, bottom: opts.tray === "desktop" ? DESK_TRAY_ROOM : 0, left: 0, width: DESK_PANEL_W } : null;
  return {
    layer: { top: 0, right: 0, bottom: 0, left: 0 },
    panel,
    content: { top: 20, right: 24, bottom: opts.tray === "desktop" ? DESK_TRAY_ROOM + 8 : 32, left: 24 },
  };
}import { matchesCommand } from "./keybindings";
