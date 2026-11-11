import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { createServer as tcpServer, createConnection, type Socket } from "node:net";

const state = vi.hoisted(() => ({ dir: "", port: 0, denied: false, closed: 0, available: true }));
vi.mock("electron", () => ({ app: { getPath: () => state.dir, isPackaged: true }, safeStorage: {
  isEncryptionAvailable: () => state.available,
  encryptString: (text: string) => Buffer.from([...text].reverse().join("")),
  decryptString: (data: Buffer) => [...data.toString()].reverse().join(""),
} }));
vi.mock("../src/main/ssh", () => ({
  SshFailure: class extends Error {}, SshTunnel: class {},
  TunnelPidFile: class { saved() { return Promise.resolve(); } },
  openTemporaryTunnel: vi.fn(async () => ({ port: state.port, close: () => state.closed++, failure: () => state.denied ? { code: "forwardDenied", detail: "administratively prohibited" } : null })),
  runSsh: vi.fn(() => { throw new Error("Remote commands are forbidden in imported mode"); }),
}));
import { HostManager } from "../src/main/hosts";
import { probeImportedToken } from "../src/main/sshTokenImport";
import { classifySshFailure, parseHostsFile } from "../src/shared/hosts";
import { runSsh } from "../src/main/ssh";
import { CutexClient } from "@cutex-desktop/cutex-client";

let server: Server;
let hostId = "remote";
let status = 200;
let token = "private-test-token";
let extra: Record<string, unknown> = {};
const managers: HostManager[] = [];
const grant = { projects: ["p-ema"], standaloneAgents: [], send: true };
beforeEach(async () => {
  state.dir = await mkdtemp(join(tmpdir(), "cutex-token-")); state.closed = 0; state.denied = false; state.available = true;
  hostId = "remote"; status = 200; token = "private-test-token"; extra = {};
  server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (status !== 200 || req.headers.authorization !== `Bearer ${token}`) {
      res.statusCode = status !== 200 ? status : 401;
      return res.end(JSON.stringify({ error: { code: "rejected", message: `reflected ${token}` } }));
    }
    res.end(JSON.stringify(req.url === "/v2/host" ? { hostId, name: hostId } : {
      hostId, featureList: ["users"], user: { isOwner: false, pending: false, id: "u-ema", name: "ema", grant,
        scope: "full", token: { id: "mct_ema", label: "ema" }, ...extra },
    }));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening"); state.port = (server.address() as { port: number }).port;
});
afterEach(async () => { for (const h of managers.splice(0)) { await h.saved(); h.stop(); } server.closeAllConnections(); await new Promise<void>((r) => server.close(() => r())); await rm(state.dir, { recursive: true, force: true, maxRetries: 5 }); vi.restoreAllMocks(); });

function manager() {
  const manager = new HostManager(() => {}, () => { throw new Error("unexpected daemon creation"); }, { localHost: false });
  managers.push(manager);
  const internals = manager as unknown as { open(): void; publish(): void };
  vi.spyOn(internals, "open").mockImplementation(() => {});
  vi.spyOn(internals, "publish").mockImplementation(() => {});
  return manager;
}
const request = () => ({ target: "ema@remote", token, remotePort: 24670, expectedHostId: "remote" });

describe("imported SSH credentials", () => {
  it("probes real loopback HTTP, returns rights, persists ciphertext only, and forgets without remote commands", async () => {
    const h = manager(); const result = await h.importSshHostToken(request());
    expect(result).toMatchObject({ ok: true, connectAs: "member", access: { hostId: "remote", user: { userId: "u-ema", grant, scope: "full" } } });
    if (!result.ok) throw new Error("import failed");
    await h.saved();
    const hosts = await readFile(join(state.dir, "hosts.json"), "utf8");
    expect(hosts).not.toContain(token);
    expect(JSON.stringify(result)).not.toContain(token);
    expect(await readFile(join(state.dir, "host-tokens.json"), "utf8")).not.toContain(token);
    expect(parseHostsFile(JSON.parse(hosts)).hosts[0]).toMatchObject({ pairingMode: "tokenImport", daemonHostId: "remote" });
    expect(await h.pairSshHost(result.hostId)).toMatchObject({ ok: false, error: { code: "badInput" } });
    expect(await h.setSshConnectAs(result.hostId, "owner")).toMatchObject({ ok: false });
    expect(await h.removeSshHost(result.hostId)).toEqual({ revoked: false }); await h.saved();
    expect(JSON.parse(await readFile(join(state.dir, "host-tokens.json"), "utf8")).tokens).toEqual({});
    expect(runSsh).not.toHaveBeenCalled(); expect(state.closed).toBe(1); h.stop();
  });

  it("retains the old credential on failed rotation and pins identity even if the caller supplies another", async () => {
    const h = manager(); const first = await h.importSshHostToken(request()); if (!first.ok) throw new Error("import failed");
    await h.saved(); const before = await readFile(join(state.dir, "host-tokens.json"), "utf8");
    hostId = "other"; token = "replacement-token";
    expect(await h.importSshHostToken({ hostId: first.hostId, token, expectedHostId: "other" })).toMatchObject({ ok: false, error: { code: "hostMismatch" } });
    await h.saved(); expect(await readFile(join(state.dir, "host-tokens.json"), "utf8")).toBe(before);
    hostId = "remote";
    expect(await h.importSshHostToken({ hostId: first.hostId, token })).toMatchObject({ ok: true, hostId: first.hostId });
    await h.saved(); expect(await readFile(join(state.dir, "host-tokens.json"), "utf8")).not.toBe(before); h.stop();
  });

  it.each([401, 403])("redacts reflected secrets on HTTP %s", async (code) => {
    status = code; const h = manager(); const result = await h.importSshHostToken(request());
    expect(result).toMatchObject({ ok: false, error: { code: "tokenRejected" } });
    expect(JSON.stringify(result)).not.toContain(token); h.stop();
  });

  it("reports disabled forwarding distinctly and closes the temporary tunnel", async () => {
    status = 500; state.denied = true; const h = manager();
    expect(await h.importSshHostToken(request())).toMatchObject({ ok: false, error: { code: "forwardDenied" } });
    expect(state.closed).toBe(1); h.stop();
    expect(classifySshFailure(255, "channel 2: open failed: administratively prohibited: open failed", "tunnel").code).toBe("forwardDenied");
  });

  it("reports a pending binding without granting owner access", async () => {
    extra = { pending: true, id: null, grant: null };
    expect(await probeImportedToken(state.port, token)).toMatchObject({ user: { pending: true, isOwner: false, userId: null } });
  });

  it("does not open a tunnel for invalid input or unavailable encrypted storage", async () => {
    const h = manager(); expect(await h.importSshHostToken({ ...request(), token: "has whitespace" })).toMatchObject({ ok: false, error: { code: "badInput" } });
    state.available = false; expect(await h.importSshHostToken(request())).toMatchObject({ ok: false, error: { code: "noKeyring" } });
    expect(state.closed).toBe(0); h.stop();
  });

  it.runIf(!!process.env.CUTEX_TOKEN_IMPORT_FIXTURE)("two private debug daemons: desktop sidebar receives only ema's granted project through a loopback tunnel", async () => {
    const fixture = JSON.parse(await readFile(process.env.CUTEX_TOKEN_IMPORT_FIXTURE!, "utf8")) as Record<string, { port: number; owner: string; token: string; userId: string; hostId: string }>;
    const secondary = fixture.secondary!; const remote = fixture.remote!;
    const local = new CutexClient({ baseUrl: `http://127.0.0.1:${secondary.port}`, token: secondary.owner });
    expect((await local.projects()).projects).toHaveLength(2);
    const sockets = new Set<Socket>();
    const tunnel = tcpServer((incoming) => {
      const outgoing = createConnection({ host: "127.0.0.1", port: remote.port });
      sockets.add(incoming); sockets.add(outgoing);
      incoming.on("error", () => outgoing.destroy()); outgoing.on("error", () => incoming.destroy());
      incoming.pipe(outgoing).pipe(incoming);
    });
    tunnel.listen(0, "127.0.0.1"); await once(tunnel, "listening"); state.port = (tunnel.address() as { port: number }).port;
    const h = manager();
    const { DaemonService } = await import("../src/main/daemon");
    const service = new DaemonService(() => {});
    try {
      const result = await h.importSshHostToken({ target: "ema@private-remote", remotePort: remote.port, token: remote.token, expectedHostId: remote.hostId });
      expect(result).toMatchObject({ ok: true, access: { user: { isOwner: false, userId: remote.userId, grant: { projects: ["ema-project"], standaloneAgents: [], send: true } } } });
      await h.saved();
      const encrypted = JSON.parse(await readFile(join(state.dir, "host-tokens.json"), "utf8"));
      if (!result.ok) throw new Error("private import failed");
      const stored = [...Buffer.from(encrypted.tokens[result.hostId], "base64").toString()].reverse().join("");
      service.useEndpoint({ baseUrl: `http://127.0.0.1:${state.port}`, token: stored }, { remote: true });
      let sidebar: Awaited<ReturnType<typeof service.sidebar>> | undefined;
      // The initial event-feed connection invalidates any in-flight sidebar
      // snapshot. Retry exactly that freshness guard, as the renderer does.
      for (let attempt = 0; attempt < 20; attempt++) {
        try { sidebar = await service.sidebar(); break; }
        catch (error) {
          if (!(error instanceof Error) || error.message !== "sidebar event scope changed") throw error;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }
      if (!sidebar) throw new Error("The private sidebar never reached a stable event scope");
      expect(sidebar.projects?.projects.map((p) => p.project_id)).toEqual(["ema-project"]);
      expect(JSON.stringify(sidebar)).not.toContain("owner-only-project");
      const capabilities = await service.capabilities();
      expect(capabilities?.user).toMatchObject({ id: remote.userId, isOwner: false });
      expect(runSsh).not.toHaveBeenCalled();
    } finally {
      service.stop(); for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => tunnel.close(() => resolve()));
    }
  }, 60_000);
});
