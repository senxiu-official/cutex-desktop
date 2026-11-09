import { beforeEach, describe, expect, it, vi } from "vitest";

const ssh = vi.hoisted(() => ({ tunnels: [] as any[], temporary: [] as string[] }));
const client = vi.hoisted(() => ({ host: vi.fn() }));

vi.mock("electron", () => ({ app: {}, safeStorage: { isEncryptionAvailable: () => true } }));
vi.mock("@cutex-desktop/cutex-client/node", () => ({ discoverLocalDaemon: vi.fn() }));
vi.mock("@cutex-desktop/cutex-client", () => ({
  CutexApiError: class CutexApiError extends Error { constructor(readonly status: number, message = "api") { super(message); } },
  CutexUnreachableError: class CutexUnreachableError extends Error {},
  CutexClient: class {
    constructor(readonly endpoint: unknown) {}
    host(options?: unknown) { return client.host(this.endpoint, options); }
    request() { return Promise.resolve({ featureList: [] }); }
  },
  readCutexBuild: () => null,
}));
vi.mock("../src/main/ssh", () => ({
  SshFailure: class extends Error {},
  TunnelPidFile: class {},
  SshTunnel: class {
    state = { status: "idle", localPort: null, target: null, error: null, attempt: 0, retryAt: null, upSince: null };
    constructor(readonly options: any) { ssh.tunnels.push(this); }
    start() {}
    stop() {}
    rejectReady = vi.fn();
  },
  openTemporaryTunnel: vi.fn(async (target: { destination: string }) => {
    ssh.temporary.push(target.destination);
    return { port: target.destination === "hachimi-lan" ? 41001 : 41002, close: vi.fn() };
  }),
  resolveSshHost: vi.fn(async () => null),
  runSsh: vi.fn(),
}));

import { HostManager } from "../src/main/hosts";
import { emptyHostsFile, initialTunnel, type HostsFile, type HostsState } from "../src/shared/hosts";

const ID = "ssh-hachimi1";

function harness(identity: string | null = "HOST-H") {
  const file: HostsFile = emptyHostsFile();
  file.hosts.push({ id: ID, label: "hachimi", target: "hachimi-lan", targets: ["hachimi-lan", "hachimi-direct"], daemonHostId: identity, remotePort: 24270, cutexPath: "cutex", tokenId: "ct_1", createdAt: "", lastConnectedAt: null, autoConnect: false, color: "#f97316", platform: "linux" });
  const published: HostsState[] = [];
  const daemon = {
    currentState: { kind: "connecting", baseUrl: "" } as any,
    suspend: vi.fn(function (this: any, state: unknown) { this.currentState = state; }),
    useEndpoint: vi.fn(),
    retarget: vi.fn(),
    reconnectNow: vi.fn(),
    activeClient: vi.fn(() => null),
    stop: vi.fn(),
    detachViews: vi.fn(),
  };
  const manager = Object.assign(Object.create(HostManager.prototype), {
    file,
    conns: new Map(),
    scope: { kind: "host", id: ID },
    local: {},
    dev: new Map(),
    noLocalHost: false,
    tokens: { get: () => "secret", has: () => true },
    pids: {},
    createDaemon: () => daemon,
    emit: (_event: string, state: HostsState) => published.push(state),
    save() {},
    promptSession: () => ({ close() {} }),
  }) as HostManager;
  return { manager, get file() { return (manager as unknown as { file: HostsFile }).file; }, daemon, published };
}

const flush = async () => {
  for (let index = 0; index < 12; index++) await Promise.resolve();
};

async function connect(manager: HostManager, target = "hachimi-direct") {
  await manager.connectHost(ID, true);
  const conn = manager.connection(ID)!;
  const tunnel = ssh.tunnels.at(-1)!;
  tunnel.state = { ...initialTunnel(target), status: "up", localPort: 40001, target };
  tunnel.options.onChange(tunnel.state);
  await flush();
  return { conn, tunnel };
}

describe("HostManager multi-address identity checks", () => {
  beforeEach(() => {
    ssh.tunnels = [];
    ssh.temporary = [];
    client.host.mockReset();
  });

  it("passes the ordered addresses to the tunnel and installs a verified endpoint", async () => {
    client.host.mockResolvedValue({ hostId: "HOST-H", platform: "linux" });
    const h = harness();
    const { tunnel } = await connect(h.manager);
    expect(tunnel.options.targets.map((target: { destination: string }) => target.destination)).toEqual(["hachimi-lan", "hachimi-direct"]);
    expect(h.daemon.useEndpoint).toHaveBeenCalledWith(expect.objectContaining({ baseUrl: "http://127.0.0.1:40001", configPath: "ssh:hachimi-direct" }), { remote: true });
    expect(tunnel.rejectReady).not.toHaveBeenCalled();
    expect((await h.manager.hosts()).hosts.find((host) => host.id === ID)?.conn?.tunnel?.target).toBe("hachimi-direct");
  });

  it("refuses a different cutex hostId before exposing the endpoint", async () => {
    client.host.mockResolvedValue({ hostId: "HOST-OTHER", platform: "linux" });
    const h = harness();
    const { tunnel } = await connect(h.manager);
    expect(h.daemon.useEndpoint).not.toHaveBeenCalled();
    expect(h.daemon.suspend).toHaveBeenCalledWith(expect.objectContaining({ kind: "error", baseUrl: "ssh://hachimi-direct" }), { remote: true });
    expect(tunnel.rejectReady).toHaveBeenCalledWith(expect.objectContaining({ code: "hostMismatch", detail: expect.stringContaining("HOST-OTHER") }));
  });

  it("persists the first confirmed identity and applies it to later addresses", async () => {
    client.host.mockResolvedValue({ hostId: "HOST-FIRST", platform: "linux" });
    const h = harness(null);
    await connect(h.manager, "hachimi-lan");
    expect(h.file.hosts[0]?.daemonHostId).toBe("HOST-FIRST");
    expect(h.daemon.useEndpoint).toHaveBeenCalledTimes(1);
  });

  it("keeps the legacy target field pointing at the first edited address", async () => {
    const h = harness();
    await h.manager.connectHost(ID, true);
    const result = await h.manager.updateSshHost(ID, { targets: ["hachimi-direct", "hachimi-direct", "hachimi-lan"] });
    expect(result.ok).toBe(true);
    expect(h.file.hosts[0]).toMatchObject({ target: "hachimi-direct", targets: ["hachimi-direct", "hachimi-lan"] });
    expect(ssh.tunnels.at(-1)?.options.targets.map((target: { destination: string }) => target.destination)).toEqual(["hachimi-direct", "hachimi-lan"]);
  });

  describe("a better route's check before traffic moves", () => {
    const verifyOf = async (identity: string | null = "HOST-H") => {
      const h = harness(identity);
      const { tunnel } = await connect(h.manager);
      return { h, verify: tunnel.options.verifyRoute as (port: number, target: string) => Promise<{ code: string } | null>, tunnel };
    };

    it("accepts only the confirmed identity, over the candidate's own port", async () => {
      client.host.mockResolvedValue({ hostId: "HOST-H", platform: "linux" });
      const { verify } = await verifyOf();
      expect(await verify(45001, "hachimi-lan")).toBeNull();
      expect(client.host.mock.calls.at(-1)![0]).toMatchObject({ baseUrl: "http://127.0.0.1:45001", token: "secret" });
      client.host.mockResolvedValue({ hostId: "HOST-OTHER", platform: "linux" });
      expect(await verify(45001, "hachimi-lan")).toMatchObject({ code: "hostMismatch" });
    });

    it("refuses when the token is rejected, the daemon does not answer, or no identity is confirmed", async () => {
      client.host.mockResolvedValue({ hostId: "HOST-H", platform: "linux" });
      const { verify } = await verifyOf();
      const { CutexApiError } = await import("@cutex-desktop/cutex-client");
      client.host.mockRejectedValue(new (CutexApiError as any)(401));
      expect(await verify(45001, "hachimi-lan")).toMatchObject({ code: "tokenRejected" });
      client.host.mockRejectedValue(new Error("no answer"));
      expect(await verify(45001, "hachimi-lan")).toMatchObject({ code: "remoteDaemon" });

      client.host.mockRejectedValue(new Error("never connected"));
      const unconfirmed = await verifyOf(null);
      client.host.mockResolvedValue({ hostId: "HOST-ANY", platform: "linux" });
      expect(await unconfirmed.verify(45001, "hachimi-lan")).toMatchObject({ code: "remoteDaemon" });
    });

    it("moves the streams when the tunnel reports a switch; the endpoint stays", async () => {
      client.host.mockResolvedValue({ hostId: "HOST-H", platform: "linux" });
      const { h, tunnel } = await verifyOf();
      (h.daemon as any).moveStreams = vi.fn();
      tunnel.options.onRouteSwitched();
      expect((h.daemon as any).moveStreams).toHaveBeenCalledTimes(1);
      expect(h.daemon.useEndpoint).toHaveBeenCalledTimes(1);
    });

    it("single-address hosts do not probe", async () => {
      const h = harness();
      h.file.hosts[0]!.targets = ["hachimi-lan"];
      await h.manager.connectHost(ID, true);
      expect(ssh.tunnels.at(-1)!.options.verifyRoute).toBeUndefined();
    });
  });

  it("stores a Unicode address in its xn-- form; a typed Unicode copy of a stored address is no change", async () => {
    const h = harness();
    await h.manager.connectHost(ID, true);
    const saved = await h.manager.updateSshHost(ID, { targets: ["hachimi-lan", "remote-work.例子.test"] });
    expect(saved.ok).toBe(true);
    expect(h.file.hosts[0]!.targets).toEqual(["hachimi-lan", "remote-work.xn--fsqu00a.test"]);
    const tunnels = ssh.tunnels.length;
    await h.manager.updateSshHost(ID, { targets: ["hachimi-lan", "remote-work.xn--fsqu00a.test"] });
    await h.manager.updateSshHost(ID, { targets: ["hachimi-lan", "remote-work.例子.test"] });
    expect(ssh.tunnels.length).toBe(tunnels);
    expect(ssh.tunnels.at(-1)!.options.targets[1].destination).toBe("remote-work.xn--fsqu00a.test");
  });

  it("offline tests reject a wrong identity and continue to the next address", async () => {
    client.host.mockImplementation((endpoint: { baseUrl: string }) => Promise.resolve({ hostId: endpoint.baseUrl.endsWith("41001") ? "HOST-OTHER" : "HOST-H", platform: "linux" }));
    const h = harness();
    const result = await h.manager.testHost(ID);
    expect(result).toMatchObject({ ok: true, hostId: "HOST-H" });
    expect(ssh.temporary).toEqual(["hachimi-lan", "hachimi-direct"]);
  });
});
