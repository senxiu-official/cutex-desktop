// 「调整左侧栏…」 at the end of the sidebar's project / section header menus and alone on its empty
// area (lead 2026-10-18; agent rows keep their menu as is). Puts the sidebar into edit state with the
// Settings Shelf on 设置 → 左侧栏 beside it (owner 2026-10-21).
import { SlidersHorizontal } from "lucide-react";
import type { MessageKey } from "../i18n";
import type { MenuAction, MenuEntry } from "./contextMenu";
import { services } from "../modules/app";
import { panelSettingsItem } from "./panelSettings";
import { panelGuideTail } from "./panelGuideMenu";

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

export function customizeSidebarItem(t: T): MenuAction {
  return { label: t("customize.sidebar.menu"), icon: <SlidersHorizontal size={14} />, onSelect: () => services.ui.customize("sidebar") };
}

/** The sidebar menus' last rows: 「调整左侧栏…」, (design 006 v1) 「⚙ 侧栏设置…」 and 「使用小指南」 (lib/panelGuides). */
export function sidebarMenuTail(t: T): MenuEntry[] {
  return [customizeSidebarItem(t), panelSettingsItem("sidebar"), ...panelGuideTail({ panel: "sidebar" })];
}
