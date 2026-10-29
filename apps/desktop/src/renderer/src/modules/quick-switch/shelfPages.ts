// The Shelf pages section (canvas principles §6: Shelf → 页 → 窗格): the Shelves' read API
// (lib/shelves `listShelfPages` / `openShelfPage`), read once when the palette opens. A page's icon is
// the one its Shelf Rail draws (lib/shelfIcons pageIcon: its own, else its first pane's kind icon).
import type { ItemId } from "../types";
import type { Icon } from "../slots";
import { sideRegistry } from "../../lib/sideComponents";
import { pageIcon } from "../../lib/shelfIcons";
import { listShelfPages, openShelfPage } from "../../lib/shelves";

/** One Shelf page as the switcher lists it. */
export interface ShelfPageInfo {
  shelfId: string;
  pageId: string;
  name: string;
  side: "left" | "right";
  /** 1-based place in its Shelf Rail. */
  index: number;
  icon: Icon;
  /** Its Shelf shows it now (and is not collapsed into the tray). */
  current: boolean;
}

/** The Shelves' pages now (never throws: a broken read = no section). */
export function readShelfPages(): ShelfPageInfo[] {
  try {
    let registry: ReturnType<typeof sideRegistry> | null;
    try {
      registry = sideRegistry();
    } catch {
      registry = null; // the module host is not up (tests): the generic icon
    }
    const kindIcon = (kind: string) => registry?.get(kind as ItemId)?.item.icon ?? null;
    return listShelfPages().map((p) => ({
      shelfId: p.shelfId,
      pageId: p.pageId,
      name: p.name,
      side: p.side,
      index: p.index,
      icon: pageIcon({ icon: p.icon, cards: p.firstKind ? [{ kind: p.firstKind }] : [] } as unknown as Parameters<typeof pageIcon>[0], kindIcon),
      current: p.inView && !p.shelfCollapsed,
    }));
  } catch {
    return [];
  }
}

/** Shows the page (its Shelf back from the tray, the page in view and focused); false = it is gone. */
export function showShelfPage(pageId: string): boolean {
  return openShelfPage(pageId);
}
