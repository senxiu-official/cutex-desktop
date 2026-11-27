// Settings → 你 → 设置同步 (design 056 §12, owner 2026-11-26): the memory host, the last sync and per category its
// 「同步」 switch for this computer with a one-line summary of the 同步设置; where this computer differs, 本机设置 and
// 同步设置 side by side with 「用同步设置」 / 「把本机设置同步上去」. A read-only summary, not a second copy of the
// settings pages. Also the once-asked 「保留哪一份？」 (App) and 「已同步」 on a settings page header (Form).
import { useEffect, useRef, useState } from "react";
import { Cloud, CloudOff } from "lucide-react";
import { useI18n } from "../../i18n";
import { useOwnerDocument } from "../../lib/ownerContext";
import { settingsAnchorId } from "../../lib/settingsNav";
import { chooseMemoryHost, useLayoutView } from "../../lib/userLayoutSync";
import { useSyncCategories, type SyncCategory } from "../../lib/settingsSync/registry";
import { settingsSync, useSettingsSync } from "../../lib/settingsSync/run";
import { missingSyncedModules } from "../../lib/settingsSync/categories";
import { dismissSyncAsk, useSyncAskDismissed, syncStatusLine } from "../../lib/settingsSync/ui";
import type { SyncValues } from "../../lib/settingsSync/model";
import { useApp } from "../../store";
import { Button, ListRow, Notice, Section, SettingRow, SettingsGroup, Toggle } from "./Form";

export function SettingsSyncSection() {
  const { t, locale } = useI18n();
  const s = useSettingsSync();
  const layout = useLayoutView();
  const categories = useSyncCategories();
  const [busy, setBusy] = useState(false);
  const ready = s.status !== "noHost" && s.status !== "unsupported";
  const status = syncStatusLine(s, locale);
  const value = layout.hosts.find((h) => h.instanceId === layout.memoryHost?.instanceId)?.id ?? "";
  const choose = async (id: string) => {
    const host = layout.hosts.find((h) => h.id === id);
    if (!host?.instanceId) return;
    setBusy(true);
    try { await chooseMemoryHost({ instanceId: host.instanceId, label: host.label }); } finally { setBusy(false); }
  };
  return (
    <Section id={settingsAnchorId("settings-sync")} title={t("settingsSync.title")} hint={t("settingsSync.hint")}>
      <SettingRow agents="none" source="person" label={t("settingsSync.memoryHost")} hint={<span data-sync-status={s.status}>{t(status.key, status.vars)}</span>}>
        <span className="inline-flex items-center gap-2">
          {s.status === "synced" ? <Cloud size={14} className="text-ok" aria-hidden /> : s.memoryHost ? <CloudOff size={14} className="text-subtle" aria-hidden /> : null}
          <select aria-label={t("settingsSync.memoryHost")} disabled={busy} value={value} onChange={(e) => void choose(e.target.value)} className="max-w-full rounded-md border border-border bg-surface px-2 py-1.5 text-xs">
            <option value="" disabled>{layout.memoryHost?.label ?? t("settingsSync.memoryHost.none")}</option>
            {layout.hosts.filter((h) => h.online && h.supported && h.eligible && h.instanceId).map((h) => <option key={h.id} value={h.id}>{h.label}</option>)}
          </select>
        </span>
      </SettingRow>
      {s.error && <Notice>{s.error}</Notice>}
      <div data-sync-categories="" aria-disabled={!ready || undefined}>
        {categories.map((c) => <CategoryRow key={c.id} category={c} ready={ready} />)}
      </div>
      <p className="py-2 text-xs text-subtle">{t("settingsSync.never")}</p>
    </Section>
  );
}

function CategoryRow({ category: c, ready }: { category: SyncCategory; ready: boolean }) {
  const { t } = useI18n();
  const view = useSettingsSync((s) => s.categories[c.id]);
  const asking = useSettingsSync((s) => s.ask.includes(c.id));
  const title = t(c.titleKey);
  const on = view?.on ?? c.defaultOn;
  const sum = (v: SyncValues | null | undefined) => (v ? c.summary(v, t, { hosts: [] }) : "");
  const syncedLine = sum(view?.synced);
  const localLine = sum(view?.local);
  const compare = c.kind !== "layout" && !!view?.synced && Object.keys(view.synced).length > 0 && (view.differs || asking);
  const missing = c.id === "modules" ? missingSyncedModules(view?.synced ?? null) : [];
  return (
    <SettingsGroup agents="none" source="person">
      <ListRow
        title={<span data-sync-category={c.id}>{title}</span>}
        detail={c.kind === "layout" ? t(c.hintKey) : syncedLine || localLine || t(c.hintKey)}
        actions={<Toggle label={t("settingsSync.switch", { name: title })} checked={on} disabled={!ready} onChange={(v) => settingsSync()?.setOn(c.id, v)} />}
        below={
          <>
            {compare && (
              <div className="mb-2 rounded-lg border border-border bg-surface-2/50 px-3 py-2 text-xs" data-sync-compare={c.id}>
                <p className="mb-1.5 text-muted">{t("settingsSync.differs")}</p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                  <dt className="text-subtle">{t("settingsSync.local")}</dt><dd data-sync-side="local">{localLine || t("settingsSync.empty")}</dd>
                  <dt className="text-subtle">{t("settingsSync.synced")}</dt><dd data-sync-side="synced">{syncedLine || t("settingsSync.empty")}</dd>
                </dl>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button onClick={() => settingsSync()?.useSynced(c.id)}>{t("settingsSync.useSynced")}</Button>
                  <Button onClick={() => settingsSync()?.pushLocal(c.id)}>{t("settingsSync.pushLocal")}</Button>
                </div>
              </div>
            )}
            {missing.length > 0 && (
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted" data-sync-modules-missing="">
                <span>{t("settingsSync.modulesMissing", { list: missing.join("、") })}</span>
                <Button onClick={() => useApp.getState().openSettings("modules")}>{t("settingsSync.modulesMissing.open")}</Button>
              </div>
            )}
          </>
        }
      />
    </SettingsGroup>
  );
}

/** Once, when categories turned on here hold values that differ from the synced ones: which to keep. */
export function SettingsSyncAsk() {
  const { t } = useI18n();
  const ask = useSettingsSync((s) => s.ask);
  const dismissed = useSyncAskDismissed();
  const categories = useSyncCategories();
  const doc = useOwnerDocument();
  const primary = useRef<HTMLButtonElement>(null);
  const open = ask.filter((id) => !dismissed.has(id));
  const shown = open.length > 0;
  useEffect(() => { if (shown) primary.current?.focus(); }, [shown]);
  if (!shown) return null;
  const names = open.map((id) => { const c = categories.find((x) => x.id === id); return c ? t(c.titleKey) : id; });
  const resolve = (keep: "local" | "synced" | null) => {
    const store = settingsSync();
    for (const id of open) {
      if (keep === "synced") store?.useSynced(id);
      else if (keep === "local") store?.pushLocal(id);
    }
    if (!keep) dismissSyncAsk(open);
  };
  return (
    <div className="fixed inset-0 z-[154] flex items-center justify-center bg-black/30 p-5" onKeyDown={(e) => {
      if (e.key === "Escape") { e.preventDefault(); resolve(null); }
      if (e.key === "Tab") {
        const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
        const at = buttons.indexOf(doc.activeElement as HTMLButtonElement);
        e.preventDefault(); buttons[(at + (e.shiftKey ? buttons.length - 1 : 1)) % buttons.length]?.focus();
      }
    }}>
      <div role="dialog" aria-modal="true" aria-labelledby="settings-sync-ask-title" className="w-full max-w-md rounded-xl border border-border bg-raised p-5 shadow-xl" data-settings-sync-ask="">
        <p id="settings-sync-ask-title" className="mb-2 text-sm leading-relaxed">{t("settingsSync.ask.title")}</p>
        <p className="mb-5 text-xs text-muted">{names.join("、")}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={() => resolve(null)}>{t("settingsSync.ask.later")}</Button>
          <Button onClick={() => resolve("local")}>{t("settingsSync.ask.useLocal")}</Button>
          <button ref={primary} onClick={() => resolve("synced")} className="rounded-md bg-accent px-3 py-1.5 text-xs text-on-accent">{t("settingsSync.ask.useSynced")}</button>
        </div>
      </div>
    </div>
  );
}

