// Settings → 模块 → 模块数据 (docs/desktop-modules.md §30.6): every module data folder in userData, with its size, also those
// of modules no longer installed. Deleting one opens main's own dialog; this only asks.
import { useEffect, useState } from "react";
import { bridge } from "../../bridge";
import { Button, ListRow, SettingsGroup } from "../../components/settings/Form";
import { useI18n } from "../../i18n";
import { useModuleDevView } from "../devModules";
import { usePackRuntime } from "../packs";
import type { ModuleDataFolderView } from "../../../../shared/moduleData";

function formatDataSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function ModuleDataGroup() {
  const { t } = useI18n();
  const api = bridge.moduleData;
  const packs = usePackRuntime().view;
  const dev = useModuleDevView();
  const [folders, setFolders] = useState<ModuleDataFolderView[] | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!api) return;
    let live = true;
    api.folders().then((f) => live && setFolders(f), () => live && setFolders([]));
    return () => {
      live = false;
    };
    // Again after an install or a removal, which may add or orphan a folder.
  }, [api, packs, dev, tick]);
  if (!api || !folders?.length) return null;
  const clear = async (id: string) => {
    try {
      await api.clear(id);
    } catch (error) {
      console.warn("[module-data]", error);
    }
    setTick((n) => n + 1);
  };
  return (
    <SettingsGroup agents="none" source="local">
      <ListRow title={t("modules.data.title")} detail={t("modules.data.detail")} />
      {folders.map((f) => (
        <ListRow
          key={f.id}
          title={f.id}
          detail={f.known ? formatDataSize(f.bytes) : t("modules.data.orphan", { size: formatDataSize(f.bytes) })}
          actions={<Button onClick={() => void clear(f.id)}>{t("modules.data.delete")}</Button>}
        />
      ))}
    </SettingsGroup>
  );
}
