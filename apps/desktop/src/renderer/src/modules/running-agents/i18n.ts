export const zhCN = {
  "running-agents.title": "正在运行的{{agent}}",
  "running-agents.description": "桌面上列出此刻正在工作的{{agent}}：在做什么、已经多久，左键点击一下就打开它",
  "running-agents.widget": "正在运行",
  "running-agents.widgetHint": "此刻有任务在进行的{{agent}}，以及它们在做什么、已经多久",
  "running-agents.maxRows": "最多显示几个",
  "running-agents.scope": "范围",
  "running-agents.scopeAll": "所有主机",
  "running-agents.scopeFocus": "只看当前主机",
  "running-agents.none": "现在没有{{agent}}在工作",
  "running-agents.justNow": "刚开始",
  "running-agents.more": "还有 {n} 个",
};
declare module "../i18nCatalog" {
  interface ModuleMessages extends Messages {}
}
type Messages = typeof zhCN;

declare module "../i18nCatalog" {
  interface ModuleZhHantMessages extends Record<keyof typeof zhCN, string> {}
}
