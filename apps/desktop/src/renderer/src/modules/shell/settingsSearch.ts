// Settings search declarations of the shell's pages (SettingsPageItem.keywords / sections): the cards
// each page component renders (with id={settingsAnchorId(anchor)}) and the row labels inside them.
import type { MessageKey } from "../../i18n";
import { SHORTCUT_GROUPS } from "../../lib/shortcuts";
import type { SettingsPageItem } from "../slots";

type Search = Pick<SettingsPageItem, "keywords" | "sections">;

export const GENERAL_SEARCH: Search = {
  sections: [
    { anchor: "startup", titleKey: "shell.general.startup", keywords: ["shell.language", "shell.closeWindow", "shell.closeWindow.tray"] },
    { anchor: "terms", titleKey: "terms.title", keywords: ["terms.singular", "terms.plural"] },
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
    { anchor: "overall", titleKey: "appearance.overall", keywords: ["shell.theme", "shell.theme.dark", "shell.theme.light", "shell.contrast", "appearance.zoom", "appearance.projectIconStyle", "appearance.projectIconStyle.tint", "appearance.projectIconStyle.line", "appearance.agentAvatar"] },
    {
      anchor: "fonts",
      titleKey: "appearance.fonts",
      keywords: ["appearance.uiFont", "appearance.cjkFont", "appearance.chatFont", "appearance.chatCjkFont", "appearance.chatFontSize", "appearance.monoFont", "appearance.monoFontSize"],
    },
    { anchor: "layout", titleKey: "appearance.layout", keywords: ["appearance.fullWidth", "appearance.readingWidth", "appearance.density"] },
    { anchor: "launchArt", titleKey: "appearance.launchArt", keywords: ["appearance.launchArt.import", "appearance.launchArt.source.imported", "appearance.launchArt.source.bundled"] },
  ],
};

export const SIDEBAR_SEARCH: Search = {
  sections: [
    {
      anchor: "sidebar",
      titleKey: "appearance.sidebar",
      keywords: [
        "appearance.projectGrouping",
        "appearance.noOnlineProjects",
        "appearance.runningAgents",
        "appearance.rowPreview",
        "appearance.foldIdleAgents",
        "appearance.offlineAgents",
        "appearance.sectionCollapsed",
        "appearance.sidebarWidth",
        "appearance.projectOrder",
      ],
    },
    { anchor: "titleBar", titleKey: "shell.sidebar.titleBar", keywords: ["appearance.titleTwoLines", "appearance.runtimeButton"] },
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

export const STATUS_SEARCH: Search = {
  sections: [
    { anchor: "places", titleKey: "shell.capsule.places" },
    { anchor: "aboveInput", titleKey: "shell.status.aboveInput", keywords: ["appearance.needsYouStrip"] },
  ],
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
  keywords: ["shell.about.native", "shell.about.licenses"],
};
