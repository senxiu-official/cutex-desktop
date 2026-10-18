// The updater's network access through Chromium (main process only): its own in-memory session
// `cutex-updater` (no persisted cookies or cache) with the OS proxy settings (`setProxy({ mode: "system" })`
// — Windows / macOS system proxy incl. PAC / WPAD, Linux desktop settings and *_PROXY env, as Chrome
// resolves them), and `resolveProxy` for the programs the source updater runs (git fetch over http(s),
// pnpm / corepack / Electron downloads during the build).
//
// Containment: the agent-page / plugin lockdown (pluginNetwork.ts) proxies only the default session —
// this session is not touched by it, nor by the in-app browser's egress (its own partitions) — but its
// DNS setting (`app.configureHostResolver`, secure DNS to a dead endpoint) is process wide and cannot be
// scoped to one session. Once it is engaged in a run (`contained()`), Chromium cannot resolve names any
// more, so the transfer moves to Node (OS resolver) through the proxy Chromium resolved for that URL;
// the lockdown itself stays exactly as it is.
//
// Settings → 网络代理 picks the mode (system / none / manual, `UpdateProxyConfig` below); it applies to this
// session only — never to desktop → cutex calls (Node fetch, loopback / SSH tunnel, always direct).
//
// Test builds only (`--update-test-hooks` packages, binarySource): CUTEX_DESKTOP_UPDATE_TEST_PROXY =
// http://127.0.0.1:<port> replaces the system proxy with that fixed proxy, loopback not bypassed.
import { app, net, session, type ClientRequestConstructorOptions, type ProxyConfig, type Session } from "electron";
import type { Readable } from "node:stream";
import { nodeTransport, parseResolvedProxy, ProxyAuthError, type ProxyServer, type Transport, type TransportResponse } from "./updateTransport";

export const UPDATER_PARTITION = "cutex-updater";

export interface UpdateNet {
  transport: Transport;
  /** The proxy Chromium would use for `url` (null = DIRECT / unknown). */
  proxyFor(url: string): Promise<ProxyServer | null>;
  /** Re-apply the update proxy setting (Settings → 网络代理 changed). */
  reconfigure?(): Promise<void>;
}

/**
 * This desktop's update proxy (desktop-prefs.json `updateProxy`, main/shell.ts `updateProxyConfig`):
 * the OS settings (default), direct, or one manual proxy (Chromium `proxyRules`, plus the Basic
 * credentials answered once to its `login` challenge). Loopback stays direct in every mode.
 */
export type UpdateProxyConfig = { mode: "system" } | { mode: "none" } | { mode: "manual"; rules: string; server: ProxyServer };

export function chromiumProxyConfig(config: UpdateProxyConfig): ProxyConfig {
  if (config.mode === "none") return { mode: "direct" };
  if (config.mode === "manual") return { mode: "fixed_servers", proxyRules: config.rules };
  return { mode: "system" };
}

export function createUpdateNet(opts: { contained: () => boolean; testProxy?: string | null; proxy?: () => UpdateProxyConfig }): UpdateNet {
  let ready: Promise<Session> | null = null;
  const config = (): UpdateProxyConfig => opts.proxy?.() ?? { mode: "system" };
  const apply = async (s: Session) => {
    if (opts.testProxy) await s.setProxy({ mode: "fixed_servers", proxyRules: opts.testProxy, proxyBypassRules: "<-loopback>" });
    else await s.setProxy(chromiumProxyConfig(config()));
  };
  const ses = (): Promise<Session> =>
    (ready ??= (async () => {
      await app.whenReady();
      const s = session.fromPartition(UPDATER_PARTITION, { cache: false });
      await apply(s);
      return s;
    })().catch((error) => {
      ready = null;
      throw error;
    }));
  const manualServer = (): ProxyServer | null => {
    const c = config();
    return c.mode === "manual" ? c.server : null;
  };
  const proxyFor = async (url: string): Promise<ProxyServer | null> => {
    try {
      const resolved = parseResolvedProxy(await (await ses()).resolveProxy(url));
      // The manual proxy's credentials ride along for the Node fallback (never into git / pnpm URLs).
      const manual = manualServer();
      return resolved && manual?.auth && resolved.host === manual.host && resolved.port === manual.port ? { ...resolved, auth: manual.auth } : resolved;
    } catch {
      return null;
    }
  };
  const transport: Transport = async (url, init) => {
    const s = await ses();
    if (!opts.contained()) return chromiumRequest(s, url, init, manualServer()?.auth ?? null);
    return nodeTransport(await proxyFor(url))(url, init);
  };
  const reconfigure = async () => {
    if (!ready) return;
    const s = await ready.catch(() => null);
    if (!s) return;
    await apply(s);
    await s.closeAllConnections().catch(() => {});
  };
  return { transport, proxyFor, reconfigure };
}

/** One GET through Chromium on `ses`: redirects are returned (never followed), no cookies, no credentials. */
function chromiumRequest(ses: Session, url: string, init: { headers: Record<string, string>; signal: AbortSignal }, proxyCredentials: { username: string; password: string } | null): Promise<TransportResponse> {
  return new Promise((resolve, reject) => {
    const options: ClientRequestConstructorOptions = { url, method: "GET", session: ses, redirect: "manual", credentials: "omit", useSessionCookies: false, cache: "no-store" };
    const req = net.request(options);
    for (const [k, v] of Object.entries(init.headers)) req.setHeader(k, v);
    let settled = false;
    let proxyAuth: string | null = null;
    let answered = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };
    const abort = () => {
      try {
        req.abort();
      } catch {
        // already finished
      }
    };
    // No prompt in v1: the manual proxy's Basic credentials are answered once; otherwise (or when
    // they are refused) an authenticating proxy fails the request (cancelled auth → 407 / error).
    req.on("login", (info, callback) => {
      if (info.isProxy && proxyCredentials && !answered) {
        answered = true;
        return callback(proxyCredentials.username, proxyCredentials.password);
      }
      if (info.isProxy) proxyAuth = `${info.host}:${info.port}`;
      callback();
    });
    req.on("redirect", (status, _method, redirectUrl, headers) => {
      done(() => {
        abort();
        resolve({
          status,
          header: (name) => (name.toLowerCase() === "location" ? redirectUrl : first(headers[name.toLowerCase()])),
          body: (async function* () {})(),
          cancel: () => {},
        });
      });
    });
    req.on("response", (res) => {
      if (res.statusCode === 407 || proxyAuth) {
        abort();
        return done(() => reject(new ProxyAuthError(proxyAuth ?? "407")));
      }
      // An abort mid-body ends the stream with an error instead of leaving the reader waiting.
      // (Electron's IncomingMessage is a Readable at runtime; its typings omit destroy.)
      const stream = res as unknown as Readable;
      res.on("aborted", () => stream.destroy(new Error("request aborted")));
      done(() => resolve({ status: res.statusCode, header: (name) => first(res.headers[name.toLowerCase()]), body: stream, cancel: abort }));
    });
    req.on("error", (error) => done(() => reject(proxyAuth ? new ProxyAuthError(proxyAuth) : error)));
    if (init.signal.aborted) {
      abort();
      return done(() => reject(init.signal.reason ?? new Error("aborted")));
    }
    init.signal.addEventListener(
      "abort",
      () => {
        abort();
        done(() => reject(init.signal.reason ?? new Error("aborted")));
      },
      { once: true },
    );
    req.end();
  });
}

function first(v: string | string[] | undefined): string | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}
