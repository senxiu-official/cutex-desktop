export const zhCN = {
  "perf-log.moduleTitle": "性能记录",
  "perf-log.description": "界面卡住超过 100 毫秒时记一条：什么时间、屏幕上开着什么、你刚做了什么、哪段代码最耗时。只存在这台电脑上，不会发出去",
  "perf-log.section": "性能记录",
  "perf-log.enabled": "记录卡顿",
  "perf-log.enabled.hint": "界面卡住超过 100 毫秒时记一条，最多保留最近 500 条（约 5 MB），只存在这台电脑上。不卡的时候几乎不占资源",
  "perf-log.range": "时间",
  "perf-log.range.15m": "15 分钟",
  "perf-log.range.1h": "1 小时",
  "perf-log.range.today": "今天",
  "perf-log.range.all": "全部",
  "perf-log.range.custom": "指定时间",
  "perf-log.around": "前后 10 分钟",
  "perf-log.around.hint": "比如「22:40 卡了一下」：选那一刻，看前后 10 分钟的记录",
  "perf-log.count": "{n} 条，最长 {max} 毫秒",
  "perf-log.empty": "这段时间没有卡顿",
  "perf-log.off": "记录已关闭",
  "perf-log.copy": "复制 JSON",
  "perf-log.save": "保存 JSON",
  "perf-log.clear": "清空",
  "perf-log.frames": "{n} 帧，共 {total} 毫秒",
  "perf-log.layout": "样式和布局 {ms} 毫秒",
  "perf-log.action": "之前 {ago} 毫秒：{what}",
  "perf-log.noAction": "之前没有操作",
  "perf-log.screen": "屏幕",
  "perf-log.code": "最耗时的代码",
  "perf-log.noCode": "浏览器没有给出代码归属（可能是绘制或垃圾回收）",
  "perf-log.hiddenWindow": "窗口在后台",
  "perf-log.desktop": "桌面",
  "perf-log.workspaces": "{n} 个工作区",
  "perf-log.rows": "时间线 {turns} 轮 / {rows} 项",
  "perf-log.dom": "{n} 个元素",
} as const;

declare module "../i18nCatalog" {
  interface ModuleMessages extends Messages {}
}
type Messages = typeof zhCN;

declare module "../i18nCatalog" {
  interface ModuleZhHantMessages extends Record<keyof typeof zhCN, string> {}
}
