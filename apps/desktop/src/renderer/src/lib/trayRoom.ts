// 托盘常驻 at the bottom (polish-0.2 checklist #36, docs/design/001-tray-taskbar.md, owner 2026-10-21): the tray
// is an opaque low card at the bottom of the conversation area, spanning only the conversation columns — the
// sidebar card and the Shelves keep their full height. The conversation cards leave room for it at their
// bottom (components/tray.css `[data-tray-room]`), and the tray card is placed under them, measured from the
// union of their boxes (components/ChipTray TrayFrame). Icons that do not fit fold into 「… N」 (design 038, owner
// 2026-10-23: never the full-width band because of the Settings Shelf). A Shelf between two conversation columns
// (Shelf placement 「永远偏右」), or conversations too narrow for even 「… N」 (a lone strip, 只看 Shelf): the card
// spans the conversations and their Shelves ("wide": they all leave room at their bottom) — never the sidebar or
// the Settings Shelf. The desktop showing (no conversation): the card is centred over the stage's bottom.
// Pure parts unit-tested in test/trayRoom.test.ts. Shell code: names no feature.
import { create } from "zustand";
import { windowStore } from "./windowScope";
import { TRAY_DOCK_PX } from "./trayModel";

/** The gap between the tray card and the conversation cards above it (the cards' usual gap). */
export const TRAY_ROOM_GAP = 8;
/** Under conversations narrower than this (px: the grip, one icon and 「… N」) the card spans their Shelves too (a lone strip, 只看 Shelf). */
export const TRAY_MIN_SPAN = 120;
/** The room the conversation cards leave at their bottom (CSS `--tray-room`). */
export const TRAY_ROOM_PX = TRAY_DOCK_PX + TRAY_ROOM_GAP;

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Where the tray card goes, in the frame's px: under the conversations ("room"), under them and their Shelves ("wide":
 * the Shelves leave room too), centred over the desktop, or the band (nothing to place it under).
 */
export type RoomGeometry = { kind: "band" } | { kind: "room" | "wide"; left: number; width: number; top: number; centre: boolean };

/**
 * The tray card's place (pure). `cards`: the conversation cards on screen (window px; already shortened by the
 * room); `shelves`: the Shelf boxes in the row (not inside a card); `stage`: the desktop's stage when it shows. The
 * items never send it to the band: what does not fit folds into 「… N」 (components/ChipTray).
 */
export function roomGeometry(input: { frame: Box; cards: readonly Box[]; shelves: readonly Box[]; stage: Box | null; /** The dock's height (default one row). */ dock?: number }): RoomGeometry {
  const { frame } = input;
  if (input.stage) {
    const s = input.stage;
    return { kind: "room", left: s.left - frame.left, width: s.right - s.left, top: s.bottom - frame.top - (input.dock ?? TRAY_DOCK_PX), centre: true };
  }
  const cards = input.cards.filter((c) => c.right > c.left && c.bottom > c.top);
  if (!cards.length) return { kind: "band" };
  const left = Math.min(...cards.map((c) => c.left));
  const right = Math.max(...cards.map((c) => c.right));
  const bottom = Math.max(...cards.map((c) => c.bottom));
  // A Shelf lying between two conversation columns (the card would run under it), or conversations too narrow for
  // even 「… N」 (a conversation folded to its strip, 只看 Shelf): the conversations and their Shelves together.
  const shelves = input.shelves.filter((s) => s.right > s.left && s.bottom > s.top);
  const between = shelves.some((s) => (s.left + s.right) / 2 > left && (s.left + s.right) / 2 < right);
  if (between || right - left < TRAY_MIN_SPAN) {
    const all = [...cards, ...shelves];
    const l = Math.min(...all.map((c) => c.left));
    const r = Math.max(...all.map((c) => c.right));
    const b = Math.max(...all.map((c) => c.bottom));
    if (r - l < TRAY_MIN_SPAN) return { kind: "band" };
    return { kind: "wide", left: l - frame.left, width: r - l, top: b - frame.top + TRAY_ROOM_GAP, centre: false };
  }
  return { kind: "room", left: left - frame.left, width: right - left, top: bottom - frame.top + TRAY_ROOM_GAP, centre: false };
}

export function sameGeometry(a: RoomGeometry | null, b: RoomGeometry | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === "band" || b.kind === "band") return true;
  const near = (x: number, y: number) => Math.abs(x - y) < 0.5;
  return a.kind === b.kind && near(a.left, b.left) && near(a.width, b.width) && near(a.top, b.top) && a.centre === b.centre;
}

/** How long a hold waits for the desktop to come up (ms). */
export const TRAY_HOLD_MS = 1000;

/**
 * The last workspace closed (lib/workspaces closeWorkspace), before the layout changes: when the desktop comes up
 * next, the tray card keeps the place it has now under the conversations instead of moving to the desktop's middle
 * (owner 2026-10-23: the tray flew away). Kept until the window is resized or the conversations come back
 * (components/ChipTray takes the place it had at this moment: the layouts in between are not the owner's).
 */
export function holdTrayPlace(): void {
  useTrayRoom.setState({ hold: Date.now() });
}

/**
 * The card's place given a fresh measure (pure): over the desktop (`next` centred) with a place kept from under the
 * conversations, that place at the desktop's height; else null (the measure as it is).
 */
export function heldGeometry(next: RoomGeometry, kept: RoomGeometry | null): RoomGeometry | null {
  if (next.kind === "band" || !next.centre || !kept || kept.kind === "band" || kept.centre) return null;
  return { kind: "room", left: kept.left, width: kept.width, top: next.top, centre: false };
}

/** Live: the tray is a card in the conversations' room (the desktop's content keeps its bottom clear). */
/** Per app window (multi-window P3, lib/windowScope). */
export const useTrayRoom = windowStore(() => create<{ active: boolean; /** holdTrayPlace's time (0: never). */ hold: number; /** The dock's rows of items (「托盘两排」: 2 while they do not fit one; components/ChipTray). */ rows: number }>(() => ({ active: false, hold: 0, rows: 1 })));
