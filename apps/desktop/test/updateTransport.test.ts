// Proxy plumbing of the updater (main/updateTransport.ts): Chromium's resolveProxy answers, the proxy
// handed to git / the build steps, and the Node transport through an HTTP proxy (the fallback while the
// agent-page containment has Chromium's DNS off). Chromium's own transport (main/updateNet.ts) runs only in
// Electron: scripts/qa-binary-update-e2e.mjs --proxy covers it.
import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { envHasProxy, gitProxyArgs, nodeTransport, parseResolvedProxy, ProxyAuthError, proxyEnv, proxyUrl } from "../src/main/updateTransport";

describe("parseResolvedProxy", () => {
  it("takes the first entry of Chromium's answer", () => {
    expect(parseResolvedProxy("DIRECT")).toBeNull();
    expect(parseResolvedProxy("")).toBeNull();
    expect(parseResolvedProxy("PROXY proxy.example.org:3128; DIRECT")).toEqual({ scheme: "http", host: "proxy.example.org", port: 3128 });
    expect(parseResolvedProxy("HTTPS secure.example.org:443")).toEqual({ scheme: "https", host: "secure.example.org", port: 443 });
    expect(parseResolvedProxy("SOCKS5 127.0.0.1:1080")).toEqual({ scheme: "socks5", host: "127.0.0.1", port: 1080 });
    expect(parseResolvedProxy("SOCKS 10.0.0.1:1080")).toEqual({ scheme: "socks4", host: "10.0.0.1", port: 1080 });
    expect(parseResolvedProxy("PROXY [::1]:8080")).toEqual({ scheme: "http", host: "::1", port: 8080 });
    expect(parseResolvedProxy("DIRECT; PROXY p:1")).toBeNull();
    expect(parseResolvedProxy("PROXY p:0")).toBeNull();
    expect(parseResolvedProxy("PROXY p:99999")).toBeNull();
    expect(parseResolvedProxy("PROXY bad host:1")).toBeNull();
  });

  it("as URLs for git and *_PROXY (socks names resolved by the proxy)", () => {
    expect(proxyUrl({ scheme: "http", host: "p", port: 3128 })).toBe("http://p:3128");
    expect(proxyUrl({ scheme: "socks5", host: "p", port: 1080 })).toBe("socks5h://p:1080");
    expect(proxyUrl({ scheme: "socks4", host: "p", port: 1080 })).toBe("socks4a://p:1080");
    expect(proxyUrl({ scheme: "http", host: "::1", port: 8080 })).toBe("http://[::1]:8080");
  });
});

describe("proxy for the source updater's programs", () => {
  const p = { scheme: "http" as const, host: "proxy.example.org", port: 3128 };
  it("git gets -c http.proxy only for http(s) remotes with a proxy", () => {
    expect(gitProxyArgs("https://github.com/example-org/cutex-desktop.git", p)).toEqual(["-c", "http.proxy=http://proxy.example.org:3128"]);
    expect(gitProxyArgs("http://git.example.org/x.git", p)).toHaveLength(2);
    expect(gitProxyArgs("git@github.com:example-org/x.git", p)).toEqual([]);
    expect(gitProxyArgs("ssh://git@github.com/example-org/x.git", p)).toEqual([]);
    expect(gitProxyArgs("/srv/git/x.git", p)).toEqual([]);
    expect(gitProxyArgs("https://github.com/x.git", null)).toEqual([]);
  });

  it("build steps get *_PROXY (and @electron/get's variables) only when a proxy was resolved", () => {
    expect(proxyEnv(null)).toEqual({});
    expect(proxyEnv(p)).toMatchObject({ HTTPS_PROXY: "http://proxy.example.org:3128", http_proxy: "http://proxy.example.org:3128", ELECTRON_GET_USE_PROXY: "1", GLOBAL_AGENT_HTTPS_PROXY: "http://proxy.example.org:3128" });
  });

  it("an environment that names a proxy is left to the programs themselves", () => {
    expect(envHasProxy({})).toBe(false);
    expect(envHasProxy({ HTTPS_PROXY: " " })).toBe(false);
    expect(envHasProxy({ https_proxy: "http://p:1" })).toBe(true);
    expect(envHasProxy({ ALL_PROXY: "socks5://p:1" })).toBe(true);
  });
});

describe("nodeTransport", () => {
  const signal = () => AbortSignal.timeout(5000);

  it("never follows a redirect", async () => {
    const server = createServer((_req, res) => res.writeHead(302, { location: "https://evil.example/x" }).end());
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    try {
      const res = await nodeTransport()(`http://127.0.0.1:${(server.address() as { port: number }).port}/a`, { headers: {}, signal: signal() });
      expect(res.status).toBe(302);
      expect(res.header("Location")).toBe("https://evil.example/x");
      res.cancel();
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  it("an https target through a proxy uses CONNECT; 407 there is ProxyAuthError", async () => {
    const seen: string[] = [];
    const proxy = createServer();
    proxy.on("connect", (req, socket) => {
      seen.push(`CONNECT ${req.url}`);
      socket.end("HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic\r\n\r\n");
    });
    await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", () => r()));
    try {
      const t = nodeTransport({ scheme: "http", host: "127.0.0.1", port: (proxy.address() as { port: number }).port });
      await expect(t("https://api.github.com/repos/example-org/cutex-desktop/releases/latest", { headers: {}, signal: signal() })).rejects.toBeInstanceOf(ProxyAuthError);
      expect(seen).toEqual(["CONNECT api.github.com:443"]);
    } finally {
      await new Promise((r) => proxy.close(r));
    }
  });

  it("the manual update proxy's Basic login goes in Proxy-Authorization (CONNECT and plain http), never in proxyUrl", async () => {
    const seen: string[] = [];
    const proxy = createServer((req, res) => {
      seen.push(`${req.method} ${req.url} ${req.headers["proxy-authorization"] ?? "-"}`);
      res.writeHead(204).end();
    });
    proxy.on("connect", (req, socket) => {
      seen.push(`CONNECT ${req.url} ${req.headers["proxy-authorization"] ?? "-"}`);
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    });
    await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", () => r()));
    try {
      const server = { scheme: "http" as const, host: "127.0.0.1", port: (proxy.address() as { port: number }).port, auth: { username: "alice", password: "s3cret" } };
      const res = await nodeTransport(server)("http://updates.example/latest", { headers: {}, signal: signal() });
      expect(res.status).toBe(204);
      res.cancel();
      await expect(nodeTransport(server)("https://updates.example/latest", { headers: {}, signal: signal() })).rejects.toThrow(/answered 403/);
      const basic = `Basic ${Buffer.from("alice:s3cret").toString("base64")}`;
      expect(seen).toEqual([`GET http://updates.example/latest ${basic}`, `CONNECT updates.example:443 ${basic}`]);
      expect(proxyUrl(server)).toBe(`http://127.0.0.1:${server.port}`);
    } finally {
      await new Promise((r) => proxy.close(r));
    }
  });

  it("refuses proxy kinds it cannot speak", async () => {
    await expect(nodeTransport({ scheme: "socks5", host: "127.0.0.1", port: 1 })("https://github.com/", { headers: {}, signal: signal() })).rejects.toThrow(/socks5 proxies are not supported/);
  });
});
