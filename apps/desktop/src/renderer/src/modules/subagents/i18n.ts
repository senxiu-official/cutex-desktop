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
  "subagents.claude.agent": "{{subagent}}",
  "subagents.claude.open": "查看这个{{subagent}}的过程",
  "subagents.claude.readOnly": "只读 · Claude 前台{{subagent}}的消息和工具调用（输出只保留摘要）",
  "subagents.claude.truncated": "记录太长，后面的内容没有保存",
  "subagents.recent": "最近完成 · {n}",
  "subagents.recentTitle": "最近完成的{{subagent}}",
  "subagents.recent.background": "后台运行，没有过程记录",
  "subagents.background": "后台",
  "subagents.stop": "停止",
  "subagents.stop.title": "停止后台{{subagent}}「{name}」（不影响当前回合）",
  "subagents.stopAgain": "再次左键点击停止以确认",
  "subagents.recent.noTranscript": "没有保存这个{{subagent}}的过程记录",
  "subagents.outcome.completed": "完成",
  "subagents.outcome.failed": "失败",
  "subagents.outcome.stopped": "已停止",
} as const;

// Adds these keys to MessageKey (modules/i18nCatalog.ts collects the dictionary itself).
declare module "../i18nCatalog" {
  interface ModuleMessages extends Messages {}
}
type Messages = typeof zhCN;
