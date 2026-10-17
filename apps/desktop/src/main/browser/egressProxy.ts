/** Browser-only N2 egress (dev + packaged, behind the owner switch). No Electron imports, TLS termination, cache,
 * redirect following, credentials on disk, automatic request retries or logging.
 * The caller MUST withdraw session policy permission before closing this instance.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { lookup as systemLookup } from "node:dns/promises";
import { Agent, createServer, request, type IncomingMessage, type OutgoingHttpHeaders, type ServerResponse } from "node:http";
import { createConnection, isIP, type Socket } from "node:net";
import { Transform } from "node:stream";
import { isAllowedEgressAddress, matchesEgressHost, parseLanBrowserUrl, parsePublicBrowserUrl, parsePublicConnectAuthority, type BrowserEgressTarget } from "./egressAddress";

export const BROWSER_EGRESS_LIMITS = Object.freeze({ connections: 64, lookups: 16, addresses: 32,
  headerBytes: 16 * 1024, headBytes: 64 * 1024, bodyBytes: 32 * 1024 * 1024,
  helloMs: 5000, setupMs: 10_000, idleMs: 60_000, requestMs: 30_000 });
// getaddrinfo outlives socket/proxy disposal. Share its budget across generations,
// so repeatedly closing the last tab and reopening cannot reset pending DNS slots.
let pendingLookups = 0;
export interface BrowserEgressAddress { address: string; family: 4 | 6 }
export type BrowserEgressLookup = (hostname: string) => Promise<readonly BrowserEgressAddress[]>;
export type BrowserEgressDial = (target: BrowserEgressAddress & { port: number }, signal: AbortSignal) => Socket;
export interface BrowserEgressProxy {
  readonly port: number;
  readonly credentials: Readonly<{ username: string; password: string; realm: string }>;
  /** A syntactic candidate only. DNS must still pass at every upstream connection. */
  isPublicBrowserUrl(url: unknown): boolean;
  /** Withdraws the public candidate gate and destroys all sockets synchronously. */
  close(): Promise<void>;
}
interface Connection { controller: AbortController; upstreams: Set<Socket>; busy: boolean; hello: ReturnType<typeof setTimeout> }
const HOP = new Set(["connection", "proxy-connection", "keep-alive", "transfer-encoding", "te", "trailer", "upgrade", "proxy-authorization", "proxy-authenticate"]);
const tokens = (value: string | string[] | undefined) => typeof value === "string" ? value.toLowerCase().split(",").map(part => part.trim()) : [];
function headers(message: IncomingMessage): OutgoingHttpHeaders {
  const remove = new Set([...HOP, ...tokens(message.headers.connection)]), result: OutgoingHttpHeaders = Object.create(null);
  for (const [name, value] of Object.entries(message.headers)) if (!remove.has(name)) result[name] = value;
  return result;
}
const rawCount = (request: IncomingMessage, name: string) => request.rawHeaders.filter((_, index) => index % 2 === 0 && request.rawHeaders[index]!.toLowerCase() === name).length;
function bodyLimit(): Transform {
  let bytes = 0;
  return new Transform({ transform(chunk: Buffer, _encoding, callback) {
    bytes += chunk.length;
    callback(bytes > BROWSER_EGRESS_LIMITS.bodyBytes ? new Error("body_limit") : null, bytes > BROWSER_EGRESS_LIMITS.bodyBytes ? undefined : chunk);
  } });
}

export interface BrowserEgressPolicy {
  /** The owner switch 「允许浏览外部网页」, re-read per connection (default: on). */
  publicAllowed?: () => boolean;
  /** An authority main admitted after an owner navigation (LAN / tailnet). Only such a target may
   * use a LAN-class literal / name or LAN DNS answers; never loopback, link-local or reserved. */
  lanAllowed?: (hostname: string, port: number) => boolean;
}
export async function startBrowserEgressProxy(options: { lookup?: BrowserEgressLookup; dial?: BrowserEgressDial; onClosed?: () => void } & BrowserEgressPolicy = {}): Promise<BrowserEgressProxy> {
  const publicAllowed = () => { try { return options.publicAllowed?.() ?? true; } catch { return false; } };
  const lanAllowed = (hostname: string, port: number) => { try { return options.lanAllowed?.(hostname, port) === true; } catch { return false; } };
  /** Per connection: an owner-admitted LAN authority, else a public one while websites are on. */
  const admitTarget = (parse: (lan: boolean) => BrowserEgressTarget | undefined): (BrowserEgressTarget & { lan: boolean }) | undefined => {
    const lan = parse(true);
    if (lan && lanAllowed(lan.hostname, lan.port)) return { ...lan, lan: true };
    const target = publicAllowed() ? parse(false) : undefined;
    return target && { ...target, lan: false };
  };
  const credentials = Object.freeze({ username: randomBytes(16).toString("hex"), password: randomBytes(32).toString("hex"), realm: `cutex-browser-${randomBytes(16).toString("hex")}` });
  const expectedAuth = Buffer.from(`Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64")}`);
  const lookup = options.lookup ?? (async hostname => (await systemLookup(hostname, { all: true, verbatim: true })) as BrowserEgressAddress[]);
  const dial = options.dial ?? ((target, signal) => createConnection({ host: target.address, family: target.family, port: target.port, autoSelectFamily: false, signal }));
  const connections = new Map<Socket, Connection>(); let closed = false, closePromise: Promise<void> | undefined;
  const server = createServer({ maxHeaderSize: BROWSER_EGRESS_LIMITS.headerBytes, headersTimeout: BROWSER_EGRESS_LIMITS.helloMs,
    requestTimeout: BROWSER_EGRESS_LIMITS.requestMs, connectionsCheckingInterval: 1000 });
  server.maxHeadersCount = 100; server.maxRequestsPerSocket = 1;
  const deny = (socket: Socket, status: number) => {
    if (socket.destroyed) return;
    const text = status === 407 ? "Proxy Authentication Required" : status === 403 ? "Forbidden" : status === 503 ? "Service Unavailable" : "Bad Gateway";
    socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n${status === 407 ? `Proxy-Authenticate: Basic realm="${credentials.realm}"\r\n` : ""}\r\n`);
    // Never leave an unauthenticated half-open peer holding a slot indefinitely.
    const timeout = setTimeout(() => socket.destroy(), 1000); timeout.unref(); socket.once("close", () => clearTimeout(timeout));
  };
  const admit = (req: IncomingMessage, socket: Socket): Connection | undefined => {
    const context = connections.get(socket);
    if (closed || !context || context.busy) { socket.destroy(); return; }
    context.busy = true; clearTimeout(context.hello);
    const auth = req.headers["proxy-authorization"];
    const supplied = typeof auth === "string" ? Buffer.from(auth.replace(/^basic /i, "Basic ")) : Buffer.alloc(0);
    if (rawCount(req, "proxy-authorization") !== 1 || supplied.length !== expectedAuth.length || !timingSafeEqual(supplied, expectedAuth)) { deny(socket, 407); return; }
    if (rawCount(req, "host") !== 1 || req.httpVersion !== "1.1") { deny(socket, 403); return; }
    socket.setTimeout(BROWSER_EGRESS_LIMITS.idleMs);
    return context;
  };
  const upstream = async (target: BrowserEgressTarget & { lan: boolean }, client: Socket, context: Connection): Promise<Socket> => {
    const check = () => { if (closed || client.destroyed || context.controller.signal.aborted) throw new Error("closed"); };
    check();
    const setupTimer = setTimeout(() => { context.controller.abort(); client.destroy(); }, BROWSER_EGRESS_LIMITS.setupMs); setupTimer.unref();
    const cancelTimer = () => clearTimeout(setupTimer);
    context.controller.signal.addEventListener("abort", cancelTimer, { once: true });
    try {
      let addresses: readonly BrowserEgressAddress[];
      if (isIP(target.hostname)) addresses = [{ address: target.hostname, family: isIP(target.hostname) as 4 | 6 }];
      else {
        if (pendingLookups >= BROWSER_EGRESS_LIMITS.lookups) throw new Error("busy");
        // getaddrinfo cannot be cancelled. Keep unresolved work counted after timeout;
        // never let closing a socket turn unbounded DNS work into fresh capacity.
        pendingLookups++;
        try { addresses = await lookup(target.hostname); } finally { pendingLookups--; }
      }
      check();
      if (!Array.isArray(addresses) || !addresses.length || addresses.length > BROWSER_EGRESS_LIMITS.addresses ||
        addresses.some(item => !item || isIP(item.address) !== item.family || !isAllowedEgressAddress(item.address, target.lan))) throw new Error("denied");
      const selected = addresses[0]!;
      const socket = dial({ address: selected.address, family: selected.family, port: target.port }, context.controller.signal);
      context.upstreams.add(socket);
      socket.on("error", () => client.destroy());
      socket.once("close", () => context.upstreams.delete(socket));
      socket.setTimeout(BROWSER_EGRESS_LIMITS.idleMs, () => socket.destroy());
      try { check(); } catch (error) { socket.destroy(); throw error; }
      if (socket.connecting) await new Promise<void>((resolve, reject) => {
        const done = () => { socket.off("error", fail); socket.off("close", gone); resolve(); };
        const fail = () => { socket.off("connect", done); socket.off("close", gone); reject(new Error("connect_failed")); };
        const gone = () => { socket.off("connect", done); socket.off("error", fail); reject(new Error("closed")); };
        socket.once("connect", done); socket.once("error", fail); socket.once("close", gone);
      });
      check(); if (socket.destroyed) throw new Error("closed"); return socket;
    } finally { clearTimeout(setupTimer); context.controller.signal.removeEventListener("abort", cancelTimer); }
  };
  const connectStreams = (client: Socket, remote: Socket, clientHead: Buffer, remoteHead = Buffer.alloc(0)) => {
    if (clientHead.length) remote.write(clientHead);
    if (remoteHead.length) client.write(remoteHead);
    client.pipe(remote); remote.pipe(client); client.resume(); remote.resume();
  };
  const forward = async (req: IncomingMessage, client: Socket, context: Connection, target: BrowserEgressTarget & { lan: boolean }, response?: ServerResponse, head?: Buffer) => {
    const remote = await upstream(target, client, context);
    // A dedicated non-environment Agent, exactly one pinned socket and no retries.
    // https://nodejs.org/docs/latest-v24.x/api/http.html#built-in-proxy-support
    const agent = new Agent({ keepAlive: false, maxSockets: 1, proxyEnv: {} });
    agent.createConnection = () => remote;
    const outgoing = headers(req); outgoing.host = target.authority;
    outgoing.connection = head ? "Upgrade" : "close";
    if (head) outgoing.upgrade = "websocket";
    const sent = request({ hostname: target.hostname, port: target.port, method: req.method, path: target.path, headers: outgoing,
      agent, maxHeaderSize: BROWSER_EGRESS_LIMITS.headerBytes, signal: context.controller.signal });
    sent.on("error", () => client.destroy());
    client.once("close", () => { sent.destroy(); agent.destroy(); });
    sent.once("response", received => {
      if (head) { received.destroy(); deny(client, 502); return; }
      const contentLength = received.headers["content-length"];
      if (contentLength && Number(contentLength) > BROWSER_EGRESS_LIMITS.bodyBytes) { received.destroy(); deny(client, 502); return; }
      const outgoingHeaders = headers(received); outgoingHeaders.connection = "close";
      response!.writeHead(received.statusCode || 502, outgoingHeaders);
      const limited = bodyLimit(); limited.on("error", () => { received.destroy(); client.destroy(); });
      received.on("error", () => client.destroy()); received.pipe(limited).pipe(response!);
    });
    sent.once("upgrade", (received, upgraded, remoteHead) => {
      if (!head || received.statusCode !== 101 || received.headers.upgrade?.toLowerCase() !== "websocket" ||
        !tokens(received.headers.connection).includes("upgrade") || remoteHead.length > BROWSER_EGRESS_LIMITS.headBytes ||
        received.headers["sec-websocket-accept"] !== createHash("sha1").update(`${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64")) {
        upgraded.destroy(); client.destroy(); return;
      }
      const responseHeaders = headers(received); responseHeaders.connection = "Upgrade"; responseHeaders.upgrade = "websocket";
      let text = "HTTP/1.1 101 Switching Protocols\r\n";
      for (const [name, value] of Object.entries(responseHeaders)) for (const item of Array.isArray(value) ? value : [value]) if (item !== undefined) text += `${name}: ${item}\r\n`;
      client.write(text + "\r\n"); connectStreams(client, upgraded as Socket, head, remoteHead);
    });
    if (head) sent.end();
    else {
      const limited = bodyLimit(); limited.on("error", () => { sent.destroy(); client.destroy(); });
      req.on("aborted", () => sent.destroy()); req.on("error", () => sent.destroy()); req.pipe(limited).pipe(sent);
    }
  };
  server.on("connection", socket => {
    if (closed || connections.size >= BROWSER_EGRESS_LIMITS.connections) { socket.destroy(); return; }
    const context: Connection = { controller: new AbortController(), upstreams: new Set(), busy: false,
      hello: setTimeout(() => socket.destroy(), BROWSER_EGRESS_LIMITS.helloMs) };
    context.hello.unref(); connections.set(socket, context);
    socket.on("error", () => socket.destroy()); socket.on("timeout", () => socket.destroy());
    socket.once("close", () => {
      clearTimeout(context.hello); context.controller.abort(); for (const remote of context.upstreams) remote.destroy(); connections.delete(socket);
    });
  });
  const handleRequest = (req: IncomingMessage, res: ServerResponse) => {
    const client = req.socket, context = admit(req, client); if (!context) return;
    const target = admitTarget(lan => lan ? parseLanBrowserUrl(req.url, false) : parsePublicBrowserUrl(req.url, false));
    if (!target || target.protocol !== "http:" || !matchesEgressHost(req.headers.host, target, target.lan) || req.method === "CONNECT" ||
      req.headers.upgrade !== undefined || req.headers.expect !== undefined || Number(req.headers["content-length"] || 0) > BROWSER_EGRESS_LIMITS.bodyBytes) { deny(client, 403); return; }
    void forward(req, client, context, target, res).catch(() => deny(client, 403));
  };
  server.on("request", handleRequest);
  // Do not send 100 Continue or an expectation response before proxy authentication.
  server.on("checkContinue", handleRequest); server.on("checkExpectation", handleRequest);
  server.on("connect", (req, stream, head) => {
    const client = stream as Socket, context = admit(req, client); if (!context) return;
    const target = admitTarget(lan => parsePublicConnectAuthority(req.url, lan));
    if (!target || !matchesEgressHost(req.headers.host, target, target.lan) || head.length > BROWSER_EGRESS_LIMITS.headBytes ||
      req.headers["transfer-encoding"] !== undefined || Number(req.headers["content-length"] || 0) !== 0) { deny(client, 403); return; }
    client.pause();
    void upstream(target, client, context).then(remote => { client.write("HTTP/1.1 200 Connection Established\r\n\r\n"); connectStreams(client, remote, head); }).catch(() => deny(client, 403));
  });
  server.on("upgrade", (req, stream, head) => {
    const client = stream as Socket, context = admit(req, client); if (!context) return;
    const target = admitTarget(lan => lan ? parseLanBrowserUrl(req.url, false) : parsePublicBrowserUrl(req.url, false)), key = req.headers["sec-websocket-key"];
    if (!target || !["ws:", "http:"].includes(target.protocol) || !matchesEgressHost(req.headers.host, target, target.lan) || req.method !== "GET" ||
      req.headers.upgrade?.toLowerCase() !== "websocket" || !tokens(req.headers.connection).includes("upgrade") ||
      req.headers["sec-websocket-version"] !== "13" || typeof key !== "string" || !/^[A-Za-z0-9+/]{22}==$/.test(key) ||
      Buffer.from(key, "base64").toString("base64") !== key || head.length > BROWSER_EGRESS_LIMITS.headBytes ||
      req.headers["transfer-encoding"] !== undefined || Number(req.headers["content-length"] || 0) !== 0) { deny(client, 403); return; }
    client.pause(); void forward(req, client, context, target, undefined, head).catch(() => deny(client, 403));
  });
  server.on("clientError", (_error, socket) => deny(socket as Socket, 400));
  const close = (): Promise<void> => {
    if (closePromise) return closePromise;
    let finished!: () => void;
    closePromise = new Promise(resolve => { finished = resolve; });
    closed = true;
    for (const [client, context] of connections) { context.controller.abort(); for (const remote of context.upstreams) remote.destroy(); client.destroy(); }
    try { options.onClosed?.(); } catch { /* observer failure must not keep a listener alive */ }
    if (!server.listening) finished(); else server.close(finished);
    return closePromise;
  };
  try {
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); }); });
    server.on("error", () => { void close(); });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("unavailable");
    return { port: address.port, credentials, isPublicBrowserUrl: value => !closed && !!parsePublicBrowserUrl(value), close };
  } catch { await close(); throw new Error("browser_egress_unavailable"); }
}
