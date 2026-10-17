import { createHash } from "node:crypto";
import { createServer as httpServer, globalAgent, type IncomingMessage, type ServerResponse } from "node:http";
import { createConnection, createServer as tcpServer, type Server, type Socket } from "node:net";
import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startBrowserEgressProxy, BROWSER_EGRESS_LIMITS, type BrowserEgressLookup, type BrowserEgressDial, type BrowserEgressProxy } from "../src/main/browser/egressProxy";

// Every upstream dial below is injected and connects ONLY to a random 127.0.0.1
// fixture. Public addresses are assertion data; no real DNS or external traffic.
const cleanup: (() => Promise<unknown> | void)[] = [];
afterEach(async () => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllEnvs(); for (const close of cleanup.splice(0).reverse()) await close(); });
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
async function until(check: () => boolean) { for (let i = 0; i < 200 && !check(); i++) await new Promise(resolve => setTimeout(resolve, 2)); expect(check()).toBe(true); }
async function listen(server: Server) {
  const sockets = new Set<Socket>(); server.on("connection", socket => { sockets.add(socket); socket.on("error", () => {}); socket.once("close", () => sockets.delete(socket)); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(async () => { for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); });
  return (server.address() as { port: number }).port;
}
async function fixture(handler: (req: IncomingMessage, res: ServerResponse) => void = (_req, res) => res.end("fixture"), extra: { lookup?: BrowserEgressLookup; dial?: BrowserEgressDial; onClosed?: () => void } = {}) {
  const origin = httpServer(handler), port = await listen(origin);
  const lookup = vi.fn<BrowserEgressLookup>(extra.lookup ?? (async () => [{ address: "8.8.8.8", family: 4 }]));
  const dial = vi.fn<BrowserEgressDial>(extra.dial ?? ((_target, signal) => createConnection({ host: "127.0.0.1", port, signal })));
  const proxy = await startBrowserEgressProxy({ lookup, dial, onClosed: extra.onClosed }); cleanup.push(proxy.close);
  return { origin, proxy, lookup, dial };
}
const auth = (proxy: BrowserEgressProxy) => `Basic ${Buffer.from(`${proxy.credentials.username}:${proxy.credentials.password}`).toString("base64")}`;
async function client(proxy: BrowserEgressProxy) {
  const socket = createConnection({ host: "127.0.0.1", port: proxy.port }); let received = Buffer.alloc(0);
  socket.on("error", () => {}); socket.on("data", chunk => { received = Buffer.concat([received, chunk]); });
  cleanup.push(() => { socket.destroy(); }); await once(socket, "connect");
  return { socket, get bytes() { return received; }, get text() { return received.toString("utf8"); },
    async send(value: string | Buffer) { socket.write(value); await until(() => received.includes(Buffer.from("\r\n\r\n")) || socket.destroyed); return received.toString("utf8"); } };
}
async function get(proxy: BrowserEgressProxy, target = "http://public.example.com/a", extra = "", authHeader: string | undefined = auth(proxy)) {
  const c = await client(proxy);
  await c.send(`GET ${target} HTTP/1.1\r\nHost: ${new URL(target).host}\r\n${authHeader === undefined ? "" : `Proxy-Authorization: ${authHeader}\r\n`}${extra}\r\n`);
  await until(() => c.socket.destroyed); return c.text;
}
const upgradeRequest = (proxy: BrowserEgressProxy, key = "dGhlIHNhbXBsZSBub25jZQ==", extra = "") => `GET ws://public.example.com/chat HTTP/1.1\r\nHost: public.example.com\r\nProxy-Authorization: ${auth(proxy)}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n${extra}\r\n`;

describe("browser-only N2 egress proxy (X1–X3; dev and packaged share this module)", () => {
  it("binds only IPv4 loopback, generates per-instance secrets and synchronously withdraws candidates", async () => {
    const a = await fixture(), b = await fixture();
    expect(a.proxy.port).toBeGreaterThan(0); expect(a.proxy.credentials.password).toMatch(/^[a-f0-9]{64}$/);
    expect(a.proxy.credentials).not.toEqual(b.proxy.credentials); expect(Object.isFrozen(a.proxy.credentials)).toBe(true);
    const c = await client(a.proxy); expect(c.socket.remoteAddress).toBe("127.0.0.1");
    expect(a.proxy.isPublicBrowserUrl("https://example.com/")).toBe(true);
    const closing = a.proxy.close(); expect(a.proxy.isPublicBrowserUrl("https://example.com/")).toBe(false); await closing;
  });
  it.each(["missing", "wrong", "duplicate", "origin-auth", "continue", "connect", "upgrade"])("X1 returns 407 before DNS/dial for %s authentication", async mode => {
    const f = await fixture(), c = await client(f.proxy);
    const line = mode === "connect" ? "CONNECT public.example.com:443" : "GET http://public.example.com/";
    const authorization = mode === "wrong" ? "Proxy-Authorization: Basic YmFkOmJhZA==\r\n" : mode === "origin-auth" ? `Authorization: ${auth(f.proxy)}\r\n`
      : mode === "duplicate" ? `Proxy-Authorization: ${auth(f.proxy)}\r\nProxy-Authorization: ${auth(f.proxy)}\r\n` : "";
    const extra = mode === "continue" ? "Expect: 100-continue\r\n" : mode === "upgrade" ? "Connection: Upgrade\r\nUpgrade: websocket\r\n" : "";
    expect(await c.send(`${line} HTTP/1.1\r\nHost: public.example.com\r\n${authorization}${extra}\r\n`)).toMatch(/^HTTP\/1.1 407 /);
    expect(c.text).not.toContain("100 Continue"); expect(f.lookup).not.toHaveBeenCalled(); expect(f.dial).not.toHaveBeenCalled();
  });
  it.each(["http://127.0.0.1/", "http://10.0.0.3/", "http://169.254.169.254/", "http://[::1]/", "http://[::ffff:127.0.0.1]/", "http://localhost/"])("X2 rejects literal/local %s before lookup", async target => {
    const f = await fixture(); expect(await get(f.proxy, target)).toMatch(/^HTTP\/1.1 403 /);
    expect(f.lookup).not.toHaveBeenCalled(); expect(f.dial).not.toHaveBeenCalled();
  });
  it.each([
    [{ address: "127.0.0.1", family: 4 }], [{ address: "169.254.169.254", family: 4 }], [{ address: "fd00::1", family: 6 }],
    [{ address: "8.8.8.8", family: 4 }, { address: "10.0.0.1", family: 4 }], [], [{ address: "8.8.8.8", family: 6 }],
    Array.from({ length: BROWSER_EGRESS_LIMITS.addresses + 1 }, () => ({ address: "8.8.8.8", family: 4 })),
  ])("X2 rejects every invalid/mixed DNS answer set %# without dial", async addresses => {
    const f = await fixture(undefined, { lookup: async () => addresses as any });
    expect(await get(f.proxy)).toMatch(/^HTTP\/1.1 403 /); expect(f.dial).not.toHaveBeenCalled();
  });
  it("pins one validated numeric IP, does not inherit env proxy, and never resolves twice", async () => {
    vi.stubEnv("HTTP_PROXY", "http://127.0.0.1:1"); vi.stubEnv("NODE_USE_ENV_PROXY", "1");
    const globalDial = vi.spyOn(globalAgent, "createConnection").mockImplementation(() => { throw new Error("must_not_use_global_agent"); });
    const f = await fixture(); expect(await get(f.proxy)).toContain("fixture");
    expect(f.lookup).toHaveBeenCalledExactlyOnceWith("public.example.com");
    expect(f.dial).toHaveBeenCalledWith({ address: "8.8.8.8", family: 4, port: 80 }, expect.any(AbortSignal));
    f.lookup.mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    expect(await get(f.proxy)).toMatch(/^HTTP\/1.1 403 /); expect(f.dial).toHaveBeenCalledTimes(1);
    expect(globalDial).not.toHaveBeenCalled();
  });
  it("accepts public literal IPv6 without DNS and passes only that numeric address to dial", async () => {
    const f = await fixture(); expect(await get(f.proxy, "http://[2606:4700:4700::1111]:8080/path")).toContain("fixture");
    expect(f.lookup).not.toHaveBeenCalled();
    expect(f.dial).toHaveBeenCalledWith({ address: "2606:4700:4700::1111", family: 6, port: 8080 }, expect.any(AbortSignal));
  });
  it("rejects another proxy instance's credential before DNS", async () => {
    const a = await fixture(), b = await fixture();
    expect(await get(a.proxy, undefined, "", auth(b.proxy))).toMatch(/^HTTP\/1.1 407 /); expect(a.lookup).not.toHaveBeenCalled();
  });
  it("forwards origin authorization/cookies/body, strips both hop/proxy headers and never follows redirects or caches", async () => {
    const seen: { headers: IncomingMessage["headers"]; body: string; url?: string }[] = [];
    const f = await fixture((req, res) => { let body = ""; req.on("data", chunk => { body += chunk; }); req.on("end", () => {
      seen.push({ headers: req.headers, body, url: req.url });
      res.writeHead(302, { Location: "http://127.0.0.1/private", "Proxy-Authenticate": "SECRET_ORIGIN", Connection: "close, x-response-hop", "X-Response-Hop": "gone", "Set-Cookie": ["one=1", "two=2"] }); res.end("redirect");
    }); });
    const c = await client(f.proxy); await c.send(`POST http://public.example.com/a?q=1 HTTP/1.1\r\nHost: public.example.com\r\nProxy-Authorization: ${auth(f.proxy)}\r\nAuthorization: Bearer origin-only\r\nCookie: origin=1\r\nConnection: close, x-hop\r\nX-Hop: gone\r\nProxy-Connection: keep-alive\r\nContent-Length: 5\r\n\r\nhello`);
    await until(() => c.socket.destroyed); expect(c.text).toContain("302"); expect(c.text).toContain("redirect"); expect(c.text).toContain("one=1"); expect(c.text).toContain("two=2");
    expect(c.text).not.toContain("SECRET_ORIGIN"); expect(c.text).not.toContain("x-response-hop");
    expect(seen[0]).toMatchObject({ body: "hello", url: "/a?q=1", headers: { host: "public.example.com", authorization: "Bearer origin-only", cookie: "origin=1" } });
    expect(seen[0]!.headers["proxy-authorization"]).toBeUndefined(); expect(seen[0]!.headers["x-hop"]).toBeUndefined(); expect(f.dial).toHaveBeenCalledTimes(1);
    await get(f.proxy); expect(seen).toHaveLength(2); expect(f.lookup).toHaveBeenCalledTimes(2);
  });
  it.each(["host", "relative", "https-absolute", "userinfo", "port", "expect", "oversized-body"])("rejects ambiguous HTTP %s before dial", async mode => {
    const f = await fixture(), c = await client(f.proxy);
    const target = mode === "relative" ? "/path" : mode === "https-absolute" ? "https://public.example.com/" : mode === "userinfo" ? "http://u:p@public.example.com/" : mode === "port" ? "http://public.example.com:0/" : "http://public.example.com/";
    const extra = mode === "expect" ? "Expect: 100-continue\r\n" : mode === "oversized-body" ? `Content-Length: ${BROWSER_EGRESS_LIMITS.bodyBytes + 1}\r\n` : "";
    expect(await c.send(`GET ${target} HTTP/1.1\r\nHost: ${mode === "host" ? "other.example.com" : "public.example.com"}\r\nProxy-Authorization: ${auth(f.proxy)}\r\n${extra}\r\n`)).toMatch(/^HTTP\/1.1 403 /); expect(f.dial).not.toHaveBeenCalled();
  });
  it("CONNECT forwards opaque bytes and early head without TLS termination, then X3 closes every tunnel", async () => {
    const origin = tcpServer(socket => socket.pipe(socket)), port = await listen(origin), dialed: Socket[] = [], onClosed = vi.fn();
    const proxy = await startBrowserEgressProxy({ lookup: async () => [{ address: "8.8.8.8", family: 4 }],
      dial: (_target, signal) => { const socket = createConnection({ host: "127.0.0.1", port, signal }); dialed.push(socket); return socket; }, onClosed }); cleanup.push(proxy.close);
    const c = await client(proxy); await c.send(`CONNECT public.example.com:443 HTTP/1.1\r\nHost: public.example.com:443\r\nProxy-Authorization: ${auth(proxy)}\r\n\r\nearly`);
    await until(() => c.text.includes("early")); expect(c.text).toMatch(/^HTTP\/1.1 200 Connection Established/);
    c.socket.write(Buffer.from([0, 1, 2, 255])); await until(() => c.bytes.includes(Buffer.from([0, 1, 2, 255])));
    const closing = proxy.close(); expect(dialed.every(socket => socket.destroyed)).toBe(true); expect(proxy.isPublicBrowserUrl("https://example.com")).toBe(false);
    await closing; await until(() => c.socket.destroyed); expect(onClosed).toHaveBeenCalledTimes(1); await proxy.close(); expect(onClosed).toHaveBeenCalledTimes(1);
    const refused = createConnection({ host: "127.0.0.1", port: proxy.port }); refused.on("error", () => {}); await new Promise<void>(resolve => refused.once("close", () => resolve())); expect(refused.destroyed).toBe(true);
  });
  it.each(["127.0.0.1:443", "public.example.com", "public.example.com:443/path", "public.example.com:0", "u@public.example.com:443"])("rejects unsafe CONNECT %s", async target => {
    const f = await fixture(), c = await client(f.proxy); expect(await c.send(`CONNECT ${target} HTTP/1.1\r\nHost: public.example.com:443\r\nProxy-Authorization: ${auth(f.proxy)}\r\n\r\n`)).toMatch(/^HTTP\/1.1 403 /); expect(f.dial).not.toHaveBeenCalled();
  });
  it.each(["connect", "websocket"])("applies the same mixed-DNS rejection to %s", async mode => {
    const f = await fixture(undefined, { lookup: async () => [{ address: "8.8.8.8", family: 4 }, { address: "::ffff:127.0.0.1", family: 6 }] }), c = await client(f.proxy);
    const request = mode === "websocket" ? upgradeRequest(f.proxy) : `CONNECT public.example.com:443 HTTP/1.1\r\nHost: public.example.com:443\r\nProxy-Authorization: ${auth(f.proxy)}\r\n\r\n`;
    expect(await c.send(request)).toMatch(/^HTTP\/1.1 403 /); expect(f.dial).not.toHaveBeenCalled();
  });
  it("upgrades only validated websocket handshakes and streams early/client/server data", async () => {
    const f = await fixture();
    f.origin.on("upgrade", (req, socket, head) => {
      expect(req.headers["proxy-authorization"]).toBeUndefined();
      const accept = createHash("sha1").update(`${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
      socket.write(`HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade, x-hidden\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: ${accept}\r\nX-Hidden: removed\r\nProxy-Authenticate: secret\r\n\r\nserver-head`);
      if (head.length) socket.write(head); socket.pipe(socket);
    });
    const c = await client(f.proxy); await c.send(upgradeRequest(f.proxy) + "client-head");
    await until(() => c.text.includes("server-head") && c.text.includes("client-head"));
    expect(c.text).toMatch(/^HTTP\/1.1 101 /); expect(c.text).not.toContain("x-hidden:"); expect(c.text).not.toContain("secret");
    c.socket.write("next-message"); await until(() => c.text.includes("next-message")); await f.proxy.close(); await until(() => c.socket.destroyed);
  });
  it.each(["wrong-upgrade", "bad-key", "wrong-accept"])("rejects invalid websocket %s without promoting a tunnel", async mode => {
    const f = await fixture(); f.origin.on("upgrade", (_req, socket) => socket.end("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: wrong\r\n\r\n"));
    const c = await client(f.proxy); const text = upgradeRequest(f.proxy, mode === "bad-key" ? "bad" : undefined);
    await c.send(mode === "wrong-upgrade" ? text.replace("Upgrade: websocket", "Upgrade: h2c") : text);
    await until(() => c.socket.destroyed); expect(c.text).not.toContain("101 Switching Protocols");
    expect(f.dial).toHaveBeenCalledTimes(mode === "wrong-accept" ? 1 : 0);
  });
  it("close during pending DNS never dials after the late answer, even with a throwing observer", async () => {
    const pending = deferred<readonly { address: string; family: 4 }[]>(), f = await fixture(undefined, { lookup: () => pending.promise, onClosed: () => { throw new Error("observer"); } });
    const c = await client(f.proxy); c.socket.write(`GET http://public.example.com/ HTTP/1.1\r\nHost: public.example.com\r\nProxy-Authorization: ${auth(f.proxy)}\r\n\r\n`);
    await until(() => f.lookup.mock.calls.length === 1); await f.proxy.close(); pending.resolve([{ address: "8.8.8.8", family: 4 }]); await tick();
    expect(f.dial).not.toHaveBeenCalled();
  });
  it("setup timeout keeps unresolved DNS counted and never late-dials", async () => {
    const pending = deferred<readonly { address: string; family: 4 }[]>(), f = await fixture(undefined, { lookup: () => pending.promise });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }); const c = await client(f.proxy);
    c.socket.write(`GET http://public.example.com/ HTTP/1.1\r\nHost: public.example.com\r\nProxy-Authorization: ${auth(f.proxy)}\r\n\r\n`);
    for (let i = 0; i < 100 && f.lookup.mock.calls.length === 0; i++) await tick(); expect(f.lookup).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(BROWSER_EGRESS_LIMITS.setupMs); for (let i = 0; i < 100 && !c.socket.destroyed; i++) await tick(); expect(c.socket.destroyed).toBe(true);
    pending.resolve([{ address: "8.8.8.8", family: 4 }]); await tick(); expect(f.dial).not.toHaveBeenCalled();
  });
  it("bounds unauthenticated sockets and closes slow headers on the hello deadline", async () => {
    const f = await fixture(); vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const peers = [];
    for (let i = 0; i < BROWSER_EGRESS_LIMITS.connections; i++) peers.push(await client(f.proxy));
    // Client connect may precede Node's accept callback on Windows.
    for (let i = 0; i < 100 && vi.getTimerCount() < peers.length; i++) await tick();
    const excess = await client(f.proxy);
    for (let i = 0; i < 100 && !excess.socket.destroyed; i++) await tick(); expect(excess.socket.destroyed).toBe(true);
    peers[0]!.socket.write("GET http://public.example.com/ HTTP/1.1\r\nX-Slow: ");
    await vi.advanceTimersByTimeAsync(BROWSER_EGRESS_LIMITS.helloMs);
    for (let i = 0; i < 100 && peers.some(peer => !peer.socket.destroyed); i++) await tick();
    expect(peers.every(peer => peer.socket.destroyed)).toBe(true); expect(f.lookup).not.toHaveBeenCalled();
  });
  it("keeps abandoned unresolved lookups counted against the global DNS cap", async () => {
    const pending = deferred<readonly { address: string; family: 4 }[]>(), f = await fixture(undefined, { lookup: () => pending.promise });
    const peers = [];
    for (let i = 0; i < BROWSER_EGRESS_LIMITS.lookups; i++) {
      const c = await client(f.proxy); peers.push(c);
      c.socket.write(`GET http://public.example.com/ HTTP/1.1\r\nHost: public.example.com\r\nProxy-Authorization: ${auth(f.proxy)}\r\n\r\n`);
    }
    await until(() => f.lookup.mock.calls.length === BROWSER_EGRESS_LIMITS.lookups);
    peers.forEach(peer => peer.socket.destroy()); await tick();
    expect(await get(f.proxy)).toMatch(/^HTTP\/1.1 403 /);
    expect(f.lookup).toHaveBeenCalledTimes(BROWSER_EGRESS_LIMITS.lookups); expect(f.dial).not.toHaveBeenCalled();
    pending.resolve([{ address: "8.8.8.8", family: 4 }]); await tick(); expect(f.dial).not.toHaveBeenCalled();
    expect(await get(f.proxy)).toContain("fixture");
  });
  it("does not reset unresolved DNS capacity when the last tab closes and a new proxy starts", async () => {
    const pending = deferred<readonly { address: string; family: 4 }[]>(), old = await fixture(undefined, { lookup: () => pending.promise });
    for (let i = 0; i < BROWSER_EGRESS_LIMITS.lookups; i++) {
      const c = await client(old.proxy);
      c.socket.write(`GET http://public.example.com/ HTTP/1.1\r\nHost: public.example.com\r\nProxy-Authorization: ${auth(old.proxy)}\r\n\r\n`);
    }
    await until(() => old.lookup.mock.calls.length === BROWSER_EGRESS_LIMITS.lookups); await old.proxy.close();
    const replacement = await fixture();
    expect(await get(replacement.proxy)).toMatch(/^HTTP\/1.1 403 /);
    expect(replacement.lookup).not.toHaveBeenCalled(); expect(replacement.dial).not.toHaveBeenCalled();
    pending.resolve([{ address: "8.8.8.8", family: 4 }]); await tick();
    expect(old.dial).not.toHaveBeenCalled(); expect(await get(replacement.proxy)).toContain("fixture");
  });
  it.each(["oversized-header", "cl-te", "duplicate-length"])("rejects %s parser ambiguity without an upstream request", async mode => {
    const f = await fixture(), c = await client(f.proxy);
    const extra = mode === "oversized-header" ? `X-Big: ${"x".repeat(BROWSER_EGRESS_LIMITS.headerBytes)}\r\n`
      : mode === "cl-te" ? "Content-Length: 1\r\nTransfer-Encoding: chunked\r\n" : "Content-Length: 1\r\nContent-Length: 2\r\n";
    await c.send(`POST http://public.example.com/ HTTP/1.1\r\nHost: public.example.com\r\nProxy-Authorization: ${auth(f.proxy)}\r\n${extra}\r\n`);
    expect(c.text).toMatch(/^HTTP\/1.1 400 /); expect(f.lookup).not.toHaveBeenCalled(); expect(f.dial).not.toHaveBeenCalled();
  });
  it("does not retry another public address when dialing fails", async () => {
    const f = await fixture(undefined, { lookup: async () => [{ address: "8.8.8.8", family: 4 }, { address: "1.1.1.1", family: 4 }],
      dial: () => { throw new Error("SECRET_DIAL_FAILURE"); } });
    const response = await get(f.proxy); expect(response).toMatch(/^HTTP\/1.1 403 /); expect(response).not.toContain("SECRET"); expect(f.dial).toHaveBeenCalledTimes(1);
  });
  it("closes a socket returned by a reentrant dial after close has begun", async () => {
    let proxy!: BrowserEgressProxy, late!: Socket;
    const origin = tcpServer(), port = await listen(origin);
    proxy = await startBrowserEgressProxy({ lookup: async () => [{ address: "8.8.8.8", family: 4 }], dial: () => {
      void proxy.close(); late = createConnection({ host: "127.0.0.1", port }); return late;
    } }); cleanup.push(proxy.close);
    const c = await client(proxy); c.socket.write(`GET http://public.example.com/ HTTP/1.1\r\nHost: public.example.com\r\nProxy-Authorization: ${auth(proxy)}\r\n\r\n`);
    await until(() => !!late); expect(late.destroyed).toBe(true); await proxy.close();
  });
  it("handles reentrant onClosed exactly once", async () => {
    let proxy!: BrowserEgressProxy; const onClosed = vi.fn(() => { void proxy.close(); });
    const f = await fixture(undefined, { onClosed }); proxy = f.proxy;
    await proxy.close(); expect(onClosed).toHaveBeenCalledTimes(1);
  });
  it("denies an oversized HTTP response before forwarding its body", async () => {
    const f = await fixture((_req, res) => { res.writeHead(200, { "Content-Length": BROWSER_EGRESS_LIMITS.bodyBytes + 1 }); res.end("not-forwarded"); });
    const text = await get(f.proxy); expect(text).not.toContain("not-forwarded"); expect(text).not.toContain("200 OK");
  });
  it("bounds a chunked upload while applying stream backpressure, with no resend", async () => {
    let received = 0, finished = false;
    const f = await fixture((req, res) => { req.on("data", data => { received += data.length; }); req.on("end", () => { finished = true; res.end(); }); });
    const c = await client(f.proxy);
    c.socket.write(`POST http://public.example.com/upload HTTP/1.1\r\nHost: public.example.com\r\nProxy-Authorization: ${auth(f.proxy)}\r\nTransfer-Encoding: chunked\r\n\r\n`);
    const body = Buffer.alloc(64 * 1024, 97), chunk = Buffer.concat([Buffer.from(`${body.length.toString(16)}\r\n`), body, Buffer.from("\r\n")]);
    for (let sent = 0; sent <= BROWSER_EGRESS_LIMITS.bodyBytes && !c.socket.destroyed; sent += body.length) {
      if (!c.socket.write(chunk)) await new Promise<void>(resolve => {
        const done = () => { c.socket.off("drain", done); c.socket.off("close", done); resolve(); };
        c.socket.once("drain", done); c.socket.once("close", done);
      });
    }
    await until(() => c.socket.destroyed); expect(received).toBeGreaterThan(0); expect(received).toBeLessThanOrEqual(BROWSER_EGRESS_LIMITS.bodyBytes);
    expect(finished).toBe(false); expect(f.dial).toHaveBeenCalledTimes(1);
  });
});

describe("0.1.3 owner-admitted LAN authorities through N2", () => {
  async function lanFixture(policy: { publicAllowed?: () => boolean; lanAllowed?: (hostname: string, port: number) => boolean }, lookup: BrowserEgressLookup) {
    const origin = httpServer((_req, res) => res.end("lan-fixture")), port = await listen(origin);
    const dial = vi.fn<BrowserEgressDial>((_target, signal) => createConnection({ host: "127.0.0.1", port, signal }));
    const proxy = await startBrowserEgressProxy({ lookup: vi.fn(lookup), dial, ...policy }); cleanup.push(proxy.close);
    return { proxy, dial };
  }
  it("dials a LAN literal / LAN answer only for the admitted authority, never a loopback or link-local answer", async () => {
    const admitted = new Set(["100.64.0.27:8765", "nas.local:80", "box.tail0000.ts.net:80"]);
    const table: Record<string, string> = { "nas.local": "10.0.0.14", "box.tail0000.ts.net": "100.101.102.103", "other.local": "10.0.0.15" };
    const f = await lanFixture({ publicAllowed: () => false, lanAllowed: (hostname, port) => admitted.has(`${hostname}:${port}`) },
      async hostname => [{ address: table[hostname] ?? "127.0.0.1", family: 4 }]);
    expect(await get(f.proxy, "http://100.64.0.27:8765/x")).toMatch(/^HTTP\/1.1 200 /);
    expect(await get(f.proxy, "http://nas.local/x")).toMatch(/^HTTP\/1.1 200 /);
    expect(await get(f.proxy, "http://box.tail0000.ts.net/x")).toMatch(/^HTTP\/1.1 200 /);
    expect(f.dial.mock.calls.map(([target]) => target.address)).toEqual(["100.64.0.27", "10.0.0.14", "100.101.102.103"]);
    // Not admitted: another LAN host, another port, a public site while websites are off.
    for (const url of ["http://other.local/", "http://100.64.0.27:9000/", "http://10.0.0.10/", "http://public.example.com/"])
      expect(await get(f.proxy, url)).toMatch(/^HTTP\/1.1 403 /);
    admitted.add("evil.local:80"); // resolves to loopback in this table
    expect(await get(f.proxy, "http://evil.local/")).toMatch(/^HTTP\/1.1 403 /);
    admitted.add("169.254.169.254:80");
    expect(await get(f.proxy, "http://169.254.169.254/")).toMatch(/^HTTP\/1.1 403 /);
    expect(f.dial).toHaveBeenCalledTimes(3);
  });
  it("CONNECT to an admitted tailnet authority tunnels; a non-admitted public name with a LAN answer does not", async () => {
    const f = await lanFixture({ publicAllowed: () => true, lanAllowed: (hostname, port) => hostname === "box.tail0000.ts.net" && port === 443 },
      async () => [{ address: "100.101.102.103", family: 4 }]);
    const tunnel = async (authority: string) => {
      const c = await client(f.proxy);
      return c.send(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\nProxy-Authorization: ${auth(f.proxy)}\r\n\r\n`);
    };
    expect(await tunnel("box.tail0000.ts.net:443")).toMatch(/^HTTP\/1.1 200 /);
    expect(await tunnel("other.example.com:443")).toMatch(/^HTTP\/1.1 403 /);
  });
});
