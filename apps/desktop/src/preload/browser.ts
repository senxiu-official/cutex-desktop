import type { BrowserCursorPreferences } from "../shared/browserCursor";
import type { BrowserCarrierPreferences } from "../shared/browserCarrier";
import { BROWSER_CHANNEL, type BrowserBridge, type BrowserEvent, type BrowserRequest, type BrowserTabMount, type BrowserTabView, type BrowserTurnShot, type BrowserImage, type BrowserToolItem, type BrowserAgentView, type BrowserHostSettings, type BrowserIdempotencyClearResult, type BrowserClaimPolicyView, type BrowserClaimAllowView, type BrowserClaimAuditView, type BrowserExternalPagesView, type BrowserSitePermissionView, type BrowserProfileTools, type BrowserViewMemory } from "../shared/browser";
import type { HostBinding } from "../shared/hosts";
import type { WhatsAppWatchView } from "../shared/browser";

import { BROWSER_IDENTITY_CHANNEL, type BrowserIdentityBridge, type BrowserIdentityEvent, type BrowserIdentityRequest } from "../shared/browserIdentity";

export interface BrowserPreloadOptions {
  /** 浏览器身份 events (DesktopEvents.browserIdentityEvent). */
  subscribeIdentities?(listener: (event: BrowserIdentityEvent) => void): () => void;
  invoke(channel: string, request: BrowserRequest, binding: HostBinding | null): Promise<unknown>;
  binding(hostId: string): HostBinding | null;
  /** Existing EVENT_CHANNEL delivery, after the shared HostTag filter. */
  subscribe(listener: (event: BrowserEvent) => void): () => void;
}
export function browserBridge(options: BrowserPreloadOptions): BrowserBridge {
  return {
    setEnabled: enabled => options.invoke(BROWSER_CHANNEL, { op: "setEnabled", enabled }, null) as Promise<void>,
    resetOrigins: () => options.invoke(BROWSER_CHANNEL, { op: "resetOrigins" }, null) as Promise<void>,
    whatsAppModule: enabled => options.invoke(BROWSER_CHANNEL, enabled === undefined ? { op: "whatsAppModule" } : { op: "whatsAppModule", enabled }, null) as Promise<{ enabled: boolean }>,
    externalPages: enabled => options.invoke(BROWSER_CHANNEL, enabled === undefined ? { op: "externalPages" } : { op: "externalPages", enabled }, null) as Promise<BrowserExternalPagesView>,
    systemProxy: enabled => options.invoke(BROWSER_CHANNEL, enabled === undefined ? { op: "systemProxy" } : { op: "systemProxy", enabled }, null) as Promise<{ enabled: boolean }>,
    cursorColor: color => options.invoke(BROWSER_CHANNEL, color === undefined ? { op: "cursorColor" } : { op: "cursorColor", color }, null) as Promise<BrowserCursorPreferences>,
    carrierFrameRate: frameRate => options.invoke(BROWSER_CHANNEL, frameRate === undefined ? { op: "carrierFrameRate" } : { op: "carrierFrameRate", frameRate }, null) as Promise<BrowserCarrierPreferences>,
    sitePermissions: forget => options.invoke(BROWSER_CHANNEL, forget === undefined ? { op: "sitePermissions" } : { op: "sitePermissions", forget }, null) as Promise<BrowserSitePermissionView[]>,
    forHost(hostId) {
      const call = (request: BrowserRequest) => {
        const observed = options.binding(hostId);
        // Cleanup remains reachable with an expired epoch, but never an unbound target host.
        const binding = observed ? { hostId: observed.hostId, epoch: observed.epoch } :
          request.op === "close" || request.op === "stop" || request.op === "ownerInput" || request.op === "releaseLease" || request.op === "openRefused" || (request.op === "holdReady" && !request.held) ? { hostId, epoch: "" } : null;
        return options.invoke(BROWSER_CHANNEL, request, binding);
      };
      return {
        whatsAppWatch: () => call({ op: "whatsAppWatch" }) as Promise<WhatsAppWatchView>,
        setWhatsAppWatch: (tabKey, enabled, preview) => call({ op: "setWhatsAppWatch", tabKey, enabled, preview }) as Promise<WhatsAppWatchView>,
        unbindWhatsAppWatch: tabKey => call({ op: "unbindWhatsAppWatch", tabKey }) as Promise<WhatsAppWatchView>,
        openBlockedNavigation: (tabKey, id) => call({ op: "openBlockedNavigation", tabKey, id }) as Promise<void>,
        openOwnerNotice: (tabKey, id) => call({ op: "openOwnerNotice", tabKey, id }) as Promise<void>,
        dismissLoginWarning: (tabKey, origin) => call({ op: "dismissLoginWarning", tabKey, origin }) as Promise<void>,
        openOwnerCopy: tabKey => call({ op: "openOwnerCopy", tabKey }) as Promise<{ tabKey: string; url: string }>,
        reserveOwnerTab: browserIdentityId => call({ op: "reserveOwnerTab", ...(browserIdentityId !== undefined ? { browserIdentityId } : {}) }) as Promise<{ tabKey: string }>,
        list: () => call({ op: "list" }) as Promise<BrowserTabView[]>,
        turnShots: (sessionId, turnId) => call({ op: "turnShots", sessionId, turnId }) as Promise<BrowserTurnShot[]>,
        turnShot: id => call({ op: "turnShot", id }) as Promise<BrowserImage>,
        toolItem: (sessionId, turnId, itemId) => call({ op: "toolItem", sessionId, turnId, itemId }) as Promise<BrowserToolItem>,
        agents: () => call({ op: "agents" }) as Promise<BrowserAgentView[]>,
        settings: agentOpenApproval => call({ op: "settings", ...(agentOpenApproval !== undefined ? { agentOpenApproval } : {}) }) as Promise<BrowserHostSettings>,
        desktopLoopback: enabled => call({ op: "desktopLoopback", ...(enabled !== undefined ? { enabled } : {}) }) as Promise<{ enabled: boolean }>,
        desktopLoopbackChallenge: (tabKey, url) => call({ op: "desktopLoopbackChallenge", tabKey, url }) as Promise<{ nonce: string }>,
        clearIdempotency: cutexSessionId => call({ op: "clearIdempotency", ...(cutexSessionId ? { cutexSessionId } : {}) }) as Promise<BrowserIdempotencyClearResult>,
        profileTools: (profile, enabled, surface) => call({ op: "profileTools", profile, ...(enabled !== undefined ? { enabled } : {}), ...(surface !== undefined ? { surface } : {}) }) as Promise<BrowserProfileTools>,
        grantAgent: (tabKey, sessionId, settings, approvalId, expected, options) => call({ op: "grantAgent", tabKey, sessionId, settings, expected, ...(approvalId ? { approvalId } : {}), ...(approvalId && options?.remember ? { remember: true as const } : {}) }) as Promise<void>,
        claimOpen: (approvalId, settings) => call({ op: "claimOpen", approvalId, settings }) as Promise<void>,
        claimPolicy: (profile, mode) => call({ op: "claimPolicy", profile, ...(mode !== undefined ? { mode } : {}) }) as Promise<BrowserClaimPolicyView>,
        claimAllows: () => call({ op: "claimAllows" }) as Promise<BrowserClaimAllowView[]>,
        claimAllowRevoke: (sessionId, origin) => call({ op: "claimAllowRevoke", sessionId, ...(origin !== undefined ? { origin } : {}) }) as Promise<void>,
        claimAudit: () => call({ op: "claimAudit" }) as Promise<BrowserClaimAuditView[]>,
        holdReady: (tabKey, leaseId, held) => call({ op: "holdReady", tabKey, leaseId, held }) as Promise<void>,
        releaseLease: (tabKey, leaseId, owner) => call({ op: "releaseLease", tabKey, leaseId, ...(owner ? { owner: true as const } : {}) }) as Promise<void>,
        resumeLease: (tabKey, leaseId, settings) => call({ op: "resumeLease", tabKey, leaseId, settings }) as Promise<void>,
        pauseLease: (tabKey, leaseId) => call({ op: "pauseLease", tabKey, leaseId }) as Promise<void>,
        openRefused: (requestId, code) => call({ op: "openRefused", requestId, code }) as Promise<void>,
        open: (tabKey, url, receipt, identity, options) => call({ op: "open", tabKey, url, ...(receipt ? { receipt } : {}), ...(identity ? { identity } : {}), ...(options?.desktopLoopback ? { desktopLoopback: options.desktopLoopback } : {}) }) as Promise<BrowserTabMount>,
        navigate: (tabKey, url, options) => call({ op: "navigate", tabKey, url, ...(options?.desktopLoopback ? { desktopLoopback: options.desktopLoopback } : {}) }) as Promise<void>,
        ownerInput: (tabKey, kind) => call({ op: "ownerInput", tabKey, kind }) as Promise<void>,
        setZoom: (tabKey, action) => call({ op: "setZoom", tabKey, action }) as Promise<void>,
        setMuted: (tabKey, muted) => call({ op: "setMuted", tabKey, muted }) as Promise<void>,
        pauseMedia: tabKey => call({ op: "pauseMedia", tabKey }) as Promise<void>,
        rememberView: tabKey => call({ op: "rememberView", tabKey }) as Promise<void>,
        restoreView: tabKey => call({ op: "restoreView", tabKey }) as Promise<void>,
        viewMemory: tabKey => call({ op: "viewMemory", tabKey }) as Promise<BrowserViewMemory>,
        back: tabKey => call({ op: "back", tabKey }) as Promise<void>,
        forward: tabKey => call({ op: "forward", tabKey }) as Promise<void>,
        reload: tabKey => call({ op: "reload", tabKey }) as Promise<void>,
        stop: tabKey => call({ op: "stop", tabKey }) as Promise<void>,
        toBackground: tabKey => call({ op: "toBackground", tabKey }) as Promise<void>,
        close: (tabKey, value) => call({ op: "close", tabKey, unmount: value?.unmount === true }) as Promise<void>,
      };
    },
    subscribe: options.subscribe,
    identities: identityBridge(options),
  };
}

/** 浏览器身份: one host-independent channel; main validates every request again (shared parseBrowserIdentityRequest). */
function identityBridge(options: BrowserPreloadOptions): BrowserIdentityBridge {
  const call = <T>(request: BrowserIdentityRequest) => options.invoke(BROWSER_IDENTITY_CHANNEL, request as never, null) as Promise<T>;
  return {
    state: () => call({ op: "state" }),
    create: (name, color, initial) => call({ op: "create", name, color, ...(initial !== undefined ? { initial } : {}) }),
    update: (id, expectedRevision, change) => call({ op: "update", id, expectedRevision, ...change }),
    setCurrent: (id) => call({ op: "setCurrent", id }),
    signOut: (id) => call({ op: "signOut", id }),
    remove: (id) => call({ op: "remove", id }),
    storage: (id) => call({ op: "storage", id }),
    signedInSites: (id, hostId) => call({ op: "signedInSites", id, hostId }),
    clearData: (request) => call({ op: "clearData", request }),
    prefs: (patch) => call(patch === undefined ? { op: "prefs" } : { op: "prefs", patch }),
    history: (query) => call({ op: "history", query }),
    topSites: (identityId, hostId, limit) => call({ op: "topSites", identityId, hostId, ...(limit !== undefined ? { limit } : {}) }),
    historyDelete: (target) => call({ op: "historyDelete", target }),
    passwords: (identityId) => call({ op: "passwords", identityId }),
    passwordUpdate: (id, username) => call({ op: "passwordUpdate", id, username }),
    passwordRemove: (id) => call({ op: "passwordRemove", id }),
    passwordReveal: (id) => call({ op: "passwordReveal", id }),
    passwordStatus: () => call({ op: "passwordStatus" }),
    passwordCopy: (id) => call({ op: "passwordCopy", id }),
    neverSave: (identityId, remove) => call({ op: "neverSave", identityId, ...(remove !== undefined ? { remove } : {}) }),
    promptAnswer: (promptId, choice) => call({ op: "promptAnswer", promptId, choice }),
    fill: (offerId, loginId) => call({ op: "fill", offerId, loginId }),
    dismissOffer: (offerId) => call({ op: "dismissOffer", offerId }),
    subscribe: (listener) => options.subscribeIdentities?.(listener) ?? (() => {}),
  };
}
