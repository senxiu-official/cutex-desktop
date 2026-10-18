// Settings navigation model and pure page helpers (docs/research/settings-design-review-20261009.md §2):
// groups ordered by "what you are changing" — this machine first, then the connection, then the
// connected host (agents, codex tools, data), the app's own system pages last. The pages themselves are `settings.page` items contributed by modules
// (docs/desktop-modules.md §9 step 1). Kept free of React / store imports so it is unit-testable.

import { cutexBuildChannelTag, cutexBuildLabel, type CutexBuild } from "@cutex-desktop/cutex-client";
import type { SettingsTab } from "../store"; // type only (erased)

/** Where a page's settings live (the page-header tag). */
export type SettingsSource = "local" | "host" | "codex";

/**
 * Whether agents feel a page's (or section's) settings, the second scope chip (owner 2026-10-18):
 * none = only the UI; next = agents started (or restarted) afterwards; now = running agents at once;
 * access = not the agents but who can reach the host (devices, users, peers).
 */
export type SettingsAgents = "none" | "next" | "now" | "access";

export type SettingsGroupId = "app" | "connection" | "agents" | "tools" | "data" | "system";

/** Group order of the settings nav (the shell owns it). */
export const SETTINGS_GROUP_ORDER: readonly SettingsGroupId[] = ["app", "connection", "agents", "tools", "data", "system"];

/** The settings page of the `shell.settings` main page params (default 通用). */
export function settingsTab(params: Readonly<Record<string, string | undefined>>): SettingsTab {
  return (params.tab as SettingsTab | undefined) ?? "general";
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
