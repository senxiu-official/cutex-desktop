// Every module dictionary, spread into i18n/zh-CN.ts (en: modules/i18nCatalogEn.ts, other locales: i18nCatalogLocales.ts). Keys carry the `<id>.` prefix
// (the host's own strings: `modules.`); test/modules.test.ts checks prefixes, duplicates and that
// every module directory was collected.
//
// Collection is automatic: a new `modules/<id>/i18n.ts` is picked up by the glob below — nothing to
// edit here. Types: `import.meta.glob` cannot carry per-file types, so each module's i18n.ts adds its
// `zhCN` type to `ModuleMessages` by declaration merging:
//
//   declare module "../i18nCatalog" {
//     interface ModuleMessages extends Messages {}
//   }
//   type Messages = typeof zhCN;
//
// That keeps `MessageKey` (= keyof typeof i18n/zh-CN.ts zhCN) exact: a module key used in `t(...)`
// without that block fails to compile, and the same key in two modules with different text is a
// compile error ("cannot simultaneously extend"). Each module's `en: Record<keyof typeof zhCN,
// string>` keeps en complete.
import * as host from "./i18n";

type HostMessages = typeof host.zhCN;
/** All module zh-CN dictionaries (merged into by every `modules/<id>/i18n.ts`). */
export interface ModuleMessages extends HostMessages {}

/**
 * zh-Hant-CN entries shipped by modules themselves (`locales["zh-Hant-CN"]`): a module that ships them
 * merges its key set here (`interface ModuleZhHantMessages extends Record<keyof typeof zhCN, string> {}`),
 * so i18n/zh-Hant-CN.ts stays complete at compile time.
 */
export interface ModuleZhHantMessages {}

// zh-CN only: the modules' en strings (./<id>/i18n.en.ts → i18nCatalogEn) and other locales (./<id>/i18n.locales.ts →
// i18nCatalogLocales) load with their lazy catalogs (i18n/index.tsx; 0.2.0 beta perf audit, 2026-10-24).
// A pack-only module (pack.json `packOnly`) brings its own strings when it loads; test/modules.test.ts keeps these lists right.
const found = import.meta.glob<{ zhCN: Record<string, string> }>(["./*/i18n.ts", "!./desk-pet/**"], { eager: true });

/** Key prefix → zh-CN dictionary ("modules" = the host itself; otherwise the module directory name). */
export const MODULE_DICTIONARIES_ZH: Record<string, Record<string, string>> = {
  modules: host.zhCN,
  ...Object.fromEntries(Object.entries(found).map(([file, dict]) => [file.split("/")[1]!, dict.zhCN])),
};

export const modulesZhCN = Object.assign({}, ...Object.values(MODULE_DICTIONARIES_ZH)) as ModuleMessages;
