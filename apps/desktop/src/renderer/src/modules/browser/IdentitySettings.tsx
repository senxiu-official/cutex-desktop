// Settings → 浏览器 → 浏览器身份 (design browser-profiles v3 §3): the list (one row per identity, 新建…) and one
// identity's sub-page (storage, 清除浏览数据…, signed-in sites, this identity's site permissions, passwords / history,
// 改名和颜色, 退出所有登录… / 删除…). Main owns every value; this page reads and asks.
import { useEffect, useState } from "react";
import { useI18n, type MessageKey } from "../../i18n";
import { Button, EmptyState, ListRow, Loading, Section, Select, SettingRow, SettingsGroup, SubPageRow } from "../../components/settings/Form";
import { settingsAnchorId } from "../../lib/settingsNav";
import { useScrollToSettingsAnchor } from "../../lib/settingsFocus";
import { SettingsDevicePart } from "../../components/SettingsHostFrame";
import { hostLabel } from "../../lib/stopIdle";
import { BROWSER_HISTORY_RETENTIONS, BROWSER_SEARCH_ENGINES, type BrowserIdentityStorage } from "../../../../shared/browserIdentity";
import { identityRequest, setBrowserPrefs, useBrowserIdentities, useIdentity, useIdentityPage } from "./identities";
import { IdentityBadge } from "./IdentityBadge";
import { IdentityEditDialog } from "./IdentityEditDialog";
import { ClearDataDialog, IdentityConfirmDialog } from "./IdentityDialogs";
import { openIdentityHistory, openIdentityPage, openIdentityPasswords } from "./identityMenus";
import { BrowserSitePermissionSettings } from "./BrowserSettings";
import { formatBytes } from "./identityFormat";

export function BrowserIdentitiesSection() {
  const { t } = useI18n();
  const supported = useBrowserIdentities((s) => s.supported);
  const state = useBrowserIdentities((s) => s.state);
  const [creating, setCreating] = useState(false);
  return (
    <Section id={settingsAnchorId("browser-identities")} title={t("browser.identity.settings.title")} hint={t("browser.identity.settings.hint")}
      actions={supported ? <button type="button" data-identity-new onClick={() => setCreating(true)} className="rounded text-xs text-accent hover:underline">{t("browser.identity.new")}</button> : undefined}>
      <SettingsGroup agents="none" source="local"><div data-browser-identities>
        {!supported && <EmptyState>{t("browser.identity.settings.unsupported")}</EmptyState>}
        {supported && !state && <Loading rows={2} />}
        {state?.identities.map((view) => (
          <button key={view.id} type="button" data-identity-row={view.id} onClick={() => openIdentityPage(view.id)}
            className="-mx-4 flex w-[calc(100%+2rem)] min-w-0 items-center gap-2.5 border-b border-border px-4 py-2 text-left last:border-b-0 hover:bg-surface-2/60 press">
            <IdentityBadge view={view} size={22} />
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 items-center gap-1.5 text-sm text-foreground">
                <span className="truncate">{view.name}</span>
                {view.isDefault && <span className="shrink-0 rounded-chip bg-surface-2 px-1.5 text-caption text-muted">{t("browser.identity.settings.original")}</span>}
                {state.current === view.id && <span className="shrink-0 text-caption text-subtle">· {t("browser.identity.current")}</span>}
              </span>
              <span className="block truncate text-xs text-subtle">
                {view.openTabs ? t("browser.identity.settings.openTabs", { n: view.openTabs }) : t("browser.identity.settings.noTabs")}
                {view.hosts.length > 0 && ` · ${t("browser.identity.settings.hosts", { hosts: view.hosts.map(hostLabel).join("、") })}`}
              </span>
            </span>
            <span aria-hidden className="shrink-0 text-subtle">›</span>
          </button>
        ))}
        {supported && <p className="pt-2 text-xs text-subtle">{t("browser.identity.settings.agentPool")}</p>}
      </div></SettingsGroup>
      {creating && <IdentityEditDialog onClose={() => setCreating(false)} />}
    </Section>
  );
}

/** 搜索和历史 (all identities): the search engine and how long history is kept. */
export function BrowserSearchHistorySection() {
  const { t } = useI18n();
  const supported = useBrowserIdentities((s) => s.supported);
  const prefs = useBrowserIdentities((s) => s.prefs);
  if (!supported) return null;
  const save = (patch: Partial<typeof prefs>) => void setBrowserPrefs(patch).catch(() => {});
  return (
    <Section id={settingsAnchorId("browser-search")} title={t("browser.search.section")}>
      <SettingRow agents="none" source="local" label={t("browser.search.engine")} hint={t("browser.search.engineHint")}>
        <Select value={prefs.searchEngine} label={t("browser.search.engine")} options={BROWSER_SEARCH_ENGINES.map((e) => ({ value: e, label: t(`browser.search.engine.${e}` as MessageKey) }))} onChange={(searchEngine) => save({ searchEngine })} />
      </SettingRow>
      <SettingRow agents="none" source="local" label={t("browser.history.retention")} hint={t("browser.history.retentionHint")}>
        <Select value={prefs.historyRetention} label={t("browser.history.retention")} options={BROWSER_HISTORY_RETENTIONS.map((r) => ({ value: r, label: t(`browser.history.retention.${r}` as MessageKey) }))} onChange={(historyRetention) => save({ historyRetention })} />
      </SettingRow>
    </Section>
  );
}

/** 研究中 (design §12): extensions are being studied; shown greyed, not clickable (sync: IdentitySyncSettings). */
export function BrowserResearchSection() {
  const { t } = useI18n();
  return (
    <Section title={t("browser.research.title")} tag={{ label: t("browser.research.tag") }}>
      <SettingsGroup agents="none" source="local"><div data-browser-research aria-disabled="true" className="opacity-60">
        <ListRow title={t("browser.research.extensions")} detail={t("browser.research.extensionsHint")} />
      </div></SettingsGroup>
    </Section>
  );
}

/** One row per host holding data: a configured host offers 退出登录 there; a removed host's leftover offers 清除. */
function StorageLines({ storage, onHost }: { storage: BrowserIdentityStorage[] | null; onHost(s: BrowserIdentityStorage): void }) {
  const { t } = useI18n();
  if (!storage) return <Loading rows={1} />;
  if (!storage.length) return <EmptyState>{t("browser.identity.page.noData")}</EmptyState>;
  const size = (n: number | null) => (n === null ? t("browser.identity.page.storageUnknown") : formatBytes(n, t));
  return <>{storage.map((s) => s.removedHost ? (
    <div key={s.hostId} data-identity-storage={s.hostId} data-removed-host="">
      <ListRow title={<span title={t("browser.identity.page.removedHostTip", { id: s.hostId })}>{t("browser.identity.page.removedHost")}</span>}
        detail={t("browser.identity.page.removedHostLine", { size: size(s.siteDataBytes) })}
        actions={<Button onClick={() => onHost(s)}>{t("browser.identity.page.leftoverClear")}</Button>} />
    </div>
  ) : (
    <div key={s.hostId} data-identity-storage={s.hostId}>
      <ListRow title={hostLabel(s.hostId)} detail={t("browser.identity.page.storageLine", { site: size(s.siteDataBytes), cache: size(s.cacheBytes) })}
        actions={<Button onClick={() => onHost(s)}>{t("browser.identity.page.hostSignOut")}</Button>} />
    </div>
  ))}</>;
}

type IdentityDialog = null | "edit" | "clear" | "signOut" | "remove" | { kind: "signOutHost" | "clearLeftover"; hostId: string };

/** One identity's page (sub "identity"; which one: useIdentityPage, set by the list row / the switcher's 管理). */
export function BrowserIdentitySubPage() {
  const { t } = useI18n();
  useScrollToSettingsAnchor();
  const target = useIdentityPage((s) => s.id);
  const identity = useIdentity(target);
  const [storage, setStorage] = useState<BrowserIdentityStorage[] | null>(null);
  const [sites, setSites] = useState<Record<string, string[]>>({});
  const [passwords, setPasswords] = useState<number | null>(null);
  const [dialog, setDialog] = useState<IdentityDialog>(null);
  const [done, setDone] = useState(false);
  const [reload, setReload] = useState(0);
  const id = identity?.id;
  useEffect(() => {
    if (!id) return;
    let live = true;
    setStorage(null); setSites({});
    void identityRequest((ids) => ids.storage(id)).then(async (list) => {
      if (!live) return;
      setStorage(list);
      const found: Record<string, string[]> = {};
      for (const s of list) found[s.hostId] = await identityRequest((ids) => ids.signedInSites(id, s.hostId)).catch(() => []);
      if (live) setSites(found);
    }, () => { if (live) setStorage([]); });
    void identityRequest((ids) => ids.passwords(id)).then((list) => { if (live) setPasswords(list.length); }, () => { if (live) setPasswords(null); });
    return () => { live = false; };
  }, [id, reload]);
  if (!identity) return <SettingsDevicePart title={t("browser.part.device")}><EmptyState>{t("browser.identity.page.missing")}</EmptyState></SettingsDevicePart>;
  const allSites = [...new Set(Object.values(sites).flat())].sort();
  const refresh = () => { setDone(true); setReload((n) => n + 1); };
  return (
    <SettingsDevicePart title={t("browser.part.device")} hint={t("browser.part.deviceHint")}>
      <div data-identity-page={identity.id} className="contents">
        <Section title={<span className="flex items-center gap-2"><IdentityBadge view={identity} size={20} />{identity.name}</span>}
          hint={identity.isDefault ? `${t("browser.identity.settings.original")} · ${t("browser.identity.page.storage")}` : t("browser.identity.page.storage")}
          actions={<button type="button" data-identity-rename onClick={() => setDialog("edit")} className="rounded text-xs text-accent hover:underline">{t("browser.identity.edit.renameTitle")}</button>}>
          <SettingsGroup agents="none" source="local">
            <StorageLines storage={storage} onHost={(s) => { setDone(false); setDialog({ kind: s.removedHost ? "clearLeftover" : "signOutHost", hostId: s.hostId }); }} />
            <ListRow title={<span className="text-muted">{t("browser.identity.page.clearHint")}</span>} actions={<Button onClick={() => { setDone(false); setDialog("clear"); }}>{t("browser.identity.page.clear")}</Button>} />
            {done && <p role="status" className="py-1 text-xs text-subtle">{t("browser.identity.page.done")}</p>}
            <p data-identity-sync-note className="pt-1 pb-2 text-xs text-subtle">{t("browser.identity.page.syncNote")}</p>
          </SettingsGroup>
        </Section>
        <Section title={t("browser.identity.page.signedIn")} hint={t("browser.identity.page.signedInHint")}>
          <SettingsGroup agents="none" source="local"><div data-identity-signed-in>
            {!storage ? <Loading rows={1} /> : allSites.length ? Object.entries(sites).filter(([, list]) => list.length).map(([hostId, list]) => (
              <ListRow key={hostId} title={hostLabel(hostId)} detail={list.map((d) => d.replace(/^\./, "")).join(" · ")} />
            )) : <EmptyState>{t("browser.identity.page.signedInEmpty")}</EmptyState>}
          </div></SettingsGroup>
        </Section>
        <Section title={t("browser.identity.page.data")}>
          <SubPageRow title={t("browser.identity.page.passwords")} summary={passwords === null ? undefined : t("browser.identity.page.passwordsCount", { n: passwords })} onOpen={() => openIdentityPasswords(identity.id)} />
          <SubPageRow title={t("browser.identity.page.history")} onOpen={() => openIdentityHistory(identity.id)} />
        </Section>
        <BrowserSitePermissionSettings identityId={identity.id} />
        <Section title={t("browser.identity.page.whole")}>
          <SettingsGroup agents="none" source="local">
            <ListRow title={t("browser.identity.page.signOut")} actions={<Button onClick={() => setDialog("signOut")}>{t("browser.identity.page.signOutDo")}</Button>} />
            {identity.isDefault
              ? <p className="py-2 text-xs text-subtle">{t("browser.identity.page.defaultNoRemove")}</p>
              : <ListRow title={t("browser.identity.page.remove")} actions={<button type="button" data-identity-remove onClick={() => setDialog("remove")} className="rounded-md border border-danger/40 px-2.5 py-1 text-xs text-danger hover:bg-danger/10">{t("browser.identity.page.removeDo")}</button>} />}
          </SettingsGroup>
        </Section>
      </div>
      {dialog === "edit" && <IdentityEditDialog editing={identity} onClose={() => setDialog(null)} />}
      {dialog === "clear" && <ClearDataDialog identity={identity} hosts={(storage ?? []).filter((s) => !s.removedHost).map((s) => ({ id: s.hostId, name: hostLabel(s.hostId) }))}
        sites={sites} onClose={() => setDialog(null)} onDone={refresh} />}
      {(dialog === "signOut" || dialog === "remove") && <IdentityConfirmDialog identity={identity} kind={dialog} passwords={passwords ?? 0} onClose={() => setDialog(null)} onDone={refresh} />}
      {typeof dialog === "object" && dialog && <IdentityConfirmDialog identity={identity} kind={dialog.kind} passwords={passwords ?? 0}
        host={{ id: dialog.hostId, name: dialog.kind === "signOutHost" ? hostLabel(dialog.hostId) : dialog.hostId }} onClose={() => setDialog(null)} onDone={refresh} />}
    </SettingsDevicePart>
  );
}
