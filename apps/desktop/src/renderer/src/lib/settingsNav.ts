// Settings navigation model and pure page helpers (docs/research/settings-design-review-20261009.md §2):
// groups ordered by "what you are changing" — this machine first, then the connection, then the
// connected host (agents, codex tools, data), the app's own system pages last. The pages themselves are `settings.page` items contributed by modules
// (docs/desktop-modules.md §9 step 1). Kept free of React / store imports so it is unit-testable.

import { cutexBuildChannelTag, cutexBuildLabel, type CutexBuild } from "@cutex-desktop/cutex-client";
import type { SettingsTab } from "../store"; // type only (erased)
import { FEATURE_PROFILES_OLD_PAGE, FEATURE_PROFILES_OLD_SUB, FEATURE_PROFILES_SECTION, FEATURE_PROFILES_SUB } from "./featureProfilesNav";
import { INPUT_REFINEMENT_OLD_PAGE, INPUT_REFINEMENT_PAGE, INPUT_REFINEMENT_SECTION, INPUT_REFINEMENT_TEMPLATE_SUB } from "./inputRefinementNav";

/** Where a setting lives; host/codex resolve to its actual target host. */
export type SettingsSource = "local" | "host" | "codex" | "person";

/**
 * Whether agents feel a declared setting (summarized mechanically at page/card/row):
 * none = only the UI; next = agents started (or restarted) afterwards; now = running agents at once;
 * newAgents = future creation requests only; access = immediate admission changes for subsequent requests (devices, users, peers);
 * chatsNow = quick chats at once, from their next message (自动标题; agents are not affected, so no agent glyph).
 */
export type SettingsAgents = "none" | "next" | "now" | "newAgents" | "access" | "chatsNow" | "offNowOnNext" | "hostNowRuntimeNext" | "hostRestart" | "hostRestartRuntimeNext";

export type SettingsGroupId = "app" | "connection" | "agents" | "tools" | "data" | "system";

/** Group order of the settings nav (the shell owns it). */
export const SETTINGS_GROUP_ORDER: readonly SettingsGroupId[] = ["app", "connection", "agents", "tools", "data", "system"];

/**
 * 面板 (design 006 v1, owner 2026-10-22: 「合面板」): the pages of the panels on screen, in this order, shown as a
 * group of their own right after 应用 (near 外观). A display grouping only — the pages' modules still declare their
 * own `group` (contract unchanged); the shell picks them out by page id.
 */
export const PANEL_PAGES: readonly string[] = ["sidebar", "conversation", "sides", "tray", "desktop"];

/** A group of the settings nav: a module group, or one the shell makes (面板, 你, 帮助与关于). */
export type SettingsNavGroupId = SettingsGroupId | "panels" | "you" | "help";

/** The nav's groups in order: 你 on top, 应用, then 面板, the rest, and 帮助与关于 at the bottom. */
export const SETTINGS_NAV_GROUP_ORDER: readonly SettingsNavGroupId[] = ["you", "app", "panels", "connection", "agents", "tools", "data", "system", "help"];

/** Groups the wide nav shows without a heading (你: its one page says the same). */
export const SETTINGS_NAV_UNTITLED: readonly SettingsNavGroupId[] = ["you"];

/**
 * Pages the nav shows in another group than their module declares (owner 2026-11-11): 你 on its own at the top
 * (it is about the person, not the connection), 键盘与手势 with 应用, 关于 / 新功能 / 帮助 in their own group at
 * the bottom. A display grouping like 面板: page ids, routes and the modules' `group` are unchanged.
 */
export const NAV_PAGE_GROUPS: Readonly<Record<string, SettingsNavGroupId>> = { me: "you", shortcuts: "app", about: "help", "whats-new": "help", help: "help" };

/** The nav group a page shows in (a panel page in 面板, a moved page in its new group, else its own group). */
export function navGroupOf(item: { page: string; group: SettingsGroupId }): SettingsNavGroupId {
  return PANEL_PAGES.includes(item.page) ? "panels" : NAV_PAGE_GROUPS[item.page] ?? item.group;
}

/**
 * The settings pages by nav group, in nav order (面板 in PANEL_PAGES order; elsewhere as given, a page moved in after
 * the group's own); empty groups left out. `details`: also the pages without a nav row (settings search finds those).
 */
export function settingsNavGroups<T extends { item: { page: string; group: SettingsGroupId; navParent?: string } }>(pages: readonly T[], details = false): { group: SettingsNavGroupId; entries: T[] }[] {
  const movedIn = (e: T) => (e.item.group !== navGroupOf(e.item) ? 1 : 0);
  return SETTINGS_NAV_GROUP_ORDER.map((group) => {
    const entries = pages.filter((e) => navGroupOf(e.item) === group && (details || !e.item.navParent));
    if (group === "panels") entries.sort((a, b) => PANEL_PAGES.indexOf(a.item.page) - PANEL_PAGES.indexOf(b.item.page));
    else entries.sort((a, b) => movedIn(a) - movedIn(b));
    return { group, entries };
  }).filter((g) => g.entries.length > 0);
}

/**
 * Old page ids (design 006 v1): 输入区 is a part of the 会话 page now. `openSettings("composer")`, saved params
 * and search results land there (its cards keep their anchors).
 */
/** Settings → 自定义桌面 (onboarding v3, 2026-11-26) became part of the guide (module start); 外观 holds its settings. */
export const CUSTOMIZE_OLD_PAGE = "customize-desktop";
/**
 * 状态显示 (owner 2026-11-28): the status row is part of the conversation, so which items it shows is on 会话 → 输入
 * (「输入框上方」, anchor `aboveInput`); the capsule's settings are the status-capsule module's own page.
 */
export const STATUS_OLD_PAGE = "status";
export const STATUS_ROW_ANCHOR = "aboveInput";
/** 会话 → 布局 → 并排工作区 (owner 2026-11-28: 允许 3 个工作区 moved here from 托盘). */
export const WORKSPACES_ANCHOR = "workspaces";
export const PAGE_ALIASES: Readonly<Record<string, SettingsTab>> = { composer: "conversation", [FEATURE_PROFILES_OLD_PAGE]: "profiles", [INPUT_REFINEMENT_OLD_PAGE]: "conversation", [CUSTOMIZE_OLD_PAGE]: "appearance", [STATUS_OLD_PAGE]: "conversation" };


/**
 * Pages that became a card of another page (owner 2026-11-26: 功能 Profile is a card of 智能体 → Profile now;
 * 输入优化 a card of 会话). `openSettings(old)` lands on the page with that card in view; an old sub-page key maps to
 * the new page's own, or to a sub-page of another page (`{ tab, sub }`: 输入优化's template editor sits on its
 * detail page under 会话).
 */
export const MOVED_PAGES: Readonly<Record<string, { tab: SettingsTab; anchor: string; subs: Readonly<Record<string, string | { tab: SettingsTab; sub: string }>> }>> = {
  [FEATURE_PROFILES_OLD_PAGE]: { tab: "profiles", anchor: FEATURE_PROFILES_SECTION, subs: { [FEATURE_PROFILES_OLD_SUB]: FEATURE_PROFILES_SUB } },
  [INPUT_REFINEMENT_OLD_PAGE]: { tab: "conversation", anchor: INPUT_REFINEMENT_SECTION, subs: { [INPUT_REFINEMENT_TEMPLATE_SUB]: { tab: INPUT_REFINEMENT_PAGE, sub: INPUT_REFINEMENT_TEMPLATE_SUB } } },
  [STATUS_OLD_PAGE]: { tab: "conversation", anchor: STATUS_ROW_ANCHOR, subs: {} },
};

/** `openSettings(tab, focus)` for a page that moved: the new page, the card as the anchor (or the new sub-page). */
export function movedSettingsRoute<F extends { anchor?: string; sub?: string }>(tab: SettingsTab, focus: F | undefined): { tab: SettingsTab; focus: F | undefined } {
  const moved = MOVED_PAGES[tab];
  if (!moved) return { tab, focus };
  const target = focus?.sub ? moved.subs[focus.sub] ?? focus.sub : undefined;
  if (typeof target === "object") return { tab: target.tab, focus: { ...focus, sub: target.sub, anchor: focus?.anchor } as F };
  const sub = target;
  return { tab: moved.tab, focus: { ...focus, sub, anchor: focus?.anchor ?? (sub ? undefined : moved.anchor) } as F };
}

/** The page the nav marks while `tab` shows (a detail page marks its parent). */
export function settingsNavPage(pages: readonly { item: { page: string; navParent?: string } }[], tab: string): string {
  return pages.find((e) => e.item.page === tab)?.item.navParent ?? tab;
}

/** The sub-page a card lives on (`SettingsPageItem.subPages`), if it moved to one. */
export function subPageOfAnchor(item: { subPages?: Readonly<Record<string, { anchors?: readonly string[] }>> } | undefined, anchor: string | null | undefined): string | undefined {
  if (!item?.subPages || !anchor) return undefined;
  return Object.entries(item.subPages).find(([, s]) => s.anchors?.includes(anchor))?.[0];
}

/**
 * Pages folded into a host's page (owner 2026-11-07, one 主机 entry): 接入, 互联 and 用户 are its cards and
 * sub-pages now. Old links (`openSettings("peers", { anchor })`, saved params) land there; anchors unchanged.
 */
const FOLDED_INTO_ACCESS: ReadonlySet<string> = new Set(["remote", "peers", "users"]);

/** The settings page of the `shell.settings` main page params (default 通用). */
export function settingsTab(params: Readonly<Record<string, string | undefined>>): SettingsTab {
  const tab = (params.tab as SettingsTab | undefined) ?? "general";
  return FOLDED_INTO_ACCESS.has(tab) ? "access" : (PAGE_ALIASES[tab] ?? tab);
}

/** "c20812e · 2026-10-07 12:20" for the running desktop build, or null (dev run / unknown). */
export function buildLabel(current: { commit: string; committedAt: string | null; version?: string } | null | undefined): string | null {
  if (!current?.commit) return null;
  const date = current.committedAt ? current.committedAt.slice(0, 16).replace("T", " ") : null;
  const build = date ? `${current.commit.slice(0, 7)} · ${date}` : current.commit.slice(0, 7);
  // Release packages (binary installs): the version first.
  return current.version ? `${current.version} · ${build}` : build;
}

/**
 * The cutex build text (About / 运行时 / connection line), in the same `commit · date` style as the
 * desktop row: `r224 · 5f30a7c`, `5f30a7c`, plus ` · release` on the release channel; `text.dev` for a
 * build without release and commit; `text.legacy` for a cutex before r224 (no `cutexBuild`).
 */
export function cutexBuildText(build: CutexBuild | null | undefined, text: { dev: string; legacy: string }): string {
  if (!build) return text.legacy;
  const label = cutexBuildLabel(build) ?? text.dev;
  const channel = cutexBuildChannelTag(build);
  return channel ? `${label} · ${channel}` : label;
}

/**
 * DOM id of a searchable settings card (settings search; `SettingsSearchSection.anchor`, or a
 * `settings.section` item id). `openSettings(page, { anchor })` uses the same ids.
 */
export function settingsAnchorId(anchor: string): string {
  return `settings-${anchor}`;
}
