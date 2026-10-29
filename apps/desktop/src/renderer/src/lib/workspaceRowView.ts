// What the work row (components/side/SideArea SideWorkArea) tells the conversation columns it lays out (two
// workspaces, lib/workspaceRow): each column's width and where another workspace's rail sits. Plus the
// readers both sides need: another conversation's rail pages (an empty Shelf shows no rail) and a
// conversation's session row (the avatar at the top of its Shelf's rail). Non-component helpers live here so
// the components keep Fast Refresh.
import { createContext, useContext, useMemo } from "react";
import type { SessionResource } from "@cutex-desktop/protocol";
import { headerSession } from "./convHeader";
import { convKey } from "./convShelves";
import { pageAsShown, shelvesOf, type ShelfSide, type SidePage } from "./sideLayout";
import { workspaceKeyFor } from "./sideComponents";
import { peekConvShelf, useConvShelfVersion, useSide } from "./sideLayoutStore";
import type { RowWidthMode } from "./workspaceRow";
import { sidebarOf, useApp } from "../store";

export interface WsRowView {
  fill?: boolean;
  /** 工作区宽度 as applied (智能 resolved: two workspaces fill, so the column handle shows). */
  mode: RowWidthMode;
  /** Per workspace (left → right): its column's width in px, or null (it fills its share). */
  widths: readonly (number | null)[];
  /** Per workspace: the side its rail is drawn on when it has no focus. */
  railAt: readonly ShelfSide[];
  /**
   * The left workspace's expanded Shelf sits between the two columns (永远偏右): its far edge is the handle there (the
   * Shelf and the next column change, 推挤) — not the columns' own handle, which moved the column behind the Shelf.
   */
  shelfBetween?: boolean;
}

export const WsRowContext = createContext<WsRowView | null>(null);

export function useWsRow(): WsRowView | null {
  return useContext(WsRowContext);
}

/**
 * The pages another conversation's Shelf rail shows (its own pages in rail order, then the shared ones): what it
 * left in this session, as stored, or what the default layout would give it. Empty: no rail (owner 2026-10-21).
 */
export function useConvRailPages(hostId: string, sessionId: string | null): SidePage[] {
  const version = useConvShelfVersion((s) => s.n);
  const live = useSide((s) => s.layout);
  const shared = useMemo(() => live.pages.filter((p) => p.shared), [live]);
  const own = useMemo(() => (sessionId ? peekConvShelf(convKey(hostId, sessionId)) : null), [hostId, sessionId, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const workspaceKey = useApp((s) => (sessionId ? workspaceKeyFor(s, hostId, sessionId) : null));
  return useMemo(() => {
    if (!own) return shared;
    const order = shelvesOf(own).flatMap((x) => own.pages.filter((p) => p.shelf === x.id));
    // As that conversation's Shelf shows them (owner 2026-10-23): a page made by placement without its empty panes,
    // and none at all when nothing of it shows there.
    const ctx = { hostId, sessionId, workspaceKey, available: () => true };
    const view = { ...own, instances: { ...live.instances, ...own.instances } };
    return [...order, ...shared]
      .map((p) => pageAsShown(view, p, ctx))
      .filter((p) => p.kept || p.shared || p.cards.length > 0 || !own.pages.includes(p));
  }, [own, shared, live.instances, hostId, sessionId, workspaceKey]);
}

/** A conversation's session row (active or retired) on its host, or undefined while its list is not known. */
export function useConvSession(hostId: string, sessionId: string | null): SessionResource | undefined {
  return useApp((s) => headerSession(sidebarOf(s, hostId), sessionId));
}
