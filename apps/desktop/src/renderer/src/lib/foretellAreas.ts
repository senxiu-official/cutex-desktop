// The areas 动作预告 outlines (docs/design/008; lib/foretell, components/ForetellLayer), as CSS selectors — a comma
// list is tried in order. Kept apart (no imports) so menus can use them without pulling in the workspace model.

const cssId = (id: string) => (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id.replace(/"/g, '\\"'));

/** A conversation column (two workspaces: its card; one: the single column, or the main card). */
export const paneArea = (paneId: string): string => `[data-conv-pane="${cssId(paneId)}"], [data-conv-single="${cssId(paneId)}"], [data-conv-card]`;
/** A live Shelf's box by its side (the focused workspace's; another workspace's carries its pane id). */
export const shelfSideArea = (side: "left" | "right"): string => (side === "right" ? `[data-side-box], [data-shelf-box="right"]:not([data-ws-shelf])` : `[data-shelf-box="left"]:not([data-ws-shelf])`);
/** A tool pane (Shelf card). */
export const cardArea = (cardId: string): string => `[data-side-card="${cssId(cardId)}"]`;
