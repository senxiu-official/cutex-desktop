// Where store.openPage puts a page besides the conversation column (2026-10-21, docs/desktop-modules.md §24.4):
// lib/paneServices registers the opener — its own pane in the focused conversation's Shelf while 页面打开位置 =
// Shelf. Its own file so the store (and the many tests that mock it) does not carry the registry.
import type { ItemId, PageParams } from "../modules/types";
import { shownPages, shownTab, visibleCards, type SideLayout, type SideViewContext } from "./sideLayout";

let opener: ((page: ItemId, params: PageParams) => boolean) | null = null;

export function setPageOpener(open: ((page: ItemId, params: PageParams) => boolean) | null): void {
  opener = open;
}

/** True: the page opened elsewhere (a Shelf); false: it shows over the conversation column (`view`). Never throws. */
export function openPageElsewhere(page: ItemId, params: PageParams): boolean {
  try {
    return !!opener?.(page, params);
  } catch {
    return false;
  }
}

let shown: (() => ReadonlySet<string>) | null = null;

/** lib/paneServices registers what the focused conversation's Shelf shows (pane kinds, `page:<id>` for pages). */
export function setShelfKindsShown(read: (() => ReadonlySet<string>) | null): void {
  shown = read;
}

/** Whether a page is on screen as a Shelf pane (a page over the column is the store's `view`). Never throws. */
export function pageInShelfShown(page: string): boolean {
  try {
    return !!shown?.().has(`page:${page}`);
  } catch {
    return false;
  }
}

/** The pane kinds the focused conversation's Shelf shows now (each Shelf's page in view, each pane's shown tab). */
export function kindsOnScreen(layout: SideLayout, ctx: SideViewContext): Set<string> {
  const out = new Set<string>();
  for (const page of shownPages(layout, ctx))
    for (const card of visibleCards(layout, page, ctx)) {
      const id = shownTab(layout, card, ctx);
      const kind = id ? layout.instances[id]?.kind : undefined;
      if (kind) out.add(kind);
    }
  return out;
}
