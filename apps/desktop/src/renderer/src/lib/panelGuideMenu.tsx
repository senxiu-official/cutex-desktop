// 「使用小指南」 at the end of a panel's own menus (right-click / ⋯; lib/panelGuides), after a separator, with a
// lightbulb — the same row in the Shelf's, the tray's, the sidebar's and the conversation's menus.
import { Lightbulb } from "lucide-react";
import { translate } from "../i18n";
import { menuOpener, type MenuEntry } from "./contextMenu";
import { openPanelGuide, type PanelGuideRequest } from "./panelGuides";

export function panelGuideItem(request: Omit<PanelGuideRequest, "opener">): MenuEntry {
  return {
    label: translate("onboarding.panel.menu"),
    icon: <Lightbulb size={14} />,
    onSelect: () => openPanelGuide({ ...request, opener: menuOpener() }),
  };
}

/** The separator and the row, to spread at a menu's end. */
export function panelGuideTail(request: Omit<PanelGuideRequest, "opener">): MenuEntry[] {
  return ["separator", panelGuideItem(request)];
}
