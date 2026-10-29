// lib/guideActions' Shelf action (loaded when it runs): the focused conversation's Shelf on screen with the pane
// header's own commands — folded: expandAll (its 「Shelf」 button); no page: newPage (Ctrl+Shift+N, the launchers).
import { expandAll, liveShelfState } from "./convPaneControls";
import { newPage } from "./sideActions";
import { sideViewNow } from "./sideComponents";
import { updateLayout, useSide } from "./sideLayoutStore";

export function showLiveShelf(): void {
  const state = liveShelfState(useSide.getState().layout, sideViewNow());
  if (state === "empty") newPage();
  else if (state === "folded") updateLayout(expandAll);
}
