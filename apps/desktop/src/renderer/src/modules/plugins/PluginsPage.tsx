import { useState, useSyncExternalStore } from "react";
import type { PluginCapability } from "@cutex-desktop/plugin-sandbox";
import { useI18n } from "../../i18n";
import { PageBody, PageToolbar } from "../../components/Page";
import { Button, EmptyState, Section } from "../../components/settings/Form";
import { appModules, services } from "../app";
import { externalItemId, externalModuleId } from "./manager";
import { pluginManager } from "./controller";
import type { PluginRecord } from "./runtime";

function PluginPermissions({ plugin }: { plugin: PluginRecord }) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<readonly PluginCapability[]>(plugin.permissions);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const change = async (permissions: readonly PluginCapability[]) => {
    setBusy(true); setError(null);
    try { await pluginManager.setPermissions(plugin.manifest.id, permissions); setSelected(permissions); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const pages = appModules().snapshot("main.page");
  const first = plugin.manifest.contributes["main.page"].find((page) => pages.some((entry) => entry.mode === "show" && entry.item.id === externalItemId(page.id)));
  return (
    <Section title={`${plugin.manifest.name} · ${plugin.manifest.version}`} hint={plugin.changed ? t("plugins.changed") : plugin.permissions.length ? t("plugins.granted") : t("plugins.ungranted")}>
      <div className="space-y-2 py-3">
        {plugin.manifest.capabilities.map((permission) => <label key={permission} className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={selected.includes(permission)} disabled={busy} onChange={(event) => setSelected((permissions) => event.target.checked ? [...permissions, permission] : permissions.filter((value) => value !== permission))} />
          <span>{t(`plugins.permission.${permission}`)}</span>
        </label>)}
        {plugin.manifest.codexPlugin && <p className="text-xs text-subtle">{t("plugins.codexPlugin", { name: plugin.manifest.codexPlugin })}</p>}
        <div className="flex flex-wrap gap-2 pt-2">
          <Button disabled={busy || selected.length === 0} onClick={() => void change(selected)}>{t("plugins.grant")}</Button>
          <Button disabled={busy || plugin.permissions.length === 0} onClick={() => void change([])}>{t("plugins.revoke")}</Button>
          {first && appModules().isEnabled(externalModuleId(plugin.manifest.id)) && <Button onClick={() => services.ui.openPage(externalItemId(first.id))}>{t("plugins.open")}</Button>}
        </div>
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      </div>
    </Section>
  );
}

export function PluginsPage() {
  const { t } = useI18n();
  const snapshot = useSyncExternalStore(pluginManager.subscribe, pluginManager.snapshot);
  // Module gating changes should update the available Open buttons without storing a second state.
  useSyncExternalStore(appModules().subscribe, appModules().statuses);
  return (
    <main className="flex min-w-0 flex-1">
      <PageBody>
        <PageToolbar><Button disabled={snapshot.loading} onClick={() => void pluginManager.refresh()}>{t("plugins.refresh")}</Button></PageToolbar>
        <p className="mb-4 text-sm text-muted">{t("plugins.hint")}</p>
        {snapshot.loading && <p className="mb-3 text-sm text-subtle">{t("plugins.loading")}</p>}
        {!snapshot.loading && !snapshot.plugins.length && <EmptyState>{t("plugins.empty")}</EmptyState>}
        {snapshot.plugins.map((plugin) => <PluginPermissions key={`${plugin.manifest.id}:${plugin.fingerprint}:${plugin.permissions.join(",")}`} plugin={plugin} />)}
        {snapshot.errors.length > 0 && <Section title={t("plugins.rejected")}><ul className="space-y-2 py-3 text-xs text-danger">{snapshot.errors.map((error, index) => <li key={`${error.id}:${index}`}>{error.id}: {error.message}</li>)}</ul></Section>}
      </PageBody>
    </main>
  );
}
