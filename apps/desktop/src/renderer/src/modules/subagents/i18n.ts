export const zhCN = {
  "subagents.timeline.spawn": "派出",
  "subagents.timeline.send": "发给",
  "subagents.timeline.followup": "追加任务给",
  "subagents.timeline.wait": "等待",
  "subagents.timeline.interrupt": "打断",
  "subagents.timeline.close": "关闭",
  "subagents.timeline.resume": "恢复",
  "subagents.timeline.list": "列出{{subagent}}",
  "subagents.timeline.other": "{{subagent}}操作",

  "subagents.title": "{{subagent}}",
  "subagents.description": "正在工作的{{subagent}}，显示在状态行和胶囊里",
  "subagents.statusTitle": "{{subagent}}",
  "subagents.count": "{n} {{subagent}}",
  "subagents.starting": "启动中",
  "subagents.working": "工作中",
  "subagents.none": "没有后台终端或{{subagent}}在运行",
  "subagents.thread": "{{subagent}}线程",
} as const;

// Adds these keys to MessageKey (modules/i18nCatalog.ts collects the dictionary itself).
declare module "../i18nCatalog" {
  interface ModuleMessages extends Messages {}
}
type Messages = typeof zhCN;

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
  "subagents.description": "Working {{subagents}}, shown in the status line and capsule",
  "subagents.statusTitle": "{{Subagents}}",
  "subagents.count": "{n} {{subagents}}",
  "subagents.starting": "starting",
  "subagents.working": "working",
  "subagents.none": "No background terminals or {{subagents}} running",
  "subagents.thread": "{{Subagent}} thread",
};
