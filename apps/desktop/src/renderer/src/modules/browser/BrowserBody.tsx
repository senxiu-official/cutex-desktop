import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Copy, ExternalLink, Globe, LoaderCircle, RotateCw, X } from "lucide-react";
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
  const requestedUrl = useRef<string | null>(null);
  // The owner's last address-bar submission, so a refusal's single fix can retry exactly it.
  const submitted = useRef<string | null>(null);
  const [fixNote, setFixNote] = useState<"browser.refusal.forced" | null>(null);
  const [address, setAddress] = useState(view?.url ?? instance.state.url);
  const editing = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [mountFailed, setMountFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [working, setWorking] = useState(false);
  const [captureFailed, setCaptureFailed] = useState(false);
  const preview = !bridge.browser && import.meta.env.DEV;
  const crashed = view?.status === "crashed";
  const invalidated = view?.status === "closed" || view?.status === "unmounted";
  const recoverable = mountFailed || crashed || invalidated;
  const currentUrl = view?.url ?? instance.state.url;
  const ready = enabled && !!bridge.browser && hostAvailable && view?.status === "attached";
  const granted = ready && view?.control?.state === "granted";
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
    setError(null);
    if (!enabled || !container || !hostId || !epoch || !bridge.browser) return;
    setMountFailed(false);
    const api = bridge.browser.forHost(hostId);
    const mountFailure = (reason: unknown) => {
      setMountFailed(true); setError(browserError(reason));
      const pending = latest.current.instance.state.pendingOpen;
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
      if (mount.tabKey !== tabKey || mount.partition !== expectedPartition || !/^about:blank#cutex-browser-attach=[a-f0-9]{64}$/.test(mount.src)) throw new Error("Invalid browser mount reservation");
      if (mount.recovery) setError(mount.recovery);
      element = document.createElement("webview") as BrowserWebview;
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
      latest.current.instance.state.agentOpened ? { agentOpened: true, ...(latest.current.instance.state.pendingOpen ? { pendingOpen: latest.current.instance.state.pendingOpen } : {}) } : undefined);
    return () => {
      offReady();
      element?.remove();
      release();
    };
    // This is an instance lifetime, not a navigation/render effect. Even locale changes only affect
    // the surrounding controls. The shell's instance layer supplies stable placement and hidden LRU.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, hostId, epoch, tabKey, retry]);

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
    if (recoverable) {
      requestedUrl.current = url;
      setError(null);
      setRetry((value) => value + 1);
      editing.current = false;
      return;
    }
    if (!ready) return;
    submitted.current = url;
    void run(() => bridge.browser!.forHost(hostId).navigate(tabKey, url));
    editing.current = false;
  }

  /** The one action that fixes this refusal; others only explain (never a misleading switch). */
  function fixRefusal(action: "enableExternal" | "retry"): void {
    if (!hostId || !bridge.browser) return;
    const browser = bridge.browser, retry = submitted.current;
    setFixNote(null);
    void run(async () => {
      if (action === "enableExternal" && !(await browser.externalPages(true)).enabled) { setFixNote("browser.refusal.forced"); return; }
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
  const fix = reason && ready ? browserRefusalAction(reason) : null;
  // Address-bar text the renderer refused before asking main (never a main / policy refusal).
  const addressKey = reason === NOT_WEB_ADDRESS ? "browser.notWebAddress" : reason === INVALID_ADDRESS ? "browser.invalidUrl" : null;
  const blank = currentUrl === "about:blank" && !view?.loading;
  return (
    <div className={`flex h-full min-h-0 flex-col bg-background${view?.control?.operating ? " ring-2 ring-inset ring-accent" : ""}`} data-browser-card data-browser-operating={view?.control?.operating || undefined} data-browser-granted={granted || undefined}
      data-browser-pool={view?.pool} data-browser-lease-state={view?.lease?.state} data-browser-session={view?.lease?.sessionId} data-browser-held={props.held || undefined}>
      <form className="flex shrink-0 items-center gap-0.5 border-b border-border p-1.5" onSubmit={(event) => { event.preventDefault(); navigate(); }}>
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
        <button type="submit" disabled={!hostAvailable || (!ready && !recoverable) || working || preview} className="h-7 shrink-0 rounded-md px-2 text-xs text-muted enabled:hover:bg-hover disabled:opacity-35">{t("browser.go")}</button>
      </form>
      <BrowserControlBanner hostId={hostId} tabKey={tabKey} />
      {(view?.pool === "agent" || instance.state.agentOpened) && <p role="alert" data-browser-isolated-warning className="shrink-0 border-b border-warn bg-background px-3 py-2 text-xs text-warn">{t("browser.origins.doNotSignIn")}</p>}
      {view?.sitePermission && <p role={view.sitePermission.state === "waiting" ? "status" : "alert"} data-browser-site-permission={view.sitePermission.state}
        className={`shrink-0 border-b border-border px-3 py-2 text-xs ${view.sitePermission.state === "waiting" ? "text-foreground" : "text-warn"}`}>
        {t(view.sitePermission.state === "waiting" ? "browser.sitePermission.waiting" : view.sitePermission.state === "hidden" ? "browser.blocked.permissionHidden" : "browser.blocked.permissionTimeout",
          { origin: view.sitePermission.origin, permissions: browserSitePermissionList(view.sitePermission.permissions) })}</p>}
      {granted && captureFailed && <p role="alert" className="shrink-0 border-b border-border px-3 py-2 text-xs text-danger">{t("browser.ownerCaptureFailed")}</p>}
      {reason && <div role="alert" data-browser-address-error={addressKey ? reason : undefined} data-browser-refusal={addressKey ? undefined : reason}
        className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-xs text-danger">
        <span className="min-w-0 flex-1 break-words">{addressKey ? t(addressKey) : t("browser.blocked", { reason: t(reasonKey!) })}{fixNote && <span className="ml-1 text-subtle">{t(fixNote)}</span>}</span>
        {fix && <button type="button" data-browser-refusal-fix={fix} disabled={working} className="shrink-0 rounded-md border border-border px-2 py-0.5 text-foreground enabled:hover:bg-hover disabled:opacity-40"
          onClick={() => fixRefusal(fix)}>{t(fix === "enableExternal" ? "browser.refusal.enableExternal" : "browser.refusal.retry")}</button>}
      </div>}
      {!safeBrowserUrl(currentUrl) && <p role="status" className="shrink-0 border-b border-border px-3 py-1 text-xs text-subtle">{t("browser.longUrl")}</p>}
      <div className="relative min-h-0 flex-1">
        <div ref={host} data-browser-viewport className="absolute inset-0" style={{ visibility: !hostAvailable || crashed || invalidated ? "hidden" : "visible" }} />
        {granted && hostId && view && <BrowserOwnerCapture key={view.guestId} hostId={hostId} tabKey={tabKey} guestId={view.guestId} viewport={host}
          failed={() => setCaptureFailed(true)} />}
        {(preview || !hostAvailable || !bridge.browser || recoverable || blank) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-xs text-subtle">
            <Globe size={24} strokeWidth={1.4} />
            <p className="max-w-sm">{preview ? t("browser.preview") : !hostAvailable ? t("browser.noHost") : !bridge.browser ? t("browser.unavailable") : crashed ? t("browser.crashed") : recoverable ? t("browser.unavailable") : t("browser.blank")}</p>
            {recoverable && hostAvailable && <button className="rounded-md border border-border px-3 py-1.5 text-foreground hover:bg-hover disabled:opacity-40" disabled={working} onClick={reload}>{t("browser.reload")}</button>}
          </div>
        )}
      </div>
      {hostAvailable && (view?.loading || (!view && !preview && !error && bridge.browser)) && <p role="status" className="shrink-0 border-t border-border px-3 py-1 text-xs text-subtle">{t(view?.loading ? "browser.loading" : "browser.starting")}</p>}
    </div>
  );
}

export function BrowserActions({ hostId, instance }: SideBodyProps<BrowserState>) {
  const { t } = useI18n();
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
      <BrowserControlHeader hostId={hostId} tabKey={instance.state.tabKey} />
      {message && <span role={failed ? "alert" : "status"} className="max-w-40 truncate text-xs text-subtle" title={message}>{message}</span>}
      <button className={BUTTON} title={t("browser.external")} aria-label={t("browser.external")} disabled={!external} onClick={() => external && void action(() => bridge.api.openExternal(external))}><ExternalLink size={13} /></button>
      <button className={BUTTON} title={t("browser.copy")} aria-label={t("browser.copy")} onClick={() => void action(() => navigator.clipboard.writeText(url), true)}><Copy size={13} /></button>
    </div>
  );
}
