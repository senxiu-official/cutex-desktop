// 「调整左侧栏…」 at the end of the sidebar's project / section header menus and alone on its empty
// area (lead 2026-10-18; agent rows keep their menu as is). Opens the 在主界面调整 panel.
import { SlidersHorizontal } from "lucide-react";
import type { MessageKey } from "../i18n";
import type { MenuAction } from "./contextMenu";
import { useApp } from "../store";

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

export function customizeSidebarItem(t: T): MenuAction {
  return { label: t("customize.sidebar.menu"), icon: <SlidersHorizontal size={14} />, onSelect: () => useApp.getState().openCustomize("sidebar") };
}
