// Core shell: the settings pages of this machine (应用组 except 对话), 运行时 and the 系统 group (模块,
// 键盘快捷键, 关于); step 3: Settings itself as the `shell.settings` page (Aside = its nav) and the
// sidebar footer ⚙ 设置. v1.2: the "bar" status surface; 状态 keeps the generic placement table (the
// capsule's own geometry is a section of the `status-capsule` module on the same page).
import { Activity, Blocks, Cpu, Info, Keyboard, PanelLeft, PanelRight, Palette, Settings as SettingsIcon, SlidersHorizontal, SquareStack, UserRound, UsersRound } from "lucide-react";
import { Settings, SettingsNav } from "../../components/Settings";
import { AboutPage, ComposerPage, GeneralPage, ShortcutsPage, SidebarPage, StatusPage } from "../../components/settings/AppSettings";
import { SidesPage } from "../../components/settings/SidesSettings";
import { openSideColumn } from "../../lib/sideActions";
import { AppearancePage } from "../../components/settings/AppearanceSettings";
import { UsersHubPage } from "../../components/settings/IdentitySettings";
import { MePage } from "../../components/settings/MeSettings";
import { SidebarSettingsCards } from "../../components/settings/regions/SidebarSettings";
import { useOutdatedAgentCount } from "../../lib/runtimePackagesView";
import { defineModule } from "../slots";
import { ModulesPage } from "./ModulesPage";
import { RuntimePage } from "./RuntimePage";
import { ABOUT_SEARCH, APPEARANCE_SEARCH, GENERAL_SEARCH, SHORTCUTS_SEARCH, SIDEBAR_SEARCH, SIDES_SEARCH, COMPOSER_SEARCH, STATUS_SEARCH, ME_SEARCH, USERS_SEARCH } from "./settingsSearch";
import { openSettingsFromNav, useSettingsBadge, useSettingsTitle } from "./settingsNav";

/** 通用 (更新与诊断): a desktop update. */
/** 运行时: agents on an old runtime package. */
function useRuntimeBadge() {
  return useOutdatedAgentCount() > 0 ? { dot: true } : null;
}

export default defineModule({
  id: "shell",
  titleKey: "shell.title",
  descriptionKey: "shell.description",
  required: true,
  contributes: {
    // v1.2: the status row above the input is the "bar" status surface (core; the items' Bars draw it).
    "conversation.statusSurface": [{ id: "shell.statusBar", surface: "bar", intents: ["view", "edit"] }],
    "nav.primary": [{ id: "shell.settings", area: "footer", order: 100, icon: SettingsIcon, titleKey: "sidebar.settings", target: { run: openSettingsFromNav }, activePages: ["shell.settings"], useBadge: useSettingsBadge }],
    "main.page": [{ id: "shell.settings", Page: Settings, Aside: SettingsNav, useTitle: useSettingsTitle }],
    // 在主界面调整 (renderer-internal): the left sidebar's panel, the same cards as 设置 → 左侧栏.
    // 输入区 and 右侧栏与留白 join with their pages (owner 2026-10-18): the same page component, compact.
    "customize.region": [
      { id: "shell.sidebar", region: "sidebar", titleKey: "customize.sidebar.title", settingsPage: "sidebar", side: "right", Panel: SidebarSettingsCards },
      { id: "shell.composer", region: "composer", titleKey: "customize.composer.title", settingsPage: "composer", side: "above", width: 440, Panel: ComposerPage },
      { id: "shell.sides", region: "sides", titleKey: "customize.sides.title", settingsPage: "sides", side: "left", Panel: SidesPage, reveal: openSideColumn },
    ],
    "settings.page": [
      // 应用（本机）
      { id: "shell.general", page: "general", group: "app", order: 100, icon: SlidersHorizontal, titleKey: "shell.general", source: "local", agents: "none", hintKey: "shell.general.pageHint", Page: GeneralPage, ...GENERAL_SEARCH },
      { id: "shell.appearance", page: "appearance", group: "app", order: 200, icon: Palette, titleKey: "shell.appearance", source: "local", agents: "none", hintKey: "shell.appearance.pageHint", Page: AppearancePage, ...APPEARANCE_SEARCH },
      // By screen region, left to right (owner 2026-10-18): 左侧栏 · 对话 (conversation module, 300) · 输入区 · 状态 · 右侧栏与留白.
      { id: "shell.sidebar", page: "sidebar", group: "app", order: 250, icon: PanelLeft, titleKey: "shell.sidebar", source: "local", agents: "none", hintKey: "shell.sidebar.pageHint", Page: SidebarPage, ...SIDEBAR_SEARCH },
      { id: "shell.sides", page: "sides", group: "app", order: 450, icon: PanelRight, titleKey: "shell.sides", source: "local", hintKey: "shell.sides.pageHint", Page: SidesPage, ...SIDES_SEARCH },
      { id: "shell.composer", page: "composer", group: "app", order: 350, icon: SquareStack, titleKey: "shell.composer", source: "local", hintKey: "shell.composer.pageHint", Page: ComposerPage, ...COMPOSER_SEARCH },
      { id: "shell.status", page: "status", group: "app", order: 400, icon: Activity, titleKey: "shell.status", source: "local", agents: "none", hintKey: "shell.status.pageHint", Page: StatusPage, ...STATUS_SEARCH },
      // 连接 → 你 (local, every connection): 「你」 (name, picture, person identity) and the hosts you can
      // access with your role / permissions there (components/settings/MeSettings.tsx).
      { id: "shell.me", page: "me", group: "connection", order: 50, icon: UserRound, titleKey: "me.title", source: "local", Page: MePage, ...ME_SEARCH },
      // 连接 → 用户: host-side management — the users module's sections on a host this device owns,
      // else a notice (components/settings/IdentitySettings.tsx).
      { id: "shell.users", page: "users", group: "connection", order: 250, icon: UsersRound, titleKey: "users.title", source: "host", Page: UsersHubPage, ...USERS_SEARCH },
      // Agent: its sections 升级 agent (runtime-packages), 已安装的运行时 (runtimes); versions are on 后端更新 (header link).
      { id: "shell.runtime", page: "runtime", group: "agents", order: 500, icon: Cpu, titleKey: "shell.runtime", source: "host", useBadge: useRuntimeBadge, Page: RuntimePage, headerLink: { page: "backend", labelKey: "shell.runtime.backendLink" } },
      // 系统
      { id: "shell.modules", page: "modules", group: "system", order: 100, icon: Blocks, titleKey: "modules.title", source: "local", hintKey: "modules.pageHint", Page: ModulesPage },
      { id: "shell.shortcuts", page: "shortcuts", group: "system", order: 200, icon: Keyboard, titleKey: "shell.shortcuts", source: "local", Page: ShortcutsPage, ...SHORTCUTS_SEARCH },
      { id: "shell.about", page: "about", group: "system", order: 300, icon: Info, titleKey: "shell.about", source: null, Page: AboutPage, ...ABOUT_SEARCH },
    ],
  },
});
