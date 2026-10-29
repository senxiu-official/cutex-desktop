// English strings of ./i18n.ts, apart from the zh-CN source so they stay out of the entry chunk: they load with the
// en catalog (i18n/index.tsx), only when the UI or a search needs English (0.2.0 beta perf audit, 2026-10-24).
import type { zhCN } from "./i18n";

export const en: Record<keyof typeof zhCN, string> = {
  "diff.title": "Diff",
  "diff.description": "The {{shelf}}'s diff pane: a workspace's git changes and one turn's changes to a file share one viewer",
  "diff.view": "Diff",
  "diff.turnTab": "This turn · {name}",
  "diff.turnBadge": "Changes in this turn",
  "diff.staged": "staged",
  "diff.noDiff": "No differences",
  "diff.noScope": "This {{agent}} has no working directory; no git diff.",
  "diff.noWorkspaceFs": "This host's cutex has no workspace routes (needs workspace-fs); upgrade cutex",
  "diff.turnGone": "A turn's change text is kept only for the run that opened it. Go back to that turn and click View changes again.",
  "diff.textGone": "This comparison is kept only for the run that opened it; open it again from where it came from.",
};
