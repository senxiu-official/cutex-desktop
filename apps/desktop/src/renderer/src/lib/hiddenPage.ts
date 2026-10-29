// What of a Shelf page the agent in view does not see (owner 2026-10-23). A page the owner made, or a shared one, keeps
// its layout for every agent: a pane with nothing for this one is an empty slot of the same size (lib/sideLayout
// shownCards, components/side/EmptySlot) that offers to open its kind here or shows whose things it holds; the rail's
// tooltip says so on hover. Things bound to another agent go to that agent's own Shelf (lib/sideLayoutStore
// adoptIntoConversation), so what is left here is legitimately someone else's: another workspace's, another host's,
// a shared page's tabs of another agent. Pure; tested (test/hiddenPage.test.ts).
import type { ItemId } from "../modules/types";
import { instanceVisible, pageVisibility, type SideCard, type SideLayout, type SidePage, type SideViewContext } from "./sideLayout";

export interface PageOwner {
  hostId: string;
  sessionId: string;
  /** Its instances on this page. */
  count: number;
}

export interface HiddenPageInfo {
  /** The kinds on the page, the most frequent first (the page's own kind first). */
  kinds: ItemId[];
  /** The agents whose instances the page holds, most first (agent-bound ones; this agent never among them). */
  owners: PageOwner[];
  /** Instances not bound to one agent (another host's, another workspace's). */
  others: number;
}

/** What a page holds when it has nothing for `ctx` (null: it shows something here, or it is an empty launcher page). */
export function hiddenPageInfo(layout: SideLayout, page: SidePage, ctx: SideViewContext): HiddenPageInfo | null {
  return pageVisibility(layout, page, ctx) === "hidden" ? othersOnPage(layout, page, ctx) : null;
}

/** What of a page only other agents see (its instances not visible to `ctx`); null when there is none. */
export function othersOnPage(layout: SideLayout, page: SidePage, ctx: SideViewContext): HiddenPageInfo | null {
  return othersIn(layout, page.cards, ctx, pageVisibility(layout, page, ctx) === "hidden");
}

/** Panes with nothing for `ctx` (empty slots): whose things they hold. */
export function slotInfo(layout: SideLayout, cards: readonly SideCard[], ctx: SideViewContext): HiddenPageInfo {
  return othersIn(layout, cards, ctx, true)!;
}

/** The panes of a page with nothing for `ctx` (on a page that keeps its layout: its empty slots). */
export function emptySlots(layout: SideLayout, page: SidePage, ctx: SideViewContext): SideCard[] {
  return page.cards.filter((c) => c.tabs.length > 0 && !c.tabs.some((id) => instanceVisible(layout, id, ctx)));
}

function othersIn(layout: SideLayout, cards: readonly SideCard[], ctx: SideViewContext, always: boolean): HiddenPageInfo | null {
  const kinds = new Map<ItemId, number>();
  const owners = new Map<string, PageOwner>();
  let others = 0;
  for (const card of cards) {
    for (const id of card.tabs) {
      const inst = layout.instances[id];
      if (!inst || instanceVisible(layout, id, ctx)) continue;
      kinds.set(inst.kind, (kinds.get(inst.kind) ?? 0) + 1);
      const b = inst.binding;
      if (b.kind === "agent") {
        const key = `${b.hostId}\u0000${b.sessionId}`;
        const o = owners.get(key) ?? { hostId: b.hostId, sessionId: b.sessionId, count: 0 };
        o.count++;
        owners.set(key, o);
      } else others++;
    }
  }
  // Nothing hidden at all (`always`: say what the panes are for all the same).
  if (!kinds.size && !owners.size && !others && !always) return null;
  // A card whose instances are gone still says what it was for.
  for (const card of cards) if (!kinds.has(card.kind)) kinds.set(card.kind, 0);
  return {
    kinds: [...kinds.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k),
    owners: [...owners.values()].sort((a, b) => b.count - a.count),
    others,
  };
}
