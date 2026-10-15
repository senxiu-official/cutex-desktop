// Preapproved profile-editor integration; shares the browser module's activation gate.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { hostEpoch } from "../../../../shared/hosts";
import { bridge } from "../../bridge";
import { useI18n } from "../../i18n";
import { useTargetFeatures, useTargetHostId } from "../../lib/targetHost";
import { browserActivation } from "../../../../shared/browser";
import { browserOwnerErrorKey as browserErrorKey } from "../../../../shared/browser";
import { useApp } from "../../store";
import { Button, ResetButton, Section, Select, SettingRow, Toggle } from "./Form";
import type { BrowserClaimPolicyView } from "../../../../shared/browser";
import { BROWSER_CLAIM_MODES, DEFAULT_BROWSER_CLAIM_MODE, type BrowserClaimMode } from "../../../../shared/browserClaim";

/** Immediate one-field save; does not join or overwrite the profile's other draft fields. */
export function BrowserProfileTools({ profile }: { profile: string }) {
  const { t } = useI18n(), hostId = useTargetHostId(), enabled = useSyncExternalStore(browserActivation.subscribe, browserActivation.get, browserActivation.get);
  const epoch = useApp(state => state.hosts ? hostEpoch(state.hosts, hostId) : null);
  const supported = useTargetFeatures().has("browser-relay-v1");
  const available = enabled && supported && !!epoch && !!bridge.browser;
  const [value, setValue] = useState<boolean | null>(null), [busy, setBusy] = useState(false), [failed, setFailed] = useState<ReturnType<typeof browserErrorKey> | null>(null);
  const generation = useRef(0);
  const current = () => { const hosts = useApp.getState().hosts; return !!hosts && hostEpoch(hosts, hostId) === epoch; };
  async function request(next?: boolean) {
    if (!available || !bridge.browser) return;
    const token = ++generation.current; setBusy(true); setFailed(null);
    try {
      await new Promise<void>(resolve => queueMicrotask(resolve));
      if (token !== generation.current || !current()) return;
      const result = await bridge.browser.forHost(hostId).profileTools(profile, next);
      if (token === generation.current && current()) setValue(result.enabled);
    } catch (reason) { if (token === generation.current) { setFailed(browserErrorKey(reason)); setValue(null); } }
    finally { if (token === generation.current) setBusy(false); }
  }
  useEffect(() => {
    ++generation.current; setValue(null); setBusy(false); setFailed(null);
    if (available) void request();
    return () => { ++generation.current; };
  }, [hostId, epoch, profile, available]);
  // Module off (fresh installs have it on since 2026-10-15): keep the row discoverable, inert, with the way to turn it on.
  if (!enabled) return <SettingRow label={t("browser.profile.tools")} hint={t("browser.profile.moduleOff")}>
    <Button onClick={() => useApp.getState().openSettings("modules")}>{t("modules.openModules")}</Button>
  </SettingRow>;
  return <SettingRow label={t("browser.profile.tools")} hint={<>
    {t("browser.profile.hint")}
    {!available && <span className="block">{t("browser.host.unavailable")}</span>}
    {failed && <span role="alert" className="block text-danger">{t(failed)}</span>}
  </>}>
    <Toggle checked={value ?? false} onChange={next => { if (!busy && value !== null) void request(next); }}
      disabled={!available || busy || value === null} label={t("browser.profile.tools")} />
  </SettingRow>;
}

/**
 * Per-profile 「浏览器控制」 for browser_claim: 每次询问 / 本机页面免问 (default) / 总是允许. Desktop-local
 * (main stores it per host + profile and enforces it), so it is its own card tagged 本机 under 行为;
 * ↺ goes back to the default. Saved immediately.
 */
export function BrowserProfileClaimMode({ profile }: { profile: string }) {
  const { t } = useI18n(), hostId = useTargetHostId(), enabled = useSyncExternalStore(browserActivation.subscribe, browserActivation.get, browserActivation.get);
  const epoch = useApp(state => state.hosts ? hostEpoch(state.hosts, hostId) : null);
  const supported = useTargetFeatures().has("browser-relay-v1");
  // The browser preview has no browser bridge: an inert local row so the layout can be checked.
  const preview = !bridge.browser && import.meta.env.DEV;
  const available = (enabled && supported && !!epoch && !!bridge.browser) || preview;
  const [view, setView] = useState<BrowserClaimPolicyView | null>(null), [busy, setBusy] = useState(false), [failed, setFailed] = useState<ReturnType<typeof browserErrorKey> | null>(null);
  const generation = useRef(0);
  async function request(mode?: BrowserClaimMode | null) {
    if (preview) { setView(previous => { const stored = mode === undefined ? previous?.stored ?? null : mode; return { mode: stored ?? DEFAULT_BROWSER_CLAIM_MODE, stored, defaultMode: DEFAULT_BROWSER_CLAIM_MODE }; }); return; }
    if (!available || !bridge.browser) return;
    const token = ++generation.current; setBusy(true); setFailed(null);
    try {
      const result = await bridge.browser.forHost(hostId).claimPolicy(profile, mode);
      if (token === generation.current) setView(result);
    } catch (reason) { if (token === generation.current) { setFailed(browserErrorKey(reason)); setView(null); } }
    finally { if (token === generation.current) setBusy(false); }
  }
  useEffect(() => {
    ++generation.current; setView(null); setBusy(false); setFailed(null);
    if (available) void request();
    return () => { ++generation.current; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostId, epoch, profile, available]);
  if (!enabled && !preview) return null;
  const label = (mode: BrowserClaimMode) => t(`browser.claim.mode.${mode}`);
  const mode = view?.mode ?? DEFAULT_BROWSER_CLAIM_MODE;
  return <Section source="local"><SettingRow label={t("browser.claim.mode")} hint={<>
    {t("browser.claim.modeHint")}
    <span className="block">{t("browser.claim.localHint")}</span>
    {mode === "always" && <span role="alert" data-browser-claim-always-warning className="block text-warn">{t("browser.claim.alwaysWarn")}</span>}
    {!available && <span className="block">{t("browser.host.unavailable")}</span>}
    {failed && <span role="alert" className="block text-danger">{t(failed)}</span>}
  </>} reset={<ResetButton disabled={!available || busy || !view?.stored} onClick={() => void request(null)} title={t("browser.claim.reset")} />}>
    <Select<BrowserClaimMode> value={mode} label={t("browser.claim.mode")} disabled={!available || busy || view === null}
      options={BROWSER_CLAIM_MODES.map(value => ({ value, label: value === DEFAULT_BROWSER_CLAIM_MODE ? t("browser.claim.modeDefault", { mode: label(value) }) : label(value) }))}
      onChange={next => { if (!busy && view !== null) void request(next); }} />
  </SettingRow></Section>;
}
