// The other app locales of ./i18n.ts, apart from the zh-CN source so they stay out of the entry chunk: they load
// with their language's lazy catalog (i18n/index.tsx; 0.2.0 beta perf audit, 2026-10-24).
import type { zhCN } from "./i18n";

const zhHantCN: Record<keyof typeof zhCN, string> = {
  "perf-log.moduleTitle": "效能記錄",
  "perf-log.description": "介面卡住超過 100 毫秒時記一條：什麼時間、螢幕上開著什麼、你剛做了什麼、哪段程式碼最耗時。只存在這台電腦上，不會發出去",
  "perf-log.section": "效能記錄",
  "perf-log.enabled": "記錄卡頓",
  "perf-log.enabled.hint": "介面卡住超過 100 毫秒時記一條，最多保留最近 500 條（約 5 MB），只存在這台電腦上。不卡的時候幾乎不佔資源",
  "perf-log.range": "時間",
  "perf-log.range.15m": "15 分鐘",
  "perf-log.range.1h": "1 小時",
  "perf-log.range.today": "今天",
  "perf-log.range.all": "全部",
  "perf-log.range.custom": "指定時間",
  "perf-log.around": "前後 10 分鐘",
  "perf-log.around.hint": "比如「22:40 卡了一下」：選那一刻，看前後 10 分鐘的記錄",
  "perf-log.count": "{n} 條，最長 {max} 毫秒",
  "perf-log.empty": "這段時間沒有卡頓",
  "perf-log.off": "記錄已關閉",
  "perf-log.copy": "複製 JSON",
  "perf-log.save": "儲存 JSON",
  "perf-log.clear": "清空",
  "perf-log.frames": "{n} 幀，共 {total} 毫秒",
  "perf-log.layout": "樣式和版面 {ms} 毫秒",
  "perf-log.action": "之前 {ago} 毫秒：{what}",
  "perf-log.noAction": "之前沒有操作",
  "perf-log.screen": "螢幕",
  "perf-log.code": "最耗時的程式碼",
  "perf-log.noCode": "瀏覽器沒有給出程式碼歸屬（可能是繪製或垃圾回收）",
  "perf-log.hiddenWindow": "視窗在背景",
  "perf-log.desktop": "桌面",
  "perf-log.workspaces": "{n} 個工作區",
  "perf-log.rows": "時間線 {turns} 輪 / {rows} 項",
  "perf-log.dom": "{n} 個元素",
};

export const locales: Record<string, Partial<Record<keyof typeof zhCN, string>>> = { "zh-Hant-CN": zhHantCN };
