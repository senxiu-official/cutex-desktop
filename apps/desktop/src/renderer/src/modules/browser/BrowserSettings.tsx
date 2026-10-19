import { useEffect, useState } from "react";
import { DEFAULT_BROWSER_CONTROL_SETTINGS, type BrowserControlSettings, type BrowserExternalPagesView, type BrowserSitePermissionForget, type BrowserSitePermissionView } from "../../../../shared/browser";
import { LinkRow, NumberField, ResetButton, Section, Select, SettingRow, Toggle } from "../../components/settings/Form";
import { useI18n } from "../../i18n";
import { browserError, browserErrorKey } from "./browserState";
import { bridge } from "../../bridge";
import { useBrowserEnabled } from "./tabs";
import { useBrowserControlSettings } from "./controlSettings";
import { BrowserHostSettings } from "./BrowserHostSettings";
import { BrowserClaimSettings } from "./BrowserClaimSettings";
import { useApp } from "../../store";
import { SettingsDevicePart, SettingsHostPart } from "../../components/SettingsHostFrame";

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
  return <Section title={t("browser.externalPages.title")} source="local">
    <SettingRow label={t("browser.externalPages.label")} hint={t("browser.externalPages.hint")}>
      <span data-browser-external-pages>
        <Toggle checked={view?.stored ?? true} disabled={!bridge.browser || !view || busy} label={t("browser.externalPages.label")} onChange={value => void change(value)} />
      </span>
    </SettingRow>
    {view?.forced && <p role="status" className="text-xs text-subtle">{t("browser.externalPages.forced")}</p>}
    {error && <p role="alert" className="text-xs text-danger">{t("browser.actionFailed", { reason: t(browserErrorKey(error)) })}</p>}
  </Section>;
}

/** Remembered per-origin site permissions: main stores them; the owner can only read and forget. */
function BrowserSitePermissionSettings() {
  const { t } = useI18n();
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
  return <Section title={t("browser.sitePermissions.title")} hint={t("browser.sitePermissions.hint")} source="local"
    actions={sites.size > 0 ? <button type="button" data-browser-site-permissions-forget-all disabled={busy} onClick={() => void forget("all")} className="rounded text-xs text-accent hover:underline disabled:opacity-40">{t("browser.sitePermissions.forgetAll")}</button> : undefined}>
    <div data-browser-site-permissions className="flex flex-col gap-2">
      {entries && sites.size === 0 && <p className="text-xs text-subtle">{t("browser.sitePermissions.empty")}</p>}
      {[...sites.values()].map(site => <div key={`${site.pool} ${site.origin}`} className="flex items-start justify-between gap-3 text-xs">
        <div className="min-w-0">
          <div className="truncate font-medium" title={site.origin}>{site.origin}{site.pool === "agent" && <span className="ml-1.5 font-normal text-subtle">({t("browser.sitePermissions.agentPool")})</span>}</div>
          <div className="text-subtle">{site.items.map(item => `${t(`browser.sitePermission.${item.permission}` as Parameters<typeof t>[0])}: ${t(item.allow ? "browser.sitePermissions.allowed" : "browser.sitePermissions.blocked")}`).join(" · ")}</div>
        </div>
        <button type="button" disabled={busy} onClick={() => void forget({ pool: site.pool, origin: site.origin })} className="shrink-0 rounded-md border border-border px-2 py-1 disabled:opacity-40">{t("browser.sitePermissions.forget")}</button>
      </div>)}
    </div>
    {error && <p role="alert" className="text-xs text-danger">{t("browser.actionFailed", { reason: t(browserErrorKey(error)) })}</p>}
  </Section>;
}

export function BrowserSettings() {
  const { t } = useI18n();
  const [settings, setSettings] = useBrowserControlSettings();
  const [error, setError] = useState<string | null>(null);
  const enabled = useBrowserEnabled();
  const [resetting, setResetting] = useState(false), [resetDone, setResetDone] = useState(false);
  async function resetOrigins() {
    if (!enabled || !bridge.browser || resetting) return;
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
  return <><SettingsDevicePart title={t("browser.part.device")} hint={t("browser.part.deviceHint")}><Section title={t("browser.settings")} hint={t("browser.owner.settingsHint")} source="local"
    actions={<ResetButton onClick={() => save(DEFAULT_BROWSER_CONTROL_SETTINGS)} title={t("browser.settingsReset")} />}>
    <SettingRow label={t("browser.hiddenTarget")} hint={t("browser.hiddenTargetHint")} reset={<ResetButton disabled={settings.hiddenTarget === DEFAULT_BROWSER_CONTROL_SETTINGS.hiddenTarget} onClick={() => save({ ...settings, hiddenTarget: DEFAULT_BROWSER_CONTROL_SETTINGS.hiddenTarget })} />}>
      <Select value={settings.hiddenTarget} label={t("browser.hiddenTarget")} options={[
        { value: "reveal", label: t("browser.hiddenReveal") }, { value: "reject", label: t("browser.hiddenReject") },
      ]} onChange={(hiddenTarget) => save({ ...settings, hiddenTarget })} />
    </SettingRow>
    <SettingRow label={t("browser.viewportWidth")} hint={t("browser.viewportHint")}>
      <NumberField value={settings.viewport.width} range={[320, 3840]} label={t("browser.viewportWidth")} unit="px"
        onCommit={(width) => save({ ...settings, viewport: { ...settings.viewport, width: width ?? 1280 } })} />
    </SettingRow>
    <SettingRow label={t("browser.viewportHeight")}>
      <NumberField value={settings.viewport.height} range={[240, 2160]} label={t("browser.viewportHeight")} unit="px"
        onCommit={(height) => save({ ...settings, viewport: { ...settings.viewport, height: height ?? 720 } })} />
    </SettingRow>
    <SettingRow label={t("browser.idleDetach")} hint={t("browser.idleDetachHint")}>
      <NumberField value={settings.idleDetachSeconds} range={[5, 600]} label={t("browser.idleDetach")} unit={t("browser.seconds")}
        onCommit={(idleDetachSeconds) => save({ ...settings, idleDetachSeconds: idleDetachSeconds ?? 30 })} />
    </SettingRow>
    <SettingRow label={t("browser.origins.reset")} hint={t("browser.origins.resetHint")}>
      <button type="button" data-browser-reset-origins disabled={!enabled || !bridge.browser || resetting} onClick={() => void resetOrigins()} className="rounded-md border border-border px-3 py-1.5 text-xs disabled:opacity-40">{t("browser.origins.reset")}</button>
    </SettingRow>
    {resetDone && <p role="status" className="text-xs text-subtle">{t("browser.origins.resetDone")}</p>}
    {error && <p role="alert" className="text-xs text-danger">{t("browser.actionFailed", { reason: t(browserErrorKey(error)) })}</p>}
    <LinkRow label={t("browser.hold.limit")} hint={t("browser.hold.hint")} link={t("browser.hold.link")}
      onClick={() => useApp.getState().openSettings("sides", { anchor: "sides" })} />
  </Section><BrowserExternalPagesSettings /><BrowserSitePermissionSettings /></SettingsDevicePart>
  <SettingsHostPart title={t("browser.part.host")} hint={t("browser.part.hostHint")} requires={HOST_PART_REQUIRES}>
    <BrowserHostSettings /><BrowserClaimSettings />
  </SettingsHostPart></>;
}
