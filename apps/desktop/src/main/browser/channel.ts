import { BROWSER_OWNER_INPUT_KINDS, isBrowserControlSettings, type BrowserOwnerInputKind, type BrowserRequest } from "../../shared/browser";
import { isBrowserClaimMode } from "../../shared/browserClaim";
import type { HostBinding } from "../../shared/hosts";
import { admitHostBinding, type FenceHosts, type HostFence } from "../hostFence";

export function parseBrowserRequest(raw: unknown): BrowserRequest {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("invalid_browser_request");
  const value = raw as Record<string, unknown>;
  if (value.op === "resetOrigins" || value.op === "reserveOwnerTab") {
    if (Object.keys(value).length !== 1) throw Error("invalid_browser_request");
    return { op: value.op };
  }
  if (value.op === "externalPages") {
    if (Object.keys(value).some(k => !["op", "enabled"].includes(k)) || (value.enabled !== undefined && typeof value.enabled !== "boolean")) throw Error("invalid_browser_request");
    return value.enabled === undefined ? { op: "externalPages" } : { op: "externalPages", enabled: value.enabled };
  }
  if (value.op === "sitePermissions") {
    const forget = value.forget as Record<string, unknown> | string | undefined;
    if (Object.keys(value).some(k => !["op", "forget"].includes(k))) throw Error("invalid_browser_request");
    if (forget === undefined) return { op: "sitePermissions" };
    if (forget === "all") return { op: "sitePermissions", forget: "all" };
    if (!forget || typeof forget !== "object" || Array.isArray(forget) || Object.keys(forget).length !== 2 || (forget.pool !== "owner" && forget.pool !== "agent")
      || typeof forget.origin !== "string" || !forget.origin || forget.origin.length > 300 || /[\x00-\x1f\x7f]/.test(forget.origin)) throw Error("invalid_browser_request");
    return { op: "sitePermissions", forget: { pool: forget.pool, origin: forget.origin } };
  }
  const validId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9._:-]{1,200}$/.test(v);
  if (value.op === "settings") {
    if (Object.keys(value).some(k => !["op", "agentOpenApproval"].includes(k)) || (value.agentOpenApproval !== undefined && value.agentOpenApproval !== "off" && value.agentOpenApproval !== "ask")) throw Error("invalid_browser_request");
    return value.agentOpenApproval === undefined ? { op: "settings" } : { op: "settings", agentOpenApproval: value.agentOpenApproval };
  }
  if (value.op === "profileTools") {
    if (Object.keys(value).some(k => !["op", "profile", "enabled"].includes(k)) || typeof value.profile !== "string" || !value.profile.trim() || value.profile.length > 200 || /[\x00-\x1f\x7f-\x9f/\\]/.test(value.profile) || [".", ".."].includes(value.profile)
      || (value.enabled !== undefined && typeof value.enabled !== "boolean")) throw Error("invalid_browser_request");
    return { op: "profileTools", profile: value.profile, ...(value.enabled !== undefined ? { enabled: value.enabled } : {}) };
  }
  if (value.op === "claimAllows" || value.op === "claimAudit") {
    if (Object.keys(value).length !== 1) throw Error("invalid_browser_request");
    return { op: value.op };
  }
  if (value.op === "claimOpen") {
    if (Object.keys(value).some(k => !["op", "approvalId", "settings"].includes(k)) || !validId(value.approvalId) || !isBrowserControlSettings(value.settings)) throw Error("invalid_browser_request");
    return { op: "claimOpen", approvalId: value.approvalId, settings: value.settings };
  }
  if (value.op === "claimPolicy") {
    if (Object.keys(value).some(k => !["op", "profile", "mode"].includes(k)) || typeof value.profile !== "string" || !value.profile.trim() || value.profile.length > 200 || /[\x00-\x1f\x7f-\x9f/\\]/.test(value.profile) || [".", ".."].includes(value.profile)
      || (value.mode !== undefined && value.mode !== null && !isBrowserClaimMode(value.mode))) throw Error("invalid_browser_request");
    return { op: "claimPolicy", profile: value.profile, ...(value.mode !== undefined ? { mode: value.mode } : {}) };
  }
  if (value.op === "claimAllowRevoke") {
    if (Object.keys(value).some(k => !["op", "sessionId", "origin"].includes(k)) || !validId(value.sessionId)
      || (value.origin !== undefined && (typeof value.origin !== "string" || !value.origin || value.origin.length > 300 || /[\x00-\x1f\x7f]/.test(value.origin)))) throw Error("invalid_browser_request");
    return { op: "claimAllowRevoke", sessionId: value.sessionId, ...(value.origin !== undefined ? { origin: value.origin } : {}) };
  }
  if (value.op === "openRefused") {
    if (Object.keys(value).some(k => !["op", "requestId", "code"].includes(k)) || !validId(value.requestId) || !["lease_limit", "scope_invalid", "scope_unsupported", "target_closed", "stale_connection", "browser_disabled", "invalid_request"].includes(value.code as string)) throw Error("invalid_browser_request");
    return value as unknown as BrowserRequest;
  }
  if (["grantAgent", "holdReady", "releaseLease", "resumeLease", "pauseLease"].includes(value.op as string)) {
    const fields = value.op === "grantAgent" ? ["sessionId", "settings", "approvalId", "expected", "remember"] : value.op === "holdReady" ? ["leaseId", "held"] : value.op === "resumeLease" ? ["leaseId", "settings"] : value.op === "pauseLease" ? ["leaseId"] : ["leaseId", "owner"];
    if (Object.keys(value).some(k => !["op", "tabKey", ...fields].includes(k)) || !validId(value.tabKey) || !validId(value.op === "grantAgent" ? value.sessionId : value.leaseId)
      || (value.op === "holdReady" && typeof value.held !== "boolean") || ((value.op === "grantAgent" || value.op === "resumeLease") && !isBrowserControlSettings(value.settings))
      || (value.approvalId !== undefined && !validId(value.approvalId)) || (value.remember !== undefined && (value.remember !== true || value.approvalId === undefined))
      || (value.owner !== undefined && value.owner !== true)) throw Error("invalid_browser_request");
    if (value.op === "grantAgent") {
      const expected = value.expected as Record<string, unknown>;
      if (!expected || typeof expected !== "object" || Array.isArray(expected) || Object.keys(expected).length !== 2
        || Object.keys(expected).some(k => k !== "guestId" && k !== "pageGeneration") || !validId(expected.guestId)
        || !Number.isSafeInteger(expected.pageGeneration) || (expected.pageGeneration as number) < 0) throw Error("invalid_browser_request");
    }
    return value as unknown as BrowserRequest;
  }
  if (value.op === "turnShot" || value.op === "turnShots" || value.op === "toolItem") {
    const fields = value.op === "turnShot" ? ["id"] : value.op === "turnShots" ? ["sessionId", "turnId"] : ["sessionId", "turnId", "itemId"];
    if (Object.keys(value).some(k => k !== "op" && !fields.includes(k)) || fields.some(k => typeof value[k] !== "string" || !/^[A-Za-z0-9._:-]{1,200}$/.test(value[k] as string))) throw new Error("invalid_browser_request");
    return value.op === "turnShot" ? { op: "turnShot", id: value.id as string } : value.op === "turnShots" ? { op: "turnShots", sessionId: value.sessionId as string, turnId: value.turnId as string } :
      { op: "toolItem", sessionId: value.sessionId as string, turnId: value.turnId as string, itemId: value.itemId as string };
  }
  if (value.op === "setEnabled") {
    if (Object.keys(value).some(k => k !== "op" && k !== "enabled") || typeof value.enabled !== "boolean") throw new Error("invalid_browser_request");
    return { op: "setEnabled", enabled: value.enabled };
  }
  const allowed = value.op === "list" || value.op === "agents" ? ["op"] : value.op === "open" ? ["op", "tabKey", "url", "receipt", "identity"] : value.op === "navigate" ? ["op", "tabKey", "url"] :
    value.op === "close" ? ["op", "tabKey", "unmount"] :
      value.op === "ownerInput" ? ["op", "tabKey", "kind"] : ["op", "tabKey"];
  if (!Object.keys(value).every(k => allowed.includes(k))) throw new Error("invalid_browser_request");
  if (value.op === "list") return { op: "list" };
  if (value.op === "agents") return { op: "agents" };
  if (typeof value.tabKey !== "string" || !value.tabKey || value.tabKey.length > 256 || /[\x00-\x1f\x7f]/.test(value.tabKey))
    throw new Error("invalid_browser_request");
  const tabKey = value.tabKey;
  if (value.op === "ownerInput") {
    if (!BROWSER_OWNER_INPUT_KINDS.includes(value.kind as BrowserOwnerInputKind)) throw new Error("invalid_browser_input");
    return { op: "ownerInput", tabKey, kind: value.kind as BrowserOwnerInputKind };
  }
  if (value.op === "open" || value.op === "navigate") {
    if (typeof value.url !== "string" || value.url.length > 8000 || !value.url || /[\x00-\x1f\x7f]/.test(value.url)) throw new Error("invalid_browser_url");
    let identity: Extract<BrowserRequest, {op:"open"}>["identity"];
    if (value.op === "open" && value.identity !== undefined) {
      const raw = value.identity as Record<string, unknown>;
      if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).some(k => !["pendingOpen", "agentOpened", "carrier"].includes(k))
        || (raw.pendingOpen !== undefined && !validId(raw.pendingOpen)) || (raw.agentOpened !== undefined && raw.agentOpened !== true)
        || (raw.carrier !== undefined && (raw.carrier !== "background" || value.receipt !== undefined))) throw Error("invalid_browser_request");
      identity = { ...(raw.pendingOpen !== undefined ? { pendingOpen: raw.pendingOpen as string } : {}), ...(raw.agentOpened === true ? { agentOpened: true as const } : {}),
        ...(raw.carrier === "background" ? { carrier: "background" as const } : {}) };
    }
    if (value.op === "open" && value.receipt !== undefined) {
      const r = value.receipt as Record<string, unknown>;
      if (!r || typeof r !== "object" || Array.isArray(r) || Object.keys(r).some(k => k !== "src" && k !== "webContentsId")
        || typeof r.src !== "string" || r.src.length > 128 || typeof r.webContentsId !== "number" || !Number.isSafeInteger(r.webContentsId) || r.webContentsId <= 0)
        throw new Error("invalid_browser_receipt");
      return { op: "open", tabKey, url: value.url, receipt: { src: r.src, webContentsId: r.webContentsId }, ...(identity ? { identity } : {}) };
    }
    return { op: value.op, tabKey, url: value.url, ...(identity ? { identity } : {}) };
  }
  if (value.op === "close") {
    if (value.unmount !== undefined && typeof value.unmount !== "boolean") throw new Error("invalid_browser_request");
    return { op: "close", tabKey, unmount: value.unmount === true };
  }
  if (value.op === "back" || value.op === "forward" || value.op === "reload" || value.op === "stop" || value.op === "toBackground") return { op: value.op, tabKey };
  throw new Error("invalid_browser_request");
}
export function createBrowserChannel<E, D extends { readonly generation: number }>(options: {
  isAppSender(event: E): boolean;
  isEnabled(): boolean;
  getHosts(): FenceHosts<D> | null | undefined;
  setEnabled(enabled: boolean): void;
  resetOrigins?(): void;
  /** Owner switch, host-independent and reachable while the module is off (it only narrows or
   * widens what a later browser tab may reach; main enforces it on every request). */
  externalPages?(enabled?: boolean): unknown;
  /** Remembered site permissions (host-independent, owner UI only). */
  sitePermissions?(forget?: Extract<BrowserRequest, { op: "sitePermissions" }>["forget"]): unknown;
  execute(request: Exclude<BrowserRequest, { op: "setEnabled" | "resetOrigins" | "externalPages" | "sitePermissions" }>, hostId: string, fence?: HostFence<D>): Promise<unknown>;
}) {
  return async (event: E, raw: unknown, binding: HostBinding | null | undefined): Promise<unknown> => {
    if (!options.isAppSender(event)) throw new Error("untrusted_sender");
    const request = parseBrowserRequest(raw);
    if (request.op === "setEnabled") return options.setEnabled(request.enabled);
    if (request.op === "externalPages") {
      if (!options.externalPages) throw Error("unsupported_operation");
      return options.externalPages(request.enabled);
    }
    if (request.op === "sitePermissions") {
      if (!options.sitePermissions) throw Error("unsupported_operation");
      return options.sitePermissions(request.forget);
    }
    // Lifecycle denial precedes host admission, including otherwise-exempt stop/close.
    if (!options.isEnabled()) throw new Error("module_disabled");
    if (request.op === "resetOrigins") {
      if (!options.resetOrigins) throw Error("unsupported_operation");
      return options.resetOrigins();
    }
    if (!binding || typeof binding.hostId !== "string" || !binding.hostId || binding.hostId.length > 128 || binding.focus === true)
      throw new Error("invalid_browser_binding");
    const cleanup = request.op === "close" || request.op === "stop" || request.op === "ownerInput" || request.op === "releaseLease" || request.op === "openRefused" || (request.op === "holdReady" && !request.held);
    const fence = cleanup ? undefined : admitHostBinding(options.getHosts, binding);
    const result = await options.execute(request, binding.hostId, fence);
    fence?.check();
    return result;
  };
}
