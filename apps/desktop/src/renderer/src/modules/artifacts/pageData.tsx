// Channel A of agent pages, owner side (docs/design/004-artifact-page-bridge.md): what each page saved on
// this computer (main/pageStorage.ts, limits there), cleared only by the owner — from the artifact's ⋯ menu
// or 设置 → 右侧栏与留白 → 页面数据. Nothing is ever evicted automatically.
import { useCallback, useEffect, useState } from "react";
import type { ArtifactSummary } from "../../../../shared/artifactStore";
import type { PageDataUsage } from "../../../../shared/pageBridge";
import { bridge } from "../../bridge";
import { Section, SettingsGroup } from "../../components/settings/Form";
import { translate, useI18n } from "../../i18n";
import { promptDialog } from "../../lib/contextMenu";
import { confirmSettingsRisk, SettingsRiskGate, settingsRiskFingerprint } from "../../lib/settingsRisk";
import { useSettingsRisk } from "../../lib/useSettingsRisk";
import { settingsRiskText as riskText } from "../../lib/settingsRiskText";
import { useApp } from "../../store";
import { services } from "../app";
import { formatBytes } from "./model";

const frames = () => bridge?.frames ?? null;

/** ⋯ menu 「清除这个页面的数据」: confirm with the size, then clear (all versions share it). */
export async function clearPageData(hostId: string, a: Pick<ArtifactSummary, "artifactId" | "name">, valid: () => boolean = () => true): Promise<void> {
  const f = frames();
  if (!f) return;
  const gate = new SettingsRiskGate();
  const artifact = { ...a };
  const scope = () => settingsRiskFingerprint([useApp.getState().hosts?.active,
    useApp.getState().hosts?.hosts.find(host => host.id === hostId)?.label, a]);
  const initialScope = scope();
  gate.update(initialScope);
  const unsubscribe = useApp.subscribe(() => gate.update(scope()));
  const alive = gate.capture();
  const current = () => alive() && valid() && frames() === f && scope() === initialScope;
  try {
    const usage = await f.pageDataUsage();
    if (!current()) return;
    const entry = usage.items.find((item) => item.hostId === hostId && item.artifactId === artifact.artifactId);
    if (!entry) return services.ui.notice(translate("artifacts.pageData.none", { name: artifact.name }));
    const name = artifact.name || entry.name || translate("artifacts.pageData.unnamed");
    const host = useApp.getState().hosts?.hosts.find(item => item.id === hostId)?.label ?? hostId;
    const result = await confirmSettingsRisk(name, () => promptDialog(riskText("settingsRisk.pageClear"), "", {
      placeholder: name,
      hint: riskText("settingsRisk.pageClearHint", { name, target: name, host, size: formatBytes(entry.bytes) }),
    }), current);
    if (result !== "confirmed") {
      if (result !== "cancelled") services.ui.notice(riskText(result === "changed" ? "settingsRisk.changed" : "settingsRisk.typeMismatch"));
      return;
    }
    const latest = await f.pageDataUsage();
    const latestEntry = latest.items.find(item => item.hostId === hostId && item.artifactId === artifact.artifactId);
    if (!current() || settingsRiskFingerprint(entry) !== settingsRiskFingerprint(latestEntry)) {
      services.ui.notice(riskText("settingsRisk.changed")); return;
    }
    await f.pageDataClear(hostId, artifact.artifactId);
    services.ui.notice(translate("artifacts.pageData.cleared", { name }));
  } catch (e) {
    services.ui.notice(String(e), "error");
  } finally { unsubscribe(); gate.invalidate(); }
}

export function PageDataSettings() {
  const { t } = useI18n();
  const hosts = useApp((s) => s.hosts?.hosts);
  const [usage, setUsage] = useState<PageDataUsage | null>(null);
  const gate = useSettingsRisk([usage, hosts], true);
  const [clearing, setClearing] = useState(false);
  const reload = useCallback(() => {
    const f = frames();
    if (f) void f.pageDataUsage().then(setUsage, () => setUsage(null));
  }, []);
  useEffect(reload, [reload]);
  if (!frames()) return null;
  const hostLabel = (id: string) => hosts?.find((h) => h.id === id)?.label ?? id;
  const clear = async (hostId: string, artifactId: string, name: string) => {
    if (clearing) return;
    const valid = gate.capture(); setClearing(true);
    try { await clearPageData(hostId, { artifactId, name }, valid); }
    finally { setClearing(false); reload(); }
  };
  return (
    <Section title={t("artifacts.pageData.title")}>
      <SettingsGroup agents="none" source="local">
      <p className="mb-2 text-xs text-subtle">{t("artifacts.pageData.hint", { page: formatBytes(usage?.pageLimit ?? 0), total: formatBytes(usage?.totalLimit ?? 0) })}</p>
      {usage?.totalRefused && <p className="mb-2 rounded-md border border-warning/40 bg-warning/10 px-2 py-1.5 text-xs text-warning">{t("artifacts.pageData.totalFull", { total: formatBytes(usage.totalLimit) })}</p>}
      {!usage || usage.items.length === 0 ? (
        <p className="text-xs text-subtle">{t("artifacts.pageData.empty")}</p>
      ) : (
        <>
          <ul className="divide-y divide-border/60 rounded-md border border-border/60" data-testid="page-data-list">
            {usage.items.map((item) => {
              const name = item.name ?? t("artifacts.pageData.unnamed");
              return (
                <li key={`${item.hostId}\n${item.artifactId}`} className="flex items-center gap-2 px-2 py-1.5 text-xs">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-foreground" title={item.artifactId}>{name}</div>
                    <div className="truncate text-subtle">{t("artifacts.pageData.row", { size: formatBytes(item.bytes), host: hostLabel(item.hostId) })}</div>
                  </div>
                  <button disabled={clearing} onClick={() => void clear(item.hostId, item.artifactId, name)} className="shrink-0 rounded-md border border-border px-2 py-0.5 text-foreground hover:bg-hover disabled:opacity-40">
                    {t("artifacts.pageData.clearOne")}
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-1.5 text-right text-xs text-subtle">{t("artifacts.pageData.total", { used: formatBytes(usage.totalBytes), total: formatBytes(usage.totalLimit) })}</p>
        </>
      )}
      </SettingsGroup>
    </Section>
  );
}
