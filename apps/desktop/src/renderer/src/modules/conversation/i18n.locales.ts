// The other app locales of ./i18n.ts, apart from the zh-CN source so they stay out of the entry chunk: they load
// with their language's lazy catalog (i18n/index.tsx; 0.2.0 beta perf audit, 2026-10-24).
import type { zhCN } from "./i18n";

const zhHantCN: Partial<Record<keyof typeof zhCN, string>> = {
  "conversation.imageHistoryHint": "這個對話裏的圖片很多，打開和往上翻會慢一些。圖片只在需要顯示時才讀取；之後的更新會把歷史記錄縮小。",
  "conversation.imageHistoryDismiss": "不再提示",
};

export const locales: Record<string, Partial<Record<keyof typeof zhCN, string>>> = { "zh-Hant-CN": zhHantCN };
