// One browser_claim, as the owner decides it: in the requesting agent's conversation (card) and on the
// 审批 page. 允许 / 本次运行内一直允许 = the exact owner-tab selection (main also remembers the origin
// for this agent until restart, only after cutex consumed the claim); with no open tab, a local page
// can be opened and handed over in one click. Main enforces everything; this only displays and sends.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Globe } from "lucide-react";
import type { ApprovalRecord, ServiceView } from "../../../../shared/ipc";
import { browserActivation, browserOwnerErrorKey, DEFAULT_BROWSER_CONTROL_SETTINGS, normalizeBrowserControlSettings, type BrowserTabView } from "../../../../shared/browser";
import { browserClaimOpenTarget, browserClaimOrigin, pickBrowserClaimTab } from "../../../../shared/browserClaim";
import { hostEpoch } from "../../../../shared/hosts";
import { bridge } from "../../bridge";
import { useI18n } from "../../i18n";
import { confirmDialog } from "../../lib/contextMenu";
import { openHostAgent } from "../../lib/hostLists";
import { useApp } from "../../store";
import { useModulePref } from "../react";
import type { Json } from "../types";
import { BrowserClaimController, browserClaimApproval, browserClaimTabDisplay, type BrowserClaimScope } from "./browserClaimUi";
import { ApprovalSource } from "../../components/ApprovalSource";

const BUTTON = "shrink-0 rounded-md border border-border px-2.5 py-1 text-xs text-foreground enabled:hover:bg-hover disabled:opacity-40";
const PRIMARY = "shrink-0 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40";
const DEFAULT_CONTROL_PREF: Json = { hiddenTarget: DEFAULT_BROWSER_CONTROL_SETTINGS.hiddenTarget,
  viewport: { ...DEFAULT_BROWSER_CONTROL_SETTINGS.viewport }, idleDetachSeconds: DEFAULT_BROWSER_CONTROL_SETTINGS.idleDetachSeconds };
// The browser preview has no browser bridge: show the card with an inert sample tab.
const PREVIEW_TABS: BrowserTabView[] = [{ guestId: "preview-guest", tabKey: "00000000-0000-4000-8000-000000000000", hostId: "", pageGeneration: 1,
  url: "https://mail.example.com/inbox", title: "收件箱 - Mail", loading: false, canGoBack: false, canGoForward: false, status: "attached", pool: "owner" },
  { guestId: "preview-guest-2", tabKey: "00000000-0000-4000-8000-000000000001", hostId: "", pageGeneration: 1,
    url: "cutex:service/yemao/", title: "夜猫望月", loading: false, canGoBack: false, canGoForward: false, status: "attached", pool: "agent" }];

export interface BrowserClaimPanelProps {
  hostId: string;
  approval: ApprovalRecord;
  /** The agent's own cutex services on this host (matched when the claim has no urlHint). */
  services?: readonly ServiceView[] | null;
  variant: "card" | "page";
  disabled?: boolean;
  onBusy?(busy: boolean): void;
}

export function BrowserClaimPanel(props: BrowserClaimPanelProps) {
  const { t } = useI18n();
  const preview = !bridge.browser && import.meta.env.DEV;
  const epoch = useApp(state => hostEpoch(state.hosts, props.hostId));
  const enabled = useSyncExternalStore(browserActivation.subscribe, browserActivation.get, browserActivation.get) || preview;
  const [controlPref] = useModulePref<Json>("browser", "control", DEFAULT_CONTROL_PREF);
  const settings = normalizeBrowserControlSettings(controlPref);
  const details = browserClaimApproval(props.approval, props.hostId);
  const latest = useRef({ ...props, enabled }); latest.current = { ...props, enabled };
  const controllerRef = useRef<BrowserClaimController | null>(null);
  controllerRef.current ??= new BrowserClaimController({
    current: scope => ({ enabled: latest.current.enabled && !latest.current.disabled,
      epoch: hostEpoch(useApp.getState().hosts, scope.hostId) === scope.epoch ? scope.epoch : null,
      approval: latest.current.hostId === scope.hostId ? latest.current.approval : undefined }),
    browser: hostId => { if (!bridge.browser) throw Error("browser_unavailable"); return bridge.browser.forHost(hostId); },
    approvals: hostId => { if (!bridge.apiFor) throw Error("browser_unavailable"); return bridge.apiFor(hostId).approvals("pending"); },
    afterHostsDelivered: () => new Promise(resolve => queueMicrotask(resolve)),
  });
  const controller = controllerRef.current;
  const owned = useMemo(() => (props.services ?? []).filter(service => service.ownerCutexSessionId === props.approval.requesterCutexSessionId).map(service => service.slug),
    [props.services, props.approval.requesterCutexSessionId]);
  const [tabs, setTabs] = useState<BrowserTabView[]>(preview ? PREVIEW_TABS : []);
  const [selected, setSelected] = useState(""), [busy, setBusy] = useState<"allow" | "session" | "open" | "deny" | null>(null);
  const [done, setDone] = useState(false), [failed, setFailed] = useState<string | null>(null);
  const generation = useRef(0);
  const allowed = enabled && !!epoch && !props.disabled && !!details && props.approval.state === "pending" && !preview;
  const scope: BrowserClaimScope | null = epoch ? { hostId: props.hostId, epoch, approval: props.approval } : null;

  async function load() {
    if (!allowed || !scope) return;
    const token = ++generation.current;
    try {
      const result = await controller.tabs(scope);
      if (generation.current !== token) return;
      setTabs(result);
      setSelected(previous => result.some(tab => tab.guestId === previous) ? previous : pickBrowserClaimTab(result, details?.urlHint, owned)?.guestId ?? result[0]?.guestId ?? "");
    } catch { if (generation.current === token) setTabs([]); }
  }
  useEffect(() => {
    setDone(false); setFailed(null); setBusy(null);
    if (preview) { setSelected((pickBrowserClaimTab(PREVIEW_TABS, details?.urlHint, owned) ?? PREVIEW_TABS[0]!).guestId); return; }
    void load();
    // Tabs attach, load and change while the card is up: follow this host's browser events.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = bridge.browser?.subscribe(event => {
      if (event.hostId !== props.hostId || timer) return;
      timer = setTimeout(() => { timer = undefined; void load(); }, 300);
    });
    return () => { generation.current++; controller.cancel(); off?.(); if (timer) clearTimeout(timer); latest.current.onBusy?.(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.hostId, props.approval.approvalId, props.approval.requestSha256, epoch, allowed, owned.join()]);

  if (!details) return null;
  const tab = tabs.find(candidate => candidate.guestId === selected);
  const display = tab ? browserClaimTabDisplay(tab) : null;
  const tabName = display ? display.title || display.url || t("approvals.browser.tab") : "";
  const openUrl = browserClaimOpenTarget(details.urlHint, owned);
  const origin = tab ? browserClaimOrigin(tab.url) : null;

  async function run(kind: "allow" | "session" | "open" | "deny") {
    if (busy || !scope) return;
    setBusy(kind); setFailed(null); props.onBusy?.(true);
    try {
      let ok = false;
      if (kind === "deny") {
        if (!bridge.apiFor) throw Error("browser_unavailable");
        const result = await bridge.apiFor(props.hostId).decideApproval(props.approval.approvalId, "deny");
        if (!result.ok) throw Object.assign(Error(result.error.code), { code: result.error.code });
        ok = true;
      } else if (kind === "open") ok = await controller.open(scope, settings);
      else if (tab) {
        // The card names the agent, the tab and the login it shares: that is the consent. The 审批
        // page keeps its confirmation dialog (it is further from the conversation).
        const confirm = props.variant === "card" ? async () => true : async (name: string, current: BrowserTabView) => {
          const shown = browserClaimTabDisplay(current);
          return confirmDialog(t("approvals.browser.confirmClaim", { name, tab: shown.title || shown.url || t("approvals.browser.tab") }), false,
            { ok: t("approvals.browser.grant"), cancel: t("approvals.browser.cancel") });
        };
        ok = await controller.grant(scope, tab, settings, confirm, { remember: kind === "session" });
      }
      if (ok && kind !== "deny") setDone(true);
    } catch (reason) { setFailed(t(browserOwnerErrorKey(reason))); }
    finally { setBusy(null); props.onBusy?.(false); }
  }

  const sessionTitle = origin ? t("approvals.claim.allowSessionHint", { name: details.agentName, origin }) : undefined;
  return <div data-browser-claim={props.approval.approvalId} className={props.variant === "card" ? "" : "mt-2 rounded-lg border border-border bg-background p-3"}>
    {props.variant === "card" && <div className="flex items-start gap-2">
      <Globe size={15} className="mt-0.5 shrink-0 text-accent" />
      <div className="min-w-0 flex-1 text-sm">
        <span className="font-medium">{tab ? t("approvals.claim.title", { name: details.agentName, tab: tabName }) : t("approvals.claim.titleNoTab", { name: details.agentName })}</span>
        {tab && <span className={tab.pool === "agent" ? "text-subtle" : "text-warn"}>{t(tab.pool === "agent" ? "approvals.claim.agentPool" : "approvals.claim.ownerLogin")}</span>}
        <p className="mt-0.5 line-clamp-2 text-xs text-subtle" title={details.reason}>{t("approvals.claim.reason", { reason: details.reason })}</p>
      </div>
      <ApprovalSource source="cutex" className="mr-5" />
    </div>}
    {props.variant === "page" && tab && <p className={`text-xs ${tab.pool === "agent" ? "text-subtle" : "text-warn"}`}>
      {t("approvals.claim.title", { name: details.agentName, tab: tabName })}{t(tab.pool === "agent" ? "approvals.claim.agentPool" : "approvals.claim.ownerLogin")}</p>}
    {!enabled && <p className="mt-2 text-xs text-subtle">{t("approvals.browser.enableModule")}</p>}
    {enabled && tabs.length > 0 && <select data-browser-claim-tab aria-label={t("approvals.claim.selectTab")} value={selected} onChange={event => setSelected(event.target.value)}
      disabled={!!busy || done} className="mt-2 w-full min-w-0 rounded-md border border-border bg-background px-2 py-1 text-xs">
      {tabs.map(candidate => { const shown = browserClaimTabDisplay(candidate);
        return <option key={candidate.guestId} value={candidate.guestId}>{shown.title || t("approvals.browser.tab")} · {shown.url || "about:blank"}{candidate.pool === "agent" ? ` · ${t("approvals.claim.agentPoolTab")}` : ""}</option>;
      })}
    </select>}
    {enabled && !tabs.length && <p className="mt-2 text-xs text-subtle">{t("approvals.claim.noTab")}{!openUrl && details.urlHint ? ` ${t("approvals.claim.openManual", { url: details.urlHint })}` : ""}</p>}
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {tabs.length > 0 && <>
        <button type="button" data-browser-claim-allow className={PRIMARY} disabled={!allowed || !tab || !!busy || done} onClick={() => void run("allow")}>
          {t(props.variant === "page" ? "approvals.claim.approve" : "approvals.claim.allow")}</button>
        <button type="button" data-browser-claim-session className={BUTTON} title={sessionTitle} disabled={!allowed || !tab || !origin || !!busy || done} onClick={() => void run("session")}>
          {t("approvals.claim.allowSession")}</button>
      </>}
      {!tabs.length && openUrl && <button type="button" data-browser-claim-open className={PRIMARY} disabled={!allowed || !!busy || done} onClick={() => void run("open")}>
        {busy === "open" ? t("approvals.claim.opening") : t("approvals.claim.open", { url: openUrl })}</button>}
      {!tabs.length && props.variant === "page" && <button type="button" className={BUTTON} onClick={() => openHostAgent(props.hostId, props.approval.requesterCutexSessionId)}>
        {t("approvals.claim.goConversation")}</button>}
      {props.variant === "card" && <button type="button" data-browser-claim-deny className={BUTTON} disabled={!!busy || done || preview} onClick={() => void run("deny")}>{t("approvals.claim.deny")}</button>}
    </div>
    {done && <p role="status" className="mt-1 text-xs text-subtle">{t("approvals.claim.granted", { name: details.agentName })}</p>}
    {failed && <p role="alert" className="mt-1 text-xs text-danger">{failed}</p>}
  </div>;
}
