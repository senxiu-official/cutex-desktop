// Performance labels reused by onboarding; loaded with each lazy locale catalog.
import type { zhCN } from "./i18n";

type PerfMessages = Pick<typeof zhCN, "shell.perf.mode" | "shell.perf.save" | "shell.perf.smooth" | "shell.perf.saveHint" | "shell.perf.smoothHint">;

declare module "../i18nCatalog" {
  interface ModuleZhHantMessages extends Record<keyof PerfMessages, string> {}
}

export const locales: Record<string, Record<keyof PerfMessages, string>> = { "zh-Hant-CN": {
    "shell.perf.mode": "性能模式",
    "shell.perf.save": "節省資源",
    "shell.perf.smooth": "流暢優先",
    "shell.perf.saveHint": "窗口不在前臺時，轉圈、閃爍這些循環動畫暫停；設置等不常用的頁面第一次打開時才加載。",
    "shell.perf.smoothHint": "循環動畫一直運行；不常用的頁面在啓動後空閒時就提前加載，第一次打開也不用等。會多用一些 CPU 和內存。"
  } };
