// Page-button (pill) content (docs/desktop-modules.md §18.3): one icon per card in card order, at
// most PILL_CAP icons (else the first PILL_CAP − 1 + "+n"), badges summed per card from the visible
// instances' useTab(). Pure (a page with nothing for this agent has no button: lanePages).
import type { SideTabInfo } from "../modules/slots";
import type { ItemId } from "../modules/types";
import { instanceVisible, pageVisibility, visibleTabs, type SideLayout, type SidePage, type SideViewContext } from "./sideLayout";

export const PILL_CAP = 5;

export interface PillBadges {
  attention: number;
  unread: boolean;
  busy: boolean;
}

export interface PillIcon extends PillBadges {
  cardId: string;
  kind: ItemId;
  /** The card is collapsed (icon at 40%). */
  collapsed: boolean;
  /** Visible instances in the card (tooltip "×n"). */
  count: number;
}

export interface PillContent extends PillBadges {
  pageId: string;
  icons: PillIcon[];
  /** Cards beyond the shown icons ("+n"); 0 = none. */
  more: number;
  launcher: boolean;
}

export type TabInfoOf = (instanceId: string) => SideTabInfo | undefined;

function sum(ids: readonly string[], info: TabInfoOf): PillBadges {
  const out: PillBadges = { attention: 0, unread: false, busy: false };
  for (const id of ids) {
    const tab = info(id);
    if (!tab) continue;
    out.attention += Math.max(0, Math.floor(tab.attention ?? 0));
    out.unread ||= !!tab.unread;
    out.busy ||= !!tab.busy;
  }
  return out;
}

export function pillContent(layout: SideLayout, page: SidePage, ctx: SideViewContext, info: TabInfoOf): PillContent {
  const visibility = pageVisibility(layout, page, ctx);
  const cards = page.cards.filter((c) => visibleTabs(layout, c, ctx).length > 0);
  const all: PillIcon[] = cards.map((card) => {
    const tabs = visibleTabs(layout, card, ctx);
    return { cardId: card.id, kind: card.kind, collapsed: card.collapsed, count: tabs.length, ...sum(tabs, info) };
  });
  const icons = all.length > PILL_CAP ? all.slice(0, PILL_CAP - 1) : all;
  const total = sum(cards.flatMap((card) => visibleTabs(layout, card, ctx)), info);
  return { pageId: page.id, icons, more: all.length - icons.length, launcher: visibility === "launcher", ...total };
}

/** A title-bar launcher's badges (§18.3): summed over the instances of `kind` the current agent can see, on any page. */
export function kindBadges(layout: SideLayout, kind: ItemId, ctx: SideViewContext, info: TabInfoOf): PillBadges {
  const ids = Object.keys(layout.instances).filter((id) => layout.instances[id]!.kind === kind && instanceVisible(layout, id, ctx));
  return sum(ids, info);
}

/** Badge text of an attention count (9+ above nine). */
export function attentionText(n: number): string {
  return n > 9 ? "9+" : String(n);
}
