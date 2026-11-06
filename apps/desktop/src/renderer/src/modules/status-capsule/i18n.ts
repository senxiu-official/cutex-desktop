export const zhCN = {
  "status-capsule.moduleTitle": "状态胶囊（旧版，已冻结）",
  "status-capsule.description": "对话区上方的悬浮状态胶囊。关闭后，放在胶囊里的状态不再常驻显示（状态行、目标、作业等照常），胶囊的位置和大小会保留",
  "status-capsule.title": "状态胶囊",
  "status-capsule.collapse": "收起为胶囊",
  "status-capsule.expand": "展开状态面板",
  "status-capsule.empty": "暂无进行中的事项",
  "status-capsule.more": "胶囊位置、大小与内容",
  "status-capsule.items": "在胶囊里显示",
  "status-capsule.shortcut": "{key} 展开 / 收起",
  "status-capsule.section": "胶囊（旧版，已冻结）",
  "status-capsule.always": "始终显示胶囊",
  "status-capsule.always.hint": "没有内容时也显示",
  "status-capsule.corner": "位置",
  "status-capsule.corner.hint": "折叠和展开都在这个角，展开时向另一侧长；面板「…」里也能改",
  "status-capsule.corner.topLeft": "左上",
  "status-capsule.corner.topRight": "右上",
  "status-capsule.corner.bottomLeft": "左下",
  "status-capsule.corner.bottomRight": "右下",
  "status-capsule.edge": "贴靠",
  "status-capsule.edge.hint": "胶囊靠窗口边，还是靠对话正文的边",
  "status-capsule.edge.window": "窗口边缘",
  "status-capsule.edge.content": "正文边缘",
  "status-capsule.size": "胶囊大小",
  "status-capsule.size.small": "小",
  "status-capsule.size.medium": "中",
  "status-capsule.size.large": "大",
  "status-capsule.size.xlarge": "特大",
  "status-capsule.scale": "大小",
  "status-capsule.scaleHint": "和胶囊「…」菜单里的大小是同一个设置",
} as const;

declare module "../i18nCatalog" {
  interface ModuleMessages extends Messages {}
}
type Messages = typeof zhCN;
