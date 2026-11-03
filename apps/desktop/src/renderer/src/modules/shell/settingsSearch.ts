// Settings search declarations of the shell's pages (SettingsPageItem.keywords / sections): the cards
// each page component renders (with id={settingsAnchorId(anchor)}) and the row labels inside them.
import type { MessageKey } from "../../i18n";
import { SHORTCUT_GROUPS } from "../../lib/shortcuts";
import type { SettingsPageItem } from "../slots";

type Search = Pick<SettingsPageItem, "keywords" | "sections">;

export const GENERAL_SEARCH: Search = {
  sections: [
    { anchor: "language", titleKey: "shell.general.language", keywords: ["shell.language", "shell.dateFormat", "shell.numberFormat"] },
    { anchor: "terms", titleKey: "terms.title", keywords: ["terms.singular", "terms.plural"] },
    { anchor: "window", titleKey: "shell.general.window", keywords: ["shell.closeWindow", "shell.closeWindow.tray", "remoteClose.allow", "desk.setting"] },
    { anchor: "performance", titleKey: "shell.perf.title", keywords: ["shell.perf.mode", "shell.perf.save", "shell.perf.smooth", "shell.perf.keywords"] },
  ],
};

/** 你: 「你」 (name, picture, person identity) and 你能访问的主机. */
export const ME_SEARCH: Search = {
  keywords: ["identity.section", "identity.name", "identity.picture", "identity.person.fingerprint", "identity.person.useElsewhere", "me.access.title"],
  sections: [
    { anchor: "identity", titleKey: "identity.section", keywords: ["identity.name", "identity.picture", "identity.person.fingerprint", "identity.person.useElsewhere", "identity.person.copyKey", "identity.person.pasteKey", "identity.person.export", "identity.person.import"] },
    { anchor: "access", titleKey: "me.access.title", keywords: ["me.access.send", "me.access.readOnly", "me.access.allProjects", "me.access.role.pending", "me.access.device.root", "me.access.issue.remember"] },
  ],
};

/**
 * 访问管理: on a member's connection 你在这台主机上 and 你的设备 (MeOnHost); the owner's parts (人, 设备,
 * 别的主机, 接入方式) are the users / peers / remote-access modules' settings.section items.
 */
export const ACCESS_SEARCH: Search = {
  sections: [
    { anchor: "hostInfo", titleKey: "host.info.title", keywords: ["host.info.owner", "host.info.version", "host.info.system"] },
    { anchor: "hostRights", titleKey: "host.rights.title", keywords: ["host.own.role.rights", "host.own.role.member", "host.own.toMember", "host.rights.manageUsers"] },
    { anchor: "hostConnection", titleKey: "shell.access.connection", keywords: ["host.connect", "host.disconnect", "host.reconnect", "host.test", "host.edit", "host.repair", "host.color", "host.autoConnect", "host.remove"] },
  ],
};

/** 用户 (on the Settings host): the owner finds its cards in the users module; a member their own user and devices. */
export const USERS_SEARCH: Search = {
  sections: [
    { anchor: "users-me", titleKey: "users.me.title", keywords: ["me.access.role.pending", "me.access.device.root"] },
    // A member's own devices (MeOnHost OwnDevicesSection); the owner finds 已登录设备 in the users module's cards.
    { anchor: "users-own-devices", titleKey: "users.own.title", keywords: ["users.devices", "users.own.hint", "users.revoke"], access: "member" },
  ],
};

export const APPEARANCE_SEARCH: Search = {
  sections: [
    { anchor: "colors", titleKey: "appearance.colors", keywords: ["shell.theme", "shell.theme.dark", "shell.theme.light", "appearance.lightPalette", "appearance.darkPalette", "shell.contrast"] },
    {
      anchor: "fonts",
      titleKey: "appearance.fonts",
      keywords: ["appearance.uiFont", "appearance.cjkFont", "appearance.chatFont", "appearance.chatCjkFont", "appearance.chatFontSize", "appearance.monoFont", "appearance.monoFontSize", "appearance.monoCjkFont"],
    },
    { anchor: "layout", titleKey: "appearance.layout", keywords: ["appearance.zoom", "appearance.density"] },
    { anchor: "avatars", titleKey: "settings.ia.avatars" as MessageKey, keywords: ["appearance.agentAvatar", "appearance.avatarTint"] },
    // 窗口与卡片 (design 006 v1: what stays here is the whole window's; the panels' rows are on their 面板 pages).
    { anchor: "work-surface", titleKey: "workSurface.title", keywords: ["workSurface.material", "workSurface.width", "workSurface.edge", "foretell.setting", "workSurface.dropPreview", "orientation.setting", "orientation.position", "orientation.split"] },
    { anchor: "portraits", titleKey: "avatarStyle.title", keywords: ["appearance.portraits", "appearance.portraits.selectAll", "appearance.portraits.replaceAll", "appearance.portraits.reassign", "info.avatar.packs", "avatarStyle.kind.portrait", "avatarStyle.kind.emoji", "avatarStyle.kind.letter", "avatarStyle.bulk.replaceAll", "avatarStyle.bulk.reassign"] },
    { anchor: "launchArt", titleKey: "appearance.launchArt", keywords: ["appearance.launchArt.import", "appearance.launchArt.clear", "appearance.launchArt.source.imported", "appearance.launchArt.source.bundled"] },
    { anchor: "headwear", titleKey: "appearance.headwear", keywords: ["appearance.headwear.maid", "appearance.headwear.crown", "appearance.headwear.mianguan", "appearance.headwear.detective", "appearance.headwear.graduation", "appearance.headwear.chef", "appearance.headwear.wizard", "appearance.headwear.halo", "appearance.headwear.cat-ears", "appearance.headwear.headphones", "appearance.headwear.none", "appearance.headwear.operators", "appearance.headwear.seasonal"] },
  ],
};

export const SIDEBAR_SEARCH: Search = {
  sections: [
    { anchor: "projects", titleKey: "appearance.sidebar.projects", keywords: ["appearance.projectGrouping", "appearance.noOnlineProjects", "appearance.sectionCollapsed", "appearance.projectOrderReset"] },
    { anchor: "agentRows", titleKey: "appearance.sidebar.agentRows", keywords: ["appearance.sidebarLayout", "appearance.runningAgents", "appearance.statusChips", "appearance.rowPreview", "appearance.foldIdleAgents", "appearance.offlineAgents"] },
    { anchor: "sidebarStyle", titleKey: "appearance.sidebar.style", keywords: ["appearance.projectIconStyle", "appearance.projectIconStyle.tint", "appearance.projectIconStyle.line", "appearance.projectSeparation", "appearance.sidebarWidth"] },
    { anchor: "hoverPreview", titleKey: "appearance.sidebar.hoverPreview", keywords: ["appearance.projectHoverPreview", "appearance.projectHoverDelay"] },
  ],
};

export const SIDES_SEARCH: Search = {
  sections: [
    {
      anchor: "sides",
      titleKey: "shell.sides.rightPane",
      // Design 006 v1 Q5: 右栏布局 / 竖条里页按钮位置 / 右栏收起时 / 点击当前页图标 are gone (lib/prefs drops them).
      keywords: ["pane.width", "shelf.single", "shell.sides.mode", "shell.sides.narrow", "shell.sides.restore", "shell.sides.keepHidden", "shell.sides.keepMounted", "shell.sides.reset"],
    },
    { anchor: "shelf-place", titleKey: "settings.panel.shelfPlace", keywords: ["workSurface.pageOpen", "workSurface.wsRails", "workSurface.shelfRail", "workSurface.shelfRailAlways", "settings.panel.pageWidth"] },
    { anchor: "open", titleKey: "shell.sides.openSection", keywords: ["shell.sides.preview", "shell.sides.peekTarget", "shell.sides.defaults"] },
    // 留白 is on 会话 now (shell.gutter section item).
  ],
};

export const COMPOSER_SEARCH: Search = {
  sections: [
    { anchor: "send", titleKey: "shell.composer.send", keywords: ["settings.sendKeys", "conversation.delegationSteerKeys"] },
    { anchor: "queuePanel", titleKey: "queue.panelFold", keywords: ["queue.panelFold.open", "queue.panelFold.auto", "queue.sectionStrip"] },
    { anchor: "aboveInput", titleKey: "shell.status.aboveInput", keywords: ["appearance.needsYouStrip", "shell.composer.barItems"] },
    { anchor: "inputBar", titleKey: "shell.composer.inputBar", keywords: ["composer.profileAvatar"] },
  ],
};

export const STATUS_SEARCH: Search = {
  sections: [{ anchor: "places", titleKey: "shell.capsule.places", keywords: ["shell.statusPlace.bar", "shell.statusPlace.capsule"] }],
};

/** One card per shortcut group (ShortcutsPage renders them with these anchors). */
function shortcutAnchor(group: string): string {
  return `shortcuts-${group}`;
}

export const SHORTCUTS_SEARCH: Search = {
  keywords: ["settings.sendKeys"],
  sections: [{ anchor: "gestures", titleKey: "gestures.title", keywords: ["gestures.group.title", "gestures.page.title", "gestures.launcher.title", "gestures.tab.title", "gestures.strip.title", "gestures.input.middle", "gestures.input.longPress", "gestures.legend.beside", "gestures.legend.background"] }, ...SHORTCUT_GROUPS.map((g) => ({ anchor: shortcutAnchor(g.id), titleKey: g.title, keywords: [...new Set<MessageKey>(g.items.map((s) => s.desc))] }))],
};

export const ABOUT_SEARCH: Search = {
  keywords: ["shell.about.native", "shell.about.desktop", "shell.about.desktopBuild"],
};
