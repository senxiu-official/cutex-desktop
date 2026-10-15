import { useEffect, useState } from "react";
import { DEFAULT_BROWSER_CONTROL_SETTINGS, type BrowserControlSettings, type BrowserExternalPagesView } from "../../../../shared/browser";
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
    <SettingRow label={t("browser.hiddenTarget")} hint={t("browser.hiddenTargetHint")}>
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
  </Section><BrowserExternalPagesSettings /></SettingsDevicePart>
  <SettingsHostPart title={t("browser.part.host")} hint={t("browser.part.hostHint")} requires={HOST_PART_REQUIRES}>
    <BrowserHostSettings /><BrowserClaimSettings />
  </SettingsHostPart></>;
}
