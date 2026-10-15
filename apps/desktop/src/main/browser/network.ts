import type { Certificate, HandlerDetails, Session, WebContents } from "electron";
import { matchBrowserPartition } from "./attachPolicy";
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
export interface BrowserUrlPolicy {
  isNavigationAllowed(url: unknown): boolean;
  isRequestAllowed(url: unknown, resourceType?: string): boolean;
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

/** Current host state is re-read on EVERY request, including redirects and subresources. */
export function createBrowserUrlPolicy(options: { getHost: () => BrowserNetworkHost | undefined; externalAllowed?: (url: string) => boolean }): BrowserUrlPolicy {
  const networkAllowed = (value: unknown) => {
    const host = options.getHost(), url = parseNetworkUrl(value);
    if (!host || !url) return false;
    const port = Number(url.port || (url.protocol === "https:" || url.protocol === "wss:" ? 443 : 80));
    if (host.serviceProxy && SERVICE_HOST.test(url.hostname) && url.protocol !== "https:" && url.protocol !== "wss:" &&
      Number.isInteger(host.connectionPort) && port === host.connectionPort) return true;
    // This callback exists only while the main-owned development N2 proxy/session is ready.
    // It is syntactic admission, not DNS proof; the proxy revalidates every resolved address.
    if (options.externalAllowed?.(url.href) === true) return true;
    if (host.kind === "ssh") return false; // Desktop loopback is not the remote host's loopback.
    if (LOOPBACK.has(url.hostname)) return true;
    // Do not promote an arbitrary public localUrl into external-network authority. A later
    // explicit LAN profile can add trusted literal private origins together with proxy bypass.
    return false;
  };
  return {
    isNavigationAllowed(value) {
      if (!options.getHost()) return false;
      if (value === "about:blank") return true;
      const url = parseNetworkUrl(value);
      return !!url && (url.protocol === "http:" || url.protocol === "https:") && networkAllowed(value);
    },
    isRequestAllowed(value, resourceType) {
      if (value === "about:blank") return !!options.getHost() && (resourceType === "mainFrame" || resourceType === "subFrame");
      return networkAllowed(value);
    },
  };
}

// This session-only proxy closes speculative TCP/WebRTC escape paths not covered by webRequest.
// It does NOT change the existing app-wide DNS policy. Speculative DNS needs separate evidence;
// onBeforeRequest alone must never be described as proving zero DNS packets.
export const BROWSER_LOCAL_PROXY = Object.freeze({ mode: "fixed_servers" as const,
  proxyRules: "socks5://127.0.0.1:9",
  proxyBypassRules: "<-loopback>;localhost;127.0.0.1;[::1];*.svc.localhost" });
export interface BrowserSessionOptions {
  partition: string;
  registeredHostIds: Iterable<string>;
  policy: BrowserUrlPolicy;
  /** Unknown guests and workers without a current registry association fail closed. */
  acceptWebContents: (id: number) => boolean;
  /** Main-only response observation; never log raw authentication URLs or headers. */
  onResponse?: (webContentsId: number, details: { url: string; statusCode: number; headers: Record<string, string[]> }) => void;
}
export interface BrowserSessionPolicy { dispose(): void }
type SessionRegistration = { partition: string; ready: Promise<BrowserSessionPolicy>; revoke(): void };
const installed = new WeakMap<Session, SessionRegistration>();
const downloadGuarded = new WeakSet<Session>();

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
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
  session.setDevicePermissionHandler(() => false);
  session.setCertificateVerifyProc((request, callback) => callback(request.errorCode === 0 && request.verificationResult === "OK" ? -3 : -2));
  if (!downloadGuarded.has(session)) {
    session.on("will-download", (event, item) => { event.preventDefault(); item.cancel(); });
    downloadGuarded.add(session);
  }
  session.webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, (details, callback) => {
    let allow = false;
    try {
      // The two-phase bind bootstraps an unbound guest on inert exact about:blank. It cannot
      // fetch a resource until main has checked the app-frame receipt and registered its ID.
      const inertBlank = details.url === "about:blank" && (details.resourceType === "mainFrame" || details.resourceType === "subFrame");
      allow = active && options.policy.isRequestAllowed(details.url, details.resourceType) && (inertBlank ||
        (typeof details.webContentsId === "number" && Number.isSafeInteger(details.webContentsId) && details.webContentsId > 0 &&
          options.acceptWebContents(details.webContentsId)));
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
  const registration: SessionRegistration = { partition: options.partition, ready: undefined!, revoke() {
    revoked = true;
    active = false; // Gate old callbacks before dropping the cached host/registry closure.
    if (installed.get(session) === registration) installed.delete(session);
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

export interface BrowserGuestPolicyOptions {
  hostId: string;
  policy: BrowserUrlPolicy;
  onBlocked?: (kind: "navigation" | "redirect", url: string, mainFrame: boolean) => void;
}
export interface BrowserPopupPolicyOptions {
  hostId: string;
  policy: BrowserUrlPolicy;
  onNewTab?: (request: { hostId: string; url: string }) => void;
  /** Must be host-observed one-use owner activation, NOT a page-supplied userGesture flag.
   * Electron's public WindowOpenHandlerDetails has no trustworthy userGesture property.
   * Omit to deny all new-tab forwarding. Input generated by a provider is not owner input. */
  consumeOwnerGesture?: () => boolean;
}
export type BrowserPopupDiscardReason = "unavailable" | "invalid_url" | "post_body" | "policy_denied"
  | "no_owner_gesture" | "no_forwarder" | "handler_error";

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
        else if (details.postBody) drop("post_body");
        else if (!options.policy.isNavigationAllowed(details.url)) drop("policy_denied");
        else if (!options.onNewTab) drop("no_forwarder");
        // Invalid scheme/policy/POST attempts do not spend the one-use owner input token.
        else if (options.consumeOwnerGesture?.() !== true) drop("no_owner_gesture");
        else options.onNewTab({ hostId: options.hostId, url: url.href });
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
    let allowed = false;
    try { allowed = active && options.policy.isNavigationAllowed(event.url); } catch { /* Fail closed. */ }
    if (!allowed) {
      event.preventDefault();
      try { options.onBlocked?.(kind, event.url, event.isMainFrame !== false); } catch { /* Reporting cannot permit navigation. */ }
    }
  };
  const navigate = denyNavigation("navigation"), redirect = denyNavigation("redirect");
  guest.on("will-frame-navigate", navigate);
  guest.on("will-navigate", navigate);
  guest.on("will-redirect", redirect);
  // Disposal keeps navigation deny handlers installed; the early popup handler lives separately.
  return () => { active = false; };
}
