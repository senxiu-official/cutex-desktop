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
    { anchor: "window", titleKey: "shell.general.window", keywords: ["shell.closeWindow", "shell.closeWindow.tray"] },
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
 * 用户: 你在这台主机上 (every connection) and, on a member's connection, 你的设备 (MeOnHost); the owner's
 * management cards are the users module's settings.section items.
 */
export const USERS_SEARCH: Search = {
  sections: [
    { anchor: "users-me", titleKey: "users.me.title", keywords: ["me.access.role.pending", "me.access.device.root"] },
    // A member's own devices (MeOnHost OwnDevicesSection); the owner finds 设备 in the users module's cards.
    { anchor: "users-own-devices", titleKey: "users.own.title", keywords: ["users.devices", "users.own.hint", "users.revoke"], access: "member" },
  ],
};

export const APPEARANCE_SEARCH: Search = {
  sections: [
    { anchor: "colors", titleKey: "appearance.colors", keywords: ["shell.theme", "shell.theme.dark", "shell.theme.light", "appearance.lightPalette", "appearance.darkPalette", "shell.contrast"] },
    {
      anchor: "fonts",
      titleKey: "appearance.fonts",
      keywords: ["appearance.uiFont", "appearance.cjkFont", "appearance.chatFont", "appearance.chatCjkFont", "appearance.chatFontSize", "appearance.monoFont", "appearance.monoFontSize"],
    },
    { anchor: "layout", titleKey: "appearance.layout", keywords: ["appearance.zoom", "appearance.width.full", "appearance.readingWidth", "appearance.density"] },
    { anchor: "launchArt", titleKey: "appearance.launchArt", keywords: ["appearance.launchArt.import", "appearance.launchArt.source.imported", "appearance.launchArt.source.bundled"] },
  ],
};

export const SIDEBAR_SEARCH: Search = {
  sections: [
    { anchor: "projects", titleKey: "appearance.sidebar.projects", keywords: ["appearance.projectGrouping", "appearance.noOnlineProjects", "appearance.sectionCollapsed", "appearance.projectOrderReset"] },
    { anchor: "agentRows", titleKey: "appearance.sidebar.agentRows", keywords: ["appearance.runningAgents", "appearance.statusChips", "appearance.rowPreview", "appearance.foldIdleAgents", "appearance.agentAvatar", "appearance.offlineAgents"] },
    { anchor: "sidebarStyle", titleKey: "appearance.sidebar.style", keywords: ["appearance.projectIconStyle", "appearance.projectIconStyle.tint", "appearance.projectIconStyle.line", "appearance.projectSeparation", "appearance.sidebarWidth"] },
    { anchor: "hoverPreview", titleKey: "appearance.sidebar.hoverPreview", keywords: ["appearance.projectHoverPreview", "appearance.projectHoverDelay"] },
  ],
};

export const SIDES_SEARCH: Search = {
  sections: [
    {
      anchor: "sides",
      titleKey: "shell.sides.rightPane",
      keywords: ["pane.width", "shell.sides.mode", "side.pageBar", "shell.sides.pillAnchor", "shell.sides.laneWhenHidden", "shell.sides.currentPageClick", "shell.sides.narrow", "shell.sides.restore", "shell.sides.keepHidden", "shell.sides.keepMounted", "shell.sides.reset"],
    },
    { anchor: "open", titleKey: "shell.sides.openSection", keywords: ["shell.sides.preview", "shell.sides.peekTarget", "shell.sides.defaults"] },
    { anchor: "gutter", titleKey: "shell.sides.gutter", keywords: ["shell.sides.gutterDocked", "shell.sides.gutterDockWidth"] },
  ],
};

export const COMPOSER_SEARCH: Search = {
  sections: [
    { anchor: "send", titleKey: "shell.composer.send", keywords: ["settings.sendKeys", "conversation.delegationSteerKeys"] },
    { anchor: "queueOrder", titleKey: "queue.orderSection", keywords: ["queue.ownerMayPassAsks"] },
    { anchor: "queuePanel", titleKey: "queue.panelFold", keywords: ["queue.panelFold.open", "queue.panelFold.auto", "queue.sectionStrip"] },
    { anchor: "aboveInput", titleKey: "shell.status.aboveInput", keywords: ["appearance.needsYouStrip", "shell.composer.barItems"] },
    { anchor: "inputBar", titleKey: "shell.composer.inputBar", keywords: ["shell.composer.quotaReset", "composer.profileAvatar"] },
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
  sections: SHORTCUT_GROUPS.map((g) => ({ anchor: shortcutAnchor(g.id), titleKey: g.title, keywords: [...new Set<MessageKey>(g.items.map((s) => s.desc))] })),
};

export const ABOUT_SEARCH: Search = {
  keywords: ["shell.about.native", "shell.about.desktop", "shell.about.desktopBuild"],
};
