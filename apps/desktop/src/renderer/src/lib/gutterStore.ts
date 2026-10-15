// The gutters' memory-only state (docs/desktop-modules.md §19.2–§19.3): the geometry the gutter host
// measured last (null = no conversation gutter on screen: a page, settings, no agent), the right
// side's frame as far as the gutters care (让位 shift, the part a float / drawer covers), the open
// gutter popover and docked lists the owner folded away for now. Nothing here is persisted; the
// 够宽时常驻 choice is the `gutterDocked` UI pref.
import { create } from "zustand";
import type { GutterGeometry } from "./gutterLayout";

export interface GutterStoreState {
  geometry: GutterGeometry | null;
  /** The conversation card's content width (overlay reference card width). */
  cardWidth: number;
  /** From the right side's frame (SideWorkArea). */
  sideShift: number;
  sideCover: number;
  /** The gutter item whose popover is open (one at a time). */
  popover: string | null;
  /** Docked lists folded with their trigger (shown again by the trigger, or on restart). */
  folded: readonly string[];
  /** The trigger that opened the last popover: focus goes back there. */
  lastTrigger: HTMLElement | null;
  /** Top of each side's trigger stack in the card (px; null = triggers not in that gutter). */
  stackTop: { left: number | null; right: number | null };
  /** Bottom of each side's top-entry stack in the card; lists / reference cards start below it. */
  topStackBottom: { left: number | null; right: number | null };
}

export const useGutter = create<GutterStoreState>(() => ({
  geometry: null,
  cardWidth: 0,
  sideShift: 0,
  sideCover: 0,
  popover: null,
  folded: [],
  lastTrigger: null,
  stackTop: { left: null, right: null },
  topStackBottom: { left: null, right: null },
}));

const sameSide = (a: GutterGeometry["left"], b: GutterGeometry["left"]) => a.width === b.width && a.trigger === b.trigger && a.topInset === b.topInset && a.bottomBand === b.bottomBand;

export function setGutterGeometry(geometry: GutterGeometry | null, cardWidth: number): void {
  const s = useGutter.getState();
  const old = s.geometry;
  const same = old === geometry || (!!old && !!geometry && old.columnLeft === geometry.columnLeft && old.columnWidth === geometry.columnWidth && sameSide(old.left, geometry.left) && sameSide(old.right, geometry.right));
  if (same && s.cardWidth === cardWidth) return;
  useGutter.setState({ geometry: same ? old : geometry, cardWidth });
}

/** The right side's frame, as the gutters need it (published by the side's work area). */
export function publishSideFrame(shift: number, cover: number): void {
  const s = useGutter.getState();
  if (s.sideShift !== shift || s.sideCover !== cover) useGutter.setState({ sideShift: shift, sideCover: cover });
}

export function setGutterPopover(id: string | null, trigger?: HTMLElement | null): void {
  useGutter.setState(trigger === undefined ? { popover: id } : { popover: id, lastTrigger: trigger });
}

export function toggleFolded(id: string): void {
  const folded = useGutter.getState().folded;
  useGutter.setState({ folded: folded.includes(id) ? folded.filter((x) => x !== id) : [...folded, id] });
}

export function setGutterTopStackBottom(side: "left" | "right", bottom: number | null): void {
  const current = useGutter.getState().topStackBottom;
  if (current[side] !== bottom) useGutter.setState({ topStackBottom: { ...current, [side]: bottom } });
}

/** The left gutter's width now (0 without a conversation gutter). */
export function leftGutterNow(): number {
  return useGutter.getState().geometry?.left.width ?? 0;
}
