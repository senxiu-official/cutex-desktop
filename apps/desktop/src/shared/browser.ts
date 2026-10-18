import type { HostTag, HostTaggedEvent, HOST_TAGGED_EVENTS } from "./ipc";
import type { BrowserClaimAutoReason, BrowserClaimMode } from "./browserClaim";

// Both app typechecks include this file. Adding a tagged event without enrolling it in
// preload/mock filtering is a compile error (satisfies alone only checks membership).
type AssertNoMissingHostEvents<T extends never> = T;
export type BrowserHostEventCoverage = AssertNoMissingHostEvents<Exclude<HostTaggedEvent, typeof HOST_TAGGED_EVENTS[number]>>;

/** Owner switch 「允许浏览外部网页」 (desktop-local, stored and enforced by main). `stored` is the
 * owner's choice (default on); `forced` is a development-run override (CUTEX_DESKTOP_BROWSER_EGRESS
 * = n2 / off), never honoured by packaged builds; `enabled` is what main enforces right now. */
export interface BrowserExternalPagesView { enabled: boolean; stored: boolean; forced?: "on" | "off" }
/** Site permissions the owner can grant a page's own origin (camera, microphone, …). */
export const BROWSER_SITE_PERMISSIONS = ["camera", "microphone", "geolocation", "notifications", "clipboard-read", "midi", "midi-sysex", "pointer-lock", "keyboard-lock",
  "idle-detection", "window-management", "storage-access", "speaker-selection", "protected-media"] as const;
export type BrowserSitePermission = typeof BROWSER_SITE_PERMISSIONS[number];
/** One remembered owner decision, per login pool (owner / agent) and origin. */
export interface BrowserSitePermissionView { pool: "owner" | "agent"; origin: string; permission: BrowserSitePermission; allow: boolean }
export type BrowserSitePermissionForget = "all" | { pool: "owner" | "agent"; origin: string };
export const DEFAULT_BROWSER_EXTERNAL_PAGES = true;

export interface BrowserControlSettings {
  hiddenTarget: "reveal" | "reject";
  viewport: { width: number; height: number };
  idleDetachSeconds: number;
}
export const DEFAULT_BROWSER_CONTROL_SETTINGS: Readonly<BrowserControlSettings> = Object.freeze({
  hiddenTarget: "reveal", viewport: Object.freeze({ width: 1280, height: 720 }), idleDetachSeconds: 30,
});
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const integer = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
/** Persisted module preferences are untrusted; unsupported values reset to safe defaults. */
export function normalizeBrowserControlSettings(value: unknown): BrowserControlSettings {
  const input = object(value) ? value : {}, viewport = object(input.viewport) ? input.viewport : {};
  return { hiddenTarget: input.hiddenTarget === "reject" ? "reject" : "reveal",
    viewport: { width: integer(viewport.width, 320, 3840) ? viewport.width : 1280, height: integer(viewport.height, 240, 2160) ? viewport.height : 720 },
    idleDetachSeconds: integer(input.idleDetachSeconds, 5, 600) ? input.idleDetachSeconds : 30 };
}
/** IPC grants must be exact: no silent coercion, extra capability fields, or partial settings. */
export function isBrowserControlSettings(value: unknown): value is BrowserControlSettings {
  return object(value) && Object.keys(value).length === 3 && Object.keys(value).every(key => ["hiddenTarget", "viewport", "idleDetachSeconds"].includes(key))
    && (value.hiddenTarget === "reveal" || value.hiddenTarget === "reject") && integer(value.idleDetachSeconds, 5, 600)
    && object(value.viewport) && Object.keys(value.viewport).length === 2 && Object.keys(value.viewport).every(key => key === "width" || key === "height")
    && integer(value.viewport.width, 320, 3840) && integer(value.viewport.height, 240, 2160);
}
export interface BrowserControlView { grantee: string; state: "granted" | "paused"; operating: boolean }
export interface BrowserLeaseView { leaseId: string; sessionId: string; agentName: string; state: "pending" | "active"; origin: "owner" | "agent";
  /** Main granted a browser_claim without the owner's click (local page / allowed until restart / profile always). */
  auto?: BrowserClaimAutoReason }
/** Per-profile 「浏览器控制」 as main stores it (desktop-local, host + profile). */
export interface BrowserClaimPolicyView { mode: BrowserClaimMode; stored: BrowserClaimMode | null; defaultMode: BrowserClaimMode }
/** 「本次运行内一直允许」: main-process memory only, gone at app restart. */
export interface BrowserClaimAllowView { sessionId: string; agentName: string; origin: string; since: string }
/** One automatic claim grant (main's in-memory audit log of this run). */
export interface BrowserClaimAuditView { at: string; sessionId: string; agentName: string; approvalId: string; reason: BrowserClaimAutoReason; origin: string; title: string }
export interface BrowserAgentView { sessionId: string; name: string }
export interface BrowserGrantTarget { guestId: string; pageGeneration: number }
export interface BrowserHostSettings { agentOpenApproval: "off" | "ask" }
export interface BrowserIdempotencyClearResult { deleted: number; outcomeUnknown: number; abandonedForwarded: number; scope: "session" | "all"; warning: string }
/** carrier "background": an agent-pool tab main renders off screen (agents act on it while the card
 * or window is hidden); main refuses it for owner tabs. Omitted: the visible webview path. */
export interface BrowserMountIdentity { pendingOpen?: string; agentOpened?: true; carrier?: "background" }
export interface BrowserOpenIntent { requestId: string; hostId: string; epoch: string; tabKey: string; cutexSessionId: string; url: string; remainingMs: number }
export type BrowserOpenRefusal = "lease_limit" | "scope_invalid" | "scope_unsupported" | "target_closed" | "stale_connection" | "browser_disabled" | "invalid_request";
/** Owner-only history projection; no filesystem path, arbitrary RPC or agent access. */
export interface BrowserTurnShot { id: string; turnId: string; createdAt: string; width: number; height: number; mimeType: "image/png" | "image/jpeg" }
export interface BrowserImage { mimeType: "image/png" | "image/jpeg"; data: string }
export interface BrowserToolItem { item: Record<string, unknown> }
/** Host capture-layer input, never a page assertion about input provenance. */
export const BROWSER_OWNER_INPUT_KINDS = ["pointerdown", "wheel", "keydown", "contextmenu", "dragenter", "drop", "touchstart"] as const;
export type BrowserOwnerInputKind = typeof BROWSER_OWNER_INPUT_KINDS[number];

/** Owner UI only. Product agent tools and leases belong to I3. */
export const BROWSER_CHANNEL = "cutex-desktop:browser";
export type BrowserTabStatus = "pending" | "attached" | "unmounted" | "crashed" | "closed";
export interface BrowserTabView {
  guestId: string;
  tabKey: string;
  hostId: string;
  pageGeneration: number;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  status: BrowserTabStatus;
  error?: string;
  /** Only a validated, bounded data image. Never a remote URL loaded by the app session. */
  favicon?: string;
  control?: BrowserControlView;
  lease?: BrowserLeaseView;
  pool?: "owner" | "agent";
  /** Exact main-confirmed open correlation, never inferred from a locally active lease. */
  confirmedOpen?: string;
  /** A site-permission request of this tab: main's native dialog is open (waiting), or the last one
   * ended without the owner (hidden window / unanswered). Display only; the owner answers in main. */
  sitePermission?: BrowserSitePermissionPromptView;
  /** "background": main's offscreen carrier of an agent tab (live thumbnail in the card, agents act
   * while it is hidden). Absent: a webview in the card (visible-only agent control). */
  carrier?: "background";
  /** A carrier hand-over is running: agent actions wait (busy) until the page reopened. */
  handover?: true;
}
export interface BrowserSitePermissionPromptView { state: "waiting" | "hidden" | "timeout"; origin: string; permissions: BrowserSitePermission[] }
export interface BrowserTabMount {
  guestId: string;
  tabKey: string;
  partition: string;
  /** Main-authoritative pool, including safe isolated recovery of corrupt provenance. */
  pool?: "owner" | "agent";
  recovery?: "browser_identity_recovered";
  /** One-use main-issued about:blank admission envelope; never persisted. Empty for a background carrier. */
  src: string;
  /** Main created an offscreen carrier for this agent tab: the renderer creates no webview. */
  carrier?: "background";
}
/** Main opens an owner tab for a claim: the renderer shows it (held) in the requesting agent's lane. */
export interface BrowserClaimOpenIntent { tabKey: string; url: string; sessionId: string }
export type BrowserEvent = HostTag & BrowserTabView & { kind: "changed" | "new-tab" | "diagnostic" | "reveal" | "agent-open" | "agent-open-cancel" | "agent-open-confirm" | "claim-open" | "claim-granted" | "blocked" | "thumbnail"; newTabUrl?: string;
  /** thumbnail: a bounded data:image/jpeg of a background agent tab (at most ~1 per second). */
  thumbnail?: string;
  /** new-tab: the opener's agent caused this popup (its own click), not the owner. */
  newTabAgent?: true;
  /** new-tab: the host granted it to that agent under the opener's lease (browser-popup-grant). */
  newTabGranted?: true;
  /** blocked: what main stopped without the owner's action (shown once as a notice). */
  blocked?: "popup" | "download" | "download-hidden" | "permission-waiting" | "permission-hidden" | "permission-timeout"; newTabKey?: string; popupDiscardReason?: string; openIntent?: BrowserOpenIntent; openRequestId?: string;
  claimOpen?: BrowserClaimOpenIntent; claimGrant?: { agentName: string; reason: BrowserClaimAutoReason } };
/** Completion of a one-use owner UI mount, not an agent target identifier. */
export interface BrowserAttachReceipt { src: string; webContentsId: number }
export type BrowserRequest =
  | { op: "setEnabled"; enabled: boolean }
  | { op: "resetOrigins" }
  | { op: "externalPages"; enabled?: boolean }
  | { op: "sitePermissions"; forget?: BrowserSitePermissionForget }
  | { op: "reserveOwnerTab" }
  | { op: "list" }
  | { op: "turnShots"; sessionId: string; turnId: string }
  | { op: "turnShot"; id: string }
  | { op: "toolItem"; sessionId: string; turnId: string; itemId: string }
  | { op: "agents" }
  | { op: "settings"; agentOpenApproval?: "off" | "ask" }
  | { op: "profileTools"; profile: string; enabled?: boolean }
  | { op: "grantAgent"; tabKey: string; sessionId: string; settings: BrowserControlSettings; approvalId?: string; expected: BrowserGrantTarget; remember?: true }
  | { op: "claimOpen"; approvalId: string; settings: BrowserControlSettings }
  | { op: "claimPolicy"; profile: string; mode?: BrowserClaimMode | null }
  | { op: "claimAllows" }
  | { op: "claimAllowRevoke"; sessionId: string; origin?: string }
  | { op: "claimAudit" }
  | { op: "holdReady"; tabKey: string; leaseId: string; held: boolean }
  | { op: "releaseLease"; tabKey: string; leaseId: string; owner?: true }
  | { op: "resumeLease"; tabKey: string; leaseId: string; settings: BrowserControlSettings }
  | { op: "pauseLease"; tabKey: string; leaseId: string }
  | { op: "openRefused"; requestId: string; code: BrowserOpenRefusal }
  | { op: "clearIdempotency"; cutexSessionId?: string }
  | { op: "open"; tabKey: string; url: string; receipt?: BrowserAttachReceipt; identity?: BrowserMountIdentity }
  | { op: "navigate"; tabKey: string; url: string }
  | { op: "ownerInput"; tabKey: string; kind: BrowserOwnerInputKind }
  | { op: "back" | "forward" | "reload" | "stop" | "toBackground"; tabKey: string }
  | { op: "close"; tabKey: string; unmount?: boolean };
export interface HostBrowserBridge {
  /** Main allocates a fresh identity; callers cannot nominate or promote an old tab key. */
  reserveOwnerTab(): Promise<{ tabKey: string }>;
  list(): Promise<BrowserTabView[]>;
  turnShots(sessionId: string, turnId: string): Promise<BrowserTurnShot[]>;
  turnShot(id: string): Promise<BrowserImage>;
  toolItem(sessionId: string, turnId: string, itemId: string): Promise<BrowserToolItem>;
  agents(): Promise<BrowserAgentView[]>;
  settings(agentOpenApproval?: "off" | "ask"): Promise<BrowserHostSettings>;
  clearIdempotency(cutexSessionId?: string): Promise<BrowserIdempotencyClearResult>;
  profileTools(profile: string, enabled?: boolean): Promise<{ enabled: boolean }>;
  /** remember (claims only): after the grant, main allows this agent the tab's origin until app restart. */
  grantAgent(tabKey: string, sessionId: string, settings: BrowserControlSettings, approvalId: string | undefined, expected: BrowserGrantTarget, options?: { remember?: boolean }): Promise<void>;
  /** Owner click: main opens the claim's own local urlHint (or the agent's service) in an owner tab and grants it. */
  claimOpen(approvalId: string, settings: BrowserControlSettings): Promise<void>;
  /** Per-profile 「浏览器控制」; mode null = back to the default. Desktop-local, enforced by main. */
  claimPolicy(profile: string, mode?: BrowserClaimMode | null): Promise<BrowserClaimPolicyView>;
  claimAllows(): Promise<BrowserClaimAllowView[]>;
  claimAllowRevoke(sessionId: string, origin?: string): Promise<void>;
  claimAudit(): Promise<BrowserClaimAuditView[]>;
  holdReady(tabKey: string, leaseId: string, held: boolean): Promise<void>;
  /** owner: the owner's 停止并撤销授予 (also ends that agent's 一直允许 for the tab's origin). */
  releaseLease(tabKey: string, leaseId: string, owner?: boolean): Promise<void>;
  /** One click, same agent + lease: no second confirmation (the grant itself was confirmed). */
  resumeLease(tabKey: string, leaseId: string, settings: BrowserControlSettings): Promise<void>;
  /** The owner's explicit 「暂停智能体」: keeps the lease (unlike revoke); 「继续」 resumes it. */
  pauseLease(tabKey: string, leaseId: string): Promise<void>;
  openRefused(requestId: string, code: BrowserOpenRefusal): Promise<void>;
  open(tabKey: string, url: string, receipt?: BrowserAttachReceipt, identity?: BrowserMountIdentity): Promise<BrowserTabMount>;
  navigate(tabKey: string, url: string): Promise<void>;
  /** Main-frame-only, epoch-exempt, reduction of authority; never grants or resumes. */
  ownerInput(tabKey: string, kind: BrowserOwnerInputKind): Promise<void>;
  back(tabKey: string): Promise<void>;
  forward(tabKey: string): Promise<void>;
  reload(tabKey: string): Promise<void>;
  stop(tabKey: string): Promise<void>;
  /** Agent tabs only: move the page from the card's webview to main's background carrier (the
   * running agent action finishes first; the page reloads at its current address). */
  toBackground(tabKey: string): Promise<void>;
  close(tabKey: string, options?: { unmount?: boolean }): Promise<void>;
}
export interface BrowserBridge {
  /** Built-in module lifecycle, app main frame only. Not an agent or plugin capability. */
  setEnabled(enabled: boolean): Promise<void>;
  /** Owner-only mechanical recovery; archives provenance, never changes existing cookie pools. */
  resetOrigins(): Promise<void>;
  /** Owner switch 「允许浏览外部网页」: read (no argument) or set. Host-independent. */
  externalPages(enabled?: boolean): Promise<BrowserExternalPagesView>;
  /** Remembered per-origin site permissions; forget one origin (all its permissions) or all. */
  sitePermissions(forget?: BrowserSitePermissionForget): Promise<BrowserSitePermissionView[]>;
  forHost(hostId: string): HostBrowserBridge;
  subscribe(listener: (event: BrowserEvent) => void): () => void;
}

/** Fixed UI keys only; no page/daemon message is ever an owner-facing fallback. */
export type BrowserOwnerErrorKey = "browser.error.invalid" | "browser.error.unsupported" | "browser.error.permission" | "browser.error.loopbackOnly" | "browser.error.disabled" | "browser.error.unavailable" | "browser.error.revoked" | "browser.error.desktopRestarted" | "browser.error.hidden" | "browser.error.paused" | "browser.error.scope" | "browser.error.stale" | "browser.error.deadline" | "browser.error.cancelled" | "browser.error.unknownOutcome" | "browser.error.conflict" | "browser.error.notRetained" | "browser.error.approvalRequired" | "browser.error.approvalDenied" | "browser.error.leaseLimit" | "browser.error.busy" | "browser.error.capacity" | "browser.error.tooLarge" | "browser.error.identityUnavailable" | "browser.error.identityRecovered" | "browser.error.serviceUnavailable" | "browser.error.serviceReclaimed" | "browser.error.serviceStopped" | "browser.error.serviceNotFound" | "browser.error.serviceStartFailed" | "browser.error.serviceCrashLooped" | "browser.error.serviceChanged" | "browser.error.upstreamUnreachable" | "browser.error.staticNotFound" | "browser.externalUnavailable" | "browser.refusal.externalOff" | "browser.refusal.proxyUnavailable" | "browser.refusal.privateAddress" | "browser.refusal.reservedAddress" | "browser.refusal.protectedEndpoint" | "browser.refusal.remoteLoopback" | "browser.serviceProxyRequired" | "browser.noHost" | "browser.unavailable" | "browser.navigationFailed" | "browser.serviceAuthFailed" | "browser.invalidReceipt" | "browser.error.unknown";
/** The one owner action that actually fixes a refusal (none: explain only). */
export type BrowserRefusalAction = "enableExternal" | "retry" | "reload" | null;
/**
 * Service errors a reload can fix: reloading a service tab goes through the ticket flow again with
 * `start: true` (an on-demand / stopped managed service starts, a moved port is picked up). Not for a
 * reclaimed or unknown service (nothing to reload into).
 */
const RELOAD_FIXES: ReadonlySet<string> = new Set(["service_stopped", "service_start_failed", "service_crash_looped", "service_changed", "upstream_unreachable", "service_unavailable", "services_store_unavailable", "proxy_busy"]);
export function browserRefusalAction(code: unknown): BrowserRefusalAction {
  if (typeof code === "string" && RELOAD_FIXES.has(code)) return "reload";
  return code === "external_pages_off" ? "enableExternal" : code === "external_proxy_unavailable" ? "retry" : null;
}
export function browserOwnerErrorKey(error: unknown): BrowserOwnerErrorKey {
  const message = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : error instanceof Error ? error.message : String(error);
  const code = message.replace(/^Error invoking remote method '[^']+': (?:[A-Za-z]*Error: )?/, "");
  switch (code) {
    case "invalid_request": case "invalid_browser_request": case "invalid_browser_url": case "invalid_result": case "not_actionable": return "browser.error.invalid";
    case "unsupported_operation": case "unsupported_provider": case "unsupported_frame": case "version_mismatch": return "browser.error.unsupported";
    case "permission_denied": case "untrusted_sender": return "browser.error.permission";
    case "loopback_only": return "browser.error.loopbackOnly";
    case "browser_disabled": case "module_disabled": return "browser.error.disabled";
    case "browser_unavailable": case "transport_error": return "browser.error.unavailable";
    case "lease_revoked": case "lease_expired": case "browser_session_revoked": return "browser.error.revoked";
    case "lease_ended_desktop_restarted": return "browser.error.desktopRestarted";
    case "target_hidden": return "browser.error.hidden";
    case "owner_paused": return "browser.error.paused";
    case "scope_invalid": case "scope_unsupported": return "browser.error.scope";
    case "stale_connection": case "stale_request": case "stale_ref": case "host switched": return "browser.error.stale";
    case "deadline_exceeded": return "browser.error.deadline";
    case "cancelled": return "browser.error.cancelled";
    case "outcome_unknown": return "browser.error.unknownOutcome";
    case "request_conflict": case "request_id_conflict": case "lease_conflict": return "browser.error.conflict";
    case "request_result_not_retained": return "browser.error.notRetained";
    case "approval_required": return "browser.error.approvalRequired";
    case "approval_denied": return "browser.error.approvalDenied";
    case "lease_limit": return "browser.error.leaseLimit";
    case "busy": case "tab_busy": case "browser_already_mounted": case "decode_busy": return "browser.error.busy";
    case "idempotency_capacity_exceeded": case "browser_capacity_exceeded": return "browser.error.capacity";
    case "message_too_large": return "browser.error.tooLarge";
    case "browser_identity_unavailable": case "invalid_browser_identity": return "browser.error.identityUnavailable";
    case "browser_identity_recovered": return "browser.error.identityRecovered";
    // Service tabs: cutex's codes from the lease / view-ticket routes and the proxy's x-cutex-service-error header.
    case "service_unavailable": case "services_store_unavailable": case "services_supervisor_unavailable": case "proxy_busy": return "browser.error.serviceUnavailable";
    case "service_reclaimed": return "browser.error.serviceReclaimed";
    case "service_stopped": return "browser.error.serviceStopped";
    case "service_not_found": return "browser.error.serviceNotFound";
    case "service_start_failed": case "cwd_not_found": case "port_in_use": case "no_free_port": return "browser.error.serviceStartFailed";
    case "service_crash_looped": case "crash_looped": return "browser.error.serviceCrashLooped";
    case "service_changed": return "browser.error.serviceChanged";
    case "upstream_unreachable": return "browser.error.upstreamUnreachable";
    case "static_not_found": return "browser.error.staticNotFound";
    case "external_pages_unavailable": return "browser.externalUnavailable";
    case "external_pages_off": return "browser.refusal.externalOff";
    case "external_proxy_unavailable": return "browser.refusal.proxyUnavailable";
    case "private_address_blocked": return "browser.refusal.privateAddress";
    case "reserved_address": return "browser.refusal.reservedAddress";
    case "protected_endpoint": return "browser.refusal.protectedEndpoint";
    case "remote_loopback": return "browser.refusal.remoteLoopback";
    case "service_proxy_required": return "browser.serviceProxyRequired";
    case "host_offline": return "browser.noHost";
    case "target_closed": case "debugger_detached": return "browser.unavailable";
    case "navigation_failed": return "browser.navigationFailed";
    case "service_auth_failed": return "browser.serviceAuthFailed";
    case "invalid_browser_receipt": return "browser.invalidReceipt";
    default: return "browser.error.unknown";
  }
}

// Renderer-local UI readiness signal, shared by the preapproved settings/approval
// integrations. It has no IPC, host lookup, cookie-pool choice or grant authority.
// Static module slots can appear during activation. A Body must wait until main acknowledges the
// enabled latch, even on a restored layout. This gate has no IPC, host lookup or guest authority.
export function createBrowserActivation() {
  let generation = 0;
  let enabled = false;
  const listeners = new Set<() => void>();
  const update = (next: boolean) => {
    if (enabled === next) return;
    enabled = next;
    for (const listener of listeners) listener();
  };
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    get: () => enabled,
    begin() { const token = ++generation; update(false); return token; },
    complete(token: number) { if (token === generation) update(true); },
    end(token: number): boolean {
      if (token !== generation) return false;
      ++generation;
      update(false);
      return true;
    },
  };
}

export const browserActivation = createBrowserActivation();
