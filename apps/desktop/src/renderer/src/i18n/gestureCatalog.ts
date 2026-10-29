// 点击与手势 of Settings → 键盘快捷键 (docs/design/039, window audit 2026-10-23; owner 2026-10-24: one block per kind of
// target, one line per gesture). Kept in its own file and spread into the catalogs (zh-CN, en, en-AU, zh-Hant-CN).
// Blocks and rows: lib/gestures.ts. Wording (owner): 左键点击 / 右键点击 / 中键点击, never a bare 点 / 右键; no 「=」 as a
// verb; key combinations spaced 「Ctrl + Shift + D」.

export const gestureZhCN = {
  "gestures.title": "点击与手势",
  "gestures.hint": "同一个手势，在哪里都是同一个意思：",
  "gestures.legend.beside": "并排",
  "gestures.legend.beside.for": "{{agent}}、页面入口",
  "gestures.legend.background": "后台新开",
  "gestures.legend.background.for": "启动器、文件",
  "gestures.legend.close": "关闭",
  "gestures.legend.close.for": "标签",
  "gestures.or": "或",
  "gestures.mod": "Ctrl/⌘",
  "gestures.shift": "Shift",
  "gestures.on.close": "悬停时出现的 ×",
  "gestures.input.left": "左键点击",
  "gestures.input.right": "右键点击",
  "gestures.input.middle": "中键点击",
  "gestures.input.drag": "拖动",
  "gestures.input.longPress": "长按",

  "gestures.agent.title": "{{agent}}",
  "gestures.agent.where": "侧栏、托盘和 ⌘K 里",
  "gestures.agent.click": "去它的工作区，原来的留在托盘",
  "gestures.agent.beside": "并排打开；列满时选替换哪一列",
  "gestures.agent.drag": "拖到一列上，替换那一列",
  "gestures.agent.menu": "打开菜单",

  "gestures.group.title": "托盘里的组",
  "gestures.group.where": "托盘里几个头像连在一起的胶囊",
  "gestures.group.click": "整组回到屏幕；已在屏幕上就切到那一列",
  "gestures.group.beside": "并排打开你点击的那一个",
  "gestures.group.menu": "菜单：拆出成员、取消固定",
  "gestures.group.close": "关掉它的列，移出托盘",

  "gestures.page.title": "页面入口",
  "gestures.page.where": "窗口顶栏上的委托、审批等入口",
  "gestures.page.click": "在当前位置打开",
  "gestures.page.beside": "并排打开：另一个{{shelf}}，或新的一页",
  "gestures.page.menu": "固定到窗口顶栏 / 取消固定",

  "gestures.launcher.title": "启动器、文件、工具",
  "gestures.launcher.where": "启动器栏、文件树和消息里的文件",
  "gestures.launcher.click": "打开，复用预览标签",
  "gestures.launcher.background": "后台新开一个保留的标签",
  "gestures.launcher.shown": "新开一个保留的标签并切过去",
  "gestures.launcher.menu": "打开菜单",

  "gestures.tab.title": "标签",
  "gestures.tab.where": "{{shelf}}顶部的标签",
  "gestures.tab.click": "切到它",
  "gestures.tab.close": "关闭；有未保存的内容先确认",
  "gestures.tab.drag": "移到另一个{{shelf}}，或拖到空白处新建",
  "gestures.tab.menu": "打开菜单",

  "gestures.strip.title": "列头的 ‹ / ›",
  "gestures.strip.where": "两个会话并排时，列头的外侧",
  "gestures.strip.click": "收成窄条",
  "gestures.strip.hold": "只看{{shelf}}",
  "gestures.strip.menu": "菜单：只看{{shelf}}、只看会话、恢复",

  "gestures.desktop.title": "桌面",
  "gestures.desktop.where": "侧栏里的「桌面」，窗口顶栏也有这个按钮",
  "gestures.desktop.click": "显示桌面；再来一次恢复布局",
};
