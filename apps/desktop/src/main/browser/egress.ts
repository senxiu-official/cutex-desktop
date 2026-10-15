import type { AuthInfo, Session } from "electron";
import type { startBrowserEgressProxy } from "./egressProxy";
import { BROWSER_LOCAL_PROXY } from "./network";
import { queueBrowserSessionProxy } from "./sessionProxy";

type Proxy = Awaited<ReturnType<typeof startBrowserEgressProxy>>;
type Loader = () => Promise<{ startBrowserEgressProxy: typeof startBrowserEgressProxy }>;
/** Main-only N2 lifecycle (owner-approved for packaged builds 2026-10-14). `isEnabled` is the
 * owner switch 「允许浏览外部网页」, re-read on every check: while it is off the proxy module is
 * never imported, no listener exists and no session is touched. Turning it off must be followed
 * by stop(), which closes the listener and restores every configured session synchronously. */
export function createBrowserEgress(options: { isEnabled: () => boolean; load?: Loader }) {
  const on = () => { try { return options.isEnabled() === true; } catch { return false; } };
  let generation = 0, current: Proxy | undefined, starting: Promise<Proxy> | undefined;
  const sessions = new Set<Session>();
  const configured = new Set<Session>();
  const sessionGenerations = new WeakMap<Session, number>();
  function revokeSession(session: Session): void {
    sessionGenerations.set(session, (sessionGenerations.get(session) ?? 0) + 1);
    sessions.delete(session); // Credentials and URL permission disappear synchronously.
    // Never touch a session that this controller has not configured, including off builds.
    if (!configured.delete(session)) return;
    void queueBrowserSessionProxy(session, async () => {
      try { await session.setProxy({ ...BROWSER_LOCAL_PROXY }); }
      finally { await session.closeAllConnections(); }
    }).catch(() => {});
  }
  function stop(): void {
    generation++;
    const old = current; current = undefined; starting = undefined;
    sessions.clear();
    // close() synchronously gates new work and destroys all CONNECT/WS sockets.
    if (old) void old.close().catch(() => {});
    for (const session of configured) revokeSession(session);
  }
  async function start(): Promise<Proxy> {
    if (current) return current;
    if (starting) return starting;
    const admitted = generation;
    const pending = (async () => {
      const module = await (options.load ?? (() => import("./egressProxy")))();
      if (admitted !== generation) throw new Error("browser_egress_revoked");
      let proxy: Proxy | undefined;
      proxy = await module.startBrowserEgressProxy({ onClosed() { if (proxy && current === proxy) stop(); } });
      if (admitted !== generation) { await proxy.close(); throw new Error("browser_egress_revoked"); }
      current = proxy; return proxy;
    })();
    starting = pending;
    try { return await pending; } finally { if (starting === pending) starting = undefined; }
  }
  return {
    async enableSession(session: Session): Promise<void> {
      if (!on() || sessions.has(session)) return;
      const admitted = generation, sessionGeneration = sessionGenerations.get(session) ?? 0;
      let proxy: Proxy | undefined;
      const check = () => {
        if (admitted !== generation || (sessionGenerations.get(session) ?? 0) !== sessionGeneration || current !== proxy)
          throw new Error("browser_egress_revoked");
      };
      try {
        proxy = await start(); check();
        if (!on()) throw new Error("browser_egress_revoked");
        configured.add(session);
        await queueBrowserSessionProxy(session, async () => {
          check();
          if (!on()) throw new Error("browser_egress_revoked");
          if (sessions.has(session)) return;
          await session.setProxy({ mode: "fixed_servers", proxyRules: `http://127.0.0.1:${proxy!.port}`,
            proxyBypassRules: BROWSER_LOCAL_PROXY.proxyBypassRules });
          // Chromium may reuse pooled connections after setProxy; never admit until flushed.
          await session.closeAllConnections();
          check();
          sessions.add(session);
        });
      } catch (error) {
        // Only this attempt's still-current session generation may revoke itself.
        // A late failure must not revoke a replacement A or another partition B.
        if (admitted === generation && (sessionGenerations.get(session) ?? 0) === sessionGeneration && (!proxy || current === proxy)) revokeSession(session);
        throw error;
      }
    },
    isEnabled: on,
    isAllowed(url: string): boolean { return on() && sessions.size > 0 && current?.isPublicBrowserUrl(url) === true; },
    isSessionAllowed(session: Session, url: string): boolean { return on() && sessions.has(session) && current?.isPublicBrowserUrl(url) === true; },
    /** Caller separately proves exact registered guest, host fence and session identity. */
    credentialsFor(session: Session, info: AuthInfo): Readonly<{ username: string; password: string }> | undefined {
      const proxy = current;
      if (!on() || !proxy || !sessions.has(session) || info.isProxy !== true || info.host !== "127.0.0.1"
        || info.port !== proxy.port || info.scheme.toLowerCase() !== "basic" || info.realm !== proxy.credentials.realm) return;
      return { username: proxy.credentials.username, password: proxy.credentials.password };
    },
    ownsChallenge(info: AuthInfo): boolean { return !!current && info.isProxy === true && info.host === "127.0.0.1" && info.port === current.port; },
    revokeSession, stop,
  };
}
