// The modules' own translations for the other app locales (modules/<id>/i18n.locales.ts `locales`), collected like
// modules/i18nCatalog: each lazy i18n/<locale>.ts spreads them after `...modulesEn` (0.2.0 beta perf audit, 2026-10-24).
import type { ModuleZhHantMessages } from "./i18nCatalog";

const found = import.meta.glob<{ locales?: Record<string, Record<string, string>> }>(["./*/i18n.locales.ts", "!./desk-pet/**"], { eager: true });
const dictionaries = Object.values(found);

/** Module translations for another app locale; each catalog spreads them after `...modulesEn`. */
export function modulesLocale(locale: string): Record<string, string> {
  return Object.assign({}, ...dictionaries.map((d) => d.locales?.[locale] ?? {}));
}
export const modulesZhHant = modulesLocale("zh-Hant-CN") as unknown as ModuleZhHantMessages;
