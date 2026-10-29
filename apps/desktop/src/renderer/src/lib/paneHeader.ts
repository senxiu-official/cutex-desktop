// A pane header short of room (lib/tabFit headerCompact): the tabs would get less than their minimum next to the pane's
// own buttons at full size. A module's Actions read it and fold their secondary buttons into a ⋯ (the browser:
// 「加载」, 外部打开, 复制), so the tab titles stay readable. components/side/SideCard provides it.
import { createContext, useContext } from "react";

export const PaneHeaderCompact = createContext(false);

/** In a pane header's Actions: true = keep only the main buttons, the rest into a ⋯ menu. */
export function usePaneHeaderCompact(): boolean {
  return useContext(PaneHeaderCompact);
}
