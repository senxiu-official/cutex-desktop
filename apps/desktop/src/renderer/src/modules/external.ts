// External (manifest-declared) modules: the id namespace the plugins adapter maps package ids into
// (docs/desktop-modules.md §10.1). The shell marks their names and entries as 外部 (acceptance O5)
// so a plugin cannot pass itself off as a built-in item such as 设置.
export const EXTERNAL_MODULE_PREFIX = "external-";

export function isExternalModuleId(id: string): boolean {
  return id.startsWith(EXTERNAL_MODULE_PREFIX);
}
