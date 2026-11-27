// Non-source translations load only with the lazy locale catalogs.
import type { zhCN } from "./i18n";
import { zhHantCN } from "./locales.zh-Hant-CN";

declare module "../i18nCatalog" {
  interface ModuleZhHantMessages extends Record<keyof typeof zhCN, string> {}
}

export const locales = {
  "zh-Hant-CN": zhHantCN,
};
