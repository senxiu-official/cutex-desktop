// Which conversation's Shelf a subtree draws (docs/desktop-modules.md §24.13, two live workspaces): null = the
// focused conversation's (the live layout of lib/sideLayoutStore); a peer = the other workspace's conversation,
// whose Shelf is live too (its own layout, its own view context). The Shelf components (components/side/*) and
// the instance layer's boxes read it: the layout through lib/shelfSource useShelfLayout, the view context
// through lib/sideComponents useSideView (a follow-bound tool in B's Shelf binds to B, not to the focused A).
// Kept apart from the hooks (no store import) so lib/sideComponents can read it without an import cycle.
import { createContext, useContext } from "react";
import type { SideLayout } from "./sideLayout";

export interface ShelfPeer {
  /** `convKey` (host + session) of the conversation whose Shelf this is. */
  key: string;
  hostId: string;
  sessionId: string;
  /** Its Shelf as it shows: its own pages with the shared ones, each Shelf's page in view (lib/sideLayoutStore peerView). */
  layout: SideLayout;
}

export const ShelfSourceContext = createContext<ShelfPeer | null>(null);

/** The peer whose Shelf this subtree draws (null: the focused conversation's live Shelf). */
export function useShelfPeer(): ShelfPeer | null {
  return useContext(ShelfSourceContext);
}
