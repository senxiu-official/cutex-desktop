import { createServer as httpServer, type IncomingMessage } from "node:http";
import { createConnection, createServer as tcpServer, type Server, type Socket } from "node:net";
import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startBrowserEgressProxy, type BrowserEgressDial, type BrowserEgressLookup, type BrowserEgressPolicy, type BrowserEgressProxy } from "../src/main/browser/egressProxy";
import { BrowserSystemProxyStore, createBrowserSystemProxy } from "../src/main/browser/systemProxy";
import { browserUpstreamProxy } from "../src/main/browser/egressUpstream";
import { isAllowedEgressAnswer, isFakeIpEgressAddress } from "../src/main/browser/egressAddress";

// B7: fake-IP DNS answers and the owner's opt-in system proxy. Every dial goes to a 127.0.0.1 fixture.
const cleanup: (() => Promise<unknown> | void)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function until(check: () => boolean) { for (let i = 0; i < 300 && !check(); i++) await new Promise(resolve => setTimeout(resolve, 2)); expect(check()).toBe(true); }
async function listen(server: Server) {
  const sockets = new Set<Socket>(); server.on("connection", socket => { sockets.add(socket); socket.on("error", () => {}); socket.once("close", () => sockets.delete(socket)); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(async () => { for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); });
  return (server.address() as { port: number }).port;
}
const auth = (proxy: BrowserEgressProxy) => `Basic ${Buffer.from(`${proxy.credentials.username}:${proxy.credentials.password}`).toString("base64")}`;
async function client(proxy: BrowserEgressProxy) {
  const socket = createConnection({ host: "127.0.0.1", port: proxy.port }); let received = Buffer.alloc(0);
  socket.on("error", () => {}); socket.on("data", chunk => { received = Buffer.concat([received, chunk]); });
  cleanup.push(() => { socket.destroy(); }); await once(socket, "connect");
  return { socket, get text() { return received.toString("utf8"); },
    async send(value: string) { socket.write(value); await until(() => received.includes(Buffer.from("\r\n\r\n")) || socket.destroyed); return received.toString("utf8"); } };
}
async function get(proxy: BrowserEgressProxy, target = "http://public.example.com/a") {
  const c = await client(proxy);
  await c.send(`GET ${target} HTTP/1.1\r\nHost: ${new URL(target).host}\r\nProxy-Authorization: ${auth(proxy)}\r\n\r\n`);
  await until(() => c.socket.destroyed); return c.text;
}

/** A fake HTTP proxy (CONNECT tunnels echo, absolute-form answered itself) and a fake SOCKS5 proxy (echo). */
async function upstreamFixture() {
  const seen: string[] = [];
  const proxyServer = httpServer((req: IncomingMessage, res) => { seen.push(`${req.method} ${req.url} auth=${req.headers["proxy-authorization"] ?? "none"}`); res.end(`via-proxy ${req.url}`); });
  proxyServer.on("connect", (req: IncomingMessage, socket: Socket, head: Buffer) => {
    seen.push(`CONNECT ${req.url}`); socket.write("HTTP/1.1 200 Connection Established\r\n\r\n"); if (head.length) socket.write(head); socket.pipe(socket);
  });
  const httpPort = await listen(proxyServer);
  const socks = tcpServer(socket => {
    let stage = 0;
    socket.on("data", chunk => {
      if (stage === 0) { stage = 1; socket.write(Buffer.from([5, 0])); return; }
      if (stage === 1) {
        stage = 2; const length = chunk[4]!; seen.push(`SOCKS ${chunk.subarray(5, 5 + length).toString()}:${chunk.readUInt16BE(5 + length)}`);
        socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 80])); return;
      }
      socket.write(chunk);
    });
  });
  const socksPort = await listen(socks);
  return { seen, httpPort, socksPort };
}
async function proxied(kind: "http" | "socks5" | null | undefined, extra: Partial<BrowserEgressPolicy> & { lookup?: BrowserEgressLookup } = {}) {
  const u = await upstreamFixture();
  const lookup = vi.fn<BrowserEgressLookup>(extra.lookup ?? (async hostname => hostname === "proxy.test" ? [{ address: "127.0.0.1", family: 4 }] : [{ address: "8.8.8.8", family: 4 }]));
  const dial = vi.fn<BrowserEgressDial>((target, signal) => createConnection({ host: "127.0.0.1", port: target.port, signal }));
  const asked: string[] = [];
  const answer = kind === "http" ? { scheme: "http" as const, host: "proxy.test", port: u.httpPort } : kind === "socks5" ? { scheme: "socks5" as const, host: "127.0.0.1", port: u.socksPort } : kind;
  const { lookup: _ignored, ...policy } = extra;
  const proxy = await startBrowserEgressProxy({ lookup, dial, upstreamProxy: url => { asked.push(url); return answer; }, ...policy }); cleanup.push(proxy.close);
  return { ...u, proxy, lookup, dial, asked };
}

describe("fake-IP answers (B7a)", () => {
  it("dials a 198.18/15 answer for a public name, never for that literal or an admitted LAN authority", async () => {
    const origin = httpServer((_req, res) => res.end("fixture")), port = await listen(origin);
    const dial = vi.fn<BrowserEgressDial>((_target, signal) => createConnection({ host: "127.0.0.1", port, signal }));
    const proxy = await startBrowserEgressProxy({ lookup: async () => [{ address: "198.18.0.7", family: 4 }], dial }); cleanup.push(proxy.close);
    expect(await get(proxy)).toContain("fixture");
    expect(dial).toHaveBeenCalledWith({ address: "198.18.0.7", family: 4, port: 80 }, expect.any(AbortSignal));
    expect(await get(proxy, "http://198.18.0.7/")).toMatch(/^HTTP\/1.1 403 /);
    const lan = await startBrowserEgressProxy({ lookup: async () => [{ address: "198.19.3.4", family: 4 }], dial, publicAllowed: () => false,
      lanAllowed: hostname => hostname === "nas.local" }); cleanup.push(lan.close);
    expect(await get(lan, "http://nas.local/")).toMatch(/^HTTP\/1.1 403 /);
    expect(dial).toHaveBeenCalledTimes(1);
  });
  it("counts a fake-IP answer only for a public-looking name", () => {
    expect(isFakeIpEgressAddress("198.18.0.1")).toBe(true); expect(isFakeIpEgressAddress("198.19.255.255")).toBe(true); expect(isFakeIpEgressAddress("198.20.0.1")).toBe(false);
    expect(isAllowedEgressAnswer("198.18.3.4", { hostname: "www.example.com", lan: false })).toBe(true);
    for (const hostname of ["198.18.3.4", "nas.local", "router", "printer.lan", "app.localhost", "box.home.arpa"])
      expect(isAllowedEgressAnswer("198.18.3.4", { hostname, lan: false })).toBe(false);
    expect(isAllowedEgressAnswer("198.18.3.4", { hostname: "box.tail0000.ts.net", lan: true })).toBe(false);
    expect(isAllowedEgressAnswer("10.0.0.1", { hostname: "www.example.com", lan: false })).toBe(false);
    expect(isAllowedEgressAnswer("127.0.0.1", { hostname: "www.example.com", lan: false })).toBe(false);
  });
});

describe("「浏览器通过系统代理上网」 upstream (B7b)", () => {
  it("plain HTTP goes to an HTTP upstream in absolute form, without N2's credentials", async () => {
    const f = await proxied("http");
    expect(await get(f.proxy, "http://public.example.com/a?q=1")).toContain("via-proxy http://public.example.com/a?q=1");
    expect(f.seen).toEqual(["GET http://public.example.com/a?q=1 auth=none"]);
    expect(f.asked).toEqual(["http://public.example.com/"]);
    expect(f.dial).toHaveBeenCalledWith({ address: "127.0.0.1", family: 4, port: f.httpPort }, expect.any(AbortSignal));
  });
  it.each(["http", "socks5"] as const)("CONNECT tunnels through a %s upstream (the proxy resolves the name)", async kind => {
    const f = await proxied(kind), c = await client(f.proxy);
    await c.send(`CONNECT public.example.com:443 HTTP/1.1\r\nHost: public.example.com:443\r\nProxy-Authorization: ${auth(f.proxy)}\r\n\r\nhello`);
    await until(() => c.text.includes("hello"));
    expect(c.text).toMatch(/^HTTP\/1.1 200 Connection Established/);
    expect(f.seen).toEqual([kind === "http" ? "CONNECT public.example.com:443" : "SOCKS public.example.com:443"]);
    expect(f.asked).toEqual(["https://public.example.com:443/"]);
  });
  it("DIRECT from the OS dials the validated address; an unusable answer is refused, never sent direct", async () => {
    const direct = await proxied(null);
    await get(direct.proxy);
    expect(direct.dial).toHaveBeenCalledWith({ address: "8.8.8.8", family: 4, port: 80 }, expect.any(AbortSignal));
    const unusable = await proxied(undefined);
    expect(await get(unusable.proxy)).toMatch(/^HTTP\/1.1 403 /);
    expect(unusable.dial).not.toHaveBeenCalled();
  });
  it("keeps N2's checks: private local answers and control-endpoint ports are refused; admitted LAN never goes upstream", async () => {
    const rebinding = await proxied("http", { lookup: async () => [{ address: "127.0.0.1", family: 4 }] });
    expect(await get(rebinding.proxy)).toMatch(/^HTTP\/1.1 403 /);
    const control = await proxied("http", { protectedAddress: (address, port) => address === "127.0.0.1" && port === 24270 });
    expect(await get(control.proxy, "http://public.example.com:24270/v2")).toMatch(/^HTTP\/1.1 403 /);
    for (const f of [rebinding, control]) expect(f.dial).not.toHaveBeenCalled();
    // A proxy name the OS gives that is a control endpoint is never dialed either.
    const proxyIsControl = await proxied("http", { protectedAddress: (address, port) => address === "127.0.0.1" && port !== 80 && port !== 443 });
    expect(await get(proxyIsControl.proxy)).toMatch(/^HTTP\/1.1 403 /);
    expect(proxyIsControl.dial).not.toHaveBeenCalled();
    const lan = await proxied("http", { lanAllowed: hostname => hostname === "nas.local", lookup: async hostname => [{ address: hostname === "nas.local" ? "10.0.0.14" : "127.0.0.1", family: 4 }] });
    await get(lan.proxy, "http://nas.local/");
    expect(lan.asked).toEqual([]);
    expect(lan.dial).toHaveBeenCalledWith({ address: "10.0.0.14", family: 4, port: 80 }, expect.any(AbortSignal));
  });
  it("an unresolvable public name still goes through the proxy (the proxy resolves it)", async () => {
    const f = await proxied("http", { lookup: async hostname => { if (hostname === "proxy.test") return [{ address: "127.0.0.1", family: 4 }]; throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" }); } });
    expect(await get(f.proxy)).toContain("via-proxy");
  });
});

const memory = (text?: string) => {
  const files = new Map<string, string>(text === undefined ? [] : [["p", text]]);
  return { files, io: { read: (path: string) => { const value = files.get(path); if (value === undefined) throw Object.assign(new Error("missing"), { code: "ENOENT" }); return value; },
    write: (path: string, value: string) => { files.set(path, value); } } };
};
describe("the switch itself (main-owned, default off)", () => {
  it("is off by default and when the file is unreadable or malformed; persists the owner's choice", () => {
    expect(new BrowserSystemProxyStore("p", memory().io).get()).toBe(false);
    expect(new BrowserSystemProxyStore("p", memory("{").io).get()).toBe(false);
    expect(new BrowserSystemProxyStore("p", memory(JSON.stringify({ systemProxy: "yes" })).io).get()).toBe(false);
    const m = memory(), store = new BrowserSystemProxyStore("p", m.io);
    store.set(true);
    expect(JSON.parse(m.files.get("p")!)).toEqual({ systemProxy: true });
    expect(new BrowserSystemProxyStore("p", m.io).get()).toBe(true);
  });
  it("asks the OS only while on; DIRECT = null, unusable = undefined", async () => {
    const resolve = vi.fn(async () => "PROXY 127.0.0.1:7890; DIRECT");
    const proxy = createBrowserSystemProxy({ store: new BrowserSystemProxyStore(null), resolve });
    expect(await proxy.upstream("https://example.com/")).toBeNull(); expect(resolve).not.toHaveBeenCalled();
    expect(proxy.set(true)).toEqual({ enabled: true });
    expect(await proxy.upstream("https://example.com/")).toEqual({ scheme: "http", host: "127.0.0.1", port: 7890 });
    resolve.mockResolvedValueOnce("DIRECT"); expect(await proxy.upstream("https://example.com/")).toBeNull();
    resolve.mockResolvedValueOnce("HTTPS proxy.example:443"); expect(await proxy.upstream("https://example.com/")).toBeUndefined();
    resolve.mockRejectedValueOnce(new Error("pac")); expect(await proxy.upstream("https://example.com/")).toBeUndefined();
  });
  it.each([
    ["DIRECT", null], ["PROXY proxy.corp:8080", { scheme: "http", host: "proxy.corp", port: 8080 }], ["SOCKS5 127.0.0.1:7891; DIRECT", { scheme: "socks5", host: "127.0.0.1", port: 7891 }],
    ["PROXY [::1]:7890", { scheme: "http", host: "::1", port: 7890 }], ["SOCKS 127.0.0.1:1080", undefined], ["HTTPS p:443", undefined], ["PROXY p:0", undefined], ["PROXY p:08080", undefined], ["", null], [42, undefined],
  ])("parses resolveProxy answer %j", (answer, expected) => expect(browserUpstreamProxy(answer)).toEqual(expected));
});
