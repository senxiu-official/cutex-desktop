import { useEffect, useRef, useState } from "react";
import { bridge } from "../../bridge";
import { Section, Select, SettingRow } from "../../components/settings/Form";
import { useI18n } from "../../i18n";
import { useTargetFeatures, useTargetHostId } from "../../lib/targetHost";
import { afterBrowserHostsDelivered, browserHostCurrent, useBrowserHostEpoch } from "./hosts";
import { useBrowserEnabled } from "./tabs";
import { browserErrorKey } from "./browserState";

/** Settings are explicitly scoped to the Settings page's host, never an agent selection. */
function useHostSetting() {
  const hostId = useTargetHostId(), epoch = useBrowserHostEpoch(hostId);
  const enabled = useBrowserEnabled(), supported = useTargetFeatures().has("browser-relay-v1");
  const [value, setValue] = useState<"off" | "ask" | null>(null), [busy, setBusy] = useState(false), [failed, setFailed] = useState<ReturnType<typeof browserErrorKey> | null>(null);
  const generation = useRef(0);
  const available = enabled && supported && !!epoch && !!bridge.browser;
  async function request(next?: "off" | "ask") {
    if (!available || !epoch || !bridge.browser) return;
    const token = ++generation.current;
    setBusy(true); setFailed(null);
    try {
      await afterBrowserHostsDelivered();
      if (token !== generation.current || !browserHostCurrent(hostId, epoch)) return;
      const result = await bridge.browser.forHost(hostId).settings(next);
      if (token === generation.current && browserHostCurrent(hostId, epoch)) setValue(result.agentOpenApproval);
    } catch (error) { if (token === generation.current) { setFailed(browserErrorKey(error)); setValue(null); } }
    finally { if (token === generation.current) setBusy(false); }
  }
  useEffect(() => {
    ++generation.current; setValue(null); setFailed(null); setBusy(false);
    if (available) void request();
    return () => { ++generation.current; };
  }, [hostId, epoch, available]);
  return { value, busy, failed, available, save: (next: "off" | "ask") => { if (!busy && value !== null) void request(next); } };
}

export function BrowserHostSettings() {
  const { t } = useI18n(), state = useHostSetting();
  const hostId = useTargetHostId();
  const canClear = useTargetFeatures().has("browser-idempotency-clear");
  // cutex browser-open-full-access (r236): an {{agent}} running with full access opens pages without
  // approval even under 每次审批 (claiming an owner tab still asks).
  const fullAccessOpens = useTargetFeatures().has("browser-open-full-access");
  const [agents, setAgents] = useState<{ sessionId: string; name: string }[]>([]);
  const [clearTarget, setClearTarget] = useState("all"), [confirming, setConfirming] = useState(false);
  const [clearing, setClearing] = useState(false), [cleared, setCleared] = useState<{ outcomeUnknown: number; abandonedForwarded: number } | null>(null);
  const [clearFailed, setClearFailed] = useState<ReturnType<typeof browserErrorKey> | null>(null);
  useEffect(() => {
    let live = true;
    if (state.available && canClear && bridge.browser) void bridge.browser.forHost(hostId).agents().then(items => { if (live) setAgents(items); }).catch(() => { if (live) setAgents([]); });
    return () => { live = false; };
  }, [hostId, state.available, canClear]);
  async function clear() {
    if (!bridge.browser || clearing) return;
    setClearing(true); setCleared(null); setClearFailed(null);
    try {
      const result = await bridge.browser.forHost(hostId).clearIdempotency(clearTarget === "all" ? undefined : clearTarget);
      setCleared({ outcomeUnknown: result.outcomeUnknown, abandonedForwarded: result.abandonedForwarded }); setConfirming(false);
    } catch (error) {
      setClearFailed(browserErrorKey(error)); setConfirming(false);
    } finally { setClearing(false); }
  }
  return <Section source="host" title={t("browser.host.settings")}>
    <SettingRow label={t("browser.host.approval")} hint={t(fullAccessOpens ? "browser.host.approvalHint3" : "browser.host.approvalHint2")}>
      <Select value={state.value ?? "off"} disabled={!state.available || state.busy || state.value === null}
        options={[{ value: "off", label: t("browser.host.off") }, { value: "ask", label: t(fullAccessOpens ? "browser.host.askFull" : "browser.host.ask") }]}
        onChange={state.save} label={t("browser.host.approval")} />
    </SettingRow>
    {canClear && <SettingRow label={t("browser.idempotency.clear")} hint={t("browser.idempotency.clearHint")}>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Select value={clearTarget} disabled={!state.available || clearing}
          options={[{ value: "all", label: t("browser.idempotency.all") }, ...agents.map(agent => ({ value: agent.sessionId, label: agent.name }))]}
          onChange={value => { setClearTarget(value); setConfirming(false); setCleared(null); setClearFailed(null); }} label={t("browser.idempotency.target")} />
        <button type="button" disabled={!state.available || clearing} onClick={() => setConfirming(true)}
          className="rounded-md border border-danger/40 px-3 py-1.5 text-xs text-danger disabled:opacity-40">{t("browser.idempotency.clear")}</button>
      </div>
    </SettingRow>}
    {canClear && confirming && <div className="rounded-lg border border-danger/30 bg-danger/5 p-3 text-xs">
      <p>{t("browser.idempotency.confirm")}</p>
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" onClick={() => setConfirming(false)} className="rounded-md px-3 py-1.5">{t("browser.idempotency.cancel")}</button>
        <button type="button" disabled={clearing} onClick={() => void clear()} className="rounded-md bg-danger px-3 py-1.5 text-white disabled:opacity-40">{t("browser.idempotency.confirmAction")}</button>
      </div>
    </div>}
    {canClear && cleared && <p role="status" className="py-2 text-xs text-subtle">{t("browser.idempotency.done", cleared)}</p>}
    {canClear && clearFailed && <p role="alert" className="py-2 text-xs text-danger">{t(clearFailed)}</p>}
    {!state.available && <p className="py-2 text-xs text-subtle">{t("browser.host.unavailable")}</p>}
    {state.failed && <p role="alert" className="py-2 text-xs text-danger">{t(state.failed)}</p>}
  </Section>;
}
