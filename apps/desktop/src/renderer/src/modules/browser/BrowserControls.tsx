import { useEffect, useRef, useState } from "react";
import { Hand, RotateCw, Square } from "lucide-react";
import type { BrowserAgentView } from "../../../../shared/browser";
import { bridge } from "../../bridge";
import { useI18n } from "../../i18n";
import { confirmDialog } from "../../lib/contextMenu";
import { browserErrorKey } from "./browserState";
import { browserActivation } from "./activation";
import { rememberGrant } from "./agentPicker";
import { BrowserAgentPicker } from "./BrowserAgentPicker";
import { browserCache } from "./browserCache";
import { BrowserOwnerController, type BrowserOwnerScope } from "./browserOwnerUi";
import { useBrowserControlSettings } from "./controlSettings";
import { afterBrowserHostsDelivered, browserHostCurrent, useBrowserHostEpoch } from "./hosts";
import { useBrowserEnabled, useBrowserView } from "./tabs";

interface ControlProps { hostId: string | null; tabKey: string }
const BUTTON = "shrink-0 rounded-md px-2 py-1 text-xs text-foreground enabled:hover:bg-hover disabled:opacity-40";
const controller = new BrowserOwnerController({
  snapshot: scope => ({ enabled: browserActivation.get(), epoch: browserHostCurrent(scope.hostId, scope.epoch) ? scope.epoch : null,
    view: browserCache.get(scope.hostId, scope.tabKey) }),
  api: hostId => {
    if (!bridge.browser) throw new Error("browser_unavailable");
    return bridge.browser.forHost(hostId);
  }, afterHostsDelivered: afterBrowserHostsDelivered,
});

function useControl({ hostId, tabKey }: ControlProps) {
  const { t } = useI18n();
  const view = useBrowserView(hostId, tabKey);
  const epoch = useBrowserHostEpoch(hostId);
  const enabled = useBrowserEnabled();
  const [settings] = useBrowserControlSettings();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<ReturnType<typeof browserErrorKey> | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    generation.current++; setPending(false); setFailed(null);
    return () => { generation.current++; if (hostId) controller.cancel({ hostId, tabKey }); };
  }, [hostId, tabKey, epoch, view?.guestId]);
  const scope: BrowserOwnerScope | null = hostId && epoch ? { hostId, tabKey, epoch } : null;
  const confirm = (resume: boolean) => (name: string, pool: "owner" | "agent") => confirmDialog(
    t(pool === "agent" ? "browser.owner.confirmAgent" : "browser.owner.confirmOwner", { name }), false,
    { ok: t(resume ? "browser.owner.resume" : "browser.owner.grant"), cancel: t("browser.cancelControl") });
  async function run(action: () => Promise<unknown>) {
    if (pending) return;
    const token = ++generation.current;
    setPending(true); setFailed(null);
    try { await action(); } catch (reason) { if (generation.current === token) setFailed(browserErrorKey(reason)); }
    finally { if (generation.current === token) setPending(false); }
  }
  const grant = (agent: BrowserAgentView) => scope ? run(async () => {
    if (await controller.grant(scope, agent, settings, confirm(false))) rememberGrant(scope.hostId, agent.sessionId);
  }) : Promise.resolve();
  const resume = () => scope ? run(() => controller.resume(scope, settings, confirm(true))) : Promise.resolve();
  // Revoke cancels pending confirmation in either header or banner, without waiting behind it.
  async function revoke() {
    if (!hostId || !view?.lease) return;
    const token = ++generation.current; setPending(false); setFailed(null);
    try { await controller.revoke(hostId, tabKey, view.lease.leaseId); } catch (reason) { if (generation.current === token) setFailed(browserErrorKey(reason)); }
  }
  return { t, view, scope, grant, resume, revoke, failed, pending,
    canGrant: enabled && !!scope && view?.status === "attached" && !pending };
}

function Header({ hostId, tabKey }: ControlProps) {
  const { t, view, scope, grant, resume, revoke, failed, pending, canGrant } = useControl({ hostId, tabKey });
  const [agents, setAgents] = useState<BrowserAgentView[]>([]), [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(false), [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState<ReturnType<typeof browserErrorKey> | null>(null);
  const readGeneration = useRef(0);
  useEffect(() => () => { readGeneration.current++; }, []);
  if (!view || !hostId || !bridge.browser) return null;
  async function loadAgents() {
    if (!scope || loading || !canGrant || view?.lease) return;
    const token = ++readGeneration.current; setLoading(true); setLoadFailed(null);
    try {
      const values = await controller.agents(scope);
      if (readGeneration.current !== token) return;
      setAgents(values); setLoaded(true); setSelected(previous => values.some(agent => agent.sessionId === previous) ? previous : "");
    } catch (reason) { if (readGeneration.current === token) { setAgents([]); setLoadFailed(browserErrorKey(reason)); setSelected(""); } }
    finally { if (readGeneration.current === token) setLoading(false); }
  }
  const agent = agents.find(candidate => candidate.sessionId === selected);
  return <>
    {(failed || loadFailed) && <span role="alert" className="max-w-40 truncate text-xs text-danger" title={t(failed ?? loadFailed!)}>{t(failed ?? loadFailed!)}</span>}
    {view.lease ? <>
      {view.lease.state === "active" && view.control?.state === "paused" && <button type="button" data-browser-resume className={BUTTON} disabled={!canGrant}
        onClick={() => void resume()}>{t("browser.owner.resume")}</button>}
      <button type="button" data-browser-revoke className={BUTTON} aria-label={t("browser.owner.revoke")}
        title={t("browser.owner.revoke")} onClick={() => void revoke()}><Square size={12} /></button>
    </> : <>
      <BrowserAgentPicker hostId={hostId} agents={agents} selected={selected} onSelect={setSelected} onOpen={() => void loadAgents()} loading={loading}
        disabled={!canGrant || !!view.control} placeholder={t(loading ? "browser.owner.loadingAgents" : loaded && !agents.length ? "browser.owner.noAgents" : "browser.owner.select")} />
      <button type="button" className={BUTTON} disabled={!canGrant || loading || !!view.control} onClick={() => void loadAgents()}
        title={t("browser.owner.loadAgents")} aria-label={t("browser.owner.loadAgents")}><RotateCw size={12} /></button>
      <button type="button" data-browser-grant-agent className={BUTTON} aria-label={t("browser.owner.grant")} title={t("browser.owner.grant")}
        disabled={!canGrant || !agent || pending || !!view.control} onClick={() => agent && void grant(agent)}><Hand size={13} /></button>
    </>}
  </>;
}

export function BrowserControlHeader(props: ControlProps) {
  const epoch = useBrowserHostEpoch(props.hostId), view = useBrowserView(props.hostId, props.tabKey);
  return <Header key={`${props.hostId}\0${epoch}\0${props.tabKey}\0${view?.guestId}`} {...props} />;
}

export function BrowserControlBanner(props: ControlProps) {
  const { t, view, resume, revoke, failed, canGrant } = useControl(props);
  if (!view?.lease) return null;
  const state = view.lease.state === "pending" ? "pending" : view.control?.state === "paused" ? "paused" : view.control?.operating ? "operating" : "granted";
  return <div data-browser-control={view.control?.state ?? view.lease.state} className="shrink-0 border-b border-border bg-hover px-3 py-2 text-xs">
    <div className="flex flex-wrap items-center gap-2">
      <span role="status" className="min-w-0 flex-1 text-foreground">{t(`browser.owner.${state}`, { name: view.lease.agentName })}
        {view.lease.auto && <span data-browser-auto-grant={view.lease.auto} className="ml-2 text-subtle">{t("browser.claim.auto", { reason: t(`browser.claim.reason.${view.lease.auto}`) })}</span>}</span>
      {state === "paused" && <button type="button" data-browser-resume className={BUTTON} disabled={!canGrant} onClick={() => void resume()}>{t("browser.owner.resume")}</button>}
      <button type="button" data-browser-revoke className={BUTTON} onClick={() => void revoke()}>{t("browser.owner.revoke")}</button>
    </div>
    <p className="mt-1 text-subtle">{t(view.pool === "agent" ? "browser.owner.loginAgent" : "browser.owner.loginOwner")}</p>
    {failed && <p role="alert" className="mt-1 text-danger">{t(failed)}</p>}
  </div>;
}
