// Folds for lack of room keep a slack before they come back (owner 2026-10-21: "when the whole window is resized,
// panels often fly around" — at a threshold every pixel of a resize flipped a fold one way and back): a Shelf
// forced to its rail (lib/workspaceRow), the right Shelf as a drawer (lib/sideFrame), the left Shelf off the row
// (lib/sideLayout shelfRow), the sidebar's automatic rail (lib/workspaces). Shell code; pure; tested.

/** The slack (px) a fold for lack of room keeps before it comes back. */
export const FOLD_HYSTERESIS = 48;

/**
 * Whether a fold for lack of room holds: `short(slack)` = the row would be short of width with `slack` px less;
 * short now, or folded before (`before`) and still within the slack.
 */
export function foldHeld(short: (slack: number) => boolean, before: boolean): boolean {
  return short(0) || (before && short(FOLD_HYSTERESIS));
}
