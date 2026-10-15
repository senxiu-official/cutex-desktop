// Every module dictionary, spread into i18n/zh-CN.ts and en.ts. Keys carry the `<id>.` prefix
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

export interface ModuleDictionary {
  zhCN: Record<string, string>;
  en: Record<string, string>;
}

const found = import.meta.glob<ModuleDictionary>("./*/i18n.ts", { eager: true });

/** Key prefix → dictionaries ("modules" = the host itself; otherwise the module directory name). */
export const MODULE_DICTIONARIES: Record<string, ModuleDictionary> = {
  modules: host,
  ...Object.fromEntries(Object.entries(found).map(([file, dict]) => [file.split("/")[1]!, dict])),
};

const dictionaries = Object.values(MODULE_DICTIONARIES);
export const modulesZhCN = Object.assign({}, ...dictionaries.map((d) => d.zhCN)) as ModuleMessages;
export const modulesEn = Object.assign({}, ...dictionaries.map((d) => d.en)) as Record<keyof ModuleMessages, string>;
