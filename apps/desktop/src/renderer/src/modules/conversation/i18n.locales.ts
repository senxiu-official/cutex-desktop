// The other app locales of ./i18n.ts, apart from the zh-CN source so they stay out of the entry chunk: they load
// with their language's lazy catalog (i18n/index.tsx; 0.2.0 beta perf audit, 2026-10-24).
import type { zhCN } from "./i18n";

const zhHantCN: Partial<Record<keyof typeof zhCN, string>> = {
  "conversation.tools.memberRuntime": "調整成員運行狀態",
  "conversation.tools.memberRuntime.online": "請求成員上線",
  "conversation.tools.memberRuntime.offline": "請求成員下線",
  "conversation.tools.memberRuntime.restart": "請求重啓成員",
  "conversation.tools.taskStop": "停止任務",
  "conversation.tools.artifactRead": "讀取成果",
  "conversation.tools.actionStatus": "查看調用狀態",
  "conversation.tools.actionStatus.running": "調用處理中",
  "conversation.tools.actionStatus.completed": "工具調用已完成",
  "conversation.tools.actionStatus.failed": "工具調用失敗",
  "conversation.tools.actionStatus.awaitingApproval": "調用等待審批",
  "conversation.tools.actionStatus.unknown": "結果未知",
  "conversation.tools.actionStatus.notFound": "未找到調用記錄",
  "conversation.tools.actionStatus.hint": "這裏顯示工具調用的處理狀態，不代表委託工作已經完成；結果未知或未找到記錄，也不代表調用未執行。",
  "conversation.tools.rawResult": "完整返回",
  "conversation.tools.read": "讀取文件",
  "conversation.tools.search": "搜索文件",
  "conversation.tools.tools": "查找工具",
  "conversation.tools.agents": "列出{{agent}}",
  "conversation.tools.agentCount": "返回 {n} 個{{agent}}",

  "conversation.imageHistoryHint": "這個對話裏的圖片很多，打開和往上翻會慢一些。圖片只在需要顯示時才讀取；之後的更新會把歷史記錄縮小。",
  "conversation.imageHistoryDismiss": "不再提示",
};

export const locales: Record<string, Partial<Record<keyof typeof zhCN, string>>> = { "zh-Hant-CN": zhHantCN };
