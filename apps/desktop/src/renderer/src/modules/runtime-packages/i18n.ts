export const zhCN = {
  "runtime-packages.title": "{{agent}}运行时升级",
  "runtime-packages.description": "把空闲的{{agent}}升级到新运行时",
} as const;

// Adds these keys to MessageKey (modules/i18nCatalog.ts collects the dictionary itself).
declare module "../i18nCatalog" {
  interface ModuleMessages extends Messages {}
}
type Messages = typeof zhCN;

export const en: Record<keyof typeof zhCN, string> = {
  "runtime-packages.title": "{{Agent}} runtime upgrades",
  "runtime-packages.description": "Upgrade idle {{agents}} to the new runtime",
};
