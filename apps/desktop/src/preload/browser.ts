import type { BrowserCursorPreferences } from "../shared/browserCursor";
import { BROWSER_CHANNEL, type BrowserBridge, type BrowserEvent, type BrowserRequest, type BrowserTabMount, type BrowserTabView, type BrowserTurnShot, type BrowserImage, type BrowserToolItem, type BrowserAgentView, type BrowserHostSettings, type BrowserIdempotencyClearResult, type BrowserClaimPolicyView, type BrowserClaimAllowView, type BrowserClaimAuditView, type BrowserExternalPagesView, type BrowserSitePermissionView, type BrowserProfileTools } from "../shared/browser";
import type { HostBinding } from "../shared/hosts";

export interface BrowserPreloadOptions {
  invoke(channel: string, request: BrowserRequest, binding: HostBinding | null): Promise<unknown>;
  binding(hostId: string): HostBinding | null;
  /** Existing EVENT_CHANNEL delivery, after the shared HostTag filter. */
  subscribe(listener: (event: BrowserEvent) => void): () => void;
}
export function browserBridge(options: BrowserPreloadOptions): BrowserBridge {
  return {
    setEnabled: enabled => options.invoke(BROWSER_CHANNEL, { op: "setEnabled", enabled }, null) as Promise<void>,
    resetOrigins: () => options.invoke(BROWSER_CHANNEL, { op: "resetOrigins" }, null) as Promise<void>,
    externalPages: enabled => options.invoke(BROWSER_CHANNEL, enabled === undefined ? { op: "externalPages" } : { op: "externalPages", enabled }, null) as Promise<BrowserExternalPagesView>,
    cursorColor: color => options.invoke(BROWSER_CHANNEL, color === undefined ? { op: "cursorColor" } : { op: "cursorColor", color }, null) as Promise<BrowserCursorPreferences>,
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
        dismissLoginWarning: (tabKey, origin) => call({ op: "dismissLoginWarning", tabKey, origin }) as Promise<void>,
        openOwnerCopy: tabKey => call({ op: "openOwnerCopy", tabKey }) as Promise<{ tabKey: string; url: string }>,
        reserveOwnerTab: () => call({ op: "reserveOwnerTab" }) as Promise<{ tabKey: string }>,
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
        back: tabKey => call({ op: "back", tabKey }) as Promise<void>,
        forward: tabKey => call({ op: "forward", tabKey }) as Promise<void>,
        reload: tabKey => call({ op: "reload", tabKey }) as Promise<void>,
        stop: tabKey => call({ op: "stop", tabKey }) as Promise<void>,
        toBackground: tabKey => call({ op: "toBackground", tabKey }) as Promise<void>,
        close: (tabKey, value) => call({ op: "close", tabKey, unmount: value?.unmount === true }) as Promise<void>,
      };
    },
    subscribe: options.subscribe,
  };
}
