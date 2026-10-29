// 快速启动's menu (sidebar v5, design 040 §4.1): start a quick chat on the default profile or on another one of the
// focus host's (in the owner's profile order, lib/profileOrder). Opened below a window-bar icon — 快速启动's and
// 新建智能体's right-click (`NavItem.menu`). Nothing when the focus host cannot create sessions.
import { api } from "../bridge";
import { translate as t } from "../i18n";
import { openMenuFrom } from "./contextMenu";
import { modelName } from "./modelDisplay";
import { applyProfileOrder, profileOrderOf } from "./profileOrder";
import { useApp } from "../store";

export function openQuickStartMenu(anchor: HTMLElement): void {
  const app = useApp.getState();
  if (!app.features.has("human-create-session")) return;
  void api.listProfiles().then((list) =>
    openMenuFrom(
      anchor,
      [
        { label: t("quick-chats.nav"), onSelect: () => void useApp.getState().newQuickChat() },
        "separator",
        ...applyProfileOrder(list?.profiles ?? [], profileOrderOf()).map((p) => ({
          label: p.name,
          hint: p.name === list?.defaultProfile || p.id === list?.defaultProfile ? t("quick-chats.defaultProfile") : p.model ? modelName(p.model, null, p.id) : undefined,
          onSelect: () => void useApp.getState().newQuickChat(p.id),
        })),
      ],
      { owner: "quick-start" },
    ),
  );
}
