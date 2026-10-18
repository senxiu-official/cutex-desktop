// Small, credential-free state / references. URL policy and service tickets remain in main.
import type { Json } from "../types";

export const BROWSER_TAB = "browser.tab";
export const MAX_BROWSER_URL = 2000;
export const MAX_BROWSER_INPUT = 8000;
export type BrowserParams = { url: string; pendingOpen?: string; tabKey?: string; agentOpened?: true; ownerTab?: true };
/** front: an agent tab the owner brought into the card's webview (otherwise agent tabs run in main's
 * background carrier). Only meaningful with agentOpened; never selects a cookie pool. */
export type BrowserState = { url: string; title: string; tabKey: string; pendingOpen?: string; agentOpened?: true; newOwner?: true; front?: true };
// The shell's instance id is only scope-local. This key identifies the page across scopes;
// it is not a lease, a guest id, a partition selector or an authorization credential.
export function isBrowserTabKey(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}

const SECRET_QUERY = /(?:^|[-_])(?:access[-_]?token|refresh[-_]?token|id[-_]?token|token|auth|authorization|password|passwd|secret|signature|sig|jwt|bearer|otp|credential|api[-_]?key|key|code|ticket|session|sessionid)(?:$|[-_])/i;
const CONTROL = /[\u0000-\u001f\u007f]/;

/** Syntax only, never permission: main checks the bound host and every actual navigation. */
export function browserNavigationUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > MAX_BROWSER_INPUT) return null;
  const value = raw.trim();
  if (!value || CONTROL.test(value) || value.includes("\\")) return null;
  if (value === "about:blank") return value;
  if (value.startsWith("cutex:service/")) {
    // Service refs use the module contract's encoded path/query, not a new custom scheme.
    if (!/^cutex:service\/[a-z0-9][a-z0-9-]{0,62}(?:\/[^\s#]*)?$/.test(value)) return null;
    try { decodeURIComponent(value); } catch { return null; }
    return value;
  }
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password && url.href.length <= MAX_BROWSER_INPUT ? url.href : null;
  } catch { return null; }
}

/** Owner address-bar text that is not a web address at all (search words, a bare name). */
export const NOT_WEB_ADDRESS = "address_not_web";
/** Owner address-bar text that looks like an address but fails a URL rule (scheme, userinfo, …). */
export const INVALID_ADDRESS = "address_invalid";
export type BrowserAddressResult = { url: string } | { error: typeof NOT_WEB_ADDRESS | typeof INVALID_ADDRESS };

// host[:port] then an optional /path, ?query or #fragment. A scheme-less entry never has "//".
const SCHEMELESS = /^([^/?#]+)([/?#].*)?$/s;
const HOST_PORT = /^(\[[0-9a-f:.]+\]|[^:[\]]+)(?::(\d{1,5}))?$/i;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const LABEL = /^(?!-)[\p{L}\p{N}-]{1,63}(?<!-)$/u;

/**
 * Address-bar input only (agent / claim / popup URLs keep the strict browserNavigationUrl). Like a
 * normal browser, a scheme-less host[:port][/path] gets a scheme: `http://` for a loopback name
 * (localhost, *.localhost, 127.x, [::1]), otherwise `https://`. The result still passes every
 * browserNavigationUrl check and is syntax only: main decides whether the host may be opened.
 */
export function browserAddressUrl(raw: unknown): BrowserAddressResult {
  if (typeof raw !== "string" || raw.length > MAX_BROWSER_INPUT) return { error: INVALID_ADDRESS };
  const value = raw.trim();
  if (!value) return { error: NOT_WEB_ADDRESS };
  if (CONTROL.test(value) || value.includes("\\")) return { error: INVALID_ADDRESS };
  // An explicit scheme (http://, about:blank, cutex:service/, javascript:, …): unchanged rules.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) || /^(?:about|cutex|javascript|data|file|blob|mailto|view-source|chrome|devtools):/i.test(value)) {
    const url = browserNavigationUrl(value);
    return url ? { url } : { error: INVALID_ADDRESS };
  }
  if (/\s/.test(value)) return { error: NOT_WEB_ADDRESS };
  const parts = SCHEMELESS.exec(value);
  if (!parts) return { error: NOT_WEB_ADDRESS };
  const authority = parts[1]!;
  // Userinfo is never filled in: the strict check refuses it as an invalid URL.
  if (authority.includes("@")) return { error: INVALID_ADDRESS };
  const hostPort = HOST_PORT.exec(authority);
  if (!hostPort) return { error: NOT_WEB_ADDRESS };
  const host = hostPort[1]!.toLowerCase().replace(/\.$/, "");
  const port = hostPort[2];
  if (port !== undefined && Number(port) > 65535) return { error: NOT_WEB_ADDRESS };
  const bracketed = host.startsWith("[");
  const ipv4 = !bracketed && IPV4.test(host);
  if (ipv4 && host.split(".").some(octet => Number(octet) > 255)) return { error: NOT_WEB_ADDRESS };
  if (!bracketed && !ipv4 && host !== "localhost") {
    const labels = host.split(".");
    if (labels.length < 2 || !labels.every(label => LABEL.test(label)) || /^\d+$/.test(labels.at(-1)!)) return { error: NOT_WEB_ADDRESS };
  }
  const loopback = host === "localhost" || host.endsWith(".localhost") || (ipv4 && host.startsWith("127.")) || host === "[::1]";
  const url = browserNavigationUrl(`${loopback ? "http" : "https"}://${value}`);
  return url ? { url } : { error: INVALID_ADDRESS };
}

/** Drop bearer-like query fields and all fragments before state, refs, clipboard or tooltips. */
export function safeBrowserUrl(raw: unknown, maxLength = MAX_BROWSER_URL): string | null {
  if (typeof raw !== "string" || raw.length > MAX_BROWSER_INPUT || CONTROL.test(raw) || raw.includes("\\")) return null;
  const value = raw.trim();
  if (value === "about:blank") return value;
  if (value.startsWith("cutex:service/")) {
    if (!browserNavigationUrl(value)) return null;
    const slash = value.indexOf("/", "cutex:service/".length);
    if (slash < 0) return value;
    try {
      const path = decodeURIComponent(value.slice(slash));
      if (CONTROL.test(path) || path.includes("\\")) return null;
      const parsed = new URL(path, "http://service.invalid");
      if (parsed.origin !== "http://service.invalid") return null;
      cleanQuery(parsed);
      const suffix = parsed.pathname + parsed.search;
      const result = value.slice(0, slash) + encodeURIComponent(suffix).replaceAll("%2F", "/");
      return result.length <= maxLength ? result : null;
    } catch { return null; }
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.username = "";
    url.password = "";
    url.hash = "";
    cleanQuery(url);
    return url.href.length <= maxLength ? url.href : null;
  } catch { return null; }
}

function cleanQuery(url: URL): void {
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    // Normalize camelCase / punctuation so accessToken, api.key and X-Amz-Signature are private too.
    const normalized = key.replace(/([a-z])([A-Z])/g, "$1_$2").replace(/[^a-z0-9]/gi, "_");
    if (SECRET_QUERY.test(normalized)) url.searchParams.delete(key);
  }
}

export function browserTitle(raw: unknown): string {
  if (typeof raw !== "string") return "";
  // The ref contract counts UTF-16 units. Avoid splitting a surrogate pair at that boundary.
  let title = raw.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 200);
  if (/[\ud800-\udbff]$/.test(title)) title = title.slice(0, -1);
  return title;
}

export function parseBrowserParams(raw: Json): BrowserParams | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const url = safeBrowserUrl(raw.url);
  if (!url) return null;
  if (raw.pendingOpen !== undefined) {
    if (typeof raw.pendingOpen !== "string" || !/^[A-Za-z0-9._:-]{1,200}$/.test(raw.pendingOpen) || !isBrowserTabKey(raw.tabKey)) return null;
    // This is a correlation hint only. Main must find the same live, trusted relay open intent;
    // arbitrary launcher/ref params cannot allocate an agent partition or a lease.
    return { url, pendingOpen: raw.pendingOpen, tabKey: raw.tabKey };
  }
  if (raw.agentOpened === true) {
    // A same-pool owner popup has main-persisted provenance but no agent lease.
    if (!isBrowserTabKey(raw.tabKey)) return null;
    return { url, tabKey: raw.tabKey, agentOpened: true };
  }
  if (raw.ownerTab === true) {
    // A key main reserved as owner (claim-open). A made-up key has no owner provenance in main and
    // mounts isolated, so this hint cannot pick a cookie pool.
    if (!isBrowserTabKey(raw.tabKey)) return null;
    return { url, tabKey: raw.tabKey, ownerTab: true };
  }
  return { url };
}

export function initBrowser(params: BrowserParams, previous: BrowserState | null): BrowserState {
  if (params.pendingOpen && isBrowserTabKey(params.tabKey)) return { url: params.url, title: "", tabKey: params.tabKey, pendingOpen: params.pendingOpen, agentOpened: true };
  if (params.agentOpened && isBrowserTabKey(params.tabKey)) return { url: params.url, title: "", tabKey: params.tabKey, agentOpened: true };
  if (params.ownerTab && isBrowserTabKey(params.tabKey)) return { url: params.url, title: "", tabKey: params.tabKey };
  return { url: params.url, title: previous?.url === params.url ? browserTitle(previous.title) : "",
    tabKey: isBrowserTabKey(previous?.tabKey) ? previous.tabKey : crypto.randomUUID(), ...(previous?.agentOpened ? { agentOpened: true } : {}),
    ...(!previous || previous.newOwner ? { newOwner: true as const } : {}) };
}

export function restoreBrowser(raw: Json, version: number): BrowserState | null {
  if (version !== 1 || !raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  // v1.10 discard can be deferred while its scope is unloaded. A restart must not resurrect
  // a page whose relay command never reached confirmation, regardless of marker shape/value.
  if (Object.hasOwn(raw, "pendingOpen")) return null;
  // Never restore newOwner: only a newly initialized card may ask main to allocate a
  // different, fresh UUID. This is a workflow hint, not authority over the supplied key.
  const params = parseBrowserParams(raw);
  return params ? { url: params.url, title: browserTitle(raw.title), tabKey: isBrowserTabKey(raw.tabKey) ? raw.tabKey : crypto.randomUUID(),
    ...(raw.agentOpened === true ? { agentOpened: true as const, ...(raw.front === true ? { front: true as const } : {}) } : {}) } : null;
}

export function browserRef(state: BrowserState): { key: string; title: string; params: { url: string } } | null {
  const url = safeBrowserUrl(state.url);
  return url ? { key: url, title: browserTitle(state.title) || browserTitle(url), params: { url } } : null;
}

export function browserExternalUrl(raw: unknown): string | null {
  const url = safeBrowserUrl(raw, MAX_BROWSER_INPUT);
  return url?.startsWith("http:") || url?.startsWith("https:") ? url : null;
}

/** A background agent tab's live thumbnail: only main's bounded JPEG data URL, never a remote URL. */
export function safeBrowserThumbnail(raw: unknown): string | undefined {
  return typeof raw === "string" && raw.length <= 256 * 1024 && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(raw) ? raw : undefined;
}

/** No favicon request may run in the privileged app session. Main supplies bounded image bytes. */
export function safeBrowserFavicon(raw: unknown): string | undefined {
  return typeof raw === "string" && raw.length <= 128 * 1024 && /^data:image\/(?:png|jpeg|x-icon|vnd\.microsoft\.icon);base64,[A-Za-z0-9+/]+={0,2}$/.test(raw) ? raw : undefined;
}

/** A bounded plain-text error, with any URL credentials removed before showing it in app UI. */
export function browserError(error: unknown): string {
  const message = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']+': (?:[A-Za-z]*Error: )?/, "")
    .replace(/https?:\/\/[^\s<>"']+/gi, (url) => safeBrowserUrl(url) ?? "[URL]")
    .replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 400);
}

export { browserOwnerErrorKey as browserErrorKey } from "../../../../shared/browser";
