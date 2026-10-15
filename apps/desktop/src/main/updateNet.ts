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
// Test builds only (`--update-test-hooks` packages, binarySource): CUTEX_DESKTOP_UPDATE_TEST_PROXY =
// http://127.0.0.1:<port> replaces the system proxy with that fixed proxy, loopback not bypassed.
import { app, net, session, type ClientRequestConstructorOptions, type Session } from "electron";
import type { Readable } from "node:stream";
import { nodeTransport, parseResolvedProxy, ProxyAuthError, type ProxyServer, type Transport, type TransportResponse } from "./updateTransport";

export const UPDATER_PARTITION = "cutex-updater";

export interface UpdateNet {
  transport: Transport;
  /** The proxy Chromium would use for `url` (null = DIRECT / unknown). */
  proxyFor(url: string): Promise<ProxyServer | null>;
}

export function createUpdateNet(opts: { contained: () => boolean; testProxy?: string | null }): UpdateNet {
  let ready: Promise<Session> | null = null;
  const ses = (): Promise<Session> =>
    (ready ??= (async () => {
      await app.whenReady();
      const s = session.fromPartition(UPDATER_PARTITION, { cache: false });
      if (opts.testProxy) await s.setProxy({ mode: "fixed_servers", proxyRules: opts.testProxy, proxyBypassRules: "<-loopback>" });
      else await s.setProxy({ mode: "system" });
      return s;
    })().catch((error) => {
      ready = null;
      throw error;
    }));
  const proxyFor = async (url: string): Promise<ProxyServer | null> => {
    try {
      return parseResolvedProxy(await (await ses()).resolveProxy(url));
    } catch {
      return null;
    }
  };
  const transport: Transport = async (url, init) => {
    const s = await ses();
    if (!opts.contained()) return chromiumRequest(s, url, init);
    return nodeTransport(await proxyFor(url))(url, init);
  };
  return { transport, proxyFor };
}

/** One GET through Chromium on `ses`: redirects are returned (never followed), no cookies, no credentials. */
function chromiumRequest(ses: Session, url: string, init: { headers: Record<string, string>; signal: AbortSignal }): Promise<TransportResponse> {
  return new Promise((resolve, reject) => {
    const options: ClientRequestConstructorOptions = { url, method: "GET", session: ses, redirect: "manual", credentials: "omit", useSessionCookies: false, cache: "no-store" };
    const req = net.request(options);
    for (const [k, v] of Object.entries(init.headers)) req.setHeader(k, v);
    let settled = false;
    let proxyAuth: string | null = null;
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
    // No prompt in v1: an authenticating proxy fails the request (cancelled auth → 407 / error).
    req.on("login", (info, callback) => {
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
