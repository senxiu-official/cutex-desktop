// Channel A of agent pages, owner side (docs/design/004-artifact-page-bridge.md): what each page saved on
// this computer (main/pageStorage.ts, limits there), cleared only by the owner — from the artifact's ⋯ menu
// or 设置 → 右侧栏与留白 → 页面数据. Nothing is ever evicted automatically.
import { useCallback, useEffect, useRef, useState } from "react";
import type { PageDataUsage } from "../../../../shared/pageBridge";
import { bridge } from "../../bridge";
import { ArmedButton } from "../../components/ArmedButton";
import { Section, SettingsGroup } from "../../components/settings/Form";
import { useI18n } from "../../i18n";
import { useSettingsRisk } from "../../lib/useSettingsRisk";
import { useApp } from "../../store";
import { formatBytes } from "./model";
import { clearPageData, pageDataClearArmedText, pageDataClearFingerprint } from "./pageDataClear";

const frames = () => bridge?.frames ?? null;

export function PageDataSettings() {
  const { t } = useI18n();
  const hosts = useApp((s) => s.hosts?.hosts);
  const [usage, setUsage] = useState<PageDataUsage | null>(null);
  const gate = useSettingsRisk([usage, hosts], true);
  const [clearing, setClearing] = useState(false);
  // Per row, what its 清除 armed on: the settings in view (useSettingsRisk) and the data shown; a change before the
  // second click cancels it.
  const armedOn = useRef(new Map<string, { valid(): boolean; expected: string }>());
  const reload = useCallback(() => {
    const f = frames();
    if (f) void f.pageDataUsage().then(setUsage, () => setUsage(null));
  }, []);
  useEffect(reload, [reload]);
  if (!frames()) return null;
  const hostLabel = (id: string) => hosts?.find((h) => h.id === id)?.label ?? id;
  const rowKey = (item: PageDataUsage["items"][number]) => `${item.hostId}\n${item.artifactId}`;
  const clear = async (item: PageDataUsage["items"][number], name: string) => {
    const armed = armedOn.current.get(rowKey(item));
    if (clearing || !armed) return;
    setClearing(true);
    try { await clearPageData(item.hostId, { artifactId: item.artifactId, name }, armed.expected, armed.valid); }
    finally { setClearing(false); reload(); }
  };
  return (
    <Section title={t("artifacts.pageData.title")}>
      <SettingsGroup agents="none" source="local">
      <p className="mb-2 text-xs text-subtle">{t("artifacts.pageData.hint", { page: formatBytes(usage?.pageLimit ?? 0), total: formatBytes(usage?.totalLimit ?? 0) })}</p>
      {usage?.totalRefused && <p className="mb-2 rounded-md border border-warn/40 bg-warn/10 px-2 py-1.5 text-xs text-warn-text">{t("artifacts.pageData.totalFull", { total: formatBytes(usage.totalLimit) })}</p>}
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
                  <ArmedButton shape="shrink-0 rounded-md border border-border px-2 py-0.5 disabled:opacity-40" idle="text-foreground hover:bg-hover" disabled={clearing}
                    hint={pageDataClearArmedText(item.hostId, name, item.bytes)} resetKey={`${item.hostId}\n${item.artifactId}\n${item.bytes}\n${item.updatedAt}`}
                    testId="page-data-clear" onArmedChange={(on) => { if (on) armedOn.current.set(rowKey(item), { valid: gate.capture(), expected: pageDataClearFingerprint(item.hostId, item) }); }}
                    onConfirm={() => void clear(item, name)}>
                    {t("artifacts.pageData.clearOne")}
                  </ArmedButton>
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
