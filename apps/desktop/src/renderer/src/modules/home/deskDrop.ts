// A tray avatar dragged onto the desktop becomes an icon there (owner 2026-10-24: the tray's pins no longer put icons on
// the desktop by themselves; model 「The desktop's icons」). While the desktop shows, its surface (DeskSurface) offers
// itself here as the drop target: the tray's drag (trayReorder trayDragLocal) asks it for the spot under the pointer —
// the icon's box on the unit grid, drawn as a dashed hint with 「放到桌面」 — and the release puts the icon in that box
// (the widgets it covers make room by the desk's own drop rule). 放到桌面 on a tray avatar's menu (the keyboard way)
// adds it without a position: the desk gives it the first free place.
import { create } from "zustand";
import type { HomeDoc, HomePin } from "../../../../shared/home";
import type { Json } from "../types";
import { deskOf, mirrorBlocks, withKindOff } from "./desk";
import type { Cells } from "./deskCells";
import { withDeskIcon } from "./model";
import { TILE_WIDGET } from "./widgets";

/** Where a dragged avatar would land on the desk. */
export interface DeskSpot {
  /** Its box on the unit grid. */
  cells: Cells;
  /** Already an icon there: the drop moves it. */
  already: boolean;
}

export interface DeskDropTarget {
  /** The spot for an icon of `pin` under the pointer at (`x`, `y`); null: the pointer is not over the desk. */
  spot(pin: HomePin, x: number, y: number): DeskSpot | null;
  /** Puts the icon of `pin` at `spot` (one 撤销 takes a new icon away again). */
  drop(pin: HomePin, spot: DeskSpot, name: string): void;
}

let target: DeskDropTarget | null = null;

/** The desk offers itself as the drop target while it is mounted (returns the withdrawal). */
export function setDeskDropTarget(next: DeskDropTarget): () => void {
  target = next;
  return () => {
    if (target === next) target = null;
  };
}

export const deskDropTarget = (): DeskDropTarget | null => target;

/** The dashed hint of a drag over the desk (in the grid's units), drawn by the desk itself. */
export const useDeskDropHint = create<{ hint: { cells: Cells; text: string } | null }>(() => ({ hint: null }));

/**
 * `pin` as a desktop icon: added (already there / full = unchanged), and the tiles turned back on when the owner had
 * turned the kind off on the desk (an icon dropped there must show). Pure.
 */
export function withIconOnDesk(doc: HomeDoc, pin: HomePin): HomeDoc {
  let next = withDeskIcon(doc, pin);
  const desk = deskOf(next);
  if (desk?.off?.includes(TILE_WIDGET)) {
    const on = withKindOff(desk, TILE_WIDGET, false);
    next = mirrorBlocks({ ...next, desk: JSON.parse(JSON.stringify(on)) as Json }, on);
  }
  return next;
}
