// Versions of the bundled copies of modules that can also come as signed packs (docs/desktop-modules.md
// §23.1): each such module has modules/<id>/pack.json { version, moduleApi }. A downloaded pack overrides
// the bundled copy only when its version is strictly newer; a module without pack.json is never overridden.
const files = import.meta.glob<{ version: string; moduleApi: string }>("./*/pack.json", { eager: true, import: "default" });

export const BUNDLED_PACK_VERSIONS: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(Object.entries(files).map(([path, json]) => [path.split("/")[1]!, json.version])),
);
