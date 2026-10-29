// Non-source translations load only with the lazy locale catalogs.
import type { zhCN } from "./i18n";
import { zhHantCN } from "./locales.zh-Hant-CN";
import { enAU } from "./locales.en-AU";
import { ruRU } from "./locales.ru-RU";
import { frFR } from "./locales.fr-FR";
import { esES } from "./locales.es-ES";
import { ptBR } from "./locales.pt-BR";
import { itIT } from "./locales.it-IT";
import { deDE } from "./locales.de-DE";
import { jaJP } from "./locales.ja-JP";
import { koKR } from "./locales.ko-KR";

declare module "../i18nCatalog" {
  interface ModuleZhHantMessages extends Record<keyof typeof zhCN, string> {}
}

export const locales = {
  "zh-Hant-CN": zhHantCN,
  "en-AU": enAU,
  "ru-RU": ruRU,
  "fr-FR": frFR,
  "es-ES": esES,
  "pt-BR": ptBR,
  "it-IT": itIT,
  "de-DE": deDE,
  "ja-JP": jaJP,
  "ko-KR": koKR,
};
