// Live checks of route failover and return with the real OpenSSH client against a throwaway sshd on
// 127.0.0.1 (own host key, own client key, temp dir; never ~/.ssh, never a real daemon port). Each
// "route" is a small TCP proxy in front of that sshd that can go silent (a VPN going off), refuse, or
// count bytes. Prints timings as ROUTE-TIMING lines.
//   CUTEX_SSH_ROUTES_IT=1 pnpm exec vitest run test/sshRoutes.live.test.ts
// CUTEX_SSH_ROUTES_MODULE=<path of an older ssh.ts> runs only the timing scenarios against that build.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer, request as httpRequest, type Server as HttpServer } from "node:http";
import { connect, createServer, type Server, type Socket } from "node:net";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseSshTarget, type TunnelView } from "../src/shared/hosts";

const moduleOverride = process.env.CUTEX_SSH_ROUTES_MODULE;
const SSH_DIR = process.platform === "win32" ? "C:/Windows/System32/OpenSSH" : "/usr/bin";
const EXE = process.platform === "win32" ? ".exe" : "";
const SSHD = process.platform === "win32" ? `${SSH_DIR}/sshd.exe` : "/usr/sbin/sshd";
const enabled = !!process.env.CUTEX_SSH_ROUTES_IT && existsSync(SSHD);
const HOST_ID = "HOST-ROUTES-TEST";

type Mode = "pass" | "silent" | "refuse";

/** One route: forwards to sshd; "silent" stops moving bytes on open and new connections and never closes them. */
class RouteProxy {
  mode: Mode = "pass";
  bytes = 0;
  connections = 0;
  private server: Server;
  private readonly open = new Set<Socket>();
  port = 0;
  constructor(private readonly sshdPort: number) {
    this.server = createServer((client) => this.accept(client));
  }
  async start(): Promise<void> {
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    this.port = (this.server.address() as { port: number }).port;
  }
  private accept(client: Socket): void {
    client.on("error", () => {});
    if (this.mode === "refuse") {
      client.destroy();
      return;
    }
    this.connections++;
    this.open.add(client);
    client.once("close", () => this.open.delete(client));
    if (this.mode === "silent") return;
    const server = connect({ host: "127.0.0.1", port: this.sshdPort });
    server.on("error", () => client.destroy());
    this.open.add(server);
    server.once("close", () => {
      this.open.delete(server);
      if (this.mode === "pass") client.destroy();
    });
    client.once("close", () => server.destroy());
    client.on("data", (d) => {
      this.bytes += d.length;
      if (this.mode === "pass") server.write(d);
    });
    server.on("data", (d) => {
      this.bytes += d.length;
      if (this.mode === "pass") client.write(d);
    });
  }
  /** Back in order after a silence: connections that went silent are dead (the path really changed). */
  recover(): void {
    this.mode = "pass";
    for (const socket of this.open) socket.destroy();
  }
  stop(): void {
    for (const socket of this.open) socket.destroy();
    this.server.close();
  }
}

const until = async (what: string, predicate: () => boolean, timeoutMs: number) => {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error(`timed out after ${timeoutMs} ms: ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
  return Date.now() - started;
};

/** vitest keeps test output quiet here: CUTEX_SSH_ROUTES_LOG=<file> collects the lines. */
function report(line: string): void {
  const text = `ROUTE-TIMING ${moduleOverride ? "before" : "after"} ${line}`;
  console.log(text);
  if (process.env.CUTEX_SSH_ROUTES_LOG) appendFileSync(process.env.CUTEX_SSH_ROUTES_LOG, `${text}
`);
}

function timing(name: string, ms: number): void {
  report(`${name}: ${(ms / 1000).toFixed(1)} s`);
}

describe.skipIf(!enabled)("SSH routes against a throwaway sshd", () => {
  const dir = mkdtempSync(join(tmpdir(), "cutex-routes-"));
  const key = join(dir, "client_key");
  const knownHosts = join(dir, "known_hosts");
  let sshd: ChildProcess;
  let sshdPort = 0;
  let http: HttpServer;
  let httpPort = 0;
  const posts: string[] = [];
  /** Answers to /slow wait here. */
  const held: (() => void)[] = [];
  let mod: typeof import("../src/main/ssh");
  const proxies: RouteProxy[] = [];
  const pidFile = () => new mod.TunnelPidFile(join(dir, `pids-${Math.random()}.json`));
  const extraArgs = () => ["-F", "none", "-o", "StrictHostKeyChecking=yes", "-o", `UserKnownHostsFile=${knownHosts}`, "-o", `IdentityFile=${key}`, "-o", "IdentitiesOnly=yes", "-o", "IdentityAgent=none", "-o", "HostKeyAlias=routes-test"];
  const target = (proxy: RouteProxy) => parseSshTarget(`${userInfo().username}@127.0.0.1:${proxy.port}`)!;
  const route = async () => {
    const proxy = new RouteProxy(sshdPort);
    await proxy.start();
    proxies.push(proxy);
    return proxy;
  };
  const get = (port: number, path: string, method = "GET", body?: string) =>
    new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = httpRequest({ host: "127.0.0.1", port, path, method, agent: false }, (res) => {
        let text = "";
        res.on("data", (d) => (text += d));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: text }));
      });
      req.on("error", reject);
      req.end(body);
    });
  const verifyRoute = async (port: number) => {
    const reply = await get(port, "/v2/host");
    return JSON.parse(reply.body).hostId === HOST_ID ? null : ({ code: "hostMismatch", detail: "other" } as const);
  };
  const tunnelOf = (targets: RouteProxy[], extra: object = {}) => {
    const views: TunnelView[] = [];
    const tunnel = new mod.SshTunnel({ targets: targets.map(target), remotePort: httpPort, pids: pidFile(), onChange: (v) => views.push(v), extraArgs: extraArgs(), ...extra });
    return { tunnel, views };
  };

  beforeAll(async () => {
    mod = moduleOverride ? await import(/* @vite-ignore */ moduleOverride) : await import("../src/main/ssh");
    const keygen = `${SSH_DIR}/ssh-keygen${EXE}`;
    for (const name of ["host_key", "client_key"]) expect(spawnSync(keygen, ["-q", "-t", "ed25519", "-N", "", "-f", join(dir, name)]).status).toBe(0);
    const pub = spawnSync(keygen, ["-y", "-f", key], { encoding: "utf8" }).stdout.trim();
    writeFileSync(join(dir, "authorized_keys"), `${pub}\n`);
    if (process.platform === "win32") for (const name of ["host_key", "client_key", "authorized_keys"]) spawnSync("icacls", [join(dir, name), "/inheritance:r", "/grant:r", `${userInfo().username}:F`], { stdio: "ignore" });
    const free = await mod.freeLocalPort();
    sshdPort = free;
    writeFileSync(join(dir, "sshd_config"), [`Port ${free}`, "ListenAddress 127.0.0.1", `HostKey ${join(dir, "host_key").replace(/\\/g, "/")}`, `PidFile ${join(dir, "sshd.pid").replace(/\\/g, "/")}`, `AuthorizedKeysFile ${join(dir, "authorized_keys").replace(/\\/g, "/")}`, "PasswordAuthentication no", "PubkeyAuthentication yes", "AllowTcpForwarding yes", "StrictModes no", "ClientAliveInterval 0", ""].join("\n"));
    sshd = spawn(SSHD, ["-D", "-e", "-f", join(dir, "sshd_config")], { stdio: "ignore", windowsHide: true });
    for (let i = 0; i < 40 && !(await mod.portListening(free, 300)); i++) await new Promise((r) => setTimeout(r, 100));
    const hostPub = spawnSync(keygen, ["-y", "-f", join(dir, "host_key")], { encoding: "utf8" }).stdout.trim();
    writeFileSync(knownHosts, `routes-test ${hostPub}\n`);
    http = createHttpServer((req, res) => {
      if (req.url === "/v2/host") return void res.end(JSON.stringify({ hostId: HOST_ID }));
      if (req.url === "/slow") {
        let body = "";
        req.on("data", (d) => (body += d));
        req.on("end", () => {
          posts.push(body);
          held.push(() => res.end(`done:${body}`));
        });
        return;
      }
      if (req.url === "/page-stream") {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write("data: open\n\n");
        const timer = setInterval(() => res.write("data: tick\n\n"), 200);
        res.on("close", () => clearInterval(timer));
        return;
      }
      res.end("ok");
    });
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
    httpPort = (http.address() as { port: number }).port;
  }, 60_000);

  afterAll(async () => {
    for (const proxy of proxies) proxy.stop();
    http?.close();
    if (sshd?.pid && sshd.exitCode === null) {
      if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(sshd.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      else sshd.kill();
    }
    await new Promise((r) => setTimeout(r, 300));
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* a file still closing: temp dir */ }
  });

  it("a connected route goes silent: time until the next route is up", async () => {
    const [a, b] = [await route(), await route()];
    const { tunnel, views } = tunnelOf([a, b]);
    tunnel.start();
    await until("first route", () => tunnel.state.status === "up", 20_000);
    expect(tunnel.state.target).toBe(`${userInfo().username}@127.0.0.1:${a.port}`);
    a.mode = "silent";
    const lost = await until("silence noticed", () => tunnel.state.status !== "up", 120_000);
    timing("silence noticed", lost);
    const total = lost + (await until("second route", () => tunnel.state.status === "up", 120_000));
    timing("connected route silent -> next route up", total);
    expect(tunnel.state.target).toBe(`${userInfo().username}@127.0.0.1:${b.port}`);
    expect(views.some((v) => v.status === "retrying")).toBe(true);
    tunnel.stop();
  }, 240_000);

  it("connecting while the first route is silent: time until the second is up", async () => {
    const [a, b] = [await route(), await route()];
    a.mode = "silent";
    const { tunnel } = tunnelOf([a, b]);
    tunnel.start();
    timing("start, 1st route silent -> 2nd up", await until("second route", () => tunnel.state.status === "up", 120_000));
    tunnel.stop();
  }, 180_000);

  it("connecting while two routes are silent: time until the third is up", async () => {
    const [a, b, c] = [await route(), await route(), await route()];
    a.mode = "silent";
    b.mode = "silent";
    const { tunnel } = tunnelOf([a, b, c]);
    tunnel.start();
    timing("start, 1st+2nd silent -> 3rd up", await until("third route", () => tunnel.state.status === "up", 180_000));
    tunnel.stop();
  }, 240_000);

  it("refused routes fail fast", async () => {
    const [a, b, c] = [await route(), await route(), await route()];
    a.mode = "refuse";
    b.mode = "refuse";
    const { tunnel } = tunnelOf([a, b, c]);
    tunnel.start();
    timing("start, 1st+2nd refused -> 3rd up", await until("third route", () => tunnel.state.status === "up", 120_000));
    tunnel.stop();
  }, 180_000);

  it("every route was down, then one comes back (Tailscale turned on): time until connected", async () => {
    const [a, b] = [await route(), await route()];
    a.mode = "silent";
    b.mode = "silent";
    const { tunnel, views } = tunnelOf([a, b]);
    tunnel.start();
    await until("backed off for a while", () => views.filter((v) => v.status === "retrying").length >= 6, 240_000);
    if (!moduleOverride) expect(tunnel.state.routesExhausted).toBe(true);
    b.recover();
    timing("all down for 6 failures, 2nd back -> up", await until("recovered", () => tunnel.state.status === "up", 180_000));
    if (!moduleOverride) expect(tunnel.state.routesExhausted).toBeUndefined();
    tunnel.stop();
  }, 480_000);

  describe.skipIf(!!moduleOverride)("going back", () => {
    it("returns to the better route; a write in flight finishes on the old route, once; streams stay until they end", async () => {
      const [lan, relay] = [await route(), await route()];
      const switches: number[] = [];
      const { tunnel, views } = tunnelOf([lan, relay], { verifyRoute: (port: number) => verifyRoute(port), onRouteSwitched: () => switches.push(Date.now()) });
      lan.mode = "refuse";
      tunnel.start();
      await until("on the relay", () => tunnel.state.status === "up", 30_000);
      const front = tunnel.state.localPort!;
      expect(tunnel.state.routeIndex).toBe(1);
      expect((await get(front, "/v2/host")).status).toBe(200);

      // A write that has not been answered yet, and a stream a service page would hold.
      const write = get(front, "/slow", "POST", "only-once");
      await until("write arrived", () => posts.length > 0, 5000);
      let streamed = "";
      const stream = httpRequest({ host: "127.0.0.1", port: front, path: "/page-stream", agent: false }, (res) => res.on("data", (d) => (streamed += d)));
      stream.on("error", () => {});
      stream.end();
      await until("stream open", () => streamed.includes("open"), 5000);
      const relayBytesBefore = relay.bytes;

      const recovered = Date.now();
      lan.mode = "pass";
      await until("switched back", () => tunnel.state.target?.endsWith(`:${lan.port}`) === true, 120_000);
      timing("better route back -> switched", Date.now() - recovered);
      expect(tunnel.state).toMatchObject({ status: "up", routeIndex: 0, localPort: front });
      expect(switches).toHaveLength(1);
      expect(views.slice(views.findIndex((v) => v.routeIndex === 1 && v.status === "up")).every((v) => v.status === "up")).toBe(true);

      // New connections take the better route through the same local port.
      const lanBefore = lan.bytes;
      expect((await get(front, "/v2/host")).status).toBe(200);
      expect(lan.bytes).toBeGreaterThan(lanBefore);

      // The old route still carries what started on it.
      const relayPid = tunnel.backendPorts().length;
      expect(relayPid).toBe(2);
      const before = streamed.length;
      await until("stream still moving", () => streamed.length > before, 5000);
      expect(relay.bytes).toBeGreaterThan(relayBytesBefore);
      expect(held).toHaveLength(1);
      held.shift()!();
      expect(await write).toEqual({ status: 200, body: "done:only-once" });
      expect(posts).toEqual(["only-once"]);

      // Last connection on it ended: the old ssh goes.
      stream.destroy();
      const drained = await until("old route drained", () => tunnel.backendPorts().length === 1, 10_000);
      timing("old route ended after its last connection", drained);
      tunnel.stop();
      expect(tunnel.backendPorts()).toEqual([]);
    }, 240_000);

    it("a better route that stays down costs next to nothing to probe; a held probe's cost is one handshake", async () => {
      const [silent, relay] = [await route(), await route()];
      silent.mode = "refuse";
      const { tunnel } = tunnelOf([silent, relay], { verifyRoute: (port: number) => verifyRoute(port) });
      tunnel.start();
      await until("on the relay", () => tunnel.state.status === "up", 30_000);
      const started = Date.now();
      const relayBefore = relay.bytes;
      await until("three probe rounds", () => Date.now() - started > 95_000, 100_000);
      report(`probe bytes, better route refusing, 95 s: ${silent.bytes}; idle keepalive on the live route: ${relay.bytes - relayBefore} bytes`);
      expect(silent.bytes).toBe(0);
      silent.mode = "pass";
      await until("switched", () => tunnel.state.routeIndex === 0, 120_000);
      report(`a probe that succeeded, handshake + 2 identity checks: ${silent.bytes} bytes`);
      expect(silent.bytes).toBeLessThan(32 * 1024);
      tunnel.stop();
    }, 300_000);
  });
});
