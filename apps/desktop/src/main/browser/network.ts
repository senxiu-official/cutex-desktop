import type { Certificate, DownloadItem, HandlerDetails, Session, WebContents } from "electron";
import { matchBrowserPartition } from "./attachPolicy";
import { isIP } from "node:net";
import { isLanEgressAddress, parseLanBrowserUrl, parsePublicBrowserUrl } from "./egressAddress";
import { queueBrowserSessionProxy } from "./sessionProxy";

export const BROWSER_WEBRTC_POLICY = "disable_non_proxied_udp" as const;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const SERVICE_HOST = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.svc\.localhost$/;
export interface BrowserNetworkHost {
  kind: "local" | "dev-direct" | "ssh";
  connectionPort?: number;
  serviceProxy?: boolean;
  /** Trusted daemon metadata, never renderer-provided. I2a supports loopback origins only. */
  serviceLocalUrls?: readonly string[];
}
/** Why main refused a browser target; each has its own owner-facing message and fix (never one
 * catch-all). Agent-facing relay results map them to the wire code the daemon understands. */
export const BROWSER_REFUSALS = ["external_pages_off", "external_proxy_unavailable", "private_address_blocked", "reserved_address", "protected_endpoint", "remote_loopback"] as const;
export type BrowserRefusal = typeof BROWSER_REFUSALS[number] | "invalid_url";
/** Who starts a request. owner / agent: a navigation main itself starts (address bar, owner
 * history buttons, an agent tool) after attributing it; page: everything a guest does, including
 * redirects, subresources, workers and page-script navigations. */
export type BrowserActor = "owner" | "agent" | "page";
export interface BrowserRequestContext {
  actor: BrowserActor;
  webContentsId?: number;
  /** Electron's initiatorOrigin: absent = started by the browser itself (main's loadURL, history,
   * reload), kept from the original request across redirects. "null" = an opaque origin. */
  initiatorOrigin?: string;
  resourceType?: string;
}
export type BrowserExternalState = "ready" | "off" | "unavailable";
export interface BrowserUrlPolicyOptions {
  getHost: () => BrowserNetworkHost | undefined;
  /** Only asked for a syntactically public URL. ready = the owner switch is on and this partition's
   * N2 session is configured; the proxy still revalidates every resolved address. */
  external?: (url: string) => BrowserExternalState;
  /** cutex control planes: every host's management / bus endpoint (desktop loopback, this
   * machine's own interface addresses, a remote host's tailnet address) and the N2 listener. */
  protectedEndpoint?: (url: URL) => boolean;
  /** Per-tab owner/main admission of a private-class origin (loopback, LAN, tailnet). */
  admitted?: (webContentsId: number, origin: string) => boolean;
  /** A LAN / tailnet authority main admitted after an owner navigation (none = not admitted).
   * Such an authority is private-class even when its name looks public (e.g. a tailnet DNS name). */
  lan?: (hostname: string, port: number) => "ready" | "unavailable" | "none";
}
export interface BrowserUrlPolicy {
  /** Without a context: a main-initiated navigation (owner actor). */
  isNavigationAllowed(url: unknown, context?: BrowserRequestContext): boolean;
  isRequestAllowed(url: unknown, resourceType?: string, context?: BrowserRequestContext): boolean;
  /** null = allowed. The single source of truth behind both predicates. */
  refusal(url: unknown, context?: BrowserRequestContext): BrowserRefusal | null;
}

function parseNetworkUrl(value: unknown): URL | undefined {
  if (typeof value !== "string" || !value || value.length > 16_384 || /[\x00-\x20\x7f\\]/.test(value)) return;
  try {
    const url = new URL(value);
    if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol) || url.username || url.password) return;
    // Refuse noncanonical IP spellings that URL() would silently turn into loopback.
    const authority = value.slice(value.indexOf("://") + 3).split(/[/?#]/, 1)[0]!;
    const rawHost = authority.startsWith("[") ? authority.slice(0, authority.indexOf("]") + 1) : authority.split(":", 1)[0];
    if (rawHost?.toLowerCase() !== url.hostname) return;
    return url;
  } catch { return; }
}
/** ws(s) shares its http(s) origin for same-origin attribution (a page's own HMR socket). */
export function browserRequestOrigin(url: URL): string {
  const scheme = url.protocol === "wss:" ? "https:" : url.protocol === "ws:" ? "http:" : url.protocol;
  return `${scheme}//${url.host}`;
}
export function browserTargetOrigin(value: unknown): string | null {
  const url = parseNetworkUrl(value);
  return url ? browserRequestOrigin(url) : null;
}
export function isBrowserLoopbackHost(hostname: string): boolean { return LOOPBACK.has(hostname); }
const PRIVATE_PATH = /^\/__cutex(?:[/?]|$)/i;

/** Current host state is re-read on EVERY request, including redirects and subresources. */
export function createBrowserUrlPolicy(options: BrowserUrlPolicyOptions): BrowserUrlPolicy {
  const refusal = (value: unknown, context: BrowserRequestContext = { actor: "owner" }): BrowserRefusal | null => {
    const host = options.getHost(), url = parseNetworkUrl(value);
    if (!host || !url) return "invalid_url";
    const port = Number(url.port || (url.protocol === "https:" || url.protocol === "wss:" ? 443 : 80));
    const page = context.actor === "page", mainFrame = context.resourceType === undefined || context.resourceType === "mainFrame";
    const origin = browserRequestOrigin(url);
    if (SERVICE_HOST.test(url.hostname)) {
      if (!host.serviceProxy || url.protocol === "https:" || url.protocol === "wss:" || !Number.isInteger(host.connectionPort) || port !== host.connectionPort) return "invalid_url";
      // A page may only reach a service's private /__cutex endpoints through main's own ticket
      // navigation (browser-initiated main frame). Cross-origin page requests into a service are
      // refused too: a public page must not drive the owner's authenticated service cookies.
      if (page && PRIVATE_PATH.test(decodedPath(url)) && (!mainFrame || context.initiatorOrigin !== undefined)) return "protected_endpoint";
      if (page && !mainFrame && context.initiatorOrigin !== origin) return "private_address_blocked";
      return null;
    }
    const loopback = LOOPBACK.has(url.hostname);
    // Control planes first: even the owner's address bar gets the precise reason.
    if (options.protectedEndpoint?.(url) === true) return "protected_endpoint";
    // This callback exists only while the main-owned N2 proxy/session is ready. It is syntactic
    // admission, not DNS proof; the proxy revalidates every resolved address.
    const bare = url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname;
    const lan = loopback ? "none" : options.lan?.(bare, port) ?? "none";
    if (!loopback && lan === "none" && parsePublicBrowserUrl(url.href)) {
      const external = options.external?.(url.href) ?? "off";
      return external === "ready" ? null : external === "unavailable" ? "external_proxy_unavailable" : "external_pages_off";
    }
    if (!loopback) {
      // Link-local (incl. 169.254.169.254), other loopback spellings (127.0.0.2, app.localhost),
      // multicast, documentation and reserved ranges: never a browser target, whoever asks.
      if (isIP(bare) ? !isLanEgressAddress(bare) && lan === "none" : !parseLanBrowserUrl(url.href) && lan === "none") return "reserved_address";
      // A LAN / tailnet origin opens only after main admitted it for the owner's own navigation.
      // Agents never get one; pages only within the tab that admitted it (below).
      if (!page) return context.actor !== "owner" || lan === "none" ? "private_address_blocked" : lan === "ready" ? null : "external_proxy_unavailable";
    } else {
      if (host.kind === "ssh") return "remote_loopback"; // Desktop loopback is not the remote host's loopback.
      if (!page) return null; // main attributes and admits its own navigation before loading it
    }
    // Loopback / LAN reached by a page: only an origin main admitted for THIS tab, and then only from
    // a document of that origin (or a browser-initiated / admitted-origin top-level navigation).
    // A public page can no longer probe desktop loopback ports or the LAN.
    const id = context.webContentsId;
    if (typeof id !== "number" || options.admitted?.(id, origin) !== true) return "private_address_blocked";
    if (context.resourceType === undefined) return null; // navigation events; onBeforeRequest decides initiators
    const initiator = context.initiatorOrigin;
    if (mainFrame) return initiator === undefined || initiator === origin || options.admitted(id, initiator) ? null : "private_address_blocked";
    return initiator === origin ? null : "private_address_blocked";
  };
  return {
    refusal,
    isNavigationAllowed(value, context) {
      if (!options.getHost()) return false;
      if (value === "about:blank") return true;
      const url = parseNetworkUrl(value);
      return !!url && (url.protocol === "http:" || url.protocol === "https:") && refusal(value, context) === null;
    },
    isRequestAllowed(value, resourceType, context) {
      if (value === "about:blank") return !!options.getHost() && (resourceType === "mainFrame" || resourceType === "subFrame");
      return refusal(value, context && { ...context, resourceType: resourceType ?? context.resourceType }) === null;
    },
  };
}
function decodedPath(url: URL): string {
  try { return decodeURIComponent(url.pathname); } catch { return "/__cutex"; }
}

// This session-only proxy closes speculative TCP/WebRTC escape paths not covered by webRequest.
// It does NOT change the existing app-wide DNS policy. Speculative DNS needs separate evidence;
// onBeforeRequest alone must never be described as proving zero DNS packets.
export const BROWSER_LOCAL_PROXY = Object.freeze({ mode: "fixed_servers" as const,
  proxyRules: "socks5://127.0.0.1:9",
  proxyBypassRules: "<-loopback>;localhost;127.0.0.1;[::1];*.svc.localhost" });
/** Certificate verify proc verdict: -3 = keep Chromium's own (successful) result, -2 = reject.
 * Only Chromium's default verification may pass; no override can admit a certificate it refused.
 * Electron documents verificationResult as "OK", but Electron 44 reports net::ErrorToString(),
 * i.e. "net::OK" (and "net::ERR_CERT_…" on failure). Matching only "OK" refused every HTTPS page. */
export function browserCertificateVerdict(request: { errorCode?: unknown; verificationResult?: unknown }): -3 | -2 {
  const result = typeof request.verificationResult === "string" ? request.verificationResult.replace(/^net::/, "") : undefined;
  return request.errorCode === 0 && result === "OK" ? -3 : -2;
}
export interface BrowserSessionOptions {
  partition: string;
  registeredHostIds: Iterable<string>;
  policy: BrowserUrlPolicy;
  /** Unknown guests and workers without a current registry association fail closed. */
  acceptWebContents: (id: number) => boolean;
  /** Main-only response observation; never log raw authentication URLs or headers. */
  onResponse?: (webContentsId: number, details: { url: string; statusCode: number; headers: Record<string, string[]> }) => void;
  /** A refused main-frame request of an admitted guest (reason enum only; never the URL). */
  onRefused?: (webContentsId: number, reason: BrowserRefusal) => void;
  /** Main's attribution of a download (owner / agent), or false to cancel it. Omitted = cancel
   * every download. An allowed download must still go through a save dialog (no setSavePath). */
  download?: (webContentsId: number | undefined, item: DownloadItem) => boolean;
  /** Per-origin site permissions the owner granted. Omitted = deny every request and check. */
  permissions?: BrowserSessionPermissions;
}
export interface BrowserPermissionDetails { requestingUrl?: string; isMainFrame?: boolean; mediaTypes?: string[]; mediaType?: string; embeddingOrigin?: string }
export interface BrowserSessionPermissions {
  /** A request from a known guest; resolves false unless the owner allowed (now or remembered). */
  request(webContentsId: number, permission: string, details: BrowserPermissionDetails): Promise<boolean> | boolean;
  /** Synchronous check: only a remembered allow passes. */
  check(webContentsId: number, permission: string, requestingOrigin: string, details: BrowserPermissionDetails): boolean;
}
export interface BrowserSessionPolicy { dispose(): void }
type SessionRegistration = { partition: string; ready: Promise<BrowserSessionPolicy>; revoke(): void; active(): boolean };
const installed = new WeakMap<Session, SessionRegistration>();
const downloadGuarded = new WeakSet<Session>();
const downloadDeciders = new WeakMap<Session, (webContentsId: number | undefined, item: DownloadItem) => boolean>();

/** Synchronous window teardown, including a still-pending setProxy. A late completion cannot
 * reactivate the old registry closure or evict a replacement window's registration. */
export function revokeBrowserSessionPolicy(session: Session): void { installed.get(session)?.revoke(); }

/** Call only on session.fromPartition(main-derived partition), before permitting attach. */
export function installBrowserSessionPolicy(session: Session, options: BrowserSessionOptions): Promise<BrowserSessionPolicy> {
  if (!matchBrowserPartition(options.partition, options.registeredHostIds)) return Promise.reject(new Error("Unregistered browser partition"));
  const old = installed.get(session);
  if (old) return old.partition === options.partition ? old.ready : Promise.reject(new Error("Session partition changed"));
  let active = false;
  let revoked = false;
  // Install denial gates synchronously before awaiting proxy setup; partial setup never permits traffic.
  // Site permissions: only main's per-origin owner decision, only for an accepted guest, only while
  // this registration is active. HID / serial / USB / Bluetooth device access stays denied.
  session.setPermissionRequestHandler((contents, permission, callback, details) => {
    const id = contents?.id;
    if (!active || !options.permissions || typeof id !== "number" || !options.acceptWebContents(id)) return callback(false);
    let answered = false;
    const answer = (value: boolean) => { if (!answered) { answered = true; callback(active && value === true); } };
    try { void Promise.resolve(options.permissions.request(id, permission, permissionDetails(details))).then(answer, () => answer(false)); }
    catch { answer(false); }
  });
  session.setPermissionCheckHandler((contents, permission, requestingOrigin, details) => {
    try {
      const id = contents?.id;
      return active && !!options.permissions && typeof id === "number" && options.acceptWebContents(id)
        && options.permissions.check(id, permission, requestingOrigin, permissionDetails(details)) === true;
    } catch { return false; }
  });
  session.setDevicePermissionHandler(() => false);
  session.setCertificateVerifyProc((request, callback) => callback(browserCertificateVerdict(request)));
  if (options.download) downloadDeciders.set(session, options.download); else downloadDeciders.delete(session);
  if (!downloadGuarded.has(session)) {
    // One listener per session for its lifetime; the current registration decides. Anything
    // unattributed, after revocation or on an error is cancelled before it touches the disk.
    session.on("will-download", (event, item, contents) => {
      let allow = false;
      try {
        const id = contents && typeof contents.id === "number" ? contents.id : undefined;
        const decide = installed.get(session)?.active() ? downloadDeciders.get(session) : undefined;
        allow = !!decide && decide(id, item) === true;
      } catch { allow = false; }
      if (!allow) { event.preventDefault(); item.cancel(); }
    });
    downloadGuarded.add(session);
  }
  session.webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, (details, callback) => {
    let allow = false;
    try {
      // The two-phase bind bootstraps an unbound guest on inert exact about:blank. It cannot
      // fetch a resource until main has checked the app-frame receipt and registered its ID.
      const inertBlank = details.url === "about:blank" && (details.resourceType === "mainFrame" || details.resourceType === "subFrame");
      const id = details.webContentsId;
      const known = typeof id === "number" && Number.isSafeInteger(id) && id > 0 && options.acceptWebContents(id);
      // Attribution: the exact guest plus Electron's initiatorOrigin (absent = browser-started).
      // Every guest request is a page actor; main's own navigations were admitted before loadURL.
      const initiator = (details as { initiatorOrigin?: unknown }).initiatorOrigin;
      const context: BrowserRequestContext = { actor: "page", resourceType: details.resourceType,
        ...(known ? { webContentsId: id } : {}), ...(typeof initiator === "string" ? { initiatorOrigin: initiator } : {}) };
      if (active && (inertBlank || known)) {
        if (inertBlank) allow = options.policy.isRequestAllowed(details.url, details.resourceType, context);
        else {
          const reason = options.policy.refusal(details.url, context);
          allow = reason === null;
          if (reason && details.resourceType === "mainFrame") try { options.onRefused?.(id!, reason); } catch { /* Reporting only. */ }
        }
      }
    } catch { /* Host removal, malformed metadata, adapter errors all deny. */ }
    callback({ cancel: !allow });
  });
  session.webRequest.onHeadersReceived({ urls: ["<all_urls>"] }, (details, callback) => {
    callback({});
    try {
      if (!active || details.resourceType !== "mainFrame" || typeof details.webContentsId !== "number" || !options.acceptWebContents(details.webContentsId)) return;
      const headers: Record<string, string[]> = Object.create(null);
      for (const [key, value] of Object.entries(details.responseHeaders ?? {}))
        headers[key.toLowerCase()] = Array.isArray(value) ? [...value] : [value];
      options.onResponse?.(details.webContentsId, { url: details.url, statusCode: details.statusCode, headers });
    } catch { /* Observation must not interfere with the response or open an admission gate. */ }
  });
  const registration: SessionRegistration = { partition: options.partition, ready: undefined!, active: () => active, revoke() {
    revoked = true;
    active = false; // Gate old callbacks before dropping the cached host/registry closure.
    if (installed.get(session) === registration) { installed.delete(session); downloadDeciders.delete(session); }
  } };
  const ready = queueBrowserSessionProxy(session, () => {
    if (revoked) throw new Error("Browser session policy revoked during setup");
    return session.setProxy({ ...BROWSER_LOCAL_PROXY });
  }).then(() => {
    if (revoked) throw new Error("Browser session policy revoked during setup");
    active = true;
    return { dispose: registration.revoke };
  });
  registration.ready = ready;
  installed.set(session, registration);
  return ready;
}

function permissionDetails(raw: unknown): BrowserPermissionDetails {
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const text = (key: string) => typeof value[key] === "string" && (value[key] as string).length <= 8192 ? value[key] as string : undefined;
  const list = Array.isArray(value.mediaTypes) ? value.mediaTypes.filter((item): item is string => typeof item === "string").slice(0, 4) : undefined;
  return { ...(text("requestingUrl") ? { requestingUrl: text("requestingUrl") } : {}), ...(typeof value.isMainFrame === "boolean" ? { isMainFrame: value.isMainFrame } : {}),
    ...(list ? { mediaTypes: list } : {}), ...(text("mediaType") ? { mediaType: text("mediaType") } : {}), ...(text("embeddingOrigin") ? { embeddingOrigin: text("embeddingOrigin") } : {}) };
}

export interface BrowserGuestPolicyOptions {
  hostId: string;
  policy: BrowserUrlPolicy;
  onBlocked?: (kind: "navigation" | "redirect", url: string, mainFrame: boolean, reason: BrowserRefusal) => void;
}
export interface BrowserPopupPolicyOptions {
  hostId: string;
  policy: BrowserUrlPolicy;
  /** The opener guest and its current document origin: a page popup is a page actor. */
  webContentsId?: number;
  openerOrigin?: string;
  /** A controlled app tab replaces the native window: same host and login pool as the opener.
   * post: a form's body (target=_blank POST), replayed once by main. agent: the opener's agent
   * caused it (its own dispatched click), not the owner. */
  onNewTab?: (request: BrowserPopupRequest) => void;
  /** Must be host-observed one-use owner activation, NOT a page-supplied userGesture flag.
   * Electron's public WindowOpenHandlerDetails has no trustworthy userGesture property.
   * Omit to deny all new-tab forwarding. Input generated by a provider is not owner input. */
  consumeOwnerGesture?: () => boolean;
  /** The opener's leased agent is dispatching input right now (main's own provider state, never a
   * page flag). Its popup becomes an app tab too, rate limited by consumeAgentPopup. */
  agentActing?: () => boolean;
  consumeAgentPopup?: () => boolean;
}
export interface BrowserPopupPost { data: Buffer; contentType: string }
export interface BrowserPopupRequest { hostId: string; url: string; post?: BrowserPopupPost; agent?: true }
export type BrowserPopupDiscardReason = "unavailable" | "invalid_url" | "post_body" | "policy_denied"
  | "no_owner_gesture" | "agent_rate_limited" | "no_forwarder" | "handler_error";
/** Largest form body a popup may carry into its new tab (raw parts only, no file references). */
export const BROWSER_POPUP_POST_LIMIT = 1024 * 1024;
const FORM_TYPES = new Set(["application/x-www-form-urlencoded", "multipart/form-data", "text/plain"]);
/** A target=_blank / window.open form body: only in-memory bytes Chromium serialized (never an
 * UploadFile path, which main would read from disk), bounded, with a plain form content type. */
export function browserPopupPost(body: unknown): BrowserPopupPost | null {
  if (!body || typeof body !== "object") return null;
  const value = body as { data?: unknown; contentType?: unknown; boundary?: unknown };
  if (!Array.isArray(value.data) || value.data.length > 64 || typeof value.contentType !== "string") return null;
  const type = value.contentType.trim().toLowerCase();
  if (!FORM_TYPES.has(type)) return null;
  const parts: Buffer[] = []; let size = 0;
  for (const part of value.data) {
    const raw = part as { type?: unknown; bytes?: unknown };
    if (!raw || raw.type !== "rawData" || !Buffer.isBuffer(raw.bytes)) return null;
    size += raw.bytes.length; if (size > BROWSER_POPUP_POST_LIMIT) return null;
    parts.push(raw.bytes);
  }
  if (type === "multipart/form-data") {
    if (typeof value.boundary !== "string" || !/^[A-Za-z0-9'()+_,./:=?-]{1,70}$/.test(value.boundary)) return null;
    return { data: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${value.boundary}` };
  }
  return { data: Buffer.concat(parts), contentType: type };
}

/** Install ONCE at web-contents-created before any guest load. Resolve current admission and
 * host state on every attempt; undefined means unbound/revoked. All paths deny native windows.
 * Diagnostics contain only an enum, never URL, frame name, features, page text or credentials. */
export function createBrowserWindowOpenHandler(getOptions: () => BrowserPopupPolicyOptions | undefined,
  onPopupDiscard?: (reason: BrowserPopupDiscardReason) => void): (details: HandlerDetails) => { action: "deny" } {
  const drop = (reason: BrowserPopupDiscardReason) => { try { onPopupDiscard?.(reason); } catch { /* Diagnostic only. */ } };
  return details => {
    try {
      const options = getOptions();
      if (!options) drop("unavailable");
      else {
        const url = parseNetworkUrl(details.url);
        if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) drop("invalid_url");
        else {
          const post = details.postBody ? browserPopupPost(details.postBody) : undefined;
          if (post === null) drop("post_body");
          else if (!options.policy.isNavigationAllowed(details.url, { actor: "page", webContentsId: options.webContentsId, resourceType: "mainFrame",
            ...(options.openerOrigin ? { initiatorOrigin: options.openerOrigin } : {}) })) drop("policy_denied");
          else if (!options.onNewTab) drop("no_forwarder");
          // The leased agent's own click: an app tab in the same pool, never the owner's gesture.
          else if (options.agentActing?.() === true) {
            if (options.consumeAgentPopup?.() !== true) drop("agent_rate_limited");
            else options.onNewTab({ hostId: options.hostId, url: url.href, ...(post ? { post } : {}), agent: true });
          }
          // Invalid scheme/policy/POST attempts do not spend the one-use owner input token.
          else if (options.consumeOwnerGesture?.() !== true) drop("no_owner_gesture");
          else options.onNewTab({ hostId: options.hostId, url: url.href, ...(post ? { post } : {}) });
        }
      }
    } catch { drop("handler_error"); }
    return { action: "deny" };
  };
}

const clientCertificateGuards = new WeakSet<object>();
/** Install before the first admitted network navigation (unbound guests are inert about:blank).
 * Never select an OS/client identity or
 * permit Electron's default first-certificate selection. Retained through guest disposal;
 * calling again from later hardening is safe and must not invoke callbacks twice. */
export function denyBrowserClientCertificates(guest: Pick<WebContents, "on">): void {
  if (clientCertificateGuards.has(guest)) return;
  guest.on("select-client-certificate", (event, _url, _certificates, callback) => {
    event.preventDefault();
    // Electron 44's app declaration permits no certificate; WebContents documents identical
    // behavior but its callback parameter is incorrectly non-optional. Pass zero arguments.
    (callback as (certificate?: Certificate) => void)();
  });
  clientCertificateGuards.add(guest);
}

/** Navigation/WebRTC and client-certificate denial. Popup handling MUST already exist at web-contents-created; never
 * replace it here. No openExternal, custom preload, or arbitrary evaluator is installed. */
export function hardenBrowserGuest(guest: WebContents, options: BrowserGuestPolicyOptions): () => void {
  denyBrowserClientCertificates(guest);
  guest.setWebRTCIPHandlingPolicy(BROWSER_WEBRTC_POLICY);
  let active = true;
  const denyNavigation = (kind: "navigation" | "redirect") => (event: { url: string; isMainFrame?: boolean; preventDefault(): void }) => {
    let reason: BrowserRefusal | null = "invalid_url";
    // Page-initiated (or redirected) navigation of this guest. Private-class targets pass here only
    // for an origin admitted in this tab; onBeforeRequest then checks the real initiator.
    try {
      const context: BrowserRequestContext = { actor: "page", webContentsId: guest.id };
      if (active) reason = options.policy.isNavigationAllowed(event.url, context) ? null : options.policy.refusal(event.url, context) ?? "invalid_url";
    } catch { reason = "invalid_url"; /* Fail closed. */ }
    if (reason) {
      event.preventDefault();
      try { options.onBlocked?.(kind, event.url, event.isMainFrame !== false, reason); } catch { /* Reporting cannot permit navigation. */ }
    }
  };
  const navigate = denyNavigation("navigation"), redirect = denyNavigation("redirect");
  guest.on("will-frame-navigate", navigate);
  guest.on("will-navigate", navigate);
  guest.on("will-redirect", redirect);
  // Disposal keeps navigation deny handlers installed; the early popup handler lives separately.
  return () => { active = false; };
}
