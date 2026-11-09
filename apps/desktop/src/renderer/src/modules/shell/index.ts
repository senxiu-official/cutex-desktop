// Core shell: the settings pages of this machine (应用组 except 对话), 运行时 and the 系统 group (模块,
// 键盘快捷键, 关于); step 3: Settings itself as the `shell.settings` page (Aside = its nav) and the
// sidebar footer ⚙ 设置. v1.2: the "bar" status surface; 状态 keeps the generic placement table (the
// capsule's own geometry is a section of the `status-capsule` module on the same page).
import { Activity, Blocks, Cpu, Info, Keyboard, Monitor, PanelBottom, PanelLeft, PanelRight, Palette, Settings as SettingsIcon, ShieldCheck, SlidersHorizontal, SquareStack, UserRound } from "lucide-react";
import { Settings, SettingsNav } from "../../components/Settings";
import { openSideColumn } from "../../lib/sideActions";
import { useOutdatedAgentCount } from "../../lib/runtimePackagesView";
import { defineModule } from "../slots";
import { getUiPrefs, setUiPref } from "../../lib/prefs";
import { ABOUT_SEARCH, APPEARANCE_SEARCH, GENERAL_SEARCH, SHORTCUTS_SEARCH, SIDEBAR_SEARCH, SIDES_SEARCH, COMPOSER_SEARCH, STATUS_SEARCH, ME_SEARCH, ACCESS_SEARCH } from "./settingsSearch";
import { toggleSettingsFromNav, useSettingsBadge, useSettingsShelfOpen, useSettingsTitle } from "./settingsNav";
import { lazyPage } from "../../lib/lazyPage";

// Loaded on first open (lib/lazyPage).
const QueueOrderSection = lazyPage(() => import("../../components/settings/AppSettings").then((m) => m.QueueOrderSection));
const ImageBusySection = lazyPage(() => import("../../components/settings/AppSettings").then((m) => m.ImageBusySection));
const ConversationWidthSection = lazyPage(() => import("../../components/WorkSurfaceSettings").then((m) => m.ConversationWidthSection));
const ComposerPage = lazyPage(() => import("../../components/settings/AppSettings").then((m) => m.ComposerPage));
const GutterSection = lazyPage(() => import("../../components/settings/SidesSettings").then((m) => m.GutterSection));
const ShelfOnlySection = lazyPage(() => import("../../components/settings/PanelPages").then((m) => m.ShelfOnlySection));
const GeneralPage = lazyPage(() => import("../../components/settings/AppSettings").then((m) => m.GeneralPage));
const AppearancePage = lazyPage(() => import("../../components/settings/AppearanceSettings").then((m) => m.AppearancePage));
const SidebarPage = lazyPage(() => import("../../components/settings/AppSettings").then((m) => m.SidebarPage));
const SidesPage = lazyPage(() => import("../../components/settings/SidesSettings").then((m) => m.SidesPage));
const StatusPage = lazyPage(() => import("../../components/settings/AppSettings").then((m) => m.StatusPage));
const TrayPage = lazyPage(() => import("../../components/settings/PanelPages").then((m) => m.TrayPage));
const DesktopPage = lazyPage(() => import("../../components/settings/PanelPages").then((m) => m.DesktopPage));
const MePage = lazyPage(() => import("../../components/settings/MeSettings").then((m) => m.MePage));
const AccessPage = lazyPage(() => import("../../components/settings/AccessSettings").then((m) => m.AccessPage));
const PeersSubPage = lazyPage(() => import("../../components/settings/AccessSettings").then((m) => m.PeersSubPage));
const AdvancedSubPage = lazyPage(() => import("../../components/settings/AccessSettings").then((m) => m.AdvancedSubPage));
const DevicesSubPage = lazyPage(() => import("../../components/settings/AccessSettings").then((m) => m.DevicesSubPage));
const RuntimePage = lazyPage(() => import("./RuntimePage").then((m) => m.RuntimePage));
const ModulesPage = lazyPage(() => import("./ModulesPage").then((m) => m.ModulesPage));
const ShortcutsPage = lazyPage(() => import("../../components/settings/AppSettings").then((m) => m.ShortcutsPage));
const AboutPage = lazyPage(() => import("../../components/settings/AppSettings").then((m) => m.AboutPage));

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
    "nav.primary": [{ id: "shell.settings", area: "footer", order: 100, icon: SettingsIcon, titleKey: "sidebar.settings", target: { run: toggleSettingsFromNav }, useActive: useSettingsShelfOpen, useBadge: useSettingsBadge }],
    "main.page": [{ id: "shell.settings", Page: Settings, Aside: SettingsNav, useTitle: useSettingsTitle }],
    // 在主界面调整 (renderer-internal): the region goes into edit state while the Settings Shelf shows its
    // page beside it (owner 2026-10-21; before: a compact panel with the same cards).
    "customize.region": [
      // The panel adjusts the full sidebar: the avatar rail expands for it.
      { id: "shell.sidebar", region: "sidebar", titleKey: "customize.sidebar.title", settingsPage: "sidebar", side: "right", reveal: () => getUiPrefs().sidebarRail && setUiPref("sidebarRail", false) },
      { id: "shell.composer", region: "composer", titleKey: "customize.composer.title", settingsPage: "conversation", side: "above" },
      { id: "shell.sides", region: "sides", titleKey: "customize.sides.title", settingsPage: "sides", side: "left", reveal: openSideColumn },
    ],
    // 排队顺序 sits on 协作 next to 消息投递 (agent-bus, 350): a host rule about the order messages reach agents.
    "settings.section": [
      { id: "shell.queueOrder", page: "collab", order: 360, titleKey: "queue.orderSection", keywords: ["queue.ownerMayPassAsks"], Section: QueueOrderSection },
      // 运行中的图片消息 (image-input-steering, r264): a host rule for busy sends with images, after 排队顺序.
      { id: "shell.imageBusy", page: "collab", order: 365, titleKey: "queue.imageBusy.section", keywords: ["queue.imageBusy", "queue.imageBusy.steer"], Section: ImageBusySection },
      // 会话 (design 006 v1, 「合面板」): its width (was 外观), the input area (was its own page 输入区, alias
      // `composer`), the margins (was 右侧栏与留白) and one line on 只看 Shelf; side chat (400 / 410) follows.
      { id: "shell.convWidth", page: "conversation", order: 100, titleKey: "settings.panel.convWidth", keywords: ["workSurface.single", "appearance.readingWidth"], Section: ConversationWidthSection },
      { id: "shell.composer", page: "conversation", order: 200, titleKey: "shell.composer", ...COMPOSER_SEARCH, Section: ComposerPage },
      { id: "shell.gutter", page: "conversation", order: 300, titleKey: "shell.sides.gutter", keywords: ["shell.sides.gutterDocked", "shell.sides.gutterDockWidth"], Section: GutterSection },
      { id: "shell.shelfOnly", page: "conversation", order: 500, titleKey: "settings.panel.shelfOnly", keywords: ["settings.panel.shelfOnlyHint"], Section: ShelfOnlySection },
    ],
    "settings.page": [
      // 应用（本机）
      { id: "shell.general", page: "general", group: "app", order: 100, icon: SlidersHorizontal, titleKey: "shell.general", source: "local",  hintKey: "settings.pageHint.general", Page: GeneralPage, ...GENERAL_SEARCH },
      { id: "shell.appearance", page: "appearance", group: "app", order: 200, icon: Palette, titleKey: "shell.appearance", source: null, hintKey: "settings.pageHint.appearance", Page: AppearancePage, ...APPEARANCE_SEARCH },
      // By screen region, left to right (owner 2026-10-18): 左侧栏 · 对话 (conversation module, 300) · 输入区 · 状态 · 右侧栏与留白.
      { id: "shell.sidebar", page: "sidebar", group: "app", order: 250, icon: PanelLeft, titleKey: "settings.panel.sidebar", source: "local",  hintKey: "settings.pageHint.sidebar", Page: SidebarPage, ...SIDEBAR_SEARCH },
      { id: "shell.sides", page: "sides", group: "app", order: 450, icon: PanelRight, titleKey: "settings.panel.shelf", source: "local", hintKey: "settings.pageHint.sides", Page: SidesPage, ...SIDES_SEARCH },
      { id: "shell.status", page: "status", group: "app", order: 400, icon: Activity, titleKey: "settings.panel.status", source: "local",  hintKey: "settings.pageHint.status", Page: StatusPage, ...STATUS_SEARCH },
      // 面板 (design 006 v1): 托盘 and 桌面, whose rows were in 外观 → 窗口与卡片 (the nav shows the panel pages as their own group).
      { id: "shell.tray", page: "tray", group: "app", order: 460, icon: PanelBottom, titleKey: "settings.panel.tray", source: "local",  hintKey: "settings.pageHint.tray", Page: TrayPage, keywords: ["pane.tray.persistent", "pane.tray.edge", "workspace.threeColumns"] },
      { id: "shell.desktop", page: "desktop", group: "app", order: 470, icon: Monitor, titleKey: "settings.panel.desktop", source: "local",  hintKey: "settings.pageHint.desktop", Page: DesktopPage, keywords: ["workSurface.desk"] },
      // 连接 → 你 (local, every connection): 「你」 (name, picture, person identity) and the hosts you can
      // access with your role / permissions there (components/settings/MeSettings.tsx).
      { id: "shell.me", page: "me", group: "connection", order: 50, icon: UserRound, titleKey: "me.title", hintKey: "settings.pageHint.me", source: "local", Page: MePage, ...ME_SEARCH },
      // One host's page (混合设置 on the Settings host; owner 2026-11-07): opened from 主机 (page "hosts"), no nav
      // row of its own. Its connection, devices and users; 跨机协作 and 高级 are sub-pages. 接入 / 互联 / 用户 fold
      // into it (lib/settingsNav settingsTab). Anchors of the cards that moved stay valid (subPages).
      {
        id: "shell.access",
        page: "access",
        group: "connection",
        order: 200,
        icon: ShieldCheck,
        titleKey: "shell.access.title",
        source: null,
        hostPart: true,
        navParent: "hosts",
        hostTitle: true,
        backLink: { page: "hosts", labelKey: "shell.access.back" },
        hintKey: "settings.pageHint.access",
        subPages: {
          peers: { titleKey: "shell.access.sub.peers", hintKey: "shell.access.sub.peersHint", Page: PeersSubPage, anchors: ["peers.access", "peers-settings", "peers-pair", "peers-list", "users.peers", "users-peers"] },
          advanced: { titleKey: "shell.access.sub.advanced", hintKey: "shell.access.sub.advancedHint", Page: AdvancedSubPage, anchors: ["hostInfo", "hostRights", "diagnostics", "remote-access.listen", "remote-access.cors"] },
          devices: { titleKey: "shell.access.sub.devices", Page: DevicesSubPage, anchors: ["users-all-devices"] },
        },
        Page: AccessPage,
        ...ACCESS_SEARCH,
      },
      // Agent: its sections 升级 agent (runtime-packages), 已安装的运行时 (runtimes); versions are on 后端更新 (header link).
      { id: "shell.runtime", page: "runtime", group: "agents", order: 500, icon: Cpu, titleKey: "shell.runtime", hintKey: "settings.pageHint.runtime", source: "host", useBadge: useRuntimeBadge, Page: RuntimePage, headerLink: { page: "backend", labelKey: "shell.runtime.backendLink" } },
      // 系统
      { id: "shell.modules", page: "modules", group: "system", order: 100, icon: Blocks, titleKey: "modules.title", source: "local", hintKey: "settings.pageHint.modules", Page: ModulesPage },
      { id: "shell.shortcuts", page: "shortcuts", group: "system", order: 200, icon: Keyboard, titleKey: "shell.shortcuts", source: "local", hintKey: "settings.pageHint.shortcuts", Page: ShortcutsPage, ...SHORTCUTS_SEARCH },
      { id: "shell.about", page: "about", group: "system", order: 300, icon: Info, titleKey: "shell.about", hintKey: "settings.pageHint.about", source: null, Page: AboutPage, ...ABOUT_SEARCH },
    ],
  },
});
