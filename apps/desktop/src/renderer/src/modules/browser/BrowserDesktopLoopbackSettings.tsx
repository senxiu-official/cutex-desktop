import { useEffect, useRef, useState } from "react";
import { bridge } from "../../bridge";
import { Section, SettingRow, Toggle } from "../../components/settings/Form";
import { useI18n } from "../../i18n";
import { useTargetHostId } from "../../lib/targetHost";
import { useApp } from "../../store";
import { afterBrowserHostsDelivered, browserHostCurrent, useBrowserHostEpoch } from "./hosts";
import { useBrowserEnabled } from "./tabs";
import { browserErrorKey } from "./browserState";

export function BrowserDesktopLoopbackSettings() {
  const { t } = useI18n();
  const hostId = useTargetHostId(), epoch = useBrowserHostEpoch(hostId);
  const kind = useApp(state => state.hosts?.hosts.find(host => host.id === hostId)?.kind);
  const enabled = useBrowserEnabled(), available = enabled && !!epoch && !!bridge.browser && kind === "ssh";
  const [value, setValue] = useState<boolean | null>(null), [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<ReturnType<typeof browserErrorKey> | null>(null);
  const generation = useRef(0);
  async function request(next?: boolean) {
    if (!available || !epoch || !bridge.browser) return;
    const token = ++generation.current;
    setBusy(true); setFailed(null);
    try {
      await afterBrowserHostsDelivered();
      if (token !== generation.current || !browserHostCurrent(hostId, epoch)) return;
      const result = await bridge.browser.forHost(hostId).desktopLoopback(next);
      if (token === generation.current && browserHostCurrent(hostId, epoch)) setValue(result.enabled);
    } catch (error) { if (token === generation.current) { setFailed(browserErrorKey(error)); setValue(null); } }
    finally { if (token === generation.current) setBusy(false); }
  }
  useEffect(() => {
    ++generation.current; setValue(null); setFailed(null); setBusy(false);
    if (available) void request();
    return () => { ++generation.current; };
  }, [hostId, epoch, available]);
  if (kind !== "ssh") return null;
  return <Section title={t("browser.desktopLoopback.title")} hint={t("browser.desktopLoopback.hint")}>
    <SettingRow agents="none" source="local" label={t("browser.desktopLoopback.label")}>
      <span data-browser-desktop-loopback><Toggle checked={value ?? false} disabled={!available || busy || value === null}
        label={t("browser.desktopLoopback.label")} onChange={next => { if (!busy && value !== null) void request(next); }} /></span>
    </SettingRow>
    {!available && <p className="py-2 text-xs text-subtle">{t("browser.host.unavailable")}</p>}
    {failed && <p role="alert" className="py-2 text-xs text-danger">{t(failed)}</p>}
  </Section>;
}
