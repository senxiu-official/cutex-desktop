// The other app locales of ./gestureCatalog.ts, apart from the zh-CN source so they stay out of the entry chunk: they load
// with their language's lazy catalog (i18n/index.tsx; 0.2.0 beta perf audit, 2026-10-24). zh-Hant-CN: OpenCC s2t of
// ./gestureCatalog.ts (mainland terms kept), regenerated 2026-10-24.
import type { gestureZhCN } from "./gestureCatalog";

export const gestureZhHant: Record<keyof typeof gestureZhCN, string> = {
  "gestures.title": "點擊與手勢",
  "gestures.hint": "同一個手勢，在哪裏都是同一個意思：",
  "gestures.legend.beside": "並排",
  "gestures.legend.beside.for": "{{agent}}、頁面入口",
  "gestures.legend.background": "後臺新開",
  "gestures.legend.background.for": "啓動器、文件",
  "gestures.legend.close": "關閉",
  "gestures.legend.close.for": "標籤",
  "gestures.or": "或",
  "gestures.mod": "Ctrl/⌘",
  "gestures.shift": "Shift",
  "gestures.on.close": "懸停時出現的 ×",
  "gestures.input.left": "左鍵點擊",
  "gestures.input.right": "右鍵點擊",
  "gestures.input.middle": "中鍵點擊",
  "gestures.input.drag": "拖動",
  "gestures.input.longPress": "長按",

  "gestures.agent.title": "{{agent}}",
  "gestures.agent.where": "側欄、托盤和 ⌘K 裏",
  "gestures.agent.click": "去它的工作區，原來的留在托盤",
  "gestures.agent.beside": "並排打開；列滿時選替換哪一列",
  "gestures.agent.drag": "拖到一列上，替換那一列",
  "gestures.agent.menu": "打開菜單",

  "gestures.group.title": "托盤裏的組",
  "gestures.group.where": "托盤裏幾個頭像連在一起的膠囊",
  "gestures.group.click": "整組回到屏幕；已在屏幕上就切到那一列",
  "gestures.group.beside": "並排打開你點擊的那一個",
  "gestures.group.menu": "菜單：拆出成員、取消固定",
  "gestures.group.close": "關掉它的列，移出托盤",

  "gestures.page.title": "頁面入口",
  "gestures.page.where": "窗口頂欄上的委託、審批等入口",
  "gestures.page.click": "在當前位置打開",
  "gestures.page.beside": "並排打開：另一個{{shelf}}，或新的一頁",
  "gestures.page.menu": "固定到窗口頂欄 / 取消固定",

  "gestures.launcher.title": "啓動器、文件、工具",
  "gestures.launcher.where": "啓動器欄、文件樹和消息裏的文件",
  "gestures.launcher.click": "打開，複用預覽標籤",
  "gestures.launcher.background": "後臺新開一個保留的標籤",
  "gestures.launcher.shown": "新開一個保留的標籤並切過去",
  "gestures.launcher.menu": "打開菜單",

  "gestures.tab.title": "標籤",
  "gestures.tab.where": "{{shelf}}頂部的標籤",
  "gestures.tab.click": "切到它",
  "gestures.tab.close": "關閉；有未保存的內容先確認",
  "gestures.tab.drag": "移到另一個{{shelf}}，或拖到空白處新建",
  "gestures.tab.menu": "打開菜單",

  "gestures.strip.title": "列頭的 ‹ / ›",
  "gestures.strip.where": "兩個會話並排時，列頭的外側",
  "gestures.strip.click": "收成窄條",
  "gestures.strip.hold": "只看{{shelf}}",
  "gestures.strip.menu": "菜單：只看{{shelf}}、只看會話、恢復",

  "gestures.desktop.title": "桌面",
  "gestures.desktop.where": "側欄裏的「桌面」，窗口頂欄也有這個按鈕",
  "gestures.desktop.click": "顯示桌面；再來一次恢復佈局",
};
