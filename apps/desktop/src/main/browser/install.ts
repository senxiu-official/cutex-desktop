import { randomBytes, randomUUID } from "node:crypto";
import type { BrowserOperationResult } from "@cutex-desktop/browser-protocol";
import { join } from "node:path";
import { networkInterfaces } from "node:os";
import { app, dialog, ipcMain, nativeImage, session, type AuthInfo, type DownloadItem, type BrowserWindow, type IpcMainInvokeEvent, type Session, type WebContents } from "electron";
import type { EventEnvelope } from "@cutex-desktop/protocol";
import { BROWSER_CHANNEL, DEFAULT_BROWSER_CONTROL_SETTINGS, type BrowserControlSettings, type BrowserEvent, type BrowserRequest, type BrowserSitePermissionPromptView, type BrowserTabMount, type BrowserTabView } from "../../shared/browser";
import { browserClaimOrigin, type BrowserClaimAutoReason, type BrowserClaimTab } from "../../shared/browserClaim";
import type { ApprovalRecord } from "../../shared/ipc";
import type { HostBinding } from "../../shared/hosts";
import type { DaemonService } from "../daemon";
import { admitHostBinding, type HostFence } from "../hostFence";
import type { HostManager } from "../hosts";
import { browserAttachId, browserAttachSource, evaluateBrowserAttach, type BrowserAttachReservation } from "./attachPolicy";
import { createBrowserChannel } from "./channel";
import { readBrowserFavicon } from "./favicon";
import { browserTargetOrigin, createBrowserUrlPolicy, createBrowserWindowOpenHandler, hardenBrowserGuest, installBrowserSessionPolicy, isBrowserLoopbackHost, revokeBrowserSessionPolicy, type BrowserActor, type BrowserNetworkHost, type BrowserPopupPost, type BrowserRefusal, type BrowserSessionPolicy } from "./network";
import { BrowserSitePermissionStore, browserPermissionOrigin, createBrowserSitePermissions } from "./sitePermissions";
import { createBrowserPermissionPrompt } from "./permissionPrompt";
import { browserDownloadDialogTitle } from "./promptText";
import { BrowserPopupInput } from "./popupInput";
import { InAppProvider, type BrowserNavigationGuard } from "./provider";
import { assertPublicBrowserNavigation, createBrowserModelAdapter, publicBrowserServiceUrl } from "./modelAdapter";
import { createBrowserEgress } from "./egress";
import { BrowserExternalPagesStore, createBrowserExternalPages } from "./externalPages";
import { BrowserLanTargets } from "./lanTargets";
import { browserGuestKeyboardFocused, ensureBrowserVisible, restoreBrowserAppFocus } from "./visibility";
import { BrowserRegistry, type BrowserGuestRecord } from "./registry";
import { BrowserServiceSession, browserServiceError, parseBrowserServiceUrl, serviceDisplayUrl, subresourceReticketDue, type BrowserServiceTarget } from "./services";
import { BrowserRelay, type RelayExecutionContext } from "./relay";
import { BrowserRefusalError, BrowserRelayError, browserServiceRelayError, isBrowserRefusalCode, POPUP_GRANT_CAPABILITY, REFUSAL_REASONS_CAPABILITY, SCROLL_OUTCOME_CAPABILITY, relayError, relayWireError, RELAY_CAPABILITY, type RelayCommand } from "./relayTypes";
import { BrowserLeases } from "./leases";
import { loadBrowserDeviceId } from "./device";
import { createBrowserTabIdentity, browserTabIdentityStorage } from "./tabIdentity";
import { createBrowserOwnerApi } from "./ownerApi";
import { modelScreenshot } from "./modelOutput";
import { BrowserClaimAudit, BrowserClaimCoordinator, BrowserClaimPolicyStore, BrowserClaimSessionAllows } from "./claims";
import { createBrowserCarrier, guardBrowserCarrierDialogs, type BrowserCarrier, type BrowserCarrierDialogGuard } from "./carrier";

type Reservation = BrowserAttachReservation & { guestId: string; epoch: string; tabKey: string; url: string; requestUrl: string; admitted: boolean; expires: number; actor: BrowserActor; post?: BrowserPopupPost; popupGrant?: PopupGrant };
/** A popup main turned into an app tab: the exact URL (display URLs drop secrets) and form body,
 * redeemed once by that new tab's first open. */
type PopupTarget = { url: string; post?: BrowserPopupPost; pool: "owner" | "agent"; expires: number; grant?: PopupGrant };
/** The opener's active lease when its agent's own click opened the tab (host has browser-popup-grant). */
type PopupGrant = { openerLeaseId: string; sessionId: string };
/** An owner gesture (click / key in the tab, or an owner navigation) makes a download the owner's
 * for this long; Chromium may start it after a redirect chain. */
const OWNER_DOWNLOAD_GESTURE_MS = 10_000;
/**
 * A carrier hand-over of one agent tab (background carrier <-> card webview). While it runs, agent
 * actions answer busy; the action already running finished first (provider.drain). The exact page
 * address stays here, in main. The lease survives: control is re-prepared on the new guest.
 */
type Handover = { to: "front" | "background"; url: string; leaseId?: string; settings?: BrowserControlSettings; paused: boolean; release(): void; timer?: ReturnType<typeof setTimeout> };
const HANDOVER_TIMEOUT_MS = 15_000;
type TabData = { url: string; title: string; confirmedOpen?: string; sitePermission?: BrowserSitePermissionPromptView; documentEpoch?: number; favicon?: string; error?: string; service?: BrowserServiceSession; navigation: number; authRetries: number; subresourceReticketAt?: number; dispose?: () => void };
const AUTH_PATH = "/__cutex/auth";
const SECRET = /(?:^|[-_])(?:access[-_]?token|refresh[-_]?token|id[-_]?token|token|auth|authorization|password|passwd|secret|signature|sig|jwt|bearer|otp|credential|api[-_]?key|key|code|ticket|session|sessionid)(?:$|[-_])/i;
let previousWindow: (() => void) | undefined;
let syncCurrentHosts: (() => void) | undefined;
let currentHostEvent: ((hostId: string, envelope: EventEnvelope) => void) | undefined;
/** Internal main-process hook, called before main publishes hostsState/daemonState. */
export function syncBrowserHosts(): void { syncCurrentHosts?.(); }
/** Internal main-process hook: every host-feed event (browser_claim approvals are acted on here, in main). */
export function browserHostEvent(hostId: string, envelope: EventEnvelope): void { currentHostEvent?.(hostId, envelope); }
// 「本次运行内一直允许」 and the auto-grant log live for this app run only (never on disk).
const claimAllows = new BrowserClaimSessionAllows();
const claimAudit = new BrowserClaimAudit();
let claimPolicies: BrowserClaimPolicyStore | undefined;
const claimPolicyStore = () => claimPolicies ??= new BrowserClaimPolicyStore(join(app.getPath("userData"), "browser-claim-policy.json"));
/** Keep one-use auth navigation and potentially credential-bearing metadata out of renderer/state. */
export function browserDisplayUrl(raw: string): string {
  if (raw === "about:blank") return raw;
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol) || url.pathname === AUTH_PATH) return "about:blank";
    url.username = ""; url.password = ""; url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      const normalized = key.replace(/([a-z])([A-Z])/g, "$1_$2").replace(/[^a-z0-9]/gi, "_");
      if (SECRET.test(normalized)) url.searchParams.delete(key);
    }
    return url.href.length <= 2000 ? url.href : "about:blank";
  } catch { return "about:blank"; }
}
function displayService(target: BrowserServiceTarget): string {
  const display = browserDisplayUrl(`http://service.localhost${target.path}`);
  const safe = new URL(display === "about:blank" ? "http://service.localhost/" : display);
  return serviceDisplayUrl({ slug: target.slug, path: safe.pathname + safe.search });
}

function refusalError(reason: BrowserRefusal | null): Error {
  return !reason || reason === "invalid_url" ? new BrowserRelayError("invalid_request") : new BrowserRefusalError(reason);
}
/** A single window's owner browser and host-bound, explicitly granted I3 relay. */
export function installBrowser(window: BrowserWindow, getHosts: () => HostManager | null,
  isAppSender: (event: IpcMainInvokeEvent) => boolean, emit: (event: "browserEvent", payload: BrowserEvent) => void, locale: () => string | undefined = () => undefined): void {
  previousWindow?.();
  const owner = window.webContents;
  // 「允许浏览外部网页」: main-only owner switch (default on, userData/browser-external.json, read
  // lazily); CUTEX_DESKTOP_BROWSER_EGRESS = n2 / off overrides it in development runs only.
  let externalPagesState: ReturnType<typeof createBrowserExternalPages> | undefined;
  const externalPages = () => externalPagesState ??= createBrowserExternalPages({ packaged: app.isPackaged, flag: process.env.CUTEX_DESKTOP_BROWSER_EGRESS,
    store: new BrowserExternalPagesStore(join(app.getPath("userData"), "browser-external.json")) });
  // N2 (browser-only egress proxy) follows the owner switch, re-read on every check. Only the two
  // browser partitions are ever configured; renderer / plugin / agent-page sessions never are.
  // Owner-typed LAN / tailnet authorities, per tab. The proxy also runs for them while websites
  // are off and dials them alone (with LAN DNS answers); the URL policy keeps other tabs away.
  const lanTargets = new BrowserLanTargets();
  const popupTargets = new Map<string, PopupTarget>();
  const ownerGestures = new Map<string, number>();
  const blockedNotices = new Map<string, number>();
  let sitePermissionStore: BrowserSitePermissionStore | undefined;
  const sitePermissionsStore = () => sitePermissionStore ??= new BrowserSitePermissionStore(join(app.getPath("userData"), "browser-site-permissions.json"));
  const egress = createBrowserEgress({ isEnabled: () => externalPages().enabled(),
    lanAllowed: (hostname, port) => lanTargets.has(hostname, port), hasLan: () => lanTargets.size > 0 });
  const reservations = new Map<string, Reservation>();
  const unbound = new Map<number, { guest: WebContents; expires: number }>();
  const data = new Map<string, TabData>();
  const policies = new Map<string, Promise<BrowserSessionPolicy>>();
  const hostGenerations = new Map<string, number>();
  const hostEpochs = new Map<string, string>();
  const hostDaemons = new Map<string, DaemonService>();
  const hostCapabilities = new Map<string, Set<string>>();
  const capabilityRevisions = new Map<string, number>();
  const capabilityRecovery = new Map<string, Promise<void>>();
  const capabilityRetryAfter = new Map<string, number>();
  const popupGuards = new WeakSet<WebContents>();
  // Owner tabs main opened for a claim: their first URL is agent-chosen (agent actor on mount).
  const claimTabs = new Set<string>();
  // Per tab (guestId): loopback origins main itself navigated it to (owner address bar / history,
  // an agent tool, a claim's local page). Pages may reach only these, and only same-origin.
  const admissions = new Map<string, Set<string>>();
  // cutex control planes seen this run. controlPorts: on this machine (loopback and its own
  // interface addresses): every loopback host endpoint / tunnel port, local agent-bus ports, the N2
  // listener. controlAuthorities: a remote host's own endpoint (e.g. its tailnet address:port).
  // Add-only: a reconnect gap never unprotects one.
  const controlPorts = new Set<number>();
  const controlAuthorities = new Set<string>();
  const busPorts = new Map<string, number[]>();
  let interfaceCache: { at: number; addresses: Set<string> } | undefined;
  const popupInputs = new WeakMap<object, BrowserPopupInput>();
  type HostRelay = { daemon: DaemonService; epoch: string; generation: number; relay?: BrowserRelay };
  const relays = new Map<string, HostRelay>();
  const relayRetryAfter = new Map<string, number>();
  type PendingOpen = { command: RelayCommand; context: RelayExecutionContext; record: BrowserGuestRecord; confirmed?: boolean; cancelled?: boolean; ready(): void; reject(error: unknown): void };
  const pendingOpens = new Map<string, PendingOpen>();
  const openKey = (hostId: string, requestId: string) => JSON.stringify([hostId, requestId]);
  const adapters = new Map<string, ReturnType<typeof createBrowserModelAdapter>>();
  let deviceId: string | undefined;
  let identities: ReturnType<typeof createBrowserTabIdentity> | undefined;
  const tabIdentities = () => identities ??= createBrowserTabIdentity(browserTabIdentityStorage(app.getPath("userData")));
  let popupGuardInstalled = false;
  let disposed = false;
  // Main's offscreen background carriers (agent tabs only), by guestId, and running hand-overs.
  const carriers = new Map<string, BrowserCarrier>();
  const handovers = new Map<string, Handover>();
  const guestDisposers = new WeakMap<WebContents, () => void>();
  // Each carrier's dialog guard (no native page dialog on the owner's desktop while unbound).
  const dialogGuards = new WeakMap<WebContents, BrowserCarrierDialogGuard>();
  const dialogGuard = (guestId: string) => { const guest = carriers.get(guestId)?.guest; return guest && dialogGuards.get(guest); };
  /** The per-tab-kind gate: only main's own carrier of an agent-pool tab is operated off screen.
   * Owner tabs (and owner tabs granted to an agent) keep the visible-only rule and capture layer. */
  function isBackground(guestId: string): boolean {
    const record = registry.get(guestId), carrier = carriers.get(guestId), guest = registry.getWebContents(guestId);
    return !!record && record.pool === "agent" && record.partition === `persist:browser-agent-${record.hostId}` && !!carrier && !!guest && carrier.guest === guest && !guest.isDestroyed();
  }
  let moduleEnabled = false;
  let lifecycle = 0;
  const registry = new BrowserRegistry<WebContents>({
    onRevoke(record, reason, guest) {
      // A carrier hand-over keeps the tab's lease (same tab, same agent pool, same agent); every
      // other detach ends it. Control on the old guest ends either way.
      const replaced = reason === "replaced";
      if (!replaced) {
        const oldLease = leases.forGuest(record.guestId); if (oldLease) adapters.delete(oldLease.leaseId);
        leases.revokeGuest(record.guestId);
        const handover = handovers.get(record.guestId);
        if (handover) { handovers.delete(record.guestId); if (handover.timer) clearTimeout(handover.timer); handover.release(); }
      }
      provider.release(record.guestId);
      const tab = data.get(record.guestId);
      // Remove exactly the old guest's listeners (a hand-over may already have wired the new one).
      const own = guest ? guestDisposers.get(guest as WebContents) : undefined, legacy = tab?.dispose;
      if (guest) guestDisposers.delete(guest as WebContents);
      if (tab) { tab.navigation++; tab.service?.dispose(); tab.service = undefined; if (!own || legacy === own) tab.dispose = undefined; }
      (own ?? legacy)?.();
      if (guest && "debugger" in guest) { try { (guest as WebContents).debugger.detach(); } catch { /* Already detached. */ } }
      if (guest) popupInputs.get(guest)?.revoke();
      const carrier = carriers.get(record.guestId);
      if (carrier && (!guest || carrier.guest === guest)) { carriers.delete(record.guestId); carrier.destroy(); }
      if (!replaced) for (const [key, value] of reservations) if (value.guestId === record.guestId) reservations.delete(key);
    },
    onEvent(record) {
      // Retired host/partition connections are actively flushed even if another host
      // still has browser tabs. Never rely only on Chromium's guest destruction.
      if (!registry.list().some(current => current.partition === record.partition)) egress.revokeSession(session.fromPartition(record.partition));
      if (registry.list().length === 0) egress.stop();
      publish(record, record.kind === "closed" || record.kind === "host_changed" || record.kind === "host_removed" ? "closed" : undefined);
      if (["closed", "host_changed", "host_removed"].includes(record.kind)) { data.delete(record.guestId); admissions.delete(record.guestId); lanTargets.release(record.guestId); }
    },
  });
  const provider = new InAppProvider({
    getGuest(guestId) {
      syncHosts();
      const record = registry.get(guestId);
      if (!moduleEnabled || disposed || !record || !networkHost(record.hostId)) return;
      return registry.getWebContents(guestId);
    },
    nextPageGeneration: guestId => registry.nextPageGeneration(guestId),
    ensureVisible: (guestId, settings, operation) => isBackground(guestId) ? backgroundBounds(settings, operation) : ensureBrowserVisible({ window, guestId, hiddenTarget: settings.hiddenTarget, ...operation,
      reveal: () => {
        const record = registry.get(guestId);
        if (!record || !moduleEnabled || disposed || owner.isDestroyed() || provider.controlView(guestId)?.state !== "granted") return;
        emit("browserEvent", { ...view(record), epoch: record.epoch, kind: "reveal" });
      } }),
    allowUrl(guestId, url) {
      const record = registry.get(guestId);
      if (!moduleEnabled || disposed || !record || !networkHost(record.hostId)) return false;
      return policy(record.hostId, record.partition).isNavigationAllowed(url, { actor: "agent" });
    },
    async prepareNavigation(guestId, url, guard) {
      const record = registry.get(guestId); if (!record) throw new BrowserRelayError("target_closed");
      const prepared = await prepareNavigation(record, url, false, guard);
      return { url: prepared.target, cancel: prepared.cancel };
    },
    onChanged(guestId) { const record = registry.get(guestId); if (record) publish(record); },
    // A background carrier is its own widget: CDP key input reaches only that page, never the
    // app's composer, so it needs no app focus (and the app's focus is never touched).
    keyboardFocused: guestId => isBackground(guestId) ? Promise.resolve(true) : browserGuestKeyboardFocused(window, guestId),
    restoreFocus: guestId => isBackground(guestId) ? Promise.resolve() : restoreBrowserAppFocus(window, guestId),
    isolated: guestId => isBackground(guestId),
    beforeAttach: guestId => dialogGuard(guestId)?.yieldTo(),
    afterDetach: guestId => { if (isBackground(guestId)) dialogGuard(guestId)?.resume(); },
  });
  /** Off-screen viewport of a background carrier: the configured size, scale 1; nothing revealed. */
  async function backgroundBounds(settings: BrowserControlSettings, operation?: { signal?: AbortSignal; deadline?: number }) {
    if (operation?.signal?.aborted) throw new BrowserRelayError("cancelled");
    if (operation?.deadline !== undefined && (!Number.isFinite(operation.deadline) || Date.now() >= operation.deadline)) throw new BrowserRelayError("deadline_exceeded");
    return { width: settings.viewport.width, height: settings.viewport.height };
  }
  const leases = new BrowserLeases({
    current(lease) {
      const record = registry.get(lease.target.guestId), relay = relays.get(lease.target.hostId);
      return moduleEnabled && !disposed && !!record && record.status === "attached" && record.hostId === lease.target.hostId && record.epoch === relay?.epoch
        && relay.relay?.online === true && relay.relay.binding()?.deviceId === lease.target.deviceId && !!registry.getWebContents(record.guestId);
    },
    prepare: (lease, settings) => provider.grant(lease.target.guestId, settings, { grantee: lease.agentName, deferBinding: lease.origin === "agent" }),
    releaseProvider(guestId, leaseId) { adapters.delete(leaseId); cancelPendingGuest(guestId); provider.release(guestId); },
    changed(guestId) { const record = registry.get(guestId); if (record) publish(record); },
  });
  // Lease id → why main granted a claim without the owner's click (shown on the control banner).
  const autoReasons = new Map<string, BrowserClaimAutoReason>();
  // Automatic claim grants use the owner's last explicit control settings of this run.
  let lastSettings: BrowserControlSettings = DEFAULT_BROWSER_CONTROL_SETTINGS;
  function leaseView(guestId: string) {
    const lease = leases.view(guestId), auto = lease && autoReasons.get(lease.leaseId);
    return lease && auto ? { ...lease, auto } : lease;
  }
  function view(record: BrowserGuestRecord, status?: BrowserTabView["status"]): BrowserTabView {
    const tab = data.get(record.guestId);
    const guest = registry.getWebContents(record.guestId);
    const alive = guest && !guest.isDestroyed();
    return { guestId: record.guestId, hostId: record.hostId, tabKey: record.tabKey, pageGeneration: record.pageGeneration,
      url: tab?.url ?? "about:blank", title: tab?.title ?? "", loading: alive ? guest.isLoading() : false,
      canGoBack: alive ? guest.navigationHistory.canGoBack() : false, canGoForward: alive ? guest.navigationHistory.canGoForward() : false,
      status: status ?? record.status, control: provider.controlView(record.guestId), pool: record.pool, lease: leaseView(record.guestId),
      ...(tab?.confirmedOpen ? { confirmedOpen: tab.confirmedOpen } : {}),
      ...(tab?.sitePermission ? { sitePermission: { ...tab.sitePermission, permissions: [...tab.sitePermission.permissions] } } : {}),
      ...(tab?.error ? { error: tab.error } : {}), ...(tab?.favicon ? { favicon: tab.favicon } : {}),
      ...(isBackground(record.guestId) ? { carrier: "background" as const } : {}), ...(handovers.has(record.guestId) ? { handover: true as const } : {}) };
  }
  function publish(record: BrowserGuestRecord, status?: BrowserTabView["status"], newTabUrl?: string): void {
    if (disposed || owner.isDestroyed()) return;
    scheduleClaimRetry(record.hostId);
    emit("browserEvent", { ...view(record, status), epoch: record.epoch, kind: newTabUrl ? "new-tab" : "changed", ...(newTabUrl ? { newTabUrl } : {}) });
  }
  function fail(record: BrowserGuestRecord, code: string): void {
    const tab = data.get(record.guestId);
    if (tab) tab.error = code;
    const current = registry.get(record.guestId);
    if (current) publish(current);
  }
  function syncHosts(): void {
    for (const hostId of registry.hostIds()) {
      const conn = getHosts()?.connection(hostId);
      // Reachability is not identity: a health-check retry must not destroy a local page's DOM.
      if (!conn || conn.daemon !== hostDaemons.get(hostId) || conn.routingEpoch !== hostEpochs.get(hostId) || hostGenerations.get(hostId) !== conn.daemon.generation) {
        registry.removeHost(hostId); hostGenerations.delete(hostId); hostEpochs.delete(hostId); hostDaemons.delete(hostId); hostCapabilities.delete(hostId);
        capabilityRevisions.set(hostId, (capabilityRevisions.get(hostId) ?? 0) + 1); capabilityRecovery.delete(hostId); capabilityRetryAfter.delete(hostId);
      } else if (conn.daemon.currentState.kind !== "connected") {
        hostCapabilities.delete(hostId);
        capabilityRevisions.set(hostId, (capabilityRevisions.get(hostId) ?? 0) + 1);
        capabilityRecovery.delete(hostId);
        capabilityRetryAfter.delete(hostId);
      } else if (!hostCapabilities.has(hostId) && !capabilityRecovery.has(hostId) && Date.now() >= (capabilityRetryAfter.get(hostId) ?? 0) && registry.list(hostId).some(record => data.get(record.guestId)?.service)) {
        // Existing service leases need fresh capabilities to resume their paused renewal.
        // Local-only tabs defer discovery until the next explicit service intent.
        capabilityRetryAfter.set(hostId, Date.now() + 5000);
        void discoverCapabilities(hostId, admitHostBinding(getHosts, { hostId, epoch: conn.routingEpoch })).catch(() => {});
      }
    }
    syncRelays();
  }
  function syncRelays(): void {
    const manager = getHosts();
    for (const [hostId, entry] of relays) {
      const connection = manager?.connection(hostId);
      if (!moduleEnabled || disposed || !connection || entry.daemon !== connection.daemon || entry.epoch !== connection.routingEpoch || entry.generation !== connection.daemon.generation || connection.daemon.currentState.kind !== "connected") {
        relays.delete(hostId); entry.relay?.dispose();
        for (const pending of pendingOpens.values()) if (pending.record.hostId === hostId) pending.reject(new BrowserRelayError("stale_connection"));
      }
    }
    if (!moduleEnabled || disposed) return;
    for (const host of manager?.state().hosts ?? []) {
      const connection = manager?.connection(host.id);
      if (!connection || connection.daemon.currentState.kind !== "connected" || relays.has(host.id) || Date.now() < (relayRetryAfter.get(host.id) ?? 0)) continue;
      const entry: HostRelay = { daemon: connection.daemon, epoch: connection.routingEpoch, generation: connection.daemon.generation };
      relays.set(host.id, entry); // Before the async prepareHost re-enters syncHosts.
      void (async () => {
        const fence = admitHostBinding(getHosts, { hostId: host.id, epoch: entry.epoch });
        await prepareHost(host.id, fence); fence.check();
        if (relays.get(host.id) !== entry || !moduleEnabled || disposed) return;
        if (!hostCapabilities.get(host.id)?.has(RELAY_CAPABILITY)) throw new BrowserRelayError("browser_unavailable");
        const client = entry.daemon.activeClient(); if (!client) throw new BrowserRelayError("browser_unavailable");
        deviceId ??= loadBrowserDeviceId(app.getPath("userData"));
        const relay = new BrowserRelay({ hostId: host.id, deviceId, client,
          localLeases: () => leases.list(host.id),
          revokeLocal(id) { adapters.delete(id); leases.revoke(id, "stale_connection", false); },
          execute: (command, context) => executeRelay(command, context),
        });
        entry.relay = relay; await relay.start();
        void scanClaims(host.id).catch(() => {});
      })().catch(() => { if (relays.get(host.id) === entry) { relays.delete(host.id); entry.relay?.dispose(); relayRetryAfter.set(host.id, Date.now() + 5000); } });
    }
  }
  /** Grant a popup tab to the agent whose own click opened it, under its still-active opener lease. */
  async function grantPopup(record: BrowserGuestRecord, grant: PopupGrant): Promise<void> {
    const current = registry.get(record.guestId);
    if (!current || current.status !== "attached" || !leases.list(record.hostId).some(lease => lease.leaseId === grant.openerLeaseId && lease.state === "active")) return;
    const peer = relayFor(record.hostId), binding = peer.binding();
    if (!binding) return;
    await leases.grant(peer, { deviceId: binding.deviceId, guestId: record.guestId, cutexSessionId: grant.sessionId, title: data.get(record.guestId)?.title || "Browser",
      url: publicSummary(current).url, source: { kind: "popup", openerLeaseId: grant.openerLeaseId } }, DEFAULT_BROWSER_CONTROL_SETTINGS);
  }
  function relayFor(hostId: string): BrowserRelay {
    const relay = relays.get(hostId)?.relay; if (!relay?.online) throw new BrowserRelayError("browser_unavailable"); return relay;
  }
  function cancelPendingGuest(guestId: string): void {
    for (const pending of pendingOpens.values()) {
      if (pending.record.guestId !== guestId || pending.confirmed || pending.cancelled) continue;
      pending.cancelled = true;
      // Discard the exact pre-hold BEFORE publishing removal of its pending lease. Otherwise
      // Body's ordinary keepMounted(false) would consume the locator before discard can use it.
      if (!owner.isDestroyed()) emit("browserEvent", { ...view(pending.record, "closed"), epoch: pending.record.epoch, kind: "agent-open-cancel", openRequestId: pending.command.requestId });
    }
  }
  function publicSummary(record: BrowserGuestRecord) {
    const tab = view(record), url = publicBrowserServiceUrl(tab.url, networkHost(record.hostId)?.connectionPort);
    if (!policy(record.hostId, record.partition).isNavigationAllowed(url)) throw new BrowserRelayError("permission_denied");
    return { guestId: tab.guestId, url, title: tab.title, pageGeneration: tab.pageGeneration };
  }
  /** Every relay result leaves here: precise refusal codes only to a host that understands them. */
  async function executeRelay(command: RelayCommand, context: RelayExecutionContext): Promise<BrowserOperationResult> {
    try { return await executeRelayCommand(command, context); }
    catch (error) {
      const code = relayError(error);
      if (!isBrowserRefusalCode(code)) throw error;
      throw new BrowserRelayError(relayWireError(code, hostCapabilities.get(command.target.hostId)?.has(REFUSAL_REASONS_CAPABILITY) === true));
    }
  }
  async function executeRelayCommand(command: RelayCommand, context: RelayExecutionContext): Promise<BrowserOperationResult> {
    syncHosts();
    if (!moduleEnabled || disposed || context.signal.aborted) throw new BrowserRelayError("browser_disabled");
    if (command.operation.kind === "tabs.open") return openForAgent(command, context);
    const candidate = command.leaseId && leases.list(command.target.hostId).find(item => item.leaseId === command.leaseId && item.target.guestId === command.target.guestId && item.cutexSessionId === command.cutexSessionId && item.state === "active");
    if (!candidate) throw new BrowserRelayError("lease_revoked");
    // A device command can beat the activation HTTP reply. Wait for that same grant,
    // without dispatching/replaying anything or weakening the owner's consent fence.
    const lease = await leases.waitActive(candidate.leaseId);
    if (!moduleEnabled || disposed || context.signal.aborted) throw new BrowserRelayError("cancelled");
    if (context.remainingMs() <= 0) throw new BrowserRelayError("deadline_exceeded");
    const record = registry.get(lease.target.guestId);
    if (!record || record.status !== "attached") throw new BrowserRelayError("target_closed");
    if (command.operation.kind === "tab.release") { leases.revoke(lease.leaseId, "lease_revoked"); adapters.delete(lease.leaseId); return { kind: "tab.release" }; }
    // The owner is moving this tab between background and front: nothing was dispatched; retry.
    if (handovers.has(record.guestId)) throw new BrowserRelayError("busy");
    if (!command.operation.kind.startsWith("tab.")) throw new BrowserRelayError("unsupported_operation");
    if (provider.controlView(record.guestId)?.state === "paused") throw new BrowserRelayError("owner_paused");
    if (command.purpose === "owner-turn-shot") {
      if (command.operation.kind !== "tab.screenshot") throw new BrowserRelayError("permission_denied");
      const image = await provider.screenshot(record.guestId, { signal: context.signal, deadline: context.deadline, hiddenTarget: "reject", format: "png" });
      return { kind: "tab.screenshot", ...modelScreenshot(image, bytes => nativeImage.createFromBuffer(bytes)) };
    }
    let adapter = adapters.get(lease.leaseId);
    if (!adapter) {
      const leaseId = lease.leaseId;
      const hostId = record.hostId;
      adapter = createBrowserModelAdapter({ provider, decodeImage: bytes => nativeImage.createFromBuffer(bytes),
        scrollOutcome: () => hostCapabilities.get(hostId)?.has(SCROLL_OUTCOME_CAPABILITY) === true, tabs: () => {
        const current = leases.forGuest(record.guestId), target = registry.get(record.guestId);
        if (!current || current.leaseId !== leaseId || current.state !== "active" || !target || target.status !== "attached") throw new BrowserRelayError("lease_revoked");
        return [publicSummary(target)];
      } }); adapters.set(leaseId, adapter);
    }
    const operation = command.operation.kind === "tab.navigate" && command.operation.url.startsWith("cutex:service/")
      ? { ...command.operation, url: publicBrowserServiceUrl(command.operation.url, networkHost(record.hostId)?.connectionPort) }
      : command.operation.kind === "tab.act" && command.operation.action.kind === "wait" && command.operation.action.condition.kind === "url"
        && command.operation.action.condition.url.startsWith("cutex:service/")
        ? { ...command.operation, action: { ...command.operation.action, condition: { ...command.operation.action.condition,
          url: publicBrowserServiceUrl(command.operation.action.condition.url, networkHost(record.hostId)?.connectionPort) } } }
      : command.operation;
    return adapter.execute(record.guestId, operation as Parameters<typeof adapter.execute>[1], { signal: context.signal, deadline: context.deadline });
  }
  async function openForAgent(command: RelayCommand, context: RelayExecutionContext): Promise<BrowserOperationResult> {
    if (command.operation.kind !== "tabs.open" || pendingOpens.size >= 16) throw new BrowserRelayError("lease_limit");
    const hostId = command.target.hostId, peer = relayFor(hostId), epoch = relays.get(hostId)!.epoch;
    assertPublicBrowserNavigation(publicBrowserServiceUrl(command.operation.url, networkHost(hostId)?.connectionPort));
    const tabKey = randomUUID();
    // Only a trusted daemon command can establish agent provenance; renderer flags are hints.
    if (!egress.isEnabled()) checkTarget(hostId, command.operation.url, `persist:browser-agent-${hostId}`, "agent");
    const registered = tabIdentities().register(hostId, tabKey);
    let record: BrowserGuestRecord;
    try { record = registry.ensure(hostId, tabKey, "agent"); }
    catch (error) { if (registered) { try { tabIdentities().rollback(hostId, tabKey); } catch { /* Preserve safe tombstone. */ } } throw error; }
    const url = command.operation.url, serviceTarget = parseBrowserServiceUrl(url, networkHost(hostId)?.connectionPort);
    const displayUrl = serviceTarget ? displayService(serviceTarget) : browserDisplayUrl(url);
    data.set(record.guestId, { url: displayUrl, title: "", navigation: 0, authRetries: 0 });
    let ready!: () => void, rejectMount!: (reason: unknown) => void, rejectTerminal!: (reason: unknown) => void;
    const mounted = new Promise<void>((yes, no) => { ready = yes; rejectMount = no; }); void mounted.catch(() => {});
    const failure = new Promise<never>((_yes, no) => { rejectTerminal = no; }); void failure.catch(() => {});
    // The main deadline also bounds the grant/hold phase after mount has resolved.
    const reject = (reason: unknown) => { rejectMount(reason); rejectTerminal(reason); };
    const key = openKey(hostId, command.requestId), pending: PendingOpen = { command, context, record, ready, reject }; pendingOpens.set(key, pending);
    const abort = () => reject(new BrowserRelayError("cancelled")); context.signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => reject(new BrowserRelayError("deadline_exceeded")), Math.max(1, context.remainingMs())); timer.unref?.();
    try {
      if (context.signal.aborted) throw new BrowserRelayError("cancelled");
      emit("browserEvent", { ...view(record, "pending"), epoch, kind: "agent-open", openIntent: { requestId: command.requestId, hostId, epoch, tabKey, cutexSessionId: command.cutexSessionId, url: displayUrl, remainingMs: Math.floor(context.remainingMs()) } });
      await mounted;
      if (context.signal.aborted || peer !== relayFor(hostId) || !registry.getWebContents(record.guestId)) throw new BrowserRelayError("stale_connection");
      const grant = leases.grant(peer, { deviceId: command.deviceId, guestId: record.guestId, cutexSessionId: command.cutexSessionId, title: command.title, url: publicSummary(registry.get(record.guestId)!).url, source: { kind: "agent-open", requestId: command.requestId } }, DEFAULT_BROWSER_CONTROL_SETTINGS);
      const cancelGrant = () => leases.revokeGuest(record.guestId); context.signal.addEventListener("abort", cancelGrant, { once: true });
      try { await Promise.race([grant, failure]); } finally { context.signal.removeEventListener("abort", cancelGrant); }
      if (context.signal.aborted || context.remainingMs() <= 0) throw new BrowserRelayError("deadline_exceeded");
      const current = registry.get(record.guestId)!;
      pending.confirmed = true;
      data.get(record.guestId)!.confirmedOpen = command.requestId;
      emit("browserEvent", { ...view(current), epoch, kind: "agent-open-confirm", openRequestId: command.requestId });
      return { kind: "tabs.open", tab: publicSummary(current) };
    } catch (error) {
      cancelPendingGuest(record.guestId); leases.revokeGuest(record.guestId); registry.close(record.guestId);
      // Only this command's new, unconfirmed provenance may be rolled back.
      // A failed cleanup retains a safe tombstone rather than crossing cookie pools.
      if (registered && !pending.confirmed) { try { tabIdentities().rollback(hostId, tabKey); } catch { /* Preserve safe provenance on disk failure. */ } }
      throw error;
    } finally { if (pendingOpens.get(key) === pending) pendingOpens.delete(key); clearTimeout(timer); context.signal.removeEventListener("abort", abort); }
  }
  /**
   * The exact owner-tab selection (the 「交给…」 menu, the claim card and main's automatic grant all
   * end here). A claim's approvalId makes cutex consume its own approval record for this agent.
   */
  async function grantRecord(hostId: string, record: BrowserGuestRecord, sessionId: string, settings: BrowserControlSettings, approvalId: string | undefined,
    options: { auto?: BrowserClaimAutoReason; remember?: boolean } = {}): Promise<void> {
    const guest = registry.getWebContents(record.guestId), tab = data.get(record.guestId);
    if (registry.get(record.guestId) !== record || record.status !== "attached" || !guest || guest.isDestroyed() || guest.isLoading() || !tab) throw new BrowserRelayError("stale_request");
    const documentEpoch = tab.documentEpoch, navigation = tab.navigation, consentUrl = guest.getURL(), origin = browserClaimOrigin(tab.url);
    // CDP attachment allocates a new ref generation without navigating. Freeze the actual
    // guest/document separately across grant HTTP, hold readiness and activation.
    const consentCurrent = () => registry.getWebContents(record.guestId) === guest && !guest.isDestroyed()
      && data.get(record.guestId) === tab && tab.documentEpoch === documentEpoch && tab.navigation === navigation && guest.getURL() === consentUrl;
    const peer = relayFor(hostId), binding = peer.binding()!;
    const lease = await leases.grant(peer, { deviceId: binding.deviceId, guestId: record.guestId, cutexSessionId: sessionId,
      title: tab.title || "Browser", url: publicSummary(record).url,
      source: approvalId ? { kind: "claim", approvalId } : { kind: "owner" } }, settings, consentCurrent);
    if (options.auto) { autoReasons.set(lease.leaseId, options.auto); for (const id of [...autoReasons.keys()]) if (!leases.list().some(l => l.leaseId === id)) autoReasons.delete(id); publish(record); }
    // Only after cutex consumed this agent's claim: a renderer flag alone never creates an allow.
    if (options.remember && approvalId && origin) claimAllows.allow(hostId, sessionId, lease.agentName, origin);
  }
  function claimTab(record: BrowserGuestRecord): BrowserClaimTab | null {
    const guest = registry.getWebContents(record.guestId), tab = data.get(record.guestId);
    if (record.status !== "attached" || !guest || guest.isDestroyed() || guest.isLoading() || !tab || tab.error || leases.forGuest(record.guestId)
      || provider.hasGrant(record.guestId) || [...pendingOpens.values()].some(p => p.record.guestId === record.guestId)) return null;
    return { guestId: record.guestId, tabKey: record.tabKey, url: tab.url, title: tab.title, pageGeneration: record.pageGeneration, pool: record.pool ?? "owner" };
  }
  const daemonOf = (hostId: string) => { const daemon = getHosts()?.connection(hostId)?.daemon; if (!daemon || daemon.currentState.kind !== "connected") throw new BrowserRelayError("browser_unavailable"); return daemon; };
  const claims = new BrowserClaimCoordinator({
    mode: (hostId, profile) => claimPolicyStore().get(hostId, profile).mode,
    async profileOf(hostId, sessionId) {
      const resource = await daemonOf(hostId).activeClient()?.session(sessionId);
      return resource?.launchedProfile ?? resource?.profile ?? null;
    },
    async ownedServices(hostId, sessionId) {
      const list = await daemonOf(hostId).services();
      return list.services.filter(service => service.ownerCutexSessionId === sessionId).map(service => service.slug);
    },
    tabs: hostId => !moduleEnabled || disposed ? [] : registry.list(hostId).map(claimTab).filter((tab): tab is BrowserClaimTab => !!tab),
    async grant(hostId, target, approval, auto) {
      const record = registry.get(target.guestId);
      if (!moduleEnabled || disposed || !record || record.hostId !== hostId || record.tabKey !== target.tabKey || record.pageGeneration !== target.pageGeneration) throw new BrowserRelayError("stale_request");
      await grantRecord(hostId, record, approval.requesterCutexSessionId, lastSettings, approval.approvalId, auto ? { auto } : {});
    },
    openTab: (hostId, url, sessionId) => openClaimTab(hostId, url, sessionId),
    async approval(hostId, approvalId) {
      const list = await daemonOf(hostId).approvals("pending");
      return list?.find(record => record.approvalId === approvalId) ?? null;
    },
    granted(hostId, target, agentName, reason) {
      const record = registry.get(target.guestId);
      if (record && record.hostId === hostId && !disposed && !owner.isDestroyed()) emit("browserEvent", { ...view(record), epoch: record.epoch, kind: "claim-granted", claimGrant: { agentName, reason } });
    },
  }, claimAllows, claimAudit);
  /** A new owner tab for a claim's local page, shown (held) in the agent's lane; resolves when loaded. */
  async function openClaimTab(hostId: string, url: string, sessionId: string): Promise<BrowserClaimTab> {
    syncHosts();
    const relay = relays.get(hostId);
    if (!moduleEnabled || disposed || !relay?.relay?.online) throw new BrowserRelayError("browser_unavailable");
    const fence = admitHostBinding(getHosts, { hostId, epoch: relay.epoch });
    await prepareHost(hostId, fence); fence.check();
    if (!egress.isEnabled()) checkTarget(hostId, url, undefined, "agent");
    const tabKey = randomUUID();
    tabIdentities().registerOwner(hostId, tabKey);
    claimTabs.add(JSON.stringify([hostId, tabKey]));
    const forget = setTimeout(() => claimTabs.delete(JSON.stringify([hostId, tabKey])), 30_000); forget.unref?.();
    const record = registry.ensure(hostId, tabKey, "owner");
    emit("browserEvent", { ...view(record, "pending"), epoch: record.epoch, kind: "claim-open", claimOpen: { tabKey, url, sessionId } });
    const deadline = Date.now() + 20_000;
    for (;;) {
      await new Promise(resolve => setTimeout(resolve, 200));
      const current = registry.get(record.guestId);
      if (!moduleEnabled || disposed || !current) throw new BrowserRelayError("target_closed");
      const tab = current.status === "attached" && data.get(current.guestId)?.url !== "about:blank" ? claimTab(current) : null;
      if (tab) return tab;
      if (data.get(current.guestId)?.error) throw new BrowserRelayError("navigation_failed");
      if (Date.now() > deadline) throw new BrowserRelayError("deadline_exceeded");
    }
  }
  const claimRetries = new Map<string, ReturnType<typeof setTimeout>>();
  function scheduleClaimRetry(hostId: string): void {
    if (claimRetries.has(hostId) || !claims.pendingFor(hostId).length) return;
    const timer = setTimeout(() => { claimRetries.delete(hostId); if (moduleEnabled && !disposed) claims.retry(hostId); }, 400); timer.unref?.();
    claimRetries.set(hostId, timer);
  }
  /** Claims made while the relay was down (app closed / restarted) are seen once the relay is up. */
  async function scanClaims(hostId: string): Promise<void> {
    const list = await daemonOf(hostId).approvals("pending");
    for (const record of list ?? []) if (record.kind === "browser_claim") void claims.observe(hostId, record as ApprovalRecord);
  }
  currentHostEvent = (hostId, envelope) => {
    if (!moduleEnabled || disposed || envelope.cutex?.method !== "cutex/approvals/changed") return;
    const approval = (envelope.cutex.params as { approval?: ApprovalRecord } | undefined)?.approval;
    if (approval && typeof approval === "object" && approval.kind === "browser_claim" && typeof approval.approvalId === "string") void claims.observe(hostId, approval);
  };
  function networkHost(hostId: string): BrowserNetworkHost | undefined {
    const manager = getHosts(), conn = manager?.connection(hostId);
    const host = manager?.state().hosts.find(h => h.id === hostId);
    if (!moduleEnabled || !conn || !host || conn.daemon !== hostDaemons.get(hostId) || conn.routingEpoch !== hostEpochs.get(hostId) || hostGenerations.get(hostId) !== conn.daemon.generation) return;
    const endpoint = conn.daemon.activeClient()?.endpoint;
    let port: number | undefined;
    try { if (endpoint) { const url = new URL(endpoint.baseUrl); port = Number(url.port || 80); } } catch { /* No usable service endpoint; ordinary local origins remain valid. */ }
    return { kind: host.kind, connectionPort: port,
      serviceProxy: conn.daemon.currentState.kind === "connected" && port !== undefined && hostCapabilities.get(hostId)?.has("services-proxy") === true };
  }
  function policy(hostId: string, partition = `persist:browser-${hostId}`) {
    return createBrowserUrlPolicy({ getHost: () => networkHost(hostId),
      external: url => egress.sessionState(session.fromPartition(partition), url),
      protectedEndpoint: url => isControlEndpoint(url),
      lan: (hostname, port) => !lanTargets.has(hostname, port) ? "none" : egress.lanState(session.fromPartition(partition)),
      admitted: (webContentsId, origin) => {
        const record = registry.getByWebContentsId(webContentsId);
        return !!record && record.hostId === hostId && record.partition === partition && admissions.get(record.guestId)?.has(origin) === true;
      } });
  }
  function isControlEndpoint(target: URL): boolean {
    const manager = getHosts();
    for (const host of manager?.state().hosts ?? []) {
      const daemon = manager?.connection(host.id)?.daemon;
      const urls = [daemon?.activeClient()?.endpoint?.baseUrl, (daemon?.currentState as { baseUrl?: unknown } | undefined)?.baseUrl];
      for (const raw of urls) {
        if (typeof raw !== "string" || !raw) continue;
        try {
          const url = new URL(raw), bare = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
          const ports = [Number(url.port || (url.protocol === "https:" ? 443 : 80)), ...(busPorts.get(host.id) ?? [])];
          for (const port of ports) { if (isBrowserLoopbackHost(url.hostname)) controlPorts.add(port); else controlAuthorities.add(`${bare}:${port}`); }
        } catch { /* Not a URL (ssh:// placeholder): nothing of that host listens here. */ }
      }
    }
    const proxy = egress.port(); if (proxy) controlPorts.add(proxy);
    const port = Number(target.port || (target.protocol === "https:" || target.protocol === "wss:" ? 443 : 80));
    const bare = target.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (isBrowserLoopbackHost(target.hostname) || localAddresses().has(bare)) return controlPorts.has(port);
    return controlAuthorities.has(`${bare}:${port}`);
  }
  /** This machine's own interface addresses (a local daemon may also listen on its LAN / tailnet IP). */
  function isControlUrl(raw: string): boolean { try { return isControlEndpoint(new URL(raw)); } catch { return false; } }
  function localAddresses(): Set<string> {
    if (interfaceCache && Date.now() - interfaceCache.at < 10_000) return interfaceCache.addresses;
    const addresses = new Set<string>();
    try { for (const list of Object.values(networkInterfaces())) for (const item of list ?? []) addresses.add(item.address.toLowerCase()); }
    catch { /* No interface list: loopback names still match. */ }
    interfaceCache = { at: Date.now(), addresses };
    return addresses;
  }
  /** Best effort: the local agent bus listens on this machine too. Never blocks a navigation. */
  function learnBusPort(hostId: string, daemon: DaemonService): void {
    const kind = getHosts()?.state().hosts.find(host => host.id === hostId)?.kind;
    if (kind === "ssh" || typeof (daemon as Partial<DaemonService>).getSettings !== "function") return;
    void daemon.getSettings().then(settings => {
      const ports = [settings?.agentBusEffectivePort, settings?.agentBusPort]
        .filter((port): port is number => typeof port === "number" && Number.isSafeInteger(port) && port > 0 && port < 65536);
      busPorts.set(hostId, [...new Set([...(busPorts.get(hostId) ?? []), ...ports])]);
    }).catch(() => {});
  }
  /**
   * The owner's own navigation (address bar, owner history buttons, a restored owner tab) to a LAN /
   * tailnet URL: admit exactly that authority for this tab, and make sure the partition's proxy runs.
   * Agents never admit LAN targets; pages only use what their tab admitted.
   */
  async function admitLan(record: BrowserGuestRecord, url: string, actor: BrowserActor): Promise<void> {
    if (actor !== "owner" || parseBrowserServiceUrl(url, networkHost(record.hostId)?.connectionPort)) return;
    let parsed: URL; try { parsed = new URL(url); } catch { return; }
    if (isBrowserLoopbackHost(parsed.hostname) || isControlEndpoint(parsed)) return;
    const target = await lanTargets.classify(url);
    if (!target || registry.get(record.guestId) !== record) return;
    lanTargets.admit(record.guestId, target);
    let set = admissions.get(record.guestId);
    if (!set) admissions.set(record.guestId, set = new Set());
    set.add(target.origin);
    await egress.enableSession(session.fromPartition(record.partition)).catch(() => {});
  }
  /** Main is about to navigate this tab itself: a loopback origin becomes reachable for it. */
  function admit(record: BrowserGuestRecord, url: string): void {
    let target: URL;
    try { target = new URL(url); } catch { return; }
    if (!isBrowserLoopbackHost(target.hostname)) return;
    const origin = browserTargetOrigin(url); if (!origin) return;
    let set = admissions.get(record.guestId);
    if (!set) admissions.set(record.guestId, set = new Set());
    if (set.size >= 64 && !set.has(origin)) set.delete(set.values().next().value!);
    set.add(origin);
  }
  function currentFence(record: BrowserGuestRecord): HostFence<DaemonService> {
    return admitHostBinding(getHosts, { hostId: record.hostId, epoch: record.epoch });
  }
  const ownerWindowVisible = () => { try { return !window.isDestroyed() && window.isVisible() && !window.isMinimized(); } catch { return false; } };
  /** Something main stopped without the owner's action: one notice per tab and kind per 10 s. */
  function blockedNotice(record: BrowserGuestRecord, kind: NonNullable<BrowserEvent["blocked"]>): void {
    const asked = data.get(record.guestId)?.sitePermission;
    const key = `${record.guestId}\n${kind}\n${kind.startsWith("permission-") && asked ? `${asked.origin} ${asked.permissions.join()}` : ""}`, now = Date.now();
    if ((blockedNotices.get(key) ?? -Infinity) > now - 10_000 || disposed || owner.isDestroyed()) return;
    blockedNotices.set(key, now);
    if (blockedNotices.size > 256) blockedNotices.delete(blockedNotices.keys().next().value!);
    emit("browserEvent", { ...view(record), epoch: record.epoch, kind: "blocked", blocked: kind });
  }
  /**
   * Downloads (0.1.3): never silent. The owner's own (a click / key in that tab or an owner
   * navigation within 10 s) opens the save dialog; the leased agent's (during its own dispatched
   * input, lease active, not paused) opens the same dialog titled with the agent's name, only while
   * the window is visible. Anything else (a page downloading on its own) is cancelled with a notice.
   * Main never sets a save path itself, so nothing lands on disk without the owner choosing it.
   */
  function decideDownload(webContentsId: number | undefined, item: DownloadItem): boolean {
    const record = webContentsId === undefined ? undefined : registry.getByWebContentsId(webContentsId);
    if (!record || disposed || !moduleEnabled) return false;
    const lease = leases.forGuest(record.guestId);
    const agent = !!lease && lease.state === "active" && provider.controlView(record.guestId)?.state !== "paused" && provider.agentInput(record.guestId);
    const ownerGesture = !agent && Date.now() - (ownerGestures.get(record.guestId) ?? -Infinity) <= OWNER_DOWNLOAD_GESTURE_MS;
    if (!agent && !ownerGesture) { blockedNotice(record, "download"); return false; }
    if (agent && !ownerWindowVisible()) { blockedNotice(record, "download-hidden"); return false; }
    const name = item.getFilename().replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g, "_").replace(/^\.+/, "").slice(0, 200) || "download";
    item.setSaveDialogOptions({ title: browserDownloadDialogTitle(locale(), agent ? lease!.agentName : undefined), defaultPath: join(app.getPath("downloads"), name) });
    return true;
  }
  // Site permissions: the page's own top-level origin asks; the owner answers in main's native
  // dialog (no page, renderer or agent can click it); 「记住」 stores it per login pool + origin.
  const sitePermissions = createBrowserSitePermissions({
    store: { get: (...args) => sitePermissionsStore().get(...args), set: (...args) => sitePermissionsStore().set(...args) },
    guest(webContentsId) {
      const record = registry.getByWebContentsId(webContentsId), guest = record && registry.getWebContents(record.guestId);
      if (!record || !guest || guest.isDestroyed() || disposed || !moduleEnabled) return undefined;
      const lease = leases.forGuest(record.guestId);
      return { guestId: record.guestId, pool: record.pool ?? "owner", url: guest.getURL(), ...(lease ? { agentName: lease.agentName } : {}) };
    },
    agentInput: guestId => provider.agentInput(guestId),
    // The tab shows the open dialog (and how the last one ended without the owner) next to the page.
    async prompt(request) {
      const asking = (state: BrowserSitePermissionPromptView["state"]) => {
        const record = registry.get(request.guestId), tab = data.get(request.guestId);
        if (!record || !tab) return;
        tab.sitePermission = { state, origin: request.origin, permissions: [...request.permissions] }; publish(record);
      };
      asking("waiting");
      try { return await permissionPrompt(request); }
      finally {
        const record = registry.get(request.guestId), tab = data.get(request.guestId);
        if (record && tab?.sitePermission?.state === "waiting") { tab.sitePermission = undefined; publish(record); }
      }
    },
    watch(webContentsId, guestId, origin, gone) {
      const guest = registry.getWebContents(guestId);
      if (!guest || guest.isDestroyed() || guest.id !== webContentsId) { gone(); return () => {}; }
      const navigated = (_event: unknown, url: string) => { if (browserPermissionOrigin(url) !== origin) gone(); };
      guest.on("did-navigate", navigated); guest.once("destroyed", gone);
      return () => { if (!guest.isDestroyed()) { guest.removeListener("did-navigate", navigated); guest.removeListener("destroyed", gone); } };
    },
  });
  // The native dialog, plus what the owner sees in the app when it cannot be (window hidden) or
  // may not be (window behind another app) noticed, and a bounded wait (permissionPrompt.ts).
  const permissionPrompt = createBrowserPermissionPrompt({ window, locale, closed: () => disposed || !moduleEnabled,
    showMessageBox: (target, options) => dialog.showMessageBox(target, options),
    notice(kind, request) {
      const record = registry.get(request.guestId), tab = data.get(request.guestId);
      if (!record || !tab) return;
      if (kind !== "permission-waiting") { tab.sitePermission = { state: kind === "permission-hidden" ? "hidden" : "timeout", origin: request.origin, permissions: [...request.permissions] }; publish(record); }
      blockedNotice(record, kind);
    } });
  // Installed in web-contents-created, before any page can run or navigate. did-attach only
  // verifies the proof; it must never be the first place a popup handler is installed.
  const guardCreatedGuest = (_event: unknown, guest: WebContents) => { if (guest.getType() === "webview") guardGuest(guest); };
  /** The early popup guard of every guest: webviews at web-contents-created, background carriers
   * synchronously at creation (before their first URL). */
  const guardGuest = (guest: WebContents) => {
    // Co-control: an owner click in a shared tab is the owner's gesture; only the provider's own
    // dispatch window is the agent's (an unregistered guest counts as neither: no gesture).
    const input = new BrowserPopupInput(undefined, () => {
      const record = registry.getByWebContentsId(guest.id);
      return !record || provider.agentInput(record.guestId);
    });
    popupInputs.set(guest, input);
    try {
      guest.setWindowOpenHandler(createBrowserWindowOpenHandler(() => {
        const record = registry.getByWebContentsId(guest.id);
        if (disposed || !moduleEnabled || !record || !networkHost(record.hostId)) return;
        currentFence(record).check();
        const lease = leases.forGuest(record.guestId);
        return { hostId: record.hostId, policy: policy(record.hostId, record.partition), consumeOwnerGesture: () => input.consume(),
          webContentsId: guest.id, ...(browserTargetOrigin(guest.getURL()) ? { openerOrigin: browserTargetOrigin(guest.getURL())! } : {}),
          // The leased agent's own dispatched click (main's provider state); paused agents dispatch nothing.
          agentActing: () => !!lease && lease.state === "active" && provider.agentInput(record.guestId), consumeAgentPopup: () => input.consumeAgent(),
          onNewTab: ({ url, post, agent }) => {
            currentFence(record).check();
            // A controlled app tab in the opener's own login pool (no opener relationship, no
            // native window). Main mints and records the new tab's provenance; the renderer only
            // ever sees the display URL, the exact URL and form body wait here for that tab.
            const newTabKey = randomUUID();
            if (record.pool === "agent") tabIdentities().register(record.hostId, newTabKey);
            else tabIdentities().registerOwner(record.hostId, newTabKey);
            const now = Date.now();
            // The agent's own click in its leased tab: with a host that understands it, the new
            // tab is granted to the same agent under the opener's lease (cutex checks it is active).
            const opener = agent ? leases.forGuest(record.guestId) : undefined;
            const grant = opener && opener.state === "active" && hostCapabilities.get(record.hostId)?.has(POPUP_GRANT_CAPABILITY)
              ? { openerLeaseId: opener.leaseId, sessionId: opener.cutexSessionId } : undefined;
            for (const [key, value] of popupTargets) if (value.expires < now) popupTargets.delete(key);
            if (popupTargets.size >= 16) popupTargets.delete(popupTargets.keys().next().value!);
            popupTargets.set(JSON.stringify([record.hostId, newTabKey]), { url, ...(post ? { post } : {}), ...(grant ? { grant } : {}), pool: record.pool ?? "owner", expires: now + 30_000 });
            scheduleClaimRetry(record.hostId);
            emit("browserEvent", { ...view(record), epoch: record.epoch, kind: "new-tab", newTabUrl: browserDisplayUrl(url), newTabKey, ...(agent ? { newTabAgent: true as const } : {}), ...(grant ? { newTabGranted: true as const } : {}) });
          } };
      }, reason => {
        const record = registry.getByWebContentsId(guest.id);
        const code = reason === "no_owner_gesture" ? input.rejection : reason;
        if (record && !disposed && !owner.isDestroyed()) {
          emit("browserEvent", { ...view(record), epoch: record.epoch, kind: "diagnostic", popupDiscardReason: code });
          // A page opening windows on its own (no owner click) is blocked like Chromium's popup
          // blocker: the owner hears it once, then can click the link themselves.
          if (code === "no_owner_input" || code === "post_body" || code === "agent_rate_limited") blockedNotice(record, "popup");
        }
      }));
      popupGuards.add(guest);
    } catch { if (!guest.isDestroyed()) guest.close({ waitForBeforeUnload: false }); }
  };
  app.on("web-contents-created", guardCreatedGuest);
  popupGuardInstalled = true;
  // Only this main callback ever sees N2 credentials. Renderer/guest/MCP never receive them.
  const proxyLogin = (event: { preventDefault(): void }, contents: WebContents | null, _details: unknown, info: AuthInfo,
    callback: (username?: string, password?: string) => void) => {
    syncHosts();
    const record = contents && registry.getByWebContentsId(contents.id);
    if (!record && !egress.ownsChallenge(info)) return;
    if (!info.isProxy) return; // No credentials for page-origin authentication.
    event.preventDefault();
    let credentials: Readonly<{ username: string; password: string }> | undefined;
    try {
      if (moduleEnabled && !disposed && contents && !contents.isDestroyed() && record?.status === "attached"
        && registry.getWebContents(record.guestId) === contents && (contents.hostWebContents === owner || (isBackground(record.guestId) && carriers.get(record.guestId)?.guest === contents))
        && contents.session === session.fromPartition(record.partition) && networkHost(record.hostId)) {
        currentFence(record).check(); credentials = egress.credentialsFor(contents.session, info);
      }
    } catch { /* Deny stale identities without exposing the error. */ }
    if (credentials) callback(credentials.username, credentials.password); else callback();
  };
  app.on("login", proxyLogin);
  async function prepareHost(hostId: string, fence: HostFence<DaemonService>): Promise<void> {
    syncHosts(); fence.check();
    const conn = getHosts()?.connection(hostId);
    if (!conn) throw new BrowserRelayError("stale_connection");
    registry.registerHost(hostId, conn.routingEpoch);
    hostEpochs.set(hostId, conn.routingEpoch);
    hostDaemons.set(hostId, conn.daemon);
    hostGenerations.set(hostId, conn.daemon.generation);
    if (conn.daemon.currentState.kind === "connected" && !hostCapabilities.has(hostId)) { learnBusPort(hostId, conn.daemon); await discoverCapabilities(hostId, fence); }
  }
  function discoverCapabilities(hostId: string, fence: HostFence<DaemonService>): Promise<void> {
    const existing = capabilityRecovery.get(hostId); if (existing) return existing;
    const pending = refreshCapabilities(hostId, fence); capabilityRecovery.set(hostId, pending);
    void pending.finally(() => { if (capabilityRecovery.get(hostId) === pending) capabilityRecovery.delete(hostId); }).catch(() => {});
    return pending;
  }
  async function refreshCapabilities(hostId: string, fence: HostFence<DaemonService>): Promise<void> {
    const conn = getHosts()?.connection(hostId);
    if (conn?.daemon.currentState.kind === "connected") {
      const revision = capabilityRevisions.get(hostId), admittedLifecycle = lifecycle;
      const caps = await fence.daemon.capabilities(); fence.check();
      // A delayed pre-disconnect reply must not overwrite capabilities learned after recovery.
      if (moduleEnabled && lifecycle === admittedLifecycle && capabilityRevisions.get(hostId) === revision && conn.daemon.currentState.kind === "connected")
        hostCapabilities.set(hostId, new Set(caps?.featureList ?? []));
    }
  }
  function checkTarget(hostId: string, url: string, partition?: string, actor: BrowserActor = "owner"): void {
    if (parseBrowserServiceUrl(url, networkHost(hostId)?.connectionPort)) {
      if (!networkHost(hostId)?.serviceProxy) throw new BrowserRelayError(getHosts()?.connection(hostId)?.daemon.currentState.kind === "connected" ? "service_proxy_required" : "service_unavailable");
      return;
    }
    const target = policy(hostId, partition);
    if (target.isNavigationAllowed(url, { actor })) return;
    throw refusalError(target.refusal(url, { actor }));
  }
  /**
   * A service page's own subresource lost its authentication (the daemon restarted: its cookie is no
   * longer accepted). Re-ticket the top-level page through the usual flow (new lease + ticket, no
   * start), at most once per tab per minute; a resource of another service or a non-service page is
   * ignored (reloading this page would not fix it).
   */
  function reticketFromSubresource(record: BrowserGuestRecord, tab: TabData, url: string): void {
    const port = networkHost(record.hostId)?.connectionPort;
    const resource = parseBrowserServiceUrl(url, port);
    const guest = registry.getWebContents(record.guestId);
    if (!resource || !guest || guest.isDestroyed()) return;
    const top = tab.service?.target.slug === resource.slug ? { ...tab.service.target } : parseBrowserServiceUrl(guest.getURL(), port);
    if (!top || top.slug !== resource.slug) return;
    const now = Date.now();
    if (!subresourceReticketDue(tab.subresourceReticketAt, now)) return;
    tab.subresourceReticketAt = now;
    void navigate(record, serviceDisplayUrl(top), true).catch(error => fail(record, browserServiceError(error)));
  }
  async function ensureSession(record: BrowserGuestRecord): Promise<Session> {
    const admitted = lifecycle;
    const check = () => {
      if (disposed || !moduleEnabled || admitted !== lifecycle || registry.get(record.guestId) !== record) throw new BrowserRelayError("lease_revoked");
      currentFence(record).check();
    };
    check();
    const target = session.fromPartition(record.partition);
    let pending = policies.get(record.partition);
    if (!pending) {
      pending = installBrowserSessionPolicy(target, { partition: record.partition, registeredHostIds: registry.hostIds(), policy: policy(record.hostId, record.partition),
        acceptWebContents: id => registry.getByWebContentsId(id)?.hostId === record.hostId && !!networkHost(record.hostId),
        download: (id, item) => decideDownload(id, item), permissions: sitePermissions,
        onRefused: (id, reason) => {
          const current = registry.getByWebContentsId(id);
          if (current) { provider.policyBlocked(current.guestId); fail(current, refusalError(reason).message); }
        },
        onResponse: (id, response) => {
          const current = registry.getByWebContentsId(id), tab = current && data.get(current.guestId);
          if (!current || !tab) return;
          if (response.resourceType !== "mainFrame") {
            // A fetch / XHR of a service page answered 401 ticket-required (network.ts forwards only those).
            if (response.statusCode === 401 && response.headers["x-cutex-service-auth"]?.includes("ticket-required")) reticketFromSubresource(current, tab, response.url);
            return;
          }
          if (response.statusCode === 401 && response.headers["x-cutex-service-auth"]?.includes("ticket-required")) {
            const target = parseBrowserServiceUrl(response.url, networkHost(current.hostId)?.connectionPort);
            if (!target || tab.authRetries++ >= 1) { fail(current, "service_auth_failed"); return; }
            if (!tab.service || tab.service.target.slug !== target.slug) {
              void navigate(current, serviceDisplayUrl(target), true).catch(() => fail(current, "service_auth_failed"));
              return;
            }
            const service = tab.service, generation = tab.navigation;
            service.setPath(target.path);
            void service.retryAuthentication().then(url => {
              if (data.get(current.guestId) !== tab || tab.navigation !== generation || tab.service !== service) return;
              currentFence(current).check();
              return registry.getWebContents(current.guestId)?.loadURL(url);
            }).catch(() => fail(current, "service_auth_failed"));
          } else {
            const code = response.headers["x-cutex-service-error"]?.[0];
            if (code && /^[a-z_]{1,64}$/.test(code)) fail(current, code);
          }
        } });
      policies.set(record.partition, pending);
    }
    await pending;
    // A delayed base setProxy must not start a fresh N2 generation after close/disable.
    check();
    // An N2 failure (listener could not start, revoked mid-setup) must not break local pages: the
    // session stays on (or is restored to) the blackhole proxy and external URLs stay refused.
    await egress.enableSession(target).catch(() => {});
    check();
    return target;
  }
  async function prepareNavigation(record: BrowserGuestRecord, url: string, authenticationRetry = false, operation?: BrowserNavigationGuard, actor: BrowserActor = operation ? "agent" : "owner") {
    operation?.check();
    const guest = registry.getWebContents(record.guestId), tab = data.get(record.guestId);
    if (!guest || guest.isDestroyed() || !tab) throw new BrowserRelayError("target_closed");
    const fence = currentFence(record);
    const serviceTarget = parseBrowserServiceUrl(url, networkHost(record.hostId)?.connectionPort);
    // A page first opened during a health retry has no capability cache yet. Learn it on the
    // first service intent after recovery, without replacing that owner's already-mounted guest.
    if (serviceTarget && !hostCapabilities.has(record.hostId) && fence.daemon.currentState.kind === "connected") {
      const previousNavigation = tab.navigation;
      await prepareHost(record.hostId, fence);
      operation?.check();
      if (disposed || registry.getWebContents(record.guestId) !== guest || tab.navigation !== previousNavigation) throw new BrowserRelayError("target_closed");
    }
    // The owner may have turned external pages on after this tab's session was prepared.
    if (egress.isEnabled()) { await egress.enableSession(session.fromPartition(record.partition)).catch(() => {}); operation?.check(); }
    await admitLan(record, url, actor); operation?.check();
    if (registry.getWebContents(record.guestId) !== guest) throw new BrowserRelayError("target_closed");
    checkTarget(record.hostId, url, record.partition, actor);
    const generation = ++tab.navigation;
    if (!authenticationRetry) tab.authRetries = 0;
    let preparing = true;
    const checkIdentity = () => {
      fence.check();
      if (disposed || registry.getWebContents(record.guestId) !== guest || tab.navigation !== generation) throw new BrowserRelayError("target_closed");
      // Renewal belongs to the mounted tab, not the initiating tool's short deadline. The
      // bootstrap still checks that tool after every awaited lease/ticket response.
      if (preparing) operation?.check();
    };
    const check = () => {
      operation?.check();
      checkIdentity();
      if (serviceTarget && !networkHost(record.hostId)?.serviceProxy) throw new BrowserRelayError("service_unavailable");
    };
    tab.service?.dispose(); tab.service = undefined; tab.error = undefined; tab.favicon = undefined;
    let target = url;
    let preparedService: BrowserServiceSession | undefined;
    const cancel = () => {
      preparedService?.dispose();
      if (tab.service === preparedService) tab.service = undefined;
    };
    if (serviceTarget) {
      const client = fence.daemon.activeClient();
      if (!client) throw new BrowserRelayError("stale_connection");
      const service = new BrowserServiceSession({ client, target: serviceTarget, check: checkIdentity,
        isAvailable: () => networkHost(record.hostId)?.serviceProxy === true,
        connectionPort: () => networkHost(record.hostId)?.connectionPort ?? 0,
        lifetime: hostCapabilities.get(record.hostId)?.has("services-lifetime") === true,
        idempotentLease: () => hostCapabilities.get(record.hostId)?.has("services-lease-idempotent") === true,
        onError: code => fail(record, code) });
      tab.service = service;
      preparedService = service;
      tab.url = displayService(serviceTarget);
      try { operation?.markEffect(); target = await service.start(!authenticationRetry); }
      // The relay gets the collapsed code; the owner's tab / IPC message keeps cutex's precise one.
      catch (error) { cancel(); operation?.check(); throw new BrowserRelayError(browserServiceRelayError(error), browserServiceError(error)); }
    } else { tab.url = browserDisplayUrl(url); admit(record, url); }
    try { check(); registry.nextPageGeneration(record.guestId); publish(registry.get(record.guestId)!); }
    catch (error) { cancel(); throw error; }
    preparing = false;
    return { target, check, cancel, guest };
  }
  async function navigate(record: BrowserGuestRecord, url: string, authenticationRetry = false, actor: BrowserActor = "owner", post?: BrowserPopupPost): Promise<void> {
    const { target, check, guest } = await prepareNavigation(record, url, authenticationRetry, undefined, actor);
    if (actor === "owner") ownerGestures.set(record.guestId, Date.now());
    // A popup's form body is replayed once, only to the exact target it was submitted to (a
    // service ticket rewrite never carries it).
    const options = post && target === url ? { postData: [{ type: "rawData" as const, bytes: post.data }], extraHeaders: `Content-Type: ${post.contentType}\n` } : undefined;
    // Navigation errors never echo the raw (possibly ticket-bearing) URL into renderer/logs.
    try { check(); await guest.loadURL(target, options); check(); } catch { check(); throw new BrowserRelayError("navigation_failed"); }
  }
  /** A hand-over's new page starts with the tab's title / open correlation, fresh page state. */
  function freshTab(previous: TabData | undefined): TabData {
    return { url: previous?.url ?? "about:blank", title: previous?.title ?? "", navigation: 0, authRetries: 0,
      ...(previous?.confirmedOpen ? { confirmedOpen: previous.confirmedOpen } : {}) };
  }
  /** Main's offscreen carrier for an agent-pool tab (carrier.ts): guarded before its first URL. */
  function openCarrier(record: BrowserGuestRecord): BrowserCarrier {
    if (record.pool !== "agent") throw new BrowserRelayError("permission_denied");
    const lease = leases.forGuest(record.guestId), settings = (lease && leases.settings(lease.leaseId)) ?? lastSettings;
    let carrier: BrowserCarrier | undefined;
    carrier = createBrowserCarrier({ hostId: record.hostId, viewport: settings.viewport,
      guard: guest => { guardGuest(guest); if (guest.isDestroyed()) throw new BrowserRelayError("invalid_request"); guest.setWebRTCIPHandlingPolicy("disable_non_proxied_udp"); },
      wanted: () => moduleEnabled && !disposed && ownerWindowVisible(),
      thumbnail: image => {
        const current = registry.get(record.guestId);
        if (!current || !carrier || carriers.get(record.guestId) !== carrier || disposed || owner.isDestroyed()) return;
        emit("browserEvent", { ...view(current), epoch: current.epoch, kind: "thumbnail", thumbnail: image });
      } });
    const created = carrier;
    const guard = guardBrowserCarrierDialogs(created.guest);
    dialogGuards.set(created.guest, guard);
    created.guest.once("destroyed", () => { guard.dispose(); if (carriers.get(record.guestId) === created) carriers.delete(record.guestId); });
    return created;
  }
  /**
   * Start a carrier hand-over: refuse new agent actions at once (busy), wait for the running one to
   * finish (never split it), then note the exact live address (main-only) and the lease to keep.
   */
  async function beginHandover(record: BrowserGuestRecord, to: Handover["to"]): Promise<Handover> {
    const guest = registry.getWebContents(record.guestId);
    if (record.pool !== "agent") throw new BrowserRelayError("permission_denied");
    if (!guest || guest.isDestroyed()) throw new BrowserRelayError("target_closed");
    if (handovers.has(record.guestId) || leases.view(record.guestId)?.state === "pending"
      || [...pendingOpens.values()].some(p => p.record.guestId === record.guestId && !p.confirmed)) throw new BrowserRelayError("busy");
    const handover: Handover = { to, url: "about:blank", paused: false, release: () => {} };
    handovers.set(record.guestId, handover);
    publish(record);
    try { handover.release = await provider.drain(record.guestId, Date.now() + HANDOVER_TIMEOUT_MS); }
    catch (error) { cancelHandover(record.guestId, handover); throw error; }
    if (handovers.get(record.guestId) !== handover || registry.getWebContents(record.guestId) !== guest || guest.isDestroyed()) {
      cancelHandover(record.guestId, handover); throw new BrowserRelayError("target_closed");
    }
    const tab = data.get(record.guestId);
    // Like reload: a service page goes through its ticket flow again; others keep the exact URL.
    const raw = tab?.service ? serviceDisplayUrl(tab.service.target) : guest.getURL();
    handover.url = raw && raw !== "about:blank" && !raw.startsWith("chrome-error:") ? raw : tab?.url && tab.url !== "about:blank" ? tab.url : "about:blank";
    const lease = leases.forGuest(record.guestId);
    if (lease?.state === "active") { handover.leaseId = lease.leaseId; handover.settings = leases.settings(lease.leaseId); }
    handover.paused = provider.controlView(record.guestId)?.state === "paused";
    handover.timer = setTimeout(() => cancelHandover(record.guestId, handover), HANDOVER_TIMEOUT_MS); handover.timer.unref?.();
    return handover;
  }
  function cancelHandover(guestId: string, handover: Handover): void {
    if (handovers.get(guestId) !== handover) return;
    handovers.delete(guestId); if (handover.timer) clearTimeout(handover.timer); handover.release();
    const record = registry.get(guestId); if (record) publish(record);
  }
  /** The new guest is attached: re-prepare the kept lease on it (paused stays paused). */
  async function finishHandover(guestId: string, handover: Handover): Promise<void> {
    if (handovers.get(guestId) !== handover) return;
    handovers.delete(guestId); if (handover.timer) clearTimeout(handover.timer); handover.release();
    const lease = leases.forGuest(guestId);
    if (lease && lease.leaseId === handover.leaseId && lease.state === "active" && !disposed && moduleEnabled) {
      try {
        await leases.resume(guestId, lease.leaseId, handover.settings ?? lastSettings);
        if (handover.paused) provider.ownerTakeover(guestId, "owner-pause");
      } catch {
        // Control could not be re-established on the new page: end it explicitly (never silently).
        if (leases.forGuest(guestId)?.leaseId === lease.leaseId) { adapters.delete(lease.leaseId); leases.revoke(lease.leaseId, "lease_revoked"); }
      }
    }
    const record = registry.get(guestId); if (record) publish(record);
  }
  /** Owner's 「放到后台」 on an agent tab shown in its card: same page, reopened in main's carrier. */
  async function moveToBackground(record: BrowserGuestRecord): Promise<void> {
    if (isBackground(record.guestId)) return;
    if (record.pool !== "agent" || record.status !== "attached") throw new BrowserRelayError("permission_denied");
    const handover = await beginHandover(record, "background");
    let carrier: BrowserCarrier | undefined;
    try {
      await ensureSession(record);
      if (handovers.get(record.guestId) !== handover) throw new BrowserRelayError("target_closed");
      carrier = openCarrier(record);
      const previous = data.get(record.guestId);
      registry.attach(record.guestId, carrier.guest, { replace: true });
      carriers.set(record.guestId, carrier);
      data.set(record.guestId, freshTab(previous));
      wireGuest(registry.get(record.guestId)!, carrier.guest);
    } catch (error) {
      if (carrier && carriers.get(record.guestId) !== carrier) carrier.destroy();
      cancelHandover(record.guestId, handover);
      throw error instanceof BrowserRelayError ? error : new BrowserRelayError("invalid_request");
    }
    try { await navigate(registry.get(record.guestId)!, handover.url, false, "agent"); }
    catch (error) { fail(record, browserServiceError(error)); }
    finally { await finishHandover(record.guestId, handover); }
  }
  function wireGuest(record: BrowserGuestRecord, guest: WebContents): void {
    const tab = data.get(record.guestId)!;
    let faviconSequence = 0;
    const popupInput = (_event: unknown, value: { type: string }) => {
      // Guest mouse events fire for CDP input too (checked in Electron 44); the gate and the
      // gesture clock skip what the provider attributes to the agent's own dispatch.
      popupInputs.get(guest)?.observe(value.type, true);
      if (["mouseDown", "mouseUp", "keyDown"].includes(value.type) && !provider.agentInput(record.guestId)) ownerGestures.set(record.guestId, Date.now());
    };
    const mouseInput = (event: unknown, value: { type: string }) => {
      popupInput(event, value);
      // Co-control: an owner click / scroll never pauses; it only makes the agent read again.
      // The provider attributes input during its own dispatch window to the agent.
      if (value.type === "mouseDown" || value.type === "mouseWheel") provider.ownerActivity(record.guestId, "guest-pointer");
    };
    const keyboardInput = (event: unknown, value: { type: string }) => {
      popupInput(event, value);
      // Owner typing in the page: agent writes wait for a short quiet; never a pause.
      if (value.type === "keyDown" || value.type === "rawKeyDown" || value.type === "char") provider.ownerActivity(record.guestId, "guest-keyboard");
    };
    guest.on("before-input-event", keyboardInput); guest.on("before-mouse-event", mouseInput);
    const stopPolicy = hardenBrowserGuest(guest, { hostId: record.hostId, policy: policy(record.hostId, record.partition),
      onBlocked: (_kind, _url, mainFrame, reason) => { if (mainFrame) provider.policyBlocked(record.guestId); fail(record, refusalError(reason).message); } });
    const changed = () => {
      const current = registry.get(record.guestId);
      if (!current || registry.getWebContents(record.guestId) !== guest || guest.isDestroyed()) return;
      const raw = guest.getURL();
      const target = parseBrowserServiceUrl(raw, networkHost(record.hostId)?.connectionPort);
      if (target) {
        tab.url = displayService(target);
        if (tab.service?.target.slug !== target.slug) {
          // A page link/history navigation also needs a lease, even with a still-valid cookie.
          void navigate(current, serviceDisplayUrl(target), true).catch(error => fail(current, browserServiceError(error)));
        } else tab.service.setPath(target.path);
      } else if (!tab.service) tab.url = browserDisplayUrl(raw);
      else if (raw && !raw.includes(AUTH_PATH) && raw !== "about:blank") { tab.service.dispose(); tab.service = undefined; tab.url = browserDisplayUrl(raw); }
      tab.title = guest.getTitle().slice(0, 200);
      publish(current);
    };
    const documentStarted = (_event: unknown, _url: string, _inPlace: boolean, mainFrame: boolean) => { if (mainFrame) tab.documentEpoch = (tab.documentEpoch ?? 0) + 1; };
    const inPage = () => { tab.documentEpoch = (tab.documentEpoch ?? 0) + 1; changed(); };
    const navigated = () => { tab.documentEpoch = (tab.documentEpoch ?? 0) + 1; tab.favicon = undefined; if (tab.sitePermission?.state !== "waiting") tab.sitePermission = undefined; if (registry.get(record.guestId)) registry.nextPageGeneration(record.guestId); changed(); };
    const favicon = (_event: unknown, urls: string[]) => {
      const sequence = ++faviconSequence;
      const current = registry.get(record.guestId);
      if (!current || !moduleEnabled || registry.getWebContents(record.guestId) !== guest) return;
      const navigation = tab.navigation, pageGeneration = current.pageGeneration;
      let fence: HostFence<DaemonService>;
      try { fence = currentFence(current); fence.check(); } catch { return; }
      void readBrowserFavicon(guest, urls, value => policy(record.hostId, record.partition).isRequestAllowed(value, "image")).then(value => {
        try { fence.check(); } catch { return; }
        const latest = registry.get(record.guestId);
        if (!moduleEnabled || !latest || sequence !== faviconSequence || latest.pageGeneration !== pageGeneration || tab.navigation !== navigation || registry.getWebContents(record.guestId) !== guest) return;
        tab.favicon = value; publish(latest);
      });
    };
    // Loading begins while getURL() may still name the previous document. Never use it to
    // release the lease just acquired for an in-flight service navigation.
    const loading = () => { const current = registry.get(record.guestId); if (current) publish(current); };
    const title = () => { tab.title = guest.getTitle().slice(0, 200); loading(); };
    guest.on("did-start-navigation", documentStarted); guest.on("did-navigate", navigated); guest.on("did-navigate-in-page", inPage);
    guest.on("page-favicon-updated", favicon);
    guest.on("page-title-updated", title); guest.on("did-start-loading", loading); guest.on("did-stop-loading", loading);
    guest.on("enter-html-full-screen", () => { if (!window.isDestroyed() && window.isFullScreen()) window.setFullScreen(false); });
    let wired = true;
    tab.dispose = () => {
      if (!wired) return;
      wired = false;
      stopPolicy(); guest.removeListener("before-input-event", keyboardInput); guest.removeListener("before-mouse-event", mouseInput);
      guest.removeListener("did-start-navigation", documentStarted); guest.removeListener("did-navigate", navigated); guest.removeListener("did-navigate-in-page", inPage);
      guest.removeListener("page-favicon-updated", favicon);
      guest.removeListener("page-title-updated", title); guest.removeListener("did-start-loading", loading); guest.removeListener("did-stop-loading", loading);
    };
    guestDisposers.set(guest, tab.dispose);
  }
  async function execute(request: Exclude<BrowserRequest, { op: "setEnabled" | "resetOrigins" | "externalPages" | "sitePermissions" }>, hostId: string, fence?: HostFence<DaemonService>): Promise<unknown> {
    if (!moduleEnabled || disposed) throw new BrowserRelayError("browser_disabled");
    const admittedLifecycle = lifecycle;
    const checkLifecycle = () => { if (!moduleEnabled || disposed || admittedLifecycle !== lifecycle) throw new BrowserRelayError("browser_disabled"); };
    syncHosts();
    if (request.op === "reserveOwnerTab") {
      if (!fence) throw new BrowserRelayError("stale_connection");
      await prepareHost(hostId, fence); fence.check(); checkLifecycle();
      const tabKey = randomUUID();
      tabIdentities().registerOwner(hostId, tabKey);
      registry.ensure(hostId, tabKey, "owner");
      return { tabKey };
    }
    if (request.op === "list") return registry.list(hostId).map(record => view(record));
    if (request.op === "turnShots" || request.op === "turnShot" || request.op === "toolItem" || request.op === "agents" || request.op === "settings" || request.op === "clearIdempotency" || request.op === "profileTools") {
      const client = fence?.daemon.activeClient(); if (!client || !fence) throw new BrowserRelayError("browser_unavailable");
      const api = createBrowserOwnerApi({ client, check() { checkLifecycle(); fence.check(); }, decodeImage: bytes => nativeImage.createFromBuffer(bytes) });
      if (request.op === "turnShots") return api.turnShots(request.sessionId, request.turnId);
      if (request.op === "turnShot") return api.turnShot(request.id);
      if (request.op === "toolItem") return api.toolItem(request.sessionId, request.turnId, request.itemId);
      if (request.op === "settings") return api.settings(request.agentOpenApproval);
      if (request.op === "clearIdempotency") return api.clearIdempotency(request.cutexSessionId);
      if (request.op === "profileTools") return api.profileTools(request.profile, request.enabled);
      return api.agents();
    }
    if (request.op === "openRefused") {
      const pending = pendingOpens.get(openKey(hostId, request.requestId));
      if (pending?.record.hostId === hostId) { cancelPendingGuest(pending.record.guestId); pending.reject(new BrowserRelayError(request.code)); leases.revokeGuest(pending.record.guestId); registry.close(pending.record.guestId); }
      else {
        // A lost confirmation event can make the generous renderer fallback discard
        // a now-confirmed card. Correlate the exact command before retiring main too.
        const confirmed = registry.list(hostId).find(record => data.get(record.guestId)?.confirmedOpen === request.requestId);
        if (confirmed) registry.close(confirmed.guestId);
      }
      return;
    }
    if (request.op === "releaseLease" || request.op === "holdReady" || request.op === "resumeLease" || request.op === "grantAgent" || request.op === "pauseLease") {
      const record = registry.getByTab(hostId, request.tabKey);
      if (!record) { if (request.op === "releaseLease" || request.op === "pauseLease" || (request.op === "holdReady" && !request.held)) return; throw new BrowserRelayError("target_closed"); }
      // Authority-reducing and idempotent: only the exact current lease; the lease itself stays.
      if (request.op === "pauseLease") { if (leases.forGuest(record.guestId)?.leaseId === request.leaseId) provider.ownerTakeover(record.guestId, "owner-pause"); return; }
      if (request.op === "holdReady") return leases.held(record.guestId, request.leaseId, request.held);
      if (request.op === "releaseLease") {
        const lease = leases.forGuest(record.guestId);
        if (lease?.leaseId === request.leaseId) {
          // The owner's 停止并撤销授予 also ends that agent's 一直允许 for this page's origin.
          const origin = request.owner ? browserClaimOrigin(data.get(record.guestId)?.url) : null;
          if (origin) claimAllows.revoke(hostId, lease.cutexSessionId, origin);
          leases.revoke(request.leaseId, "lease_revoked"); adapters.delete(request.leaseId);
        }
        return;
      }
      if (request.op === "resumeLease") { lastSettings = request.settings; adapters.delete(request.leaseId); return leases.resume(record.guestId, request.leaseId, request.settings); }
      if (record.guestId !== request.expected.guestId || record.pageGeneration !== request.expected.pageGeneration) throw new BrowserRelayError("stale_request");
      lastSettings = request.settings;
      await grantRecord(hostId, record, request.sessionId, request.settings, request.approvalId, { remember: request.remember === true && !!request.approvalId });
      return;
    }
    if (request.op === "claimOpen") { lastSettings = request.settings; return claims.ownerOpen(hostId, request.approvalId); }
    if (request.op === "claimPolicy") {
      return request.mode === undefined ? claimPolicyStore().get(hostId, request.profile) : claimPolicyStore().set(hostId, request.profile, request.mode);
    }
    if (request.op === "claimAllows") return claimAllows.list(hostId);
    if (request.op === "claimAllowRevoke") { claimAllows.revoke(hostId, request.sessionId, request.origin); return; }
    if (request.op === "claimAudit") return claimAudit.list(hostId);
    if (request.op === "ownerInput") {
      // Co-control: owner activity only (never a pause; 「暂停智能体」 is pauseLease).
      const record = registry.getByTab(hostId, request.tabKey);
      if (record) provider.ownerActivity(record.guestId, request.kind === "keydown" ? "guest-keyboard" : "guest-pointer");
      return; // Missing/ungranted targets are an idempotent no-op.
    }
    if (request.op === "close" || request.op === "stop") {
      const record = registry.getByTab(hostId, request.tabKey);
      if (!record) return;
      if (request.op === "stop") {
        const oldLease = leases.forGuest(record.guestId); if (oldLease) adapters.delete(oldLease.leaseId);
        leases.revokeGuest(record.guestId);
        provider.release(record.guestId);
        const tab = data.get(record.guestId);
        if (tab) { tab.navigation++; tab.service?.dispose(); tab.service = undefined; }
        registry.getWebContents(record.guestId)?.stop(); return;
      }
      for (const [key, value] of reservations) if (value.guestId === record.guestId) reservations.delete(key);
      const pending = [...pendingOpens.values()].find(value => value.record.guestId === record.guestId && !value.confirmed);
      if (pending) { cancelPendingGuest(record.guestId); pending.reject(new BrowserRelayError("target_closed")); registry.close(record.guestId); }
      else if (request.op === "close" && request.unmount) registry.unmount(record.guestId); else registry.close(record.guestId);
      return;
    }
    if (request.op === "open") {
      if (!moduleEnabled) throw new BrowserRelayError("browser_disabled");
      if (!fence) throw new BrowserRelayError("stale_connection");
      if (request.receipt) {
        const key = browserAttachId(request.receipt.src), reservation = key && reservations.get(key);
        const pending = unbound.get(request.receipt.webContentsId);
        const record = registry.getByTab(hostId, request.tabKey);
        if (!reservation || !reservation.admitted || reservation.expires < Date.now() || reservation.hostId !== hostId || reservation.tabKey !== request.tabKey
          || reservation.requestUrl !== request.url || reservation.guestId !== record?.guestId || reservation.epoch !== record.epoch || !pending
          || !popupGuards.has(pending.guest) || pending.guest.hostWebContents !== owner || pending.guest.session !== session.fromPartition(reservation.partition)) throw new BrowserRelayError("invalid_request");
        reservations.delete(key!); unbound.delete(pending.guest.id);
        // Front hand-over: this webview replaces main's background carrier of the same tab.
        const handover = handovers.get(record.guestId), replacing = handover?.to === "front" && isBackground(record.guestId);
        if (handover && !replacing) cancelHandover(record.guestId, handover);
        const previous = data.get(record.guestId);
        registry.attach(record.guestId, pending.guest, { replace: replacing });
        if (replacing) data.set(record.guestId, freshTab(previous));
        try { wireGuest(record, pending.guest); }
        catch { registry.close(record.guestId); throw new BrowserRelayError("invalid_request"); }
        const agentOpen = request.identity?.pendingOpen && pendingOpens.get(openKey(hostId, request.identity.pendingOpen));
        void navigate(registry.get(record.guestId)!, reservation.url, false, reservation.actor, reservation.post).then(() => {
          if (reservation.popupGrant) void grantPopup(record, reservation.popupGrant).catch(() => { /* the tab stays the owner's to hand over */ });
          if (agentOpen && agentOpen.record.guestId === record.guestId) agentOpen.ready();
        }).catch(error => { fail(record, browserServiceError(error)); if (agentOpen && agentOpen.record.guestId === record.guestId) agentOpen.reject(new BrowserRelayError(relayError(error))); })
          .finally(() => { if (replacing) void finishHandover(record.guestId, handover!); });
        return { guestId: record.guestId, tabKey: record.tabKey, partition: record.partition, pool: record.pool, src: request.receipt.src } satisfies BrowserTabMount;
      }
      await prepareHost(hostId, fence);
      const agentOpen = request.identity?.pendingOpen && pendingOpens.get(openKey(hostId, request.identity.pendingOpen));
      if (request.identity?.pendingOpen && (!agentOpen || agentOpen.record.hostId !== hostId || agentOpen.record.tabKey !== request.tabKey || agentOpen.context.signal.aborted)) throw new BrowserRelayError("stale_request");
      const known = registry.getByTab(hostId, request.tabKey);
      // Renderer flags cannot select a pool, including by omitting agentOpened. The main-only
      // provenance tombstone survives restart/close; legacy non-UUID owner IDs predate I3.
      const canonical = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(request.tabKey);
      const knownOwner = canonical && tabIdentities().owner(hostId, request.tabKey);
      const recovery = !known && (canonical ? tabIdentities().unproven(hostId, request.tabKey) : tabIdentities().requiresProof());
      const agentOrigin = known?.pool === "agent" || !!agentOpen || recovery || (!known && canonical && tabIdentities().agent(hostId, request.tabKey));
      if (request.identity?.agentOpened && !agentOrigin) throw new BrowserRelayError("permission_denied");
      // A popup's new tab: main's exact URL and body, once, for the pool that minted the key.
      const popupKey = JSON.stringify([hostId, request.tabKey]), popup = popupTargets.get(popupKey);
      if (popup) popupTargets.delete(popupKey);
      const fromPopup = popup && popup.expires >= Date.now() && popup.pool === (agentOrigin ? "agent" : "owner") && !agentOpen ? popup : undefined;
      const url = agentOpen && agentOpen.command.operation.kind === "tabs.open" ? agentOpen.command.operation.url : fromPopup ? fromPopup.url : request.url;
      // An agent chose this URL (agent pool / agent-open / a claim's local page): agent actor.
      const actor: BrowserActor = agentOrigin || claimTabs.has(JSON.stringify([hostId, request.tabKey])) ? "agent" : "owner";
      // An owner LAN / tailnet URL is admitted (and its proxy started) by the mount's own navigation.
      const lanUrl = actor === "owner" && !isControlUrl(url) && !!(await lanTargets.classify(url));
      fence.check(); checkLifecycle();
      if (!egress.isEnabled() && !lanUrl) checkTarget(hostId, url, undefined, actor);
      fence.check();
      checkLifecycle();
      const record = registry.ensure(hostId, request.tabKey, agentOrigin ? "agent" : "owner");
      // The background carrier is for agent-pool tabs only: an owner tab (or an owner tab granted
      // to an agent) keeps the visible webview path, whatever the renderer asks for.
      const background = request.identity?.carrier === "background";
      if (background && record.pool !== "agent") throw new BrowserRelayError("permission_denied");
      let handover: Handover | undefined;
      if (registry.getWebContents(record.guestId)) {
        // A card re-render of a tab main already carries in the background (after its hand-over).
        if (background && isBackground(record.guestId)) return { guestId: record.guestId, tabKey: record.tabKey, partition: record.partition, pool: record.pool, src: "", carrier: "background" } satisfies BrowserTabMount;
        // The card wants the page in its webview again: hand it over (never splits a running action).
        if (!background && isBackground(record.guestId) && !request.identity?.pendingOpen) handover = await beginHandover(record, "front");
        else throw new BrowserRelayError("busy");
      }
      const target = handover?.url ?? url, targetActor: BrowserActor = handover ? "agent" : actor;
      if (!agentOrigin && canonical) {
        try { tabIdentities().registerOwner(hostId, request.tabKey); }
        catch (error) {
          if (!(error instanceof BrowserRelayError) || error.code !== "browser_identity_unavailable") throw error;
          // Refreshing LRU order is best effort for an already proven owner.
          // A first proof still must persist before owner cookies are mounted.
          if (!knownOwner) { if (!known) registry.close(record.guestId); throw error; }
          console.warn("browser owner provenance refresh failed", error);
        }
      }
      try {
        await ensureSession(record); fence.check(); checkLifecycle(); if (!lanUrl || handover) checkTarget(hostId, target, record.partition, targetActor);
      } catch (error) { if (handover) cancelHandover(record.guestId, handover); else registry.close(record.guestId); throw error; }
      if (!registry.get(record.guestId)) throw new BrowserRelayError("browser_disabled");
      const serviceTarget = parseBrowserServiceUrl(url, networkHost(hostId)?.connectionPort);
      const initialTab = (): TabData => ({ url: serviceTarget ? displayService(serviceTarget) : browserDisplayUrl(url), title: "", navigation: 0, authRetries: 0,
        ...(recovery ? { error: "browser_identity_recovered" } : {}) });
      if (background) {
        // Main's own offscreen carrier: no webview, reservation or renderer receipt. Same partition,
        // session hooks and per-guest hardening as a webview of this pool (registry attribution).
        const carrier = openCarrier(record);
        try { registry.attach(record.guestId, carrier.guest); }
        catch { carrier.destroy(); registry.close(record.guestId); throw new BrowserRelayError("invalid_request"); }
        carriers.set(record.guestId, carrier);
        data.set(record.guestId, initialTab());
        try { wireGuest(record, carrier.guest); }
        catch { registry.close(record.guestId); throw new BrowserRelayError("invalid_request"); }
        publish(registry.get(record.guestId)!);
        void navigate(registry.get(record.guestId)!, url, false, actor, fromPopup?.post).then(() => {
          if (fromPopup?.grant) void grantPopup(record, fromPopup.grant).catch(() => { /* the tab stays the owner's to hand over */ });
          if (agentOpen && agentOpen.record.guestId === record.guestId) agentOpen.ready();
        }).catch(error => { fail(record, browserServiceError(error)); if (agentOpen && agentOpen.record.guestId === record.guestId) agentOpen.reject(new BrowserRelayError(relayError(error))); });
        return { guestId: record.guestId, tabKey: record.tabKey, partition: record.partition, pool: record.pool,
          ...(recovery ? { recovery: "browser_identity_recovered" as const } : {}), src: "", carrier: "background" } satisfies BrowserTabMount;
      }
      const attachId = randomBytes(32).toString("hex");
      for (const [key, value] of reservations) if (value.guestId === record.guestId) reservations.delete(key);
      reservations.set(attachId, { attachId, hostId, guestId: record.guestId, epoch: record.epoch, tabKey: record.tabKey,
        partition: record.partition, url: target, requestUrl: request.url, admitted: false, expires: Date.now() + 30_000, actor: targetActor,
        ...(!handover && fromPopup?.post ? { post: fromPopup.post } : {}), ...(!handover && fromPopup?.grant ? { popupGrant: fromPopup.grant } : {}) });
      // A hand-over keeps the carrier's tab state until the webview's receipt replaces it.
      if (!handover) { data.set(record.guestId, initialTab()); publish(record, "pending"); }
      else publish(record);
      return { guestId: record.guestId, tabKey: record.tabKey, partition: record.partition, pool: record.pool,
        ...(recovery ? { recovery: "browser_identity_recovered" as const } : {}), src: browserAttachSource(attachId) } satisfies BrowserTabMount;
    }
    const record = registry.getByTab(hostId, request.tabKey), guest = record && registry.getWebContents(record.guestId);
    if (!record || !guest || guest.isDestroyed()) throw new BrowserRelayError("target_closed");
    if (request.op === "navigate") return navigate(record, request.url);
    if (request.op === "toBackground") return moveToBackground(record);
    if (request.op === "reload") {
      const tab = data.get(record.guestId);
      const raw = guest.getURL();
      const serviceTarget = tab?.service?.target ?? parseBrowserServiceUrl(raw, networkHost(hostId)?.connectionPort);
      if (serviceTarget) return navigate(record, serviceDisplayUrl(serviceTarget));
      // Display/state URLs deliberately omit secrets and fragments. Only the guest retains the
      // exact live navigation, so a normal refresh must use Chromium's own reload semantics.
      await admitLan(record, raw, "owner"); fence?.check();
      checkTarget(hostId, raw, record.partition); fence?.check(); admit(record, raw);
      if (tab) { tab.navigation++; tab.authRetries = 0; tab.error = undefined; tab.favicon = undefined; }
      guest.reload();
      return;
    }
    const offset = request.op === "back" ? -1 : 1;
    const entry = guest.navigationHistory.getAllEntries()[guest.navigationHistory.getActiveIndex() + offset];
    if (!entry) return;
    await admitLan(record, entry.url, "owner"); fence?.check();
    checkTarget(hostId, entry.url, record.partition); fence?.check(); admit(record, entry.url); guest.navigationHistory.goToOffset(offset);
  }
  const handle = createBrowserChannel({
    // Do not delegate this security boundary solely to the caller's general app-origin predicate.
    isAppSender: (event: IpcMainInvokeEvent) => !disposed && !owner.isDestroyed() && event.sender === owner && event.senderFrame === owner.mainFrame && isAppSender(event),
    isEnabled: () => moduleEnabled && !disposed, getHosts, async execute(request, hostId, fence) {
      try { return await execute(request, hostId, fence); }
      catch (error) {
        if (request.op === "open" && request.identity?.pendingOpen) {
          const pending = pendingOpens.get(openKey(hostId, request.identity.pendingOpen));
          if (pending?.record.tabKey === request.tabKey) pending.reject(new BrowserRelayError(relayError(error)));
        }
        throw error;
      }
    }, resetOrigins() { tabIdentities().reset(registry.list()); }, sitePermissions(forget) {
      const store = sitePermissionsStore();
      if (forget) store.forget(forget);
      return store.list();
    }, externalPages(enabled) {
      if (enabled === undefined) return externalPages().view();
      let view;
      try { view = externalPages().set(enabled); }
      finally {
        // Off: close the listener and restore every configured browser session synchronously,
        // also when persisting failed (the store already reads off in memory).
        if (!externalPages().enabled()) egress.stop();
      }
      // On: re-arm the browser partitions that already have tabs, so in-page links work at once.
      // Off with owner-opened LAN tabs: their (LAN-only) proxy comes back for them alone.
      if ((view.enabled || lanTargets.size > 0) && moduleEnabled && !disposed)
        for (const partition of new Set(registry.list().map(record => record.partition)))
          if (policies.has(partition)) void egress.enableSession(session.fromPartition(partition)).catch(() => {});
      return view;
    }, setEnabled(enabled) {
      moduleEnabled = enabled && !disposed;
      if (!moduleEnabled) reset();
      else syncHosts();
    },
  });
  ipcMain.handle(BROWSER_CHANNEL, (event, request: unknown, binding: HostBinding | null) => handle(event, request, binding));
  owner.on("will-attach-webview", (event, prefs, params) => {
    syncHosts();
    const key = browserAttachId(params.src), candidate = key && reservations.get(key);
    const reservation = candidate && !candidate.admitted && candidate.expires >= Date.now() && registry.get(candidate.guestId)?.epoch === candidate.epoch ? candidate : undefined;
    if (candidate) candidate.admitted = true; // consume before any validation/side effect, including denial
    const result = evaluateBrowserAttach({ moduleEnabled, popupGuardInstalled, registeredHostIds: registry.hostIds(), appWebContentsId: owner.id,
      senderWebContentsId: (event as unknown as { sender?: WebContents }).sender?.id ?? owner.id, reservation, params: params as unknown as Record<string, unknown>, webPreferences: prefs as Record<string, unknown> });
    if (!result.allowed) { event.preventDefault(); if (key) reservations.delete(key); }
  });
  owner.on("did-attach-webview", (_event, guest) => {
    // will-attach may have completed immediately before a disable/reload. Never retain a late guest.
    if (!moduleEnabled || disposed || owner.isDestroyed() || !popupGuards.has(guest)) {
      if (!guest.isDestroyed()) guest.close({ waitForBeforeUnload: false });
      return;
    }
    // No association by arrival order. The exact element returns a one-use receipt through trusted IPC.
    guest.setWebRTCIPHandlingPolicy("disable_non_proxied_udp");
    unbound.set(guest.id, { guest, expires: Date.now() + 15_000 });
    guest.once("destroyed", () => unbound.delete(guest.id));
  });
  const timer = setInterval(() => {
    syncHosts();
    for (const [key, value] of reservations) if (value.expires < Date.now()) reservations.delete(key);
    for (const [id, value] of unbound) if (value.expires < Date.now()) { unbound.delete(id); if (!value.guest.isDestroyed()) value.guest.close({ waitForBeforeUnload: false }); }
  }, 250);
  const ownerActivity = (_event?: unknown, input?: { type?: string }) => {
    if (!moduleEnabled || disposed) return;
    for (const entry of relays.values()) entry.relay?.noteOwnerActivity();
    // The owner typing in the app (composer, address bar): agent writes wait for the quiet, so an
    // agent click cannot pull focus into a page mid-sentence.
    if (input?.type === "keyDown" || input?.type === "rawKeyDown" || input?.type === "char") provider.ownerActivity(undefined, "app-keyboard");
  };
  // Embedder input is not guest/CDP input. Page events are deliberately excluded.
  owner.on("before-input-event", ownerActivity); owner.on("before-mouse-event", ownerActivity);
  window.on("focus", ownerActivity);
  timer.unref();
  const reset = () => {
    lifecycle++;
    for (const [guestId, handover] of [...handovers]) cancelHandover(guestId, handover);
    for (const pending of pendingOpens.values()) pending.reject(new BrowserRelayError("browser_disabled"));
    for (const entry of relays.values()) entry.relay?.dispose(); relays.clear(); relayRetryAfter.clear();
    leases.dispose(); adapters.clear(); autoReasons.clear();
    for (const timer of claimRetries.values()) clearTimeout(timer); claimRetries.clear();
    for (const hostId of registry.hostIds()) claims.forgetHost(hostId);
    egress.stop();
    reservations.clear(); admissions.clear(); lanTargets.clear(); popupTargets.clear(); ownerGestures.clear(); blockedNotices.clear();
    for (const { guest } of unbound.values()) if (!guest.isDestroyed()) guest.close({ waitForBeforeUnload: false });
    unbound.clear(); registry.dispose(); data.clear(); hostCapabilities.clear(); capabilityRevisions.clear(); capabilityRecovery.clear(); capabilityRetryAfter.clear(); hostGenerations.clear(); hostEpochs.clear(); hostDaemons.clear();
  };
  owner.on("did-start-navigation", (_event, _url, _inPlace, mainFrame) => { if (mainFrame) { moduleEnabled = false; reset(); } });
  owner.on("render-process-gone", () => { moduleEnabled = false; reset(); });
  const dispose = () => {
    if (disposed) return;
    reset(); disposed = true; clearInterval(timer); ipcMain.removeHandler(BROWSER_CHANNEL);
    provider.dispose();
    // Background carriers are hidden windows: they would keep the app alive past the last app window.
    for (const carrier of [...carriers.values()]) { try { carrier.destroy(); } catch { /* Already gone. */ } }
    carriers.clear();
    if (syncCurrentHosts === syncHosts) syncCurrentHosts = undefined;
    currentHostEvent = undefined;
    popupGuardInstalled = false;
    // Admission is already revoked. Teardown of one native listener must not stop
    // other listener/session cleanup (including an already-destroyed embedder).
    for (const remove of [() => app.removeListener("web-contents-created", guardCreatedGuest),
      () => owner.removeListener?.("before-input-event", ownerActivity), () => owner.removeListener?.("before-mouse-event", ownerActivity),
      () => window.removeListener?.("focus", ownerActivity), () => app.removeListener("login", proxyLogin), () => app.removeListener("before-quit", dispose)]) {
      try { remove(); } catch { /* Continue the remaining authority-reducing cleanup. */ }
    }
    for (const [partition, pending] of policies) { revokeBrowserSessionPolicy(session.fromPartition(partition)); void pending.catch(() => {}); }
  };
  previousWindow = dispose;
  syncCurrentHosts = syncHosts;
  owner.on("destroyed", dispose); app.on("before-quit", dispose);
}
