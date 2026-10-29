// English strings of ./i18n.ts, apart from the zh-CN source so they stay out of the entry chunk: they load with the
// en catalog (i18n/index.tsx), only when the UI or a search needs English (0.2.0 beta perf audit, 2026-10-24).
import type { zhCN } from "./i18n";

export const en: Record<keyof typeof zhCN, string> = {
  "subagents.timeline.spawn": "Spawned",
  "subagents.timeline.send": "Sent to",
  "subagents.timeline.followup": "Follow-up to",
  "subagents.timeline.wait": "Waiting for",
  "subagents.timeline.interrupt": "Interrupted",
  "subagents.timeline.close": "Closed",
  "subagents.timeline.resume": "Resumed",
  "subagents.timeline.list": "Listed {{subagents}}",
  "subagents.timeline.other": "{{Subagent}} action",

  "subagents.title": "{{Subagents}}",
  "subagents.description": "Working {{subagents}}, shown in the status row and capsule",
  "subagents.statusTitle": "{{Subagents}}",
  "subagents.count": "{n} {{subagents}}",
  "subagents.starting": "starting",
  "subagents.working": "working",
  "subagents.none": "No background terminals or {{subagents}} running",
  "subagents.thread": "{{Subagent}} thread",
  "subagents.claude.agent": "{{Subagent}}",
  "subagents.claude.open": "Open this {{subagent}}'s transcript",
  "subagents.claude.readOnly": "Read-only · a Claude foreground {{subagent}}'s messages and tool calls (outputs as previews)",
  "subagents.claude.truncated": "Long transcript: later entries were not kept",
  "subagents.recent": "Recently finished · {n}",
  "subagents.recentTitle": "Recently finished {{subagents}}",
  "subagents.recent.background": "Ran in the background: no transcript was kept",
  "subagents.background": "background",
  "subagents.stop": "Stop",
  "subagents.stop.title": "Stop the background {{subagent}} \"{name}\" (the current turn goes on)",
  "subagents.stopAgain": "Click Stop again to confirm",
  "subagents.recent.noTranscript": "No transcript of this {{subagent}} was kept",
  "subagents.outcome.completed": "done",
  "subagents.outcome.failed": "failed",
  "subagents.outcome.stopped": "stopped",
};
