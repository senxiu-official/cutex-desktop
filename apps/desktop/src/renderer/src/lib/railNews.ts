// Something arrived on a page of a folded Shelf in the workspace without the focus (design 017, the lead's
// default): the Shelf stays folded (it never unfolds itself, nor folds the focused one for room) and that page's
// Rail button flashes and keeps a dot (components/side/ShelfRail) until the owner opens the page — whatever way
// it comes into view (its Rail button, Alt+n, a reveal). In memory only; a page that is gone loses its mark.
import { create } from "zustand";
import { findPage, shelfOfPage, type SideLayout } from "./sideLayout";
import { peerView, useSide } from "./sideLayoutStore";

/** Marked pages by id (ids are unique in the scope): a nonce, new for each arrival (the flash replays). */
export const useRailNews = create<{ pages: Record<string, number> }>(() => ({ pages: {} }));

/** Whether a page is in view in `layout`: null = not a page of it. */
function shownIn(layout: SideLayout, pageId: string): boolean | null {
  if (!findPage(layout, pageId)) return null;
  const shelf = shelfOfPage(layout, pageId);
  return !!shelf && layout.open && !shelf.collapsed && shelf.active === pageId;
}

/** A page in the live Shelves: in view, folded away (or another page in view), or gone. */
export function railPageState(pageId: string): "shown" | "hidden" | "gone" {
  const s = useSide.getState();
  const views = [s.layout, ...Object.values(s.peers).map((p) => peerView(p, s.layout))];
  let hidden = false;
  for (const view of views) {
    const shown = shownIn(view, pageId);
    if (shown) return "shown";
    if (shown === false) hidden = true;
  }
  return hidden ? "hidden" : "gone";
}

let off: (() => void) | null = null;

/** Drops the marks of pages now in view (or gone); stops watching once none is left. */
function sweep(): void {
  const pages = useRailNews.getState().pages;
  const ids = Object.keys(pages);
  const keep = ids.filter((id) => railPageState(id) === "hidden");
  if (keep.length !== ids.length) useRailNews.setState({ pages: Object.fromEntries(keep.map((id) => [id, pages[id]!])) });
  if (!keep.length && off) {
    off();
    off = null;
  }
}

/** Marks page `pageId` (its Rail button flashes, then keeps the dot until the page is opened). */
export function markRailNews(pageId: string): void {
  useRailNews.setState((s) => ({ pages: { ...s.pages, [pageId]: Date.now() + Math.random() } }));
  off ??= useSide.subscribe(sweep);
}
