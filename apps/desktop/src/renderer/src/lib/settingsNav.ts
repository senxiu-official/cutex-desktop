// Settings navigation model and pure page helpers (docs/research/settings-design-review-20261009.md §2):
// groups ordered by "what you are changing" — this machine first, then the connection, then the
// connected host (agents, codex tools, data), the app's own system pages last. The pages themselves are `settings.page` items contributed by modules
// (docs/desktop-modules.md §9 step 1). Kept free of React / store imports so it is unit-testable.

import { cutexBuildChannelTag, cutexBuildLabel, type CutexBuild } from "@cutex-desktop/cutex-client";
import type { SettingsTab } from "../store"; // type only (erased)

/** Where a setting lives; host/codex resolve to its actual target host. */
export type SettingsSource = "local" | "host" | "codex" | "person";

/**
 * Whether agents feel a declared setting (summarized mechanically at page/card/row):
 * none = only the UI; next = agents started (or restarted) afterwards; now = running agents at once;
 * newAgents = future creation requests only; access = immediate admission changes for subsequent requests (devices, users, peers).
 */
export type SettingsAgents = "none" | "next" | "now" | "newAgents" | "access" | "offNowOnNext" | "hostNowRuntimeNext" | "hostRestart" | "hostRestartRuntimeNext";

export type SettingsGroupId = "app" | "connection" | "agents" | "tools" | "data" | "system";

/** Group order of the settings nav (the shell owns it). */
export const SETTINGS_GROUP_ORDER: readonly SettingsGroupId[] = ["app", "connection", "agents", "tools", "data", "system"];

/**
 * 面板 (design 006 v1, owner 2026-10-22: 「合面板」): the pages of the panels on screen, in this order, shown as a
 * group of their own right after 应用 (near 外观). A display grouping only — the pages' modules still declare their
 * own `group` (contract unchanged); the shell picks them out by page id.
 */
export const PANEL_PAGES: readonly string[] = ["sidebar", "conversation", "status", "sides", "tray", "desktop"];

/** A group of the settings nav: a module group, or the shell's 面板. */
export type SettingsNavGroupId = SettingsGroupId | "panels";

/** The nav's groups in order: 应用, then 面板, then the rest. */
export const SETTINGS_NAV_GROUP_ORDER: readonly SettingsNavGroupId[] = ["app", "panels", "connection", "agents", "tools", "data", "system"];

/** The nav group a page shows in (a panel page in 面板, else its own group). */
export function navGroupOf(item: { page: string; group: SettingsGroupId }): SettingsNavGroupId {
  return PANEL_PAGES.includes(item.page) ? "panels" : item.group;
}

/** The settings pages by nav group, in nav order (面板 in PANEL_PAGES order, the others as given); empty groups left out. */
export function settingsNavGroups<T extends { item: { page: string; group: SettingsGroupId } }>(pages: readonly T[]): { group: SettingsNavGroupId; entries: T[] }[] {
  return SETTINGS_NAV_GROUP_ORDER.map((group) => {
    const entries = pages.filter((e) => navGroupOf(e.item) === group);
    if (group === "panels") entries.sort((a, b) => PANEL_PAGES.indexOf(a.item.page) - PANEL_PAGES.indexOf(b.item.page));
    return { group, entries };
  }).filter((g) => g.entries.length > 0);
}

/**
 * Old page ids (design 006 v1): 输入区 is a part of the 会话 page now. `openSettings("composer")`, saved params
 * and search results land there (its cards keep their anchors).
 */
export const PAGE_ALIASES: Readonly<Record<string, SettingsTab>> = { composer: "conversation" };

/**
 * Pages folded into 主机 (连接 D plan 2026-10-19): 接入 and 互联 are its cards now (用户 is its own page
 * again). Old links (`openSettings("peers", { anchor })`, saved params) land there; anchors unchanged.
 */
const FOLDED_INTO_ACCESS: ReadonlySet<string> = new Set(["remote", "peers"]);

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
