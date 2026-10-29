import { isImeComposing } from "../../lib/ime";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Copy, ExternalLink, EyeOff, Globe, LoaderCircle, Monitor, MoreHorizontal, RotateCw, X } from "lucide-react";
import { openMenuFrom } from "../../lib/contextMenu";
import { usePaneHeaderCompact } from "../../lib/paneHeader";
import { bridge } from "../../bridge";
import { useI18n } from "../../i18n";
import type { SideBodyProps } from "../slots";
import { browserAddressUrl, browserError, browserErrorKey, browserExternalUrl, INVALID_ADDRESS, MAX_BROWSER_INPUT, NOT_WEB_ADDRESS, safeBrowserUrl, type BrowserState } from "./browserState";
import { guestLifecycle } from "./guestLifecycle";
import { useBrowserEnabled, useBrowserView } from "./tabs";
import { browserSitePermissionList } from "./sitePermissionText";
import { afterBrowserHostsDelivered, browserHostCurrent, useBrowserHostEpoch } from "./hosts";
import { browserActivation } from "./activation";
import { BrowserControlBanner, BrowserControlHeader } from "./BrowserControls";
import { BrowserOwnerCapture } from "./BrowserOwnerCapture";
import { createBrowserHold } from "./hold";
import { reserveNewOwnerTab } from "./newOwnerTab";
import { browserRefusalAction } from "../../../../shared/browser";
import { BrowserBackgroundView } from "./BrowserBackgroundView";
import { BROWSER_PREVIEW_BACKGROUND } from "./thumbnails";
import { ServicePaneLink } from "../../components/ServiceLinks";
import { btn } from "../../components/Button";
import { BrowserLoginPoolPill, BrowserLoginWarning } from "./BrowserLoginHint";
import { browserLoginOrigin, openOwnerLoginCopy } from "./loginHint";
import { browserCache } from "./browserCache";
import { sideOpenFrom } from "../../lib/shelfTarget";
import { BROWSER_TAB } from "./browserState";
import { useServiceStartWait, waitsForService } from "./serviceStartWait";

const BUTTON = "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-subtle enabled:hover:bg-hover enabled:hover:text-foreground disabled:opacity-35";
interface BrowserWebview extends HTMLElement { getWebContentsId(): number }

export function BrowserBody(props: SideBodyProps<BrowserState>) {
  const { t } = useI18n();
  // The resolved binding, never the sidebar's focus host or hosts.active.
  const { hostId, instance } = props;
  const epoch = useBrowserHostEpoch(hostId);
  const hostAvailable = !!hostId && !!epoch;
  const enabled = useBrowserEnabled();
  const tabKey = instance.state.tabKey;
  const view = useBrowserView(hostId, tabKey);
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const loginAlive = useRef(true);
  useEffect(() => { loginAlive.current = true; return () => { loginAlive.current = false; }; }, []);
  const requestedUrl = useRef<string | null>(null);
  // The owner's last address-bar submission, so a refusal's single fix can retry exactly it.
  const submitted = useRef<string | null>(null);
  const desktopLoopbackRetry = useRef<string | undefined>(undefined);
  const [fixNote, setFixNote] = useState<"browser.refusal.forced" | null>(null);
  const [address, setAddress] = useState(view?.url ?? instance.state.url);
  const editing = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [mountFailed, setMountFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [working, setWorking] = useState(false);
  const [captureFailed, setCaptureFailed] = useState(false);
  // A refused front hand-over remounts the background view; its reason survives that remount.
  const carriedError = useRef<string | null>(null);
  const preview = !bridge.browser && import.meta.env.DEV;
  // Preview only (`?browserBackground`, mock.ts): show the background agent-tab card instead.
  const previewBackground = preview && typeof location !== "undefined" && new URLSearchParams(location.search).has("browserBackground");
  const crashed = view?.status === "crashed";
  const invalidated = view?.status === "closed" || view?.status === "unmounted";
  const recoverable = mountFailed || crashed || invalidated;
  const currentUrl = view?.url ?? instance.state.url;
  const ready = enabled && !!bridge.browser && hostAvailable && view?.status === "attached";
  const agentPool = view ? view.pool === "agent" : !!instance.state.agentOpened;
  const loginOrigin = agentPool && ready ? browserLoginOrigin(currentUrl, view?.loginOrigin) : null;
  const loginScope = `${hostId}:${epoch}:${tabKey}:${view?.guestId}:${view?.pageGeneration}:${loginOrigin}`;
  const granted = ready && view?.control?.state === "granted";
  // Agent tabs run in main's offscreen background carrier unless the owner brought one to the front.
  const wantBackground = !!instance.state.agentOpened && !instance.state.front;
  const background = view?.carrier === "background";
  const hold = useRef<ReturnType<typeof createBrowserHold> | null>(null);
  useEffect(() => {
    if (!hostId || !epoch || !bridge.browser || !enabled) return;
    const api = bridge.browser.forHost(hostId);
    const manager = createBrowserHold({ keepMounted: value => latest.current.keepMounted(value),
      ready: (leaseId, held) => api.holdReady(tabKey, leaseId, held), revoke: leaseId => api.releaseLease(tabKey, leaseId), failed: reason => setError(browserError(reason)) });
    hold.current = manager;
    return () => { manager.dispose(); if (hold.current === manager) hold.current = null; };
  }, [hostId, epoch, tabKey, enabled]);
  useEffect(() => { hold.current?.update(view?.lease?.leaseId, props.held); }, [view?.lease?.leaseId, props.held, hostId, epoch, tabKey, enabled]);

  useEffect(() => { if (!granted) setCaptureFailed(false); }, [granted]);

  useEffect(() => {
    if (!editing.current) setAddress(currentUrl);
  }, [currentUrl]);

  useEffect(() => {
    if (!view || (view.status !== "attached" && view.status !== "crashed")) return;
    // Long live URLs may be displayed but cannot silently exceed the state / reference budget.
    const url = safeBrowserUrl(view.url) ?? "about:blank";
    const confirmed = instance.state.pendingOpen && view.confirmedOpen === instance.state.pendingOpen;
    if (url !== instance.state.url || view.title !== instance.state.title || confirmed || (view.pool === "agent" && !instance.state.agentOpened)) {
      const state = { ...instance.state, url, title: view.title, ...(view.pool === "agent" ? { agentOpened: true as const } : {}) };
      if (confirmed) delete state.pendingOpen;
      props.setState(state);
    }
  }, [view, instance.state.url, instance.state.title, props.setState]);

  useEffect(() => {
    const container = host.current;
    setWorking(false);
    setError(carriedError.current);
    carriedError.current = null;
    if (!enabled || !container || !hostId || !epoch || !bridge.browser) return;
    setMountFailed(false);
    const api = bridge.browser.forHost(hostId);
    const mountFailure = (reason: unknown) => {
      const state = latest.current.instance.state;
      // A refused front hand-over (e.g. the agent's action ran too long): main still carries the
      // page in the background. Show it there again with the reason, never close it.
      if (state.agentOpened && state.front && !state.pendingOpen) {
        carriedError.current = browserError(reason);
        guestLifecycle.keepNext(hostId, tabKey);
        const next = { ...state }; delete next.front;
        latest.current.setState(next);
        return;
      }
      setMountFailed(true); setError(browserError(reason));
      const pending = state.pendingOpen;
      if (pending) void api.openRefused(pending, "invalid_request").catch(() => {});
    };
    if (latest.current.instance.state.newOwner) {
      return reserveNewOwnerTab(api, () => browserActivation.get() && browserHostCurrent(hostId, epoch), key => {
        const state = { ...latest.current.instance.state, tabKey: key }; delete state.newOwner;
        latest.current.setState(state);
      }, mountFailure);
    }
    let element: BrowserWebview | null = null;
    let offReady = () => {};
    const url = requestedUrl.current ?? latest.current.instance.state.url;
    requestedUrl.current = null;
    const release = guestLifecycle.mount(hostId, tabKey, url, api, (mount, confirm) => {
      // Only the main-issued one-use blank reservation enters the DOM. Ordinary navigation is IPC;
      // neither metadata updates, hidden state nor card moves may replace this element or its src.
      const agentPool = mount.pool === "agent" || latest.current.instance.state.agentOpened;
      const expectedPartition = agentPool ? `persist:browser-agent-${hostId}` : `persist:browser-${hostId}`;
      // Main's background carrier: no element at all; the card shows its live thumbnail.
      if (mount.carrier === "background") {
        if (mount.tabKey !== tabKey || mount.pool !== "agent" || mount.partition !== `persist:browser-agent-${hostId}`) throw new Error("Invalid browser mount reservation");
        if (mount.recovery) setError(mount.recovery);
        return;
      }
      if (mount.tabKey !== tabKey || mount.partition !== expectedPartition || !/^about:blank#cutex-browser-attach=[a-f0-9]{64}$/.test(mount.src)) throw new Error("Invalid browser mount reservation");
      if (mount.recovery) setError(mount.recovery);
      // From the container's own document: in a desk window that desk embeds the guest (multi-window P5), so main
      // knows the tab's window (its prompts, visibility, focus) from the guest itself, never from a renderer flag.
      element = container.ownerDocument.createElement("webview") as BrowserWebview;
      element.setAttribute("partition", mount.partition);
      element.setAttribute("src", mount.src);
      element.setAttribute("aria-label", t("browser.title"));
      element.setAttribute("data-browser-guest", mount.guestId);
      element.style.cssText = "display:flex;width:100%;height:100%;min-width:0;min-height:0;";
      const guest = element;
      const onReady = () => {
        try { void confirm(guest.getWebContentsId()); }
        catch (reason) { mountFailure(reason); }
      };
      guest.addEventListener("dom-ready", onReady, { once: true });
      offReady = () => guest.removeEventListener("dom-ready", onReady);
      container.appendChild(element);
    }, mountFailure, () => browserActivation.get() && browserHostCurrent(hostId, epoch),
      latest.current.instance.state.agentOpened ? { agentOpened: true, ...(latest.current.instance.state.pendingOpen ? { pendingOpen: latest.current.instance.state.pendingOpen } : {}),
        ...(wantBackground ? { carrier: "background" as const } : {}) } : undefined, desktopLoopbackRetry.current);
    desktopLoopbackRetry.current = undefined;
    return () => {
      offReady();
      element?.remove();
      release();
    };
    // This is an instance lifetime, not a navigation/render effect. Even locale changes only affect
    // the surrounding controls. The shell's instance layer supplies stable placement and hidden LRU.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, hostId, epoch, tabKey, retry, wantBackground]);

  /** Owner: show this background agent tab in the card (main finishes the agent's running action
   * first, then reopens the page in the webview; the agent keeps its lease). */
  function toFront(): void {
    if (!hostId || !background || view?.handover) return;
    setError(null);
    guestLifecycle.keepNext(hostId, tabKey);
    props.setState({ ...instance.state, front: true });
  }
  /** Owner: hand this agent tab back to main's background carrier (same lease, page reopens there). */
  function toBackground(): void {
    if (!hostId || !bridge.browser || background || view?.pool !== "agent") return;
    void run(async () => {
      await bridge.browser!.forHost(hostId).toBackground(tabKey);
      guestLifecycle.keepNext(hostId, tabKey);
      const next = { ...latest.current.instance.state, agentOpened: true as const }; delete next.front;
      latest.current.setState(next);
    });
  }

  async function run(action: () => Promise<void>): Promise<void> {
    if (!browserActivation.get() || !browserHostCurrent(hostId, epoch)) return;
    setWorking(true);
    setError(null);
    try {
      await afterBrowserHostsDelivered();
      if (!browserActivation.get() || !browserHostCurrent(hostId, epoch)) return;
      await action();
    } catch (reason) { if (browserHostCurrent(hostId, epoch)) setError(browserError(reason)); }
    finally { if (browserHostCurrent(hostId, epoch)) setWorking(false); }
  }

  function navigate(): void {
    if (!address.trim()) return;
    setFixNote(null);
    const typed = browserAddressUrl(address);
    if ("error" in typed) { setError(typed.error); return; }
    const url = typed.url;
    if (!hostId || !epoch || !bridge.browser) return;
    submitted.current = url;
    if (recoverable) {
      requestedUrl.current = url;
      setError(null);
      setRetry((value) => value + 1);
      editing.current = false;
      return;
    }
    if (!ready) return;
    void run(() => bridge.browser!.forHost(hostId).navigate(tabKey, url));
    editing.current = false;
  }

  /** The one action that fixes this refusal; others only explain (never a misleading switch). */
  function fixRefusal(action: "enableExternal" | "allowDesktopLoopback" | "retry" | "reload"): void {
    if (!hostId || !bridge.browser) return;
    const browser = bridge.browser, retry = submitted.current;
    setFixNote(null);
    void run(async () => {
      if (action === "reload") { await browser.forHost(hostId).reload(tabKey); return; }
      if (action === "enableExternal" && !(await browser.externalPages(true)).enabled) { setFixNote("browser.refusal.forced"); return; }
      if (action === "allowDesktopLoopback") {
        const target = retry ?? currentUrl;
        const { nonce } = await browser.forHost(hostId).desktopLoopbackChallenge(tabKey, target);
        if (recoverable) {
          requestedUrl.current = target; desktopLoopbackRetry.current = nonce; setError(null); setRetry(value => value + 1);
        } else await browser.forHost(hostId).navigate(tabKey, target, { desktopLoopback: nonce });
        return;
      }
      if (retry) await browser.forHost(hostId).navigate(tabKey, retry);
      else await browser.forHost(hostId).reload(tabKey);
    });
  }

  function reload(): void {
    if (!hostAvailable) return;
    if (recoverable) { setError(null); setRetry((value) => value + 1); }
    else if (hostId && bridge.browser) void run(() => bridge.browser!.forHost(hostId).reload(tabKey));
  }

  const reason = error ?? view?.error;
  const reasonKey = reason ? browserErrorKey(reason) : null;
  const candidateFix = reason && (ready || (recoverable && reason === "remote_loopback")) ? browserRefusalAction(reason) : null;
  const fix = candidateFix === "allowDesktopLoopback" && agentPool ? null : candidateFix;
  // A service still coming up (cutex restarted, idle-stopped, starting on demand): 正在启动, reloads by itself.
  const serviceWait = useServiceStartWait(ready && waitsForService(currentUrl, reason), () => fixRefusal("reload"));
  // Address-bar text the renderer refused before asking main (never a main / policy refusal).
  const addressKey = reason === NOT_WEB_ADDRESS ? "browser.notWebAddress" : reason === INVALID_ADDRESS ? "browser.invalidUrl" : null;
  const blank = currentUrl === "about:blank" && !view?.loading;
  function loginCurrent(): boolean {
    if (!loginAlive.current || !hostId || !epoch || !view || !browserActivation.get() || !browserHostCurrent(hostId, epoch)) return false;
    const live = browserCache.get(hostId, tabKey);
    return latest.current.hostId === hostId && latest.current.instance.state.tabKey === tabKey &&
      live?.pool === "agent" && live.status === "attached" && live.guestId === view.guestId && live.pageGeneration === view.pageGeneration;
  }
  async function openOwner(): Promise<void> {
    if (!hostId || !bridge.browser) throw Error("browser_unavailable");
    const api = bridge.browser.forHost(hostId);
    await openOwnerLoginCopy({ reserve: () => api.openOwnerCopy(tabKey), close: key => api.close(key), current: loginCurrent,
      open: params => sideOpenFrom({ instanceId: instance.id }, BROWSER_TAB, params, { binding: { kind: "host", hostId }, focus: true, reveal: true }) });
  }
  async function dismissLogin(): Promise<void> {
    if (!hostId || !bridge.browser || !loginOrigin || !loginCurrent() || browserCache.get(hostId, tabKey)?.loginOrigin !== loginOrigin) throw Error("stale_browser");
    await bridge.browser.forHost(hostId).dismissLoginWarning(tabKey, loginOrigin);
  }
  return (
    <div className={`flex h-full min-h-0 flex-col bg-background${view?.control?.operating ? " ring-2 ring-inset ring-accent" : ""}`} data-browser-card data-browser-operating={view?.control?.operating || undefined} data-browser-granted={granted || undefined}
      data-browser-pool={view?.pool} data-browser-lease-state={view?.lease?.state} data-browser-session={view?.lease?.sessionId} data-browser-held={props.held || undefined}>
      <form className="flex shrink-0 items-center gap-0.5 border-b border-border p-1.5" onSubmit={(event) => { event.preventDefault(); if (!isImeComposing(event)) navigate(); }}>
        <button type="button" className={BUTTON} title={t("browser.back")} aria-label={t("browser.back")} disabled={!ready || !view?.canGoBack || working} onClick={() => hostId && void run(() => bridge.browser!.forHost(hostId).back(tabKey))}><ArrowLeft size={14} /></button>
        <button type="button" className={BUTTON} title={t("browser.forward")} aria-label={t("browser.forward")} disabled={!ready || !view?.canGoForward || working} onClick={() => hostId && void run(() => bridge.browser!.forHost(hostId).forward(tabKey))}><ArrowRight size={14} /></button>
        {view?.loading ? (
          <button type="button" className={BUTTON} title={t("browser.stop")} aria-label={t("browser.stop")} disabled={!ready} onClick={() => hostId && void run(() => bridge.browser!.forHost(hostId).stop(tabKey))}><X size={14} /></button>
        ) : (
          <button type="button" className={BUTTON} title={t("browser.reload")} aria-label={t("browser.reload")} disabled={!hostAvailable || (!ready && !recoverable) || working} onClick={reload}><RotateCw size={14} /></button>
        )}
        <span className="flex h-5 w-5 shrink-0 items-center justify-center text-subtle" aria-hidden="true">
          {view?.loading ? <LoaderCircle size={13} className="animate-spin" /> : view?.favicon ? <img src={view.favicon} alt="" width={14} height={14} referrerPolicy="no-referrer" /> : <Globe size={13} />}
        </span>
        <input value={address} onChange={(event) => setAddress(event.target.value)} onFocus={() => { editing.current = true; }} onBlur={() => { editing.current = false; }} aria-label={t("browser.address")} spellCheck={false} autoComplete="off" autoCapitalize="off" maxLength={MAX_BROWSER_INPUT} disabled={!hostAvailable || !bridge.browser} className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-subtle disabled:opacity-60" />
        {view?.desktopLoopback && <span data-browser-desktop-loopback-badge title={t("browser.desktopLoopback.badgeHint")} className="flex h-6 shrink-0 items-center gap-1 rounded-md border border-border bg-muted px-1.5 text-caption text-muted"><Monitor size={11} aria-hidden="true" />{t("browser.desktopLoopback.badge")}</span>}
        <button type="submit" disabled={!hostAvailable || (!ready && !recoverable) || working || preview} className="h-7 shrink-0 rounded-md px-2 text-xs text-muted enabled:hover:bg-hover disabled:opacity-35">{t("browser.go")}</button>
        {agentPool && <BrowserLoginPoolPill key={loginScope} disabled={!ready || working} openOwner={openOwner} />}
        {ready && view?.pool === "agent" && !background && <button type="button" className={BUTTON} data-browser-to-background title={t("browser.background.send")} aria-label={t("browser.background.send")}
          disabled={working || !!view.handover} onClick={toBackground}><EyeOff size={14} /></button>}
      </form>
      <BrowserControlBanner hostId={hostId} tabKey={tabKey} />
      {loginOrigin && <BrowserLoginWarning key={loginScope} disabled={!ready || working} openOwner={openOwner} dismiss={dismissLogin} />}
      {view?.sitePermission && <p role={view.sitePermission.state === "waiting" ? "status" : "alert"} data-browser-site-permission={view.sitePermission.state}
        className={`shrink-0 border-b border-border px-3 py-2 text-xs ${view.sitePermission.state === "waiting" ? "text-foreground" : "text-warn"}`}>
        {t(view.sitePermission.state === "waiting" ? "browser.sitePermission.waiting" : view.sitePermission.state === "hidden" ? "browser.blocked.permissionHidden" : "browser.blocked.permissionTimeout",
          { origin: view.sitePermission.origin, permissions: browserSitePermissionList(view.sitePermission.permissions) })}</p>}
      {granted && captureFailed && <p role="alert" className="shrink-0 border-b border-border px-3 py-2 text-xs text-danger">{t("browser.ownerCaptureFailed")}</p>}
      {serviceWait.state === "waiting" && <p role="status" data-browser-service-wait="" className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-xs text-subtle">
        <LoaderCircle size={13} className="shrink-0 animate-spin" />{t("browser.serviceWait.starting")}</p>}
      {reason && serviceWait.state !== "waiting" && <div role="alert" data-browser-address-error={addressKey ? reason : undefined} data-browser-refusal={addressKey ? undefined : reason}
        data-browser-service-wait={serviceWait.state === "timedOut" ? "timed-out" : undefined}
        className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-xs text-danger">
        <span className="min-w-0 flex-1 break-words">{addressKey ? t(addressKey) : serviceWait.state === "timedOut" ? t("browser.serviceWait.timedOut") : t("browser.blocked", { reason: t(reasonKey!) })}{fixNote && <span className="ml-1 text-subtle">{t(fixNote)}</span>}</span>
        {fix && <button type="button" data-browser-refusal-fix={fix} disabled={working} className={`${btn()} shrink-0`}
          onClick={() => { serviceWait.restart(); fixRefusal(fix); }}>{t(fix === "enableExternal" ? "browser.refusal.enableExternal" : fix === "allowDesktopLoopback" ? "browser.refusal.openDesktopLoopback" : fix === "reload" ? "browser.reload" : "browser.refusal.retry")}</button>}
      </div>}
      {!safeBrowserUrl(currentUrl) && <p role="status" className="shrink-0 border-b border-border px-3 py-1 text-xs text-subtle">{t("browser.longUrl")}</p>}
      <div className="relative min-h-0 flex-1">
        <div ref={host} data-browser-viewport className="absolute inset-0" style={{ visibility: !hostAvailable || crashed || invalidated ? "hidden" : "visible" }} />
        {background && hostId && <BrowserBackgroundView hostId={hostId} tabKey={tabKey} title={view?.title || currentUrl} handover={!!view?.handover}
          operating={!!view?.control?.operating} agentName={view?.lease?.agentName} onFront={toFront} />}
        {granted && !background && hostId && view && <BrowserOwnerCapture key={view.guestId} hostId={hostId} tabKey={tabKey} guestId={view.guestId} viewport={host}
          failed={() => setCaptureFailed(true)} />}
        {previewBackground && <BrowserBackgroundView hostId={BROWSER_PREVIEW_BACKGROUND.hostId} tabKey={BROWSER_PREVIEW_BACKGROUND.tabKey} title="Agent page" handover={false}
          operating agentName="Reader" onFront={() => {}} />}
        {!previewBackground && (preview || !hostAvailable || !bridge.browser || recoverable || (blank && !background)) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-xs text-subtle">
            <Globe size={24} strokeWidth={1.4} />
            <p className="max-w-sm">{preview ? t("browser.preview") : !hostAvailable ? t("browser.noHost") : !bridge.browser ? t("browser.unavailable") : crashed ? t("browser.crashed") : recoverable ? t("browser.unavailable") : t("browser.blank")}</p>
            {recoverable && hostAvailable && <button className={btn()} disabled={working} onClick={reload}>{t("browser.reload")}</button>}
          </div>
        )}
      </div>
      {hostAvailable && (view?.loading || (!view && !preview && !error && bridge.browser)) && <p role="status" className="shrink-0 border-t border-border px-3 py-1 text-xs text-subtle">{t(view?.loading ? "browser.loading" : "browser.starting")}</p>}
    </div>
  );
}

export function BrowserActions({ hostId, instance, where }: SideBodyProps<BrowserState>) {
  const { t } = useI18n();
  // The pane header is short of room for the tab titles (lib/paneHeader): 外部打开 / 复制 go into a ⋯, the agent picker narrows.
  const compact = usePaneHeaderCompact();
  const view = useBrowserView(hostId, instance.state.tabKey);
  const url = view?.url ?? instance.state.url;
  const external = browserExternalUrl(url);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  async function action(work: () => Promise<void>, copied = false): Promise<void> {
    setMessage(null);
    setFailed(false);
    try { await work(); if (copied) setMessage(t("browser.copied")); }
    catch (reason) { setFailed(true); setMessage(t("browser.actionFailed", { reason: t(browserErrorKey(reason)) })); }
  }
  return (
    <div className="flex items-center gap-0.5">
      {/* A service tab: its agent (「打开 <owner>」, or the link + 断开; lib/serviceLink). Not on a reference card. */}
      {where === "card" && <ServicePaneLink hostId={hostId} instanceId={instance.id} url={url} linked={instance.state.linked ?? null} />}
      <BrowserControlHeader hostId={hostId} tabKey={instance.state.tabKey} compact={compact} />
      {/* Main's page zoom for this tab; click resets it (the page's own Ctrl+wheel / = / − / 0 stay in the guest). */}
      {view?.zoom && view.zoom !== 1 && (
        <button type="button" data-browser-zoom="" className="flex h-6 shrink-0 items-center rounded-md border border-border bg-muted px-1.5 text-caption text-muted enabled:hover:bg-hover enabled:hover:text-foreground"
          title={t("browser.zoom.reset")} aria-label={t("browser.zoom.reset")}
          onClick={() => { if (hostId && bridge.browser) void bridge.browser.forHost(hostId).setZoom(instance.state.tabKey, "reset"); }}>
          {Math.round(view.zoom * 100)}%
        </button>
      )}
      {message && <span role={failed ? "alert" : "status"} className={`${compact ? "max-w-16" : "max-w-40"} truncate text-xs text-subtle`} title={message}>{message}</span>}
      {compact ? (
        <button data-browser-more="" className={BUTTON} title={t("browser.more")} aria-label={t("browser.more")} aria-haspopup="menu"
          onClick={(e) => openMenuFrom(e.currentTarget, [
            { label: t("browser.external"), icon: <ExternalLink size={14} />, disabled: !external, onSelect: () => { if (external) void action(() => bridge.api.openExternal(external)); } },
            { label: t("browser.copy"), icon: <Copy size={14} />, onSelect: () => void action(() => navigator.clipboard.writeText(url), true) },
          ])}><MoreHorizontal size={13} /></button>
      ) : (
        <>
          <button className={BUTTON} title={t("browser.external")} aria-label={t("browser.external")} disabled={!external} onClick={() => external && void action(() => bridge.api.openExternal(external))}><ExternalLink size={13} /></button>
          <button className={BUTTON} title={t("browser.copy")} aria-label={t("browser.copy")} onClick={() => void action(() => navigator.clipboard.writeText(url), true)}><Copy size={13} /></button>
        </>
      )}
    </div>
  );
}
