import { BrowserAgentCursor } from "./BrowserAgentCursor";
import { isImeComposing } from "../../lib/ime";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CornerDownLeft, Globe, LoaderCircle, Monitor, MoreHorizontal, RotateCw, X } from "lucide-react";
import { openMenuFrom } from "../../lib/contextMenu";
import { browserPageMenu } from "./pageMenu";
import { dataFlags, useSizeFlags, widthBelow } from "../../lib/sizeFlags";
import { bridge } from "../../bridge";
import { useI18n } from "../../i18n";
import type { SideBodyProps } from "../slots";
import { browserAddressUrl, browserError, browserErrorKey, INVALID_ADDRESS, MAX_BROWSER_INPUT, NOT_WEB_ADDRESS, safeBrowserUrl, type BrowserState } from "./browserState";
import { guestLifecycle } from "./guestLifecycle";
import { useBrowserEnabled, useBrowserView } from "./tabs";
import { browserSitePermissionList } from "./sitePermissionText";
import { afterBrowserHostsDelivered, browserHostCurrent, useBrowserHostEpoch } from "./hosts";
import { browserActivation } from "./activation";
import { BrowserMaidRow } from "./BrowserControls";
import { BrowserOwnerCapture } from "./BrowserOwnerCapture";
import { createBrowserHold } from "./hold";
import { createHoldReasons, createMediaHold, onMediaStop } from "./media";
import { markUncappedHold } from "../../lib/sideKeep";
import { reserveNewOwnerTab } from "./newOwnerTab";
import { browserRefusalAction } from "../../../../shared/browser";
import { BrowserBackgroundView } from "./BrowserBackgroundView";
import { BROWSER_PREVIEW_BACKGROUND } from "./thumbnails";
import { ServicePaneLink } from "../../components/ServiceLinks";
import { serviceSlugOf } from "../../lib/serviceLink";
import { serviceAddressOf, serviceTabPath } from "../../lib/serviceAddress";
import { useApp } from "../../store";
import { btn } from "../../components/Button";
import { BrowserLoginPoolPill, BrowserLoginWarning } from "./BrowserLoginHint";
import { browserLoginOrigin, openOwnerLoginCopy } from "./loginHint";
import { browserCache } from "./browserCache";
import { sideOpenFrom } from "../../lib/shelfTarget";
import { BROWSER_TAB } from "./browserState";
import { useServiceStartWait, waitsForService } from "./serviceStartWait";

const BUTTON = "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-subtle enabled:hover:bg-hover enabled:hover:text-foreground disabled:opacity-35";
/** A narrow 地址行 keeps back, reload, the address and ⋯; 前进 moves into ⋯ (analysis widths: below 640 px). */
const ADDRESS_FLAGS = { narrow: widthBelow(40) };
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
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  useEffect(() => { setError(null); setDismissedError(null); }, [hostId, epoch, tabKey, view?.pageGeneration]);
  const [mountFailed, setMountFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [working, setWorking] = useState(false);
  const [captureFailed, setCaptureFailed] = useState(false);
  const [addressRow, addressFlags] = useSizeFlags(ADDRESS_FLAGS);
  // The ⋯ menu's outcome (地址已复制 / why it failed), cleared after a moment; the row keeps its height.
  const [pageMessage, setPageMessage] = useState<{ text: string; failed: boolean } | null>(null);
  useEffect(() => { if (!pageMessage) return; const timer = setTimeout(() => setPageMessage(null), 2500); return () => clearTimeout(timer); }, [pageMessage]);
  const ownerRecovery = useRef(false);
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
  // One shell hold, two reasons: the agent's lease (counted against sideKeepMounted) and a page that plays (uncapped).
  const reasons = useRef<ReturnType<typeof createHoldReasons> | null>(null);
  reasons.current ??= createHoldReasons(value => latest.current.keepMounted(value), on => markUncappedHold(latest.current.instance.id, on));
  // A page that plays stays mounted in the background (owner 2026-11-10), MEDIA_GRACE_MS after a pause; 停止 lets it go.
  const playing = !!view?.media?.playing || !!view?.media?.audible;
  const playingNow = useRef(playing);
  playingNow.current = playing;
  const media = useRef<ReturnType<typeof createMediaHold> | null>(null);
  useEffect(() => {
    const m = createMediaHold(on => void reasons.current!.set("media", on));
    media.current = m;
    m.update(playingNow.current);
    const offStop = hostId ? onMediaStop(hostId, tabKey, () => m.stop()) : () => {};
    return () => {
      offStop(); m.dispose();
      if (media.current === m) media.current = null;
      reasons.current!.set("media", false);
    };
  }, [hostId, tabKey]);
  useEffect(() => { media.current?.update(playing); }, [playing]);
  useEffect(() => {
    if (!hostId || !epoch || !bridge.browser || !enabled) return;
    const api = bridge.browser.forHost(hostId);
    const manager = createBrowserHold({ keepMounted: value => reasons.current!.set("lease", value),
      ready: (leaseId, held) => api.holdReady(tabKey, leaseId, held), revoke: leaseId => api.releaseLease(tabKey, leaseId), failed: reason => setError(browserError(reason)) });
    hold.current = manager;
    return () => { manager.dispose(); if (hold.current === manager) hold.current = null; };
  }, [hostId, epoch, tabKey, enabled]);
  useEffect(() => { hold.current?.update(view?.lease?.leaseId, props.held); }, [view?.lease?.leaseId, props.held, hostId, epoch, tabKey, enabled]);

  useEffect(() => { if (!granted) setCaptureFailed(false); }, [granted]);
  // Preview only (`?browserChrome`, mock.ts): the mock gives this tab an attached page in that control state.
  useEffect(() => {
    if (preview && hostId) window.dispatchEvent(new CustomEvent("cutex-preview-browser-tab", { detail: { hostId, tabKey, url: instance.state.url } }));
  }, [preview, hostId, tabKey]);

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
      const code = browserError(reason);
      if (!state.agentOpened && ["stale_connection", "stale_request", "host switched", "target_closed"].includes(code)) {
        if (!ownerRecovery.current) {
          ownerRecovery.current = true;
          setError(null); setRetry(value => value + 1);
          return;
        }
        setMountFailed(true); setError("target_closed");
        return;
      }
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

  async function run(action: () => Promise<void>, recoverUrl?: string): Promise<void> {
    if (!browserActivation.get() || !browserHostCurrent(hostId, epoch)) return;
    setWorking(true);
    setError(null);
    setDismissedError(null);
    try {
      await afterBrowserHostsDelivered();
      if (!browserActivation.get() || !browserHostCurrent(hostId, epoch)) return;
      await action();
    } catch (reason) {
      if (browserHostCurrent(hostId, epoch)) {
        const code = browserError(reason);
        if (recoverUrl && !latest.current.instance.state.agentOpened && ["stale_connection", "stale_request", "host switched", "target_closed"].includes(code)) {
          requestedUrl.current = recoverUrl; ownerRecovery.current = true;
          setError(null); setRetry(value => value + 1);
        } else setError(code);
      }
    }
    finally { if (browserHostCurrent(hostId, epoch)) setWorking(false); }
  }

  function navigate(): void {
    if (!address.trim()) return;
    setFixNote(null);
    const typed = browserAddressUrl(address);
    if ("error" in typed) { setError(typed.error); return; }
    const url = typed.url;
    ownerRecovery.current = false;
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
    void run(() => bridge.browser!.forHost(hostId).navigate(tabKey, url), url);
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
    ownerRecovery.current = false;
    if (recoverable) { setError(null); setRetry((value) => value + 1); }
    else if (hostId && bridge.browser) void run(() => bridge.browser!.forHost(hostId).reload(tabKey), currentUrl);
  }

  const rawReason = error ?? view?.error;
  const reason = rawReason === dismissedError ? null : rawReason;
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
  function back(): void { if (hostId) void run(() => bridge.browser!.forHost(hostId).back(tabKey)); }
  function forward(): void { if (hostId) void run(() => bridge.browser!.forHost(hostId).forward(tabKey)); }
  function resetZoom(): void { if (hostId && bridge.browser) void bridge.browser.forHost(hostId).setZoom(tabKey, "reset"); }
  async function pageAction(work: () => Promise<void>, copied = false): Promise<void> {
    setPageMessage(null);
    try { await work(); if (copied) setPageMessage({ text: t("browser.copied"), failed: false }); }
    catch (reason) { setPageMessage({ text: t("browser.actionFailed", { reason: t(browserErrorKey(reason)) }), failed: true }); }
  }
  const pageService = () => {
    // Read when the ⋯ opens (no subscription): the host's service list, as lib/serviceLinkView useHostServices.
    const slug = serviceSlugOf(currentUrl), app = useApp.getState();
    if (!slug || !hostId) return null;
    const list = hostId === (app.hosts?.active ?? "local") ? app.services : app.byHost?.[hostId]?.services;
    const found = list?.find((s) => s.slug === slug);
    return found ? serviceAddressOf(found, hostId, app.hosts?.hosts.find((h) => h.id === hostId), serviceTabPath(currentUrl) ?? undefined) : null;
  };
  const pageMenu = () => browserPageMenu({ service: pageService(), url: currentUrl, narrow: addressFlags.narrow, canGoForward: !!view?.canGoForward, ready, working,
    toBackground: ready && view?.pool === "agent" && !background ? { busy: !!view.handover } : null, zoom: view?.zoom }, {
    forward, resetZoom, toBackground,
    copy: () => void pageAction(() => navigator.clipboard.writeText(currentUrl), true),
    copyText: (text) => void pageAction(() => navigator.clipboard.writeText(text), true),
    openExternal: url => void pageAction(() => bridge.api.openExternal(url)),
  }, t);
  return (
    <div className={`flex h-full min-h-0 flex-col bg-background${view?.control?.operating ? " ring-2 ring-inset ring-accent" : ""}`} data-browser-card data-browser-operating={view?.control?.operating || undefined} data-browser-granted={granted || undefined}
      data-browser-pool={view?.pool} data-browser-lease-state={view?.lease?.state} data-browser-session={view?.lease?.sessionId} data-browser-held={props.held || undefined}>
      {/* Maid 行: the service's agent (a service tab in a card) and who controls the page; always there, one height. */}
      <BrowserMaidRow hostId={hostId} tabKey={tabKey} link={props.where === "card" && serviceSlugOf(currentUrl) ? <ServicePaneLink hostId={hostId} instanceId={instance.id} url={currentUrl} linked={instance.state.linked ?? null} /> : undefined} />
      {/* 地址行: back · forward · reload | address (favicon, Enter or ↵ submits) | badges · ⋯ (copy, open outside, …). */}
      <form ref={addressRow} {...dataFlags(addressFlags)} data-browser-address-row="" className="flex h-10 shrink-0 items-center gap-0.5 border-b border-border px-1.5" onSubmit={(event) => { event.preventDefault(); if (!isImeComposing(event)) navigate(); }}>
        <button type="button" className={BUTTON} title={t("browser.back")} aria-label={t("browser.back")} disabled={!ready || !view?.canGoBack || working} onClick={back}><ArrowLeft size={14} /></button>
        {!addressFlags.narrow && <button type="button" className={BUTTON} title={t("browser.forward")} aria-label={t("browser.forward")} disabled={!ready || !view?.canGoForward || working} onClick={forward}><ArrowRight size={14} /></button>}
        {view?.loading ? (
          <button type="button" className={BUTTON} title={t("browser.stop")} aria-label={t("browser.stop")} disabled={!ready} onClick={() => hostId && void run(() => bridge.browser!.forHost(hostId).stop(tabKey))}><X size={14} /></button>
        ) : (
          <button type="button" className={BUTTON} title={t("browser.reload")} aria-label={t("browser.reload")} disabled={!hostAvailable || (!ready && !recoverable) || working} onClick={reload}><RotateCw size={14} /></button>
        )}
        <div className={`ml-0.5 flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-ctl border border-border bg-background pr-0.5 pl-2 focus-within:border-subtle ${!hostAvailable || !bridge.browser ? "opacity-60" : ""}`}>
          <span className="flex size-4 shrink-0 items-center justify-center text-subtle" aria-hidden="true">
            {view?.loading ? <LoaderCircle size={13} className="animate-spin" /> : view?.favicon ? <img src={view.favicon} alt="" width={14} height={14} referrerPolicy="no-referrer" /> : <Globe size={13} />}
          </span>
          <input value={address} onChange={(event) => setAddress(event.target.value)} onFocus={() => { editing.current = true; }} onBlur={() => { editing.current = false; }} aria-label={t("browser.address")} spellCheck={false} autoComplete="off" autoCapitalize="off" maxLength={MAX_BROWSER_INPUT} disabled={!hostAvailable || !bridge.browser} className="h-full min-w-0 flex-1 bg-transparent text-meta text-foreground outline-none" />
          {view?.desktopLoopback && <span data-browser-desktop-loopback-badge title={t("browser.desktopLoopback.badgeHint")} className="flex h-5 shrink-0 items-center gap-1 rounded-chip bg-surface-2 px-1.5 text-caption text-muted"><Monitor size={11} aria-hidden="true" />{t("browser.desktopLoopback.badge")}</span>}
          {/* Enter submits; the arrow is the same for a pointer / touch. */}
          <button type="submit" data-browser-go="" title={t("browser.go")} aria-label={t("browser.go")} disabled={!hostAvailable || (!ready && !recoverable) || working || preview}
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-subtle enabled:hover:bg-hover enabled:hover:text-foreground disabled:opacity-35"><CornerDownLeft size={13} /></button>
        </div>
        {agentPool && <span className="ml-1 flex min-w-0 shrink items-center"><BrowserLoginPoolPill key={loginScope} disabled={!ready || working} openOwner={openOwner} /></span>}
        {/* Main's page zoom for this tab; click resets it (the page's own Ctrl+wheel / = / − / 0 stay in the guest). */}
        {view?.zoom && view.zoom !== 1 && (
          <button type="button" data-browser-zoom="" className="ml-1 flex h-6 shrink-0 items-center rounded-chip bg-surface-2 px-1.5 text-caption text-muted hover:bg-hover hover:text-foreground"
            title={t("browser.zoom.reset")} aria-label={t("browser.zoom.reset")} onClick={resetZoom}>{Math.round(view.zoom * 100)}%</button>
        )}
        {pageMessage && <span role={pageMessage.failed ? "alert" : "status"} className={`ml-1 max-w-40 min-w-0 truncate text-meta ${pageMessage.failed ? "text-danger" : "text-subtle"}`} title={pageMessage.text}>{pageMessage.text}</span>}
        <button type="button" data-browser-page-menu="" className={BUTTON} data-tip={t("browser.page.menu")} aria-label={t("browser.page.menu")} aria-haspopup="menu" onClick={(event) => openMenuFrom(event.currentTarget, pageMenu())}><MoreHorizontal size={14} /></button>
      </form>
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
        <button type="button" className={BUTTON} aria-label={t("common.close")} title={t("common.close")}
          onClick={() => { setDismissedError(reason); setError(null); }}><X size={14} /></button>
      </div>}
      {!safeBrowserUrl(currentUrl) && <p role="status" className="shrink-0 border-b border-border px-3 py-1 text-xs text-subtle">{t("browser.longUrl")}</p>}
      <div className="relative min-h-0 flex-1">
        <div ref={host} data-browser-viewport className="absolute inset-0" style={{ visibility: !hostAvailable || crashed || invalidated ? "hidden" : "visible" }} />
        <BrowserAgentCursor key={`${view?.guestId ?? "none"}:${view?.pageGeneration ?? 0}`} cue={view?.cursor} granted={!!granted && view?.control?.state === "granted"} visible={props.visible && !background && hostAvailable && !crashed && !invalidated} viewport={host} />
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
