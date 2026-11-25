// zh-Hant-CN: OpenCC s2t of ./i18n.ts (mainland terms kept); regenerate after changing a Chinese string.
import type { zhCN } from "./i18n";

const zhHantCN = {
  "feature-profiles.title": "功能 Profile",
  "feature-profiles.description": "只給應用裏的功能（例如提示詞增強）用的模型接口；{{agents}}看不到，也用不了",
  "feature-profiles.pageHint": "只給應用裏的功能用，例如提示詞增強。{{agents}}看不到，也用不了這些 Profile。",
  "feature-profiles.section": "功能 Profile",
  "feature-profiles.sectionHint": "每個功能 Profile 是一個模型接口：地址、模型和密鑰。保存在這臺主機上，和{{agent}}用的 Profile 分開。",
  "feature-profiles.all": "全部 {n} 個功能 Profile",
  "feature-profiles.add": "添加功能 Profile",
  "feature-profiles.empty": "還沒有功能 Profile。添加一個，就能在提示詞增強裏選它。",
  "feature-profiles.edit": "編輯",
  "feature-profiles.remove": "刪除這個功能 Profile",
  "feature-profiles.form.name": "名稱",
  "feature-profiles.form.namePlaceholder": "例如 便宜的小模型",
  "feature-profiles.form.protocol": "接口類型",
  "feature-profiles.form.unknownProtocol": "主機上記的是 {protocol}，這裏不能改；選一個就會換掉",
  "feature-profiles.form.baseUrl": "接口地址",
  "feature-profiles.form.baseUrlInfo": "OpenAI Responses 填 API 前綴，例如 https://api.openai.com/v1；Anthropic Messages 填域名，或以 /v1 結尾的地址。要用 HTTPS，本機地址可以用 HTTP。只能用兼容這兩種接口的服務，不支持只有 Chat Completions 的接口和賬號登錄。",
  "feature-profiles.form.model": "模型",
  "feature-profiles.form.quota": "額度類型",
  "feature-profiles.form.quotaHint": "只用來顯示，不會限制用量",
  "feature-profiles.form.key": "API 密鑰",
  "feature-profiles.form.keyHint": "只能寫入：保存後不會再顯示",
  "feature-profiles.form.keyPlaceholder": "粘貼密鑰",
  "feature-profiles.form.create": "添加",
  "feature-profiles.form.badName": "名稱要 1–{n} 個字",
  "feature-profiles.form.badProtocol": "選一個接口類型",
  "feature-profiles.form.badBaseUrl": "接口地址要以 https:// 開頭（本機地址可以用 http://）",
  "feature-profiles.form.badModel": "填模型名，不能有空格",
  "feature-profiles.form.badQuota": "選一個額度類型",
  "feature-profiles.form.badKey": "填 API 密鑰",
  "feature-profiles.key.set": "已設置（不會顯示）",
  "feature-profiles.key.missing": "沒有密鑰",
  "feature-profiles.damaged": "這條記錄讀不出來",
  "feature-profiles.damagedHint": "主機上的文件壞了，不能用也不能編輯，可以刪掉",
  "feature-profiles.error.controlPort": "主機沒有接受這個地址：它可能指向這臺主機上 cutex 自己的控制端口。請填模型服務的地址",
  "feature-profiles.key.replace": "更換密鑰",
  "feature-profiles.key.keep": "不換了",
  "feature-profiles.quota.subscriptionWindow": "訂閱窗口",
  "feature-profiles.quota.periodicAllowance": "週期額度",
  "feature-profiles.quota.balance": "餘額",
  "feature-profiles.quota.payAsYouGo": "按量付費",
  "feature-profiles.error.invalid_feature_profile": "主機沒有接受：檢查名稱、接口地址、模型和密鑰",
  "feature-profiles.error.feature_profile_limit": "這臺主機最多 {n} 個功能 Profile",
  "feature-profiles.error.feature_profile_not_found": "這個功能 Profile 已經不在了，可能在別處刪掉了",
  "feature-profiles.error.feature_profiles_unavailable": "主機暫時讀寫不了功能 Profile，稍後再試",
} satisfies Record<keyof typeof zhCN, string>;

export const locales: Record<string, Partial<Record<keyof typeof zhCN, string>>> = {
  "zh-Hant-CN": zhHantCN,
};
declare module "../i18nCatalog" {
  interface ModuleZhHantMessages extends Record<keyof typeof zhHantCN, string> {}
}
