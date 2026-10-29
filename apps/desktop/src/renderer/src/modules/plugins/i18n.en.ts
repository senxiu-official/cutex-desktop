// English strings of ./i18n.ts, apart from the zh-CN source so they stay out of the entry chunk: they load with the
// en catalog (i18n/index.tsx), only when the UI or a search needs English (0.2.0 beta perf audit, 2026-10-24).
import type { zhCN } from "./i18n";

export const en: Record<keyof typeof zhCN, string> = {
  "plugins.title": "Desktop plugins",
  "plugins.description": "Manage preinstalled isolated desktop plugins on this device; off by default",
  "plugins.externalTitle": "External desktop plugin",
  "plugins.externalDescription": "Runs in an isolated view with only the permissions you grant",
  "plugins.pageTitle": "Desktop plugins",
  "plugins.openPlugin": "Open desktop plugin",
  "plugins.hint": "Manage plugins already present on this device. Choose permissions, then Grant and enable. Changed plugin files require fresh permission grants.",
  "plugins.empty": "No desktop plugins are preinstalled on this device.",
  "plugins.refresh": "Refresh list",
  "plugins.loading": "Reading plugin list…",
  "plugins.grant": "Grant and enable",
  "plugins.revoke": "Revoke all permissions",
  "plugins.open": "Open",
  "plugins.granted": "Granted",
  "plugins.ungranted": "Not granted",
  "plugins.changed": "Plugin files changed; grant permissions again",
  "plugins.rejected": "Plugins that could not be loaded",
  "plugins.unavailable": "This plugin is unavailable or has not been granted view permission.",
  "plugins.failed": "Plugin failed to load: {message}",
  "plugins.codexPlugin": "Companion {{agent}} plugin: {name} (installed separately by the daemon)",
  "plugins.permission.views": "Show isolated plugin pages",
  "plugins.permission.entries": "Show navigation entries",
  "plugins.permission.agents.read": "Read {{agent}} names, identifiers and status on the current host",
  "plugins.permission.agents.open": "Open {{an agent}} conversation previously listed",
  "plugins.permission.settings": "Read and save this plugin's own settings",
};
