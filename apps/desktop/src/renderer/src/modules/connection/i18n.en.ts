// English strings of ./i18n.ts, apart from the zh-CN source so they stay out of the entry chunk: they load with the
// en catalog (i18n/index.tsx), only when the UI or a search needs English (0.2.0 beta perf audit, 2026-10-24).
import type { zhCN } from "./i18n";

export const en: Record<keyof typeof zhCN, string> = {
  "connection.title": "Connection",
  "connection.description": "Host list, host switching, startup host and diagnostics (Settings → Hosts)",
  // ---- settings (moved from the base catalog, 2026-10-09) ----
  "connection.diagnostics": "Diagnostics",
  "connection.page": "Hosts",
  "connection.endpoint": "Endpoint",
  "connection.version": "cutex version",
  "connection.noCaps": "Older cutex (no /v2/capabilities)",
  "connection.features": "Capabilities",
  // ---- Device management (connection restructure 2026-10-19) ----
  "connection.pageHint": "Every host this computer connects to, and desktop settings for all hosts.",
  "connection.openHost": "See the connection and access of {host}",
  "connection.thisDevice": "This machine",
  "connection.member": "You are a member",
  "connection.add": "Add a host",
  "connection.addHint": "Connect to a cutex host over SSH. Tokens stay on this computer (system encrypted storage).",
};
