// 跨主机同步 (owner 2026-11-26; cutex r297): Settings → 浏览器 → 浏览器身份 → one row per connected host with its
// state (已同步 / 同步中 / 达到上限 / 关闭 …), the last sync and its own switch; hosts without the feature say why
// instead. Above them: identities another host deleted whose logins / site data / passwords / history are still on
// this computer — 清除 (main checks the owner's click and the item) or 暂不 (folds the question for now).
import { useState } from "react";
import { useI18n, type MessageKey } from "../../i18n";
import { Banner, EmptyState, ListRow, Section, SettingsGroup, Toggle } from "../../components/settings/Form";
import { settingsAnchorId } from "../../lib/settingsNav";
import { hostLabel } from "../../lib/stopIdle";
import type { BrowserIdentityCleanup, BrowserIdentitySyncHost } from "../../../../shared/browserIdentity";
import { confirmIdentityCleanup, setHostSync, useBrowserIdentities, useCleanupLater } from "./identities";
import { IdentityBadge } from "./IdentityBadge";

/** States with an on / off switch (the others have nothing to switch yet or cannot). */
const SWITCHABLE = new Set<BrowserIdentitySyncHost["state"]>(["synced", "syncing", "limit", "off", "error", "alone"]);

export function BrowserIdentitySyncSection() {
  const { t } = useI18n();
  const sync = useBrowserIdentities((s) => s.sync);
  if (!sync) return null;
  return (
    <Section id={settingsAnchorId("browser-identity-sync")} title={t("browser.sync.title")} hint={t("browser.sync.hint")}>
      {sync.cleanups.length > 0 && <div className="mb-2 flex flex-col gap-2" data-browser-sync-cleanups>{sync.cleanups.map((c) => <CleanupItem key={`${c.identityId}:${c.deletionRevision}`} item={c} />)}</div>}
      <SettingsGroup agents="none" source="local"><div data-browser-sync-hosts>
        {sync.hosts.length === 0 && <EmptyState>{t("browser.sync.noHosts")}</EmptyState>}
        {sync.hosts.map((host) => <SyncHostRow key={host.hostId} host={host} />)}
      </div></SettingsGroup>
    </Section>
  );
}

function SyncHostRow({ host }: { host: BrowserIdentitySyncHost }) {
  const { t, locale } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const status = t(`browser.sync.state.${host.state}` as MessageKey);
  const last = host.lastSyncAt ? t("browser.sync.last", { time: new Date(host.lastSyncAt).toLocaleString(locale, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) }) : null;
  const detail = [status, last, error ? t("browser.sync.failed") : null].filter(Boolean).join(" · ");
  const toggle = (on: boolean) => {
    setBusy(true); setError(false);
    void setHostSync(host.hostId, on).catch(() => setError(true)).finally(() => setBusy(false));
  };
  return (
    <div data-browser-sync-host={host.hostId} data-browser-sync-state={host.state}>
      <ListRow title={hostLabel(host.hostId)} detail={<span className={host.state === "error" || host.state === "limit" ? "text-warn" : undefined}>{detail}</span>}
        actions={SWITCHABLE.has(host.state) ? <Toggle checked={host.state !== "off"} disabled={busy} label={t("browser.sync.switch", { host: hostLabel(host.hostId) })} onChange={toggle} /> : undefined} />
    </div>
  );
}

function CleanupItem({ item }: { item: BrowserIdentityCleanup }) {
  const { t, locale } = useI18n();
  const later = useCleanupLater((s) => s.keys.has(`${item.identityId}:${item.deletionRevision}`));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clear = () => {
    setBusy(true); setError(null);
    void confirmIdentityCleanup(item.identityId, item.deletionRevision)
      .catch((e: unknown) => setError(String(e instanceof Error ? e.message : e).includes("owner_gesture_required") ? t("browser.sync.cleanup.again") : t("browser.sync.cleanup.failed")))
      .finally(() => setBusy(false));
  };
  const view = { id: item.identityId, name: item.name, color: item.color, initial: [...item.name][0] ?? "?", isDefault: false };
  const actions = (
    <span className="flex shrink-0 items-center gap-1.5">
      <button type="button" data-browser-sync-cleanup-clear disabled={busy} onClick={clear}
        className="rounded-md border border-danger/40 px-2.5 py-1 text-xs text-danger hover:bg-danger/10 disabled:opacity-50">{t("browser.sync.cleanup.clear")}</button>
      {!later && <button type="button" data-browser-sync-cleanup-later disabled={busy} onClick={() => useCleanupLater.getState().later(`${item.identityId}:${item.deletionRevision}`)}
        className="rounded-md px-2.5 py-1 text-xs text-muted hover:bg-hover hover:text-foreground disabled:opacity-50">{t("browser.sync.cleanup.later")}</button>}
    </span>
  );
  return (
    <Banner tone={later ? "info" : "warn"} icon={<IdentityBadge view={view} size={18} />} actions={actions} attrs={{ "data-browser-sync-cleanup": item.identityId, role: later ? undefined : "alert" }}>
      <span className="text-sm">{t(later ? "browser.sync.cleanup.pending" : "browser.sync.cleanup.ask", { name: item.name })}</span>
      {item.hosts.length > 0 && <span className="block text-xs text-subtle">{t("browser.sync.cleanup.hosts", { hosts: item.hosts.map(hostLabel).join(locale.startsWith("zh") ? "、" : ", ") })}</span>}
      {error && <span className="block text-xs text-danger">{error}</span>}
    </Banner>
  );
}
