// The browser card's Maid 行 (owner plan A, 2026-11-05; docs/GLOSSARY.md 浏览器): the middle of the card's three rows
// (标签行 · Maid 行 · 地址行). Left: a service tab's link to its agent (ServicePaneLink, passed in). Right of it: who
// controls the page — 「由你操作 · 交给 Maid ▾」 (pick an agent, then the grant confirmation) or the grantee with 暂停 /
// 继续 and 收回 always in view. The row is always there and always the same height: a grant, a pause or an error never
// moves the page. What the old control banner said in full (state, the login note, co-control) sits behind ⓘ;
// an owner-pool grant keeps 「沿用你的登录」 in the row itself (AGENTS.md: the grant UI says the tab keeps the logins).
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Hand, Info, Pause, Play } from "lucide-react";
import type { BrowserAgentView } from "../../../../shared/browser";
import { bridge } from "../../bridge";
import { useI18n } from "../../i18n";
import { confirmDialog } from "../../lib/contextMenu";
import { useTrackOverlay } from "../../lib/openOverlays";
import { useOwnerWindow } from "../../lib/ownerContext";
import { dataFlags, useSizeFlags, widthBelow } from "../../lib/sizeFlags";
import { sidebarOf, useApp } from "../../store";
import { Avatar } from "../../components/Avatar";
import { btn } from "../../components/Button";
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
  const confirm = (name: string, pool: "owner" | "agent") => confirmDialog(
    t(pool === "agent" ? "browser.owner.confirmAgent" : "browser.owner.confirmOwner", { name }), false,
    { ok: t("browser.owner.grant"), cancel: t("browser.cancelControl") });
  async function run(action: () => Promise<unknown>) {
    if (pending) return;
    const token = ++generation.current;
    setPending(true); setFailed(null);
    try { await action(); } catch (reason) { if (generation.current === token) setFailed(browserErrorKey(reason)); }
    finally { if (generation.current === token) setPending(false); }
  }
  const grant = (agent: BrowserAgentView) => scope ? run(async () => {
    if (await controller.grant(scope, agent, settings, confirm)) rememberGrant(scope.hostId, agent.sessionId);
  }) : Promise.resolve();
  // Same agent, same lease: one click, no second confirmation.
  const resume = () => scope ? run(() => controller.resume(scope, settings)) : Promise.resolve();
  const pause = () => hostId && view?.lease ? run(() => controller.pause(hostId, tabKey, view.lease!.leaseId)) : Promise.resolve();
  // Revoke cancels a pending confirmation, without waiting behind it.
  async function revoke() {
    if (!hostId || !view?.lease) return;
    const token = ++generation.current; setPending(false); setFailed(null);
    try { await controller.revoke(hostId, tabKey, view.lease.leaseId); } catch (reason) { if (generation.current === token) setFailed(browserErrorKey(reason)); }
  }
  return { t, view, scope, grant, resume, pause, revoke, failed, pending,
    canGrant: enabled && !!scope && view?.status === "attached" && !view?.desktopLoopback && !pending };
}

/** Below these card widths the row drops its quiet words first (「由你操作」, then the login label's text). */
const FLAGS = { compact: widthBelow(30), tight: widthBelow(22) };
const ACTION = `${btn({ size: "sm" })} max-w-full`;

function Row({ hostId, tabKey, link }: ControlProps & { link?: ReactNode }) {
  const { t, view, scope, grant, resume, pause, revoke, failed, canGrant } = useControl({ hostId, tabKey });
  const [ref, flags] = useSizeFlags(FLAGS);
  const [agents, setAgents] = useState<BrowserAgentView[]>([]);
  const [loading, setLoading] = useState(false), [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState<ReturnType<typeof browserErrorKey> | null>(null);
  const readGeneration = useRef(0);
  useEffect(() => () => { readGeneration.current++; }, []);
  const lease = view?.lease;
  const sidebar = useApp(s => (hostId ? sidebarOf(s, hostId) : null));
  const grantee = lease ? (sidebar?.active.find(r => r.cutexSessionId === lease.sessionId) ?? sidebar?.retired.find(r => r.cutexSessionId === lease.sessionId)) : undefined;
  // The list is read when the picker opens; a failed read shows its reason there, with 重试 (no reload arrow in the row).
  async function loadAgents() {
    if (!scope || loading || !canGrant || view?.lease) return;
    const token = ++readGeneration.current; setLoading(true); setLoadFailed(null);
    try {
      const values = await controller.agents(scope);
      if (readGeneration.current !== token) return;
      setAgents(values); setLoaded(true);
    } catch (reason) { if (readGeneration.current === token) { setAgents([]); setLoaded(true); setLoadFailed(browserErrorKey(reason)); } }
    finally { if (readGeneration.current === token) setLoading(false); }
  }
  const state = !lease ? null : lease.state === "pending" ? "pending" : view?.control?.state === "paused" ? "paused" : view?.control?.operating ? "operating" : "granted";
  const live = state === "granted" || state === "operating";
  return <div ref={ref} {...dataFlags(flags)} data-browser-maid-row="" data-browser-control={view?.control?.state ?? lease?.state ?? "none"}
    className="flex h-9 shrink-0 items-center gap-1.5 overflow-hidden border-b border-border px-2 text-meta">
    {link && <>{link}<span aria-hidden className="h-4 w-px shrink-0 bg-border" /></>}
    {!lease || !state ? <>
      {view?.desktopLoopback ? <span role="status" className="min-w-0 truncate text-subtle" title={t("browser.desktopLoopback.noAgent")}>{t("browser.desktopLoopback.noAgent")}</span> : <>
        {!flags.compact && <span className="shrink-0 text-subtle" data-browser-by-you="">{t("browser.maid.byYou")}</span>}
        <BrowserAgentPicker hostId={hostId ?? ""} agents={agents} selected="" onSelect={id => { const agent = agents.find(a => a.sessionId === id); if (agent) void grant(agent); }}
          onOpen={() => void loadAgents()} loading={loading} error={loadFailed ? t(loadFailed) : undefined} look="grant" title={t("browser.maid.handOverTip")}
          disabled={!canGrant || !!view?.control || !hostId} placeholder={t(loading ? "browser.owner.loadingAgents" : loaded && !agents.length ? "browser.owner.noAgents" : "browser.owner.select")}
          label={t("browser.maid.handOver")} />
      </>}
    </> : <>
      <span role="status" data-browser-control-state={state} title={t(`browser.owner.${state}`, { name: lease.agentName })}
        className={`flex min-w-0 shrink items-center gap-1.5 ${live ? "text-foreground" : "text-muted"}`}>
        {grantee ? <Avatar name={grantee.displayName} avatar={grantee.avatar} seed={grantee.cutexSessionId} size={16} /> : <Hand size={13} className="shrink-0 text-subtle" aria-hidden />}
        {state === "operating" && <span aria-hidden className="size-1.5 shrink-0 animate-pulse rounded-full bg-accent" />}
        <span className="min-w-0 truncate font-medium">{t(`browser.maid.${state}`, { name: lease.agentName })}</span>
      </span>
      {/* Main granted it without the owner's click: say so in the row, not only behind ⓘ. */}
      {lease.auto && !flags.compact && <span data-browser-auto-grant={lease.auto} className="min-w-0 shrink-[2] truncate text-subtle"
        title={t("browser.claim.auto", { reason: t(`browser.claim.reason.${lease.auto}`) })}>{t("browser.claim.auto", { reason: t(`browser.claim.reason.${lease.auto}`) })}</span>}
      {state === "paused" && <button type="button" data-browser-resume className={ACTION} disabled={!canGrant} title={t("browser.owner.resume")} onClick={() => void resume()}>
        <Play size={12} aria-hidden />{!flags.tight && t("browser.owner.resume")}</button>}
      {live && <button type="button" data-browser-pause className={ACTION} title={t("browser.owner.pause")} aria-label={t("browser.owner.pause")} onClick={() => void pause()}>
        <Pause size={12} aria-hidden />{!flags.tight && t("browser.maid.pause")}</button>}
      <button type="button" data-browser-revoke className={ACTION} title={t("browser.owner.revoke")} aria-label={t("browser.owner.revoke")} onClick={() => void revoke()}>
        {t("browser.maid.revoke")}</button>
    </>}
    <span className="min-w-0 flex-1" />
    {failed && <span role="alert" className="min-w-0 max-w-48 truncate text-danger" title={t(failed)}>{t(failed)}</span>}
    {lease && state && <Details label={view?.pool !== "agent" && !flags.tight ? t("browser.maid.ownerLogins") : null} hint={t(view?.pool === "agent" ? "browser.owner.loginAgent" : "browser.owner.loginOwner")}>
      <p className="mb-2 font-medium text-foreground">{t(`browser.owner.${state}`, { name: lease.agentName })}
        {lease.auto && <span className="ml-1.5 font-normal text-subtle">{t("browser.claim.auto", { reason: t(`browser.claim.reason.${lease.auto}`) })}</span>}</p>
      <p data-browser-login-note={view?.pool === "agent" ? "agent" : "owner"} className="leading-relaxed">{t(view?.pool === "agent" ? "browser.owner.loginAgent" : "browser.owner.loginOwner")}</p>
      {live && <p data-browser-cocontrol className="mt-2 leading-relaxed">{t("browser.ownerCapture")}</p>}
      {failed && <p role="alert" className="mt-2 text-danger">{t(failed)}</p>}
    </Details>}
  </div>;
}

/** ⓘ (and, for an owner-pool grant, 「沿用你的登录」): the grant's details, opened deliberately. */
function Details({ label, hint, children }: { label: string | null; hint: string; children: ReactNode }) {
  const win = useOwnerWindow();
  const { t } = useI18n();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState({ top: 0, left: 8 });
  const trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  useTrackOverlay(open);
  useLayoutEffect(() => {
    if (!open) return;
    const rect = trigger.current?.getBoundingClientRect();
    if (rect) setPlace({ top: Math.max(8, Math.min(rect.bottom + 6, win.innerHeight - (panel.current?.offsetHeight ?? 0) - 8)),
      left: Math.max(8, Math.min(rect.right - 304, win.innerWidth - 312)) });
  }, [open, win]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !panel.current?.contains(target)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus();
    };
    const close = () => setOpen(false);
    win.document.addEventListener("pointerdown", outside);
    win.addEventListener("keydown", key, true);
    win.addEventListener("resize", close);
    win.addEventListener("blur", close);
    return () => {
      win.document.removeEventListener("pointerdown", outside);
      win.removeEventListener("keydown", key, true); win.removeEventListener("resize", close); win.removeEventListener("blur", close);
    };
  }, [open, win]);
  return <>
    <button ref={trigger} type="button" data-browser-control-details="" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
      data-tip={hint} aria-label={label ? `${label} · ${t("browser.maid.details")}` : t("browser.maid.details")} onClick={() => setOpen(value => !value)}
      className={`flex h-6 min-w-0 shrink-0 items-center gap-1 rounded-ctl px-1.5 text-caption hover:bg-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent ${label ? "bg-surface-2 text-muted" : "text-subtle"} ${open ? "bg-hover" : ""}`}>
      {label && <span className="truncate" data-browser-owner-logins="">{label}</span>}<Info size={13} aria-hidden className="shrink-0" />
    </button>
    {open && createPortal(<div ref={panel} id={id} role="dialog" aria-modal="false" aria-label={t("browser.maid.details")} data-popover="" data-browser-control-panel="" style={place}
      className="float fixed z-[160] max-h-[calc(100vh-16px)] w-76 max-w-[calc(100vw-16px)] overflow-y-auto p-3 text-meta text-muted">
      {children}
    </div>, win.document.body)}
  </>;
}

/** The card's Maid 行; remounted per host connection, tab and guest so no state crosses pages. */
export function BrowserMaidRow(props: ControlProps & { link?: ReactNode }) {
  const epoch = useBrowserHostEpoch(props.hostId), view = useBrowserView(props.hostId, props.tabKey);
  return <Row key={`${props.hostId}\0${epoch}\0${props.tabKey}\0${view?.guestId}`} {...props} />;
}
