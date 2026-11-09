// The modules' English strings (modules/<id>/i18n.en.ts and the host's ./i18n.en.ts), collected like modules/i18nCatalog:
// spread into i18n/en.ts, which loads on demand (i18n/index.tsx; 0.2.0 beta perf audit, 2026-10-24). Every module has one
// (test/modules.test.ts: the same keys as its zh-CN dictionary).
import { en as hostEn } from "./i18n.en";
import type { ModuleMessages } from "./i18nCatalog";

const found = import.meta.glob<{ en: Record<string, string> }>(["./*/i18n.en.ts", "!./desk-pet/**"], { eager: true });

/** Key prefix → en dictionary (as MODULE_DICTIONARIES_ZH). */
export const MODULE_DICTIONARIES_EN: Record<string, Record<string, string>> = {
  modules: hostEn,
  ...Object.fromEntries(Object.entries(found).map(([file, dict]) => [file.split("/")[1]!, dict.en])),
};

export const modulesEn = Object.assign({}, ...Object.values(MODULE_DICTIONARIES_EN)) as Record<keyof ModuleMessages, string>;
