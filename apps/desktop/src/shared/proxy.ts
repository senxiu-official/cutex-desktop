// Proxy settings (docs/research/proxy-support-20261017.md, owner-approved v1 §d + Q1–Q10):
//   - the cutex host proxy: `/v2/settings.proxy` (cutex `proxy-modes`) — the default every Profile
//     inherits and the proxy of cutex's own downloads; changed only with the host's own credential;
//   - a Profile's proxy: `/v2/profiles` item `proxy` (cutex `profile-proxy`): inherit / none / manual;
//   - this desktop's update proxy (desktop-prefs.json `updateProxy`): only the updater's own Chromium
//     session (`cutex-updater`) and the programs a source update runs; never desktop → cutex calls,
//     which always go direct (loopback / SSH tunnel; shared/loopbackNoProxy.ts).
// Credentials: only Basic inside a manual URL. cutex stores them and never returns them
// (`urlHasCredentials`); the desktop keeps its own with safeStorage and shows the URL without them.

export const PROXY_MODES_FEATURE = "proxy-modes";
export const PROFILE_PROXY_FEATURE = "profile-proxy";

export type HostProxyMode = "system" | "none" | "manual";
export type ProfileProxyMode = "inherit" | "none" | "manual";

/** `/v2/settings.proxy` with cutex `proxy-modes`. */
export interface HostProxyView {
  mode: HostProxyMode;
  /** Stored manual URL without credentials. */
  url: string | null;
  urlHasCredentials: boolean;
  noProxy: string | null;
  /** Always bypassed, not editable (described only). */
  loopbackNoProxy: string[];
  /** What "follow system" resolves to on the host right now (credentials removed). */
  system: { url: string; source: "environment" | "windowsSystem" } | null;
  pacSupported?: boolean;
  /** This connection may change it (the host's own credential, never a paired device). */
  editable: boolean;
  warning: string | null;
}

/** PATCH `/v2/settings {proxy}`: an omitted `url` / `noProxy` keeps the stored value (and its credentials). */
export interface HostProxyPatch {
  mode: HostProxyMode;
  url?: string | null;
  noProxy?: string | null;
}

/** `/v2/profiles` item `proxy` with cutex `profile-proxy`. */
export interface ProfileProxyView {
  mode: ProfileProxyMode;
  url: string | null;
  urlHasCredentials: boolean;
  noProxy: string | null;
  effective: { mode: HostProxyMode; url: string | null; source: "manual" | "environment" | "windowsSystem" | null };
  editable: boolean;
}

export interface ProfileProxyPatch {
  mode: ProfileProxyMode;
  url?: string | null;
  noProxy?: string | null;
}

export type UpdateProxyMode = "system" | "none" | "manual";

/** desktop-prefs.json `updateProxy` (credentials are not here: main keeps them with safeStorage). */
export interface UpdateProxyPref {
  mode: UpdateProxyMode;
  /**
   * Manual proxy URL without credentials (`http://host:port`). Kept in every mode (owner Q16 ②): set
   * once, switching to 跟随系统 / 不使用 and back to 手动 shows (and uses) it again.
   */
  url?: string;
  /** The manual URL had `user:password@` (stored encrypted by main). */
  hasCredentials?: boolean;
}

/** `shell.setUpdateProxy`: `url` may carry `user:password@` (sent once to main, never echoed back). */
export interface UpdateProxyRequest {
  mode: UpdateProxyMode;
  url?: string | null;
}

export type ProxyScheme = "http" | "https" | "socks4" | "socks5";

export interface ParsedProxyUrl {
  scheme: ProxyScheme;
  host: string;
  port: number;
  username: string | null;
  password: string | null;
  /** `scheme://host:port` without credentials. */
  display: string;
}

const DEFAULT_PORTS: Record<ProxyScheme, number> = { http: 80, https: 443, socks4: 1080, socks5: 1080 };

/**
 * A manual proxy URL (`http://[user:pass@]host[:port]`; schemes http, https, socks4(a), socks5(h)); a bare
 * `host:port` means http. Returns an error code instead for anything else.
 */
export function parseProxyUrl(text: string): ParsedProxyUrl | { error: "empty" | "invalid" | "scheme" } {
  const trimmed = text.trim();
  if (!trimmed) return { error: "empty" };
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { error: "invalid" };
  }
  const raw = url.protocol.replace(/:$/, "").toLowerCase();
  const scheme: ProxyScheme | null = raw === "http" || raw === "https" ? raw : raw === "socks5" || raw === "socks5h" || raw === "socks" ? "socks5" : raw === "socks4" || raw === "socks4a" ? "socks4" : null;
  if (!scheme) return { error: "scheme" };
  if (!url.hostname || (url.pathname && url.pathname !== "/") || url.search || url.hash) return { error: "invalid" };
  const port = url.port ? Number(url.port) : DEFAULT_PORTS[scheme];
  const host = url.hostname;
  const decode = (v: string) => {
    try {
      return decodeURIComponent(v);
    } catch {
      return v;
    }
  };
  return {
    scheme,
    host,
    port,
    username: url.username ? decode(url.username) : null,
    password: url.password ? decode(url.password) : null,
    display: `${scheme}://${host}:${port}`,
  };
}

export function isProxyParseError(v: ParsedProxyUrl | { error: string }): v is { error: "empty" | "invalid" | "scheme" } {
  return "error" in v;
}

/** Chromium `proxyRules` for one manual proxy (all URL schemes). */
export function chromiumProxyRules(p: Pick<ParsedProxyUrl, "scheme" | "host" | "port">): string {
  const host = p.host.includes(":") && !p.host.startsWith("[") ? `[${p.host}]` : p.host;
  return `${p.scheme}://${host}:${p.port}`;
}

/** The URL with any `user:password@` removed (for display), or the text unchanged when unparseable. */
export function redactProxyUrl(text: string): string {
  const parsed = parseProxyUrl(text);
  return isProxyParseError(parsed) ? text.replace(/^([a-z0-9+.-]+:\/\/)?[^@/]*@/i, "$1") : parsed.display;
}

export function parseUpdateProxyPref(raw: unknown): UpdateProxyPref | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const parsed = typeof value.url === "string" ? parseProxyUrl(value.url) : null;
  const url = parsed && !isProxyParseError(parsed) ? { url: parsed.display, ...(value.hasCredentials === true ? { hasCredentials: true } : {}) } : null;
  if (value.mode === "none") return { mode: "none", ...url };
  if (value.mode === "manual") return url ? { mode: "manual", ...url } : undefined;
  // Follow system: stored only to keep a manual URL for later.
  if (value.mode === "system" && url) return { mode: "system", ...url };
  return undefined;
}

/**
 * The `noProxy` text a user typed, normalised for cutex (comma list, no blanks, no loopback names —
 * those are always added by cutex and not editable); null when empty.
 */
export function normalizeNoProxy(text: string, loopback: readonly string[] = ["127.0.0.1", "localhost", "::1"]): string | null {
  const entries = text
    .split(/[,;\s]+/)
    .map((e) => e.trim())
    .filter((e) => e && !loopback.includes(e.toLowerCase()));
  return entries.length ? [...new Set(entries)].join(",") : null;
}
