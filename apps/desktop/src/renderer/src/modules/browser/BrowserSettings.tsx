import { BrowserCursorSettings } from "./BrowserCursorSettings";
import { BrowserCarrierSettings } from "./BrowserCarrierSettings";
import { useEffect, useState } from "react";
import { DEFAULT_BROWSER_CONTROL_SETTINGS, type BrowserControlSettings, type BrowserExternalPagesView, type BrowserSitePermissionForget, type BrowserSitePermissionView } from "../../../../shared/browser";
import { Button, EmptyState, ErrorNote, LinkRow, ListFilter, ListRow, Loading, NumberField, ResetButton, Section, Select, SettingRow, SettingsGroup, SubPageRow, Toggle } from "../../components/settings/Form";
import { useI18n } from "../../i18n";
import { browserError, browserErrorKey } from "./browserState";
import { bridge } from "../../bridge";
import { useBrowserEnabled } from "./tabs";
import { useBrowserControlSettings } from "./controlSettings";
import { BrowserHostSettings } from "./BrowserHostSettings";
import { BrowserClaimSettings } from "./BrowserClaimSettings";
import { useApp } from "../../store";
import { SettingsDevicePart, SettingsHostPart } from "../../components/SettingsHostFrame";
import { SettingsRiskConfirmation } from "../../components/settings/SettingsRiskConfirmation";
import { useSettingsRisk } from "../../lib/useSettingsRisk";
import { settingsRiskText as riskText } from "../../lib/settingsRiskText";
import { settingsAnchorId } from "../../lib/settingsNav";
import { useScrollToSettingsAnchor } from "../../lib/settingsFocus";
import { matchesFilter } from "../../lib/listFilter";
import { BrowserDesktopLoopbackSettings } from "./BrowserDesktopLoopbackSettings";

/** The host rows need the relay; a host without it shows 「需要升级 cutex」. */
const HOST_PART_REQUIRES = ["browser-relay-v1"] as const;

/** 「允许浏览外部网页」: main stores and enforces it; this row only reads and asks to flip it. */
function BrowserExternalPagesSettings() {
  const { t } = useI18n();
  const [view, setView] = useState<BrowserExternalPagesView | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void bridge.browser?.externalPages().then(next => { if (live) setView(next); }, reason => { if (live) setError(browserError(reason)); });
    return () => { live = false; };
  }, []);
  async function change(enabled: boolean) {
    if (!bridge.browser || busy) return;
    setBusy(true); setError(null);
    try { setView(await bridge.browser.externalPages(enabled)); }
    catch (reason) { setError(browserError(reason)); }
    finally { setBusy(false); }
  }
  return <Section title={t("browser.externalPages.title")} >
    <SettingRow agents="now" source="local" label={t("browser.externalPages.label")} hint={t("browser.externalPages.hint")}>
      <span data-browser-external-pages>
        <Toggle checked={view?.stored ?? true} disabled={!bridge.browser || !view || busy} label={t("browser.externalPages.label")} onChange={value => void change(value)} />
      </span>
    </SettingRow>
    {view?.forced && <p role="status" className="text-xs text-subtle">{t("browser.externalPages.forced")}</p>}
    {error && <ErrorNote>{t("browser.actionFailed", { reason: t(browserErrorKey(error)) })}</ErrorNote>}
  </Section>;
}

/** Sites the 浏览器 page shows; 全部 is its sub-page. */
const SITES_ON_PAGE = 5;

/** Remembered per-origin site permissions: main stores them; the owner can only read and forget. `all`: the sub-page's whole list. */
export function BrowserSitePermissionSettings({ all = false }: { all?: boolean }) {
  const { t } = useI18n();
  const [filter, setFilter] = useState("");
  const [entries, setEntries] = useState<BrowserSitePermissionView[] | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void bridge.browser?.sitePermissions().then(next => { if (live) setEntries(next); }, reason => { if (live) setError(browserError(reason)); });
    return () => { live = false; };
  }, []);
  async function forget(target: BrowserSitePermissionForget) {
    if (!bridge.browser || busy) return;
    setBusy(true); setError(null);
    try { setEntries(await bridge.browser.sitePermissions(target)); }
    catch (reason) { setError(browserError(reason)); }
    finally { setBusy(false); }
  }
  const sites = new Map<string, { pool: "owner" | "agent"; origin: string; items: BrowserSitePermissionView[] }>();
  for (const entry of entries ?? []) {
    const id = `${entry.pool}\n${entry.origin}`;
    if (!sites.has(id)) sites.set(id, { pool: entry.pool, origin: entry.origin, items: [] });
    sites.get(id)!.items.push(entry);
  }
  const listed = [...sites.values()];
  const rows = all ? listed.filter(site => matchesFilter(filter, site.origin)) : listed.slice(0, SITES_ON_PAGE);
  return <Section id={all ? settingsAnchorId("site-permissions-all") : settingsAnchorId("site-permissions")} title={all ? t("browser.sitePermissions.all", { n: listed.length }) : t("browser.sitePermissions.title")} hint={all ? undefined : t("browser.sitePermissions.hint")}
    actions={sites.size > 0 ? <button type="button" data-browser-site-permissions-forget-all disabled={busy} onClick={() => void forget("all")} className="rounded text-xs text-accent hover:underline disabled:opacity-40">{t("browser.sitePermissions.forgetAll")}</button> : undefined}>
    {/* One site = one ListRow (origin, what it may use, 忘记), like every other entity list in Settings. */}
    <SettingsGroup agents="now" source="local"><div data-browser-site-permissions>
      {!entries && !error && <Loading rows={1} />}
      {entries && sites.size === 0 && <EmptyState>{t("browser.sitePermissions.empty")}</EmptyState>}
      {all && <div role="search" className="contents"><ListFilter count={listed.length} value={filter} onChange={setFilter} /></div>}
      {all && listed.length > 0 && rows.length === 0 && <EmptyState>{t("settings.filterNone")}</EmptyState>}
      {rows.map(site => <ListRow key={`${site.pool} ${site.origin}`}
        title={<span title={site.origin}>{site.origin}{site.pool === "agent" && <span className="ml-1.5 text-subtle">({t("browser.sitePermissions.agentPool")})</span>}</span>}
        detail={site.items.map(item => `${t(`browser.sitePermission.${item.permission}` as Parameters<typeof t>[0])}: ${t(item.allow ? "browser.sitePermissions.allowed" : "browser.sitePermissions.blocked")}`).join(" · ")}
        actions={<Button disabled={busy} onClick={() => void forget({ pool: site.pool, origin: site.origin })}>{t("browser.sitePermissions.forget")}</Button>} />)}
    </div></SettingsGroup>
    {!all && listed.length > SITES_ON_PAGE && <SubPageRow title={t("browser.sitePermissions.all", { n: listed.length })} onOpen={() => useApp.getState().openSettings("browser", { sub: "sites" })} />}
    {error && <p role="alert" className="text-xs text-danger">{t("browser.actionFailed", { reason: t(browserErrorKey(error)) })}</p>}
  </Section>;
}

/** 浏览器 → 网站权限: every site this computer remembers. */
export function BrowserSitesSubPage() {
  const { t } = useI18n();
  useScrollToSettingsAnchor();
  return <SettingsDevicePart title={t("browser.part.device")} hint={t("browser.part.deviceHint")}><BrowserSitePermissionSettings all /></SettingsDevicePart>;
}

export function BrowserSettings() {
  const { t } = useI18n();
  const [settings, setSettings] = useBrowserControlSettings();
  const [error, setError] = useState<string | null>(null);
  const enabled = useBrowserEnabled();
  const gate = useSettingsRisk([settings, enabled], true);
  const [resetApproval, setResetApproval] = useState<{ valid(): boolean } | null>(null);
  const [resetting, setResetting] = useState(false), [resetDone, setResetDone] = useState(false);
  async function resetOrigins(valid: () => boolean) {
    if (!valid() || !enabled || !bridge.browser || resetting) return;
    setResetApproval(null);
    setResetting(true); setResetDone(false); setError(null);
    try { await bridge.browser.resetOrigins(); setResetDone(true); }
    catch (reason) { setError(browserError(reason)); }
    finally { setResetting(false); }
  }
  function save(next: BrowserControlSettings) {
    try { setSettings(next); setError(null); }
    catch (reason) { setError(browserError(reason)); }
  }
  // Two parts (review 2026-10-15 UI-02): this computer's browser, then the Settings target host's
  // agent permissions (the host pages' picker; never the focus host in its place).
  return <><SettingsDevicePart title={t("browser.part.device")} hint={t("browser.part.deviceHint")}><Section title={t("browser.settings")} hint={t("browser.owner.settingsHint")}
    actions={<ResetButton onClick={() => save(DEFAULT_BROWSER_CONTROL_SETTINGS)} title={t("browser.settingsReset")} />}>
    <BrowserCursorSettings />
    <SettingRow agents="now" source="local" label={t("browser.hiddenTarget")} hint={t("browser.hiddenTargetHint")} reset={<ResetButton disabled={settings.hiddenTarget === DEFAULT_BROWSER_CONTROL_SETTINGS.hiddenTarget} onClick={() => save({ ...settings, hiddenTarget: DEFAULT_BROWSER_CONTROL_SETTINGS.hiddenTarget })} />}>
      <Select value={settings.hiddenTarget} label={t("browser.hiddenTarget")} options={[
        { value: "reveal", label: t("browser.hiddenReveal") }, { value: "reject", label: t("browser.hiddenReject") },
      ]} onChange={(hiddenTarget) => save({ ...settings, hiddenTarget })} />
    </SettingRow>
    <SettingRow agents="now" source="local" label={t("browser.viewportWidth")} hint={t("browser.viewportHint")}>
      <NumberField value={settings.viewport.width} range={[320, 3840]} label={t("browser.viewportWidth")} unit="px"
        onCommit={(width) => save({ ...settings, viewport: { ...settings.viewport, width: width ?? 1280 } })} />
    </SettingRow>
    <SettingRow agents="now" source="local" label={t("browser.viewportHeight")}>
      <NumberField value={settings.viewport.height} range={[240, 2160]} label={t("browser.viewportHeight")} unit="px"
        onCommit={(height) => save({ ...settings, viewport: { ...settings.viewport, height: height ?? 720 } })} />
    </SettingRow>
    <SettingRow agents="now" source="local" label={t("browser.idleDetach")} hint={t("browser.idleDetachHint")}>
      <NumberField value={settings.idleDetachSeconds} range={[5, 600]} label={t("browser.idleDetach")} unit={t("browser.seconds")}
        onCommit={(idleDetachSeconds) => save({ ...settings, idleDetachSeconds: idleDetachSeconds ?? 30 })} />
    </SettingRow>
    <BrowserCarrierSettings />
    <div id={settingsAnchorId("site-origins")}>
      <SettingRow agents="none" source="local" label={t("browser.origins.reset")} hint={t("browser.origins.resetHint")}>
        <button type="button" data-browser-reset-origins disabled={!enabled || !bridge.browser || resetting} onClick={() => {
          gate.invalidate(); setResetApproval({ valid: gate.capture() }); setResetDone(false);
        }} className="rounded-md border border-border px-3 py-1.5 text-xs disabled:opacity-40">{t("browser.origins.reset")}</button>
      </SettingRow>
      {resetApproval && <SettingsRiskConfirmation message={riskText("settingsRisk.origins")} valid={resetApproval.valid} busy={resetting}
        confirmLabel={riskText("settingsRisk.originsConfirm")} onCancel={() => { gate.invalidate(); setResetApproval(null); }}
        onConfirm={() => void resetOrigins(resetApproval.valid)} />}
    </div>
    {resetDone && <p role="status" className="text-xs text-subtle">{t("browser.origins.resetDone")}</p>}
    {error && <p role="alert" className="text-xs text-danger">{t("browser.actionFailed", { reason: t(browserErrorKey(error)) })}</p>}
    <LinkRow agents="now" source="local" label={t("browser.hold.limit")} hint={t("browser.hold.hint")} link={t("browser.hold.link")}
      onClick={() => useApp.getState().openSettings("sides", { anchor: "sides" })} />
  </Section><BrowserExternalPagesSettings /><BrowserSitePermissionSettings /></SettingsDevicePart>
  <SettingsHostPart title={t("browser.desktopLoopback.title")}><BrowserDesktopLoopbackSettings /></SettingsHostPart>
  <SettingsHostPart title={t("browser.part.host")} hint={t("browser.part.hostHint")} requires={HOST_PART_REQUIRES}>
    <BrowserHostSettings /><BrowserClaimSettings />
  </SettingsHostPart></>;
}
