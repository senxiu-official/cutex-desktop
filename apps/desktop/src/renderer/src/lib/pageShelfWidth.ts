// A page's own width in a Shelf (design 011, owner 2026-10-21 「听你默认的」, checklist #2): pages (项目, 委托,
// 服务…) are cramped at a tool's width. When one newly opens as a pane of a Shelf narrower than PAGE_SHELF_WIDTH,
// the Shelf widens to it once (lib/sideResize widenShelf: as a drag of its edge — only the Shelf and its own
// conversation column change, it stops at that column's minimum). Never narrows; after that the Shelf keeps
// whatever width the owner drags it to.
import { locate, shelfOfPage, type ShelfSide } from "./sideLayout";
import { useSide } from "./sideLayoutStore";
import { widenShelf } from "./sideResize";
import { appWindowOfKey, queryAllAppWindows } from "./appWindowSet";
import { currentWindow, inWindow } from "./windowScope";

export const PAGE_SHELF_WIDTH = 640;

/**
 * The side the live Shelf `shelfId` is drawn on (beside two workspaces it can differ from its own side: 外侧 /
 * 永远偏右, lib/workspaceRow) — what its edge's handle sizes it by (components/side/SideArea). Not the other
 * workspace's copy (`data-ws-peer`; Shelf ids repeat across conversations).
 */
function drawnSide(shelfId: string): ShelfSide | null {
  if (typeof document === "undefined") return null;
  for (const el of queryAllAppWindows<HTMLElement>(`[data-shelf="${CSS.escape(shelfId)}"]`)) {
    if (el.closest("[data-ws-peer]")) continue;
    const at = el.dataset.shelfAt;
    if (at === "left" || at === "right") return at;
  }
  return null;
}

/**
 * After a page opened in a Shelf (lib/paneServices openPageInShelf): once the row has laid the (maybe just
 * expanded) Shelf out — the row's limits come from that layout — widen it to PAGE_SHELF_WIDTH.
 */
export function widenForPage(instanceId: string): void {
  const run = () => {
    const layout = useSide.getState().layout;
    const at = locate(layout, instanceId);
    const shelf = at ? shelfOfPage(layout, at.page.id) : null;
    if (shelf) widenShelf({ shelfId: shelf.id, side: drawnSide(shelf.id) ?? shelf.side }, PAGE_SHELF_WIDTH);
  };
  // In the window the page opened in (multi-window P3), on that window's frame clock.
  const key = currentWindow();
  const win = typeof window === "undefined" ? null : appWindowOfKey(key);
  if (win) win.requestAnimationFrame(() => win.requestAnimationFrame(() => inWindow(key, run)));
  else inWindow(key, run);
}
