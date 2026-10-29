// The other app locales of ./i18n.ts, apart from the zh-CN source so they stay out of the entry chunk: they load
// with their language's lazy catalog (i18n/index.tsx; 0.2.0 beta perf audit, 2026-10-24).
import type { zhCN } from "./i18n";

const zhHantCN: Partial<Record<keyof typeof zhCN, string>> = {
  "usage.maxContext": "最大一次",
  "usage.maxContextHint": "這段用量裏發給模型的最大一次上下文；對話越長、步驟越多，這個數越大",
  "usage.claudeFiveHourHint": "Claude 的 5 小時額度從會話開始算，每 5 小時重置；週額度每週重置一次",
};

export const locales: Record<string, Partial<Record<keyof typeof zhCN, string>>> = { "zh-Hant-CN": zhHantCN };
