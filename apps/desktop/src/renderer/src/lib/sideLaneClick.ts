// What a page button (or one of its card icons) does when clicked (docs/desktop-modules.md §18.3).
// Pure: the column's state + the setting 点击当前页图标 → one action; lib/sideActions carries it out.
// Ctrl+Shift+n (goToPage) goes through the same rule with no card, so a click and its key never diverge.

/** Settings → 两侧 → 点击当前页图标: nothing happens to the column (★), or the old "close the column". */
export type CurrentPageClick = "stay" | "collapse";

export interface LaneClickInput {
  /** The column is open. */
  open: boolean;
  /** layout.activePage. */
  activePage: string | null;
  /** A maximised / full-screen side: the mode follows the page. */
  layered: boolean;
  pageId: string;
  /** The clicked card icon (null = the pill itself / its grip / the shortcut). */
  cardId: string | null;
  /** That card is collapsed (false when there is no card). */
  cardCollapsed: boolean;
  setting: CurrentPageClick;
}

export type LaneClickAction =
  /** Open the column on the page (switch to it); `expand` = also expand that card. */
  | { kind: "switch"; pageId: string; expand: string | null }
  /** The page in view: expand its collapsed card. */
  | { kind: "expand"; cardId: string }
  /** The page in view: focus / scroll to / flash its visible card. */
  | { kind: "focus"; cardId: string }
  /** Close the column (only with 点击当前页图标 = 收起侧栏). */
  | { kind: "close" }
  | { kind: "none" };

export function laneClickAction(input: LaneClickInput): LaneClickAction {
  const { open, activePage, layered, pageId, cardId, cardCollapsed, setting } = input;
  if (layered) return { kind: "switch", pageId, expand: cardId && cardCollapsed ? cardId : null };
  if (!open || activePage !== pageId) return { kind: "switch", pageId, expand: cardId };
  if (cardId && cardCollapsed) return { kind: "expand", cardId };
  if (setting === "collapse") return { kind: "close" };
  return cardId ? { kind: "focus", cardId } : { kind: "none" };
}
