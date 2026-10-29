// English strings of ./i18n.ts, apart from the zh-CN source so they stay out of the entry chunk: they load with the
// en catalog (i18n/index.tsx), only when the UI or a search needs English (0.2.0 beta perf audit, 2026-10-24).
import type { zhCN } from "./i18n";

export const en: Record<keyof typeof zhCN, string> = {
  "terminal.moduleTitle": "Terminal",
  "terminal.description": "The {{shelf}}'s terminal pane: cutex terminals in the {{agent}}'s workspace (they run in cutex)",
  "terminal.title": "Terminal",
  "terminal.tab": "Terminal {n}",
  "terminal.tabEnded": "{title} (ended)",
  "terminal.new": "New terminal",
  "terminal.closeTab": "Close",
  "terminal.creating": "Opening a terminal…",
  "terminal.adopting": "Connecting this workspace's terminals…",
  "terminal.exited": "The terminal has ended",
  "terminal.exitedCode": "The terminal has ended (exit code {code})",
  "terminal.gone": "This terminal no longer exists (cutex restarted, or it was ended elsewhere)",
  "terminal.noWorkspace": "This {{agent}} has no working directory; no terminal",
  "terminal.willEnd": "A terminal will be ended",
  "terminal.willEndN": "Terminal {n} will be ended",
  "terminal.runTip": "Run in the terminal",
  "terminal.runArmed": "Click again to run these {n} lines in the terminal",
  "terminal.runFailed": "Couldn't run it in the terminal: {error}",
};
