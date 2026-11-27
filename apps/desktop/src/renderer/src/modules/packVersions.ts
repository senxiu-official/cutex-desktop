// Versions of the bundled copies of modules that can also come as signed packs (docs/desktop-modules.md
// §23.1): each such module has modules/<id>/pack.json { version, moduleApi }. A downloaded pack overrides
// the bundled copy only when its version is strictly newer; a module without pack.json is never overridden.
// `packOnly`: the source lives here but the app has no bundled copy (not in registry.ts), so it has no bundled version.
import { isUpgradePackId, UPGRADE_PACK_BASELINES } from "../../../shared/modulePacks";
const files = import.meta.glob<{ version: string; moduleApi: string; packOnly?: boolean }>("./*/pack.json", { eager: true, import: "default" });

export const BUNDLED_PACK_VERSIONS: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(Object.entries(files).filter(([, json]) => !json.packOnly).map(([path, json]) => {
    const id = path.split("/")[1]!;
    return [id, isUpgradePackId(id) ? UPGRADE_PACK_BASELINES[id] : json.version];
  })),
);
