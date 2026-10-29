import type { zhCN } from "./i18n";

// These are the viewer refresh strings only; existing workspace messages retain their catalogs.
export const locales = {
  "zh-Hant-CN": {
    "workspace.autoRefresh": "自動刷新文件預覽",
    "workspace.autoRefreshHint": "{{agent}}完成文件修改後刷新對應文件和 Git 差異。隱藏標籤在顯示時刷新；HTML 頁面先詢問，保留可能未保存的輸入。",
    "workspace.changedOnDisk": "文件已在磁盤上更改。重新載入會丟棄頁面中未保存的輸入。",
    "workspace.reloadChanged": "重新載入",
  },
} satisfies Record<string, Partial<Record<keyof typeof zhCN, string>>>;

declare module "../i18nCatalog" {
  interface ModuleZhHantMessages extends Record<keyof typeof locales["zh-Hant-CN"], string> {}
}
