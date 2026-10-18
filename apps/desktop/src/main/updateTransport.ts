// The HTTP transport of the binary updater (binaryUpdate.ts), behind one small interface so the update
// logic is the same whichever stack carries the bytes:
//   - Chromium's network stack on the updater's own session (updateNet.ts): the OS proxy settings
//     (Windows / macOS system proxy incl. PAC / WPAD, Linux desktop settings and *_PROXY env) as Chrome
//     uses them. The normal path.
//   - Node's http(s) with an optional HTTP proxy (CONNECT tunnel for https) — this file: used by the unit
//     tests, and as the fallback while the agent-page / plugin network containment (pluginNetwork.ts) has
//     turned Chromium's DNS off for the rest of the run; the proxy is then the one Chromium resolved.
// Every transport: GET only, never follows a redirect (the caller checks each hop), sends no cookies or
// credentials, and fails a proxy that wants authentication with ProxyAuthError (no prompt).
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest, type RequestOptions } from "node:https";
import type { Socket } from "node:net";
import { connect as tlsConnect } from "node:tls";

export interface TransportResponse {
  status: number;
  /** A response header (lower-case name), or null. A redirect's `location` is absolute. */
  header(name: string): string | null;
  body: AsyncIterable<Uint8Array>;
  /** Stop reading (and release the connection). */
  cancel(): void;
}

export type Transport = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<TransportResponse>;

/** The proxy asked for credentials; v1 never prompts — the check reports it quietly. */
export class ProxyAuthError extends Error {
  constructor(where: string) {
    super(`the proxy requires authentication (${where}); updates cannot be checked through it yet`);
  }
}

export interface ProxyServer {
  /** "http" (PROXY), "https" (HTTPS), "socks4" / "socks5" (SOCKS). */
  scheme: "http" | "https" | "socks4" | "socks5";
  host: string;
  port: number;
  /** Basic credentials of the manual update proxy (Settings → 网络代理); only this transport sends them —
   *  `proxyUrl` (git / pnpm) never includes them. */
  auth?: { username: string; password: string };
}

/**
 * The first entry of Chromium's `session.resolveProxy(url)` answer ("PROXY host:port; DIRECT", "DIRECT",
 * "HTTPS host:port", "SOCKS5 host:port"): null for DIRECT (or nothing usable), else that proxy.
 */
export function parseResolvedProxy(answer: string): ProxyServer | null {
  const first = answer.split(";")[0]?.trim() ?? "";
  const m = /^(PROXY|HTTPS|SOCKS|SOCKS4|SOCKS5)\s+(\[[0-9a-fA-F:.]+\]|[A-Za-z0-9.-]+):(\d{1,5})$/i.exec(first);
  if (!m) return null;
  const port = Number(m[3]);
  if (!(port > 0 && port < 65536)) return null;
  const kind = m[1]!.toUpperCase();
  const scheme = kind === "PROXY" ? "http" : kind === "HTTPS" ? "https" : kind === "SOCKS5" ? "socks5" : "socks4";
  return { scheme, host: m[2]!.replace(/^\[|\]$/g, ""), port };
}

/** A proxy as a URL for git's `http.proxy` / *_PROXY env (socks → socks5h:// / socks4a://: names resolved by the proxy). */
export function proxyUrl(p: ProxyServer): string {
  const host = p.host.includes(":") ? `[${p.host}]` : p.host;
  const scheme = p.scheme === "socks5" ? "socks5h" : p.scheme === "socks4" ? "socks4a" : p.scheme;
  return `${scheme}://${host}:${p.port}`;
}

function wrap(res: IncomingMessage, cancel: () => void): TransportResponse {
  return {
    status: res.statusCode ?? 0,
    header(name) {
      const v = res.headers[name.toLowerCase()];
      return Array.isArray(v) ? v.join(", ") : (v ?? null);
    },
    body: res,
    cancel,
  };
}

/** Node http(s), direct or through an HTTP proxy (`proxy.scheme` "http"; others are refused). */
export function nodeTransport(proxy: ProxyServer | null = null): Transport {
  return (url, init) =>
    new Promise<TransportResponse>((resolve, reject) => {
      if (proxy && proxy.scheme !== "http") return reject(new Error(`${proxy.scheme} proxies are not supported here`));
      const u = new URL(url);
      const secure = u.protocol === "https:";
      const port = Number(u.port || (secure ? 443 : 80));
      const proxyAuth = proxy?.auth ? { "proxy-authorization": `Basic ${Buffer.from(`${proxy.auth.username}:${proxy.auth.password}`).toString("base64")}` } : {};
      const headers = { ...init.headers, host: u.host, ...(proxy && !secure ? proxyAuth : {}) };
      const send = (tunnel?: Socket) => {
        const opts: RequestOptions = { method: "GET", headers, signal: init.signal, agent: false };
        if (proxy && !secure) Object.assign(opts, { host: proxy.host, port: proxy.port, path: url });
        else Object.assign(opts, { host: u.hostname, port, path: `${u.pathname}${u.search}`, servername: u.hostname });
        if (tunnel) opts.createConnection = () => tlsConnect({ socket: tunnel, servername: u.hostname });
        const req = (secure ? httpsRequest : httpRequest)(opts, (res) => {
          if (proxy && !secure && res.statusCode === 407) {
            res.destroy();
            return reject(new ProxyAuthError(`${proxy.host}:${proxy.port}`));
          }
          resolve(wrap(res, () => res.destroy()));
        });
        req.on("error", reject);
        req.end();
      };
      if (!proxy || !secure) return send();
      const authority = `${u.hostname.includes(":") ? `[${u.hostname}]` : u.hostname}:${port}`;
      const connect = httpRequest({ host: proxy.host, port: proxy.port, method: "CONNECT", path: authority, headers: { host: authority, ...proxyAuth }, signal: init.signal, agent: false });
      connect.on("connect", (res, socket) => {
        if (res.statusCode === 407) {
          socket.destroy();
          return reject(new ProxyAuthError(`${proxy.host}:${proxy.port}`));
        }
        if (res.statusCode !== 200) {
          socket.destroy();
          return reject(new Error(`the proxy ${proxy.host}:${proxy.port} answered ${res.statusCode} to CONNECT ${authority}`));
        }
        send(socket);
      });
      connect.on("error", reject);
      connect.end();
    });
}

const PROXY_ENV = ["https_proxy", "HTTPS_PROXY", "http_proxy", "HTTP_PROXY", "all_proxy", "ALL_PROXY"] as const;

/** Whether the environment already names a proxy (git, pnpm and corepack then use it themselves). */
export function envHasProxy(env: NodeJS.ProcessEnv): boolean {
  return PROXY_ENV.some((k) => !!env[k]?.trim());
}

/**
 * Environment for the programs a source update runs (pnpm, corepack, Electron's downloader) when
 * Chromium resolved a proxy and the environment names none: HTTP(S)_PROXY, and @electron/get's
 * global-agent variables.
 */
export function proxyEnv(p: ProxyServer | null): Record<string, string> {
  if (!p) return {};
  const url = proxyUrl(p);
  return { HTTPS_PROXY: url, HTTP_PROXY: url, https_proxy: url, http_proxy: url, ELECTRON_GET_USE_PROXY: "1", GLOBAL_AGENT_HTTPS_PROXY: url, GLOBAL_AGENT_HTTP_PROXY: url };
}

/** git `-c http.proxy=…` for a fetch from an http(s) remote; nothing for ssh / path remotes or DIRECT. */
export function gitProxyArgs(remoteUrl: string | null, p: ProxyServer | null): string[] {
  if (!remoteUrl || !/^https?:\/\//i.test(remoteUrl) || !p) return [];
  return ["-c", `http.proxy=${proxyUrl(p)}`];
}
