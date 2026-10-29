// Menus opened from the tray (components/ChipTray, the Dock's items): they open away from the edge the tray
// is docked to (above it at the bottom, below it at the top, beside it on the left / right), with owner
// TRAY_MENU_OWNER so a revealed tray stays while one is open. Shell code: names no feature.
import { openMenuAbove, openMenuAt, openMenuFrom, type MenuEntry } from "./contextMenu";
import { TRAY_MENU_OWNER } from "./trayModel";
import { useTrayPrefs } from "./trayPrefs";

/** A menu's usual width (the menu is kept inside the window anyway). */
const MENU_W = 220;

/** `at`: a right-click's pointer position — the menu opens there (the overlay keeps it inside the window), like every other context menu. */
export function openTrayMenu(el: HTMLElement, entries: MenuEntry[], at?: { x: number; y: number }): void {
  if (at) return openMenuAt(at.x, at.y, entries, { owner: TRAY_MENU_OWNER });
  const edge = useTrayPrefs.getState().edge;
  if (edge === "bottom") return openMenuAbove(el, entries, { owner: TRAY_MENU_OWNER });
  if (edge === "top") return openMenuFrom(el, entries, { owner: TRAY_MENU_OWNER });
  const r = el.getBoundingClientRect();
  openMenuAt(edge === "left" ? r.right + 6 : r.left - 6 - MENU_W, r.top, entries, { owner: TRAY_MENU_OWNER });
}
