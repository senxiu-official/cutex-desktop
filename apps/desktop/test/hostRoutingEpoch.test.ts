// C-011 per host (multi-host P0): every connection gets its routing epoch at once (state "connecting"),
// the endpoint found later is installed only into that connection, and a late discovery of a
// replaced connection (A → B → A) touches nothing. Runs the real HostManager connection code without
// disk / token / tunnel services.
import { describe, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({
  discover: vi.fn()
}));
vi.mock("electron", () => ({
  app: {},
  safeStorage: { isEncryptionAvailable: () => false }
}));
vi.mock("@cutex-desktop/cutex-client/node", () => ({
  discoverLocalDaemon: fake.discover
}));
import { HostManager } from "../src/main/hosts";
import { emptyHostsFile, type HostsState } from "../src/shared/hosts";
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return {
    promise,
    resolve,
    reject
  };
}
interface FakeDaemon {
  hostId: string;
  epoch: string;
  suspend: ReturnType<typeof vi.fn>;
  useEndpoint: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  detachViews: ReturnType<typeof vi.fn>;
  currentState: { kind: string; baseUrl: string };
}
const SSH = "ssh-bbbb2222";
function harness(localAutoConnect = true) {
  const published: HostsState[] = [];
  const daemons: FakeDaemon[] = [];
  const file = emptyHostsFile();
  file.local.autoConnect = localAutoConnect;
  file.hosts.push({ id: SSH, label: "b", target: "b", remotePort: 24270, cutexPath: "cutex", tokenId: null, createdAt: "", lastConnectedAt: null, autoConnect: false, color: "#f97316", platform: null });
  const state = Object.assign(Object.create(HostManager.prototype), {
    file,
    conns: new Map(),
    scope: file.scope,
    local: {},
    tokens: { get: () => null, has: () => false },
    pids: { reapStale() {} },
    createDaemon: (hostId: string, epoch: string) => {
      const daemon: FakeDaemon = { hostId, epoch, suspend: vi.fn(), useEndpoint: vi.fn(), stop: vi.fn(), detachViews: vi.fn(), currentState: { kind: "connecting", baseUrl: "" } };
      daemons.push(daemon);
      return daemon;
    },
    emit: (_name: string, hosts: HostsState) => void published.push(hosts),
    save() {}
  }) as HostManager;
  const epochOf = (hosts: HostsState | undefined, id: string) => hosts?.hosts.find(h => h.id === id)?.conn?.epoch ?? null;
  return {
    state,
    daemons,
    published,
    epochOf
  };
}
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};
describe("HostManager routing epoch per connection", () => {
  it("publishes one stable epoch while discovery is pending and keeps it for the installed endpoint", async () => {
    const discovery = deferred<{
      baseUrl: string;
      token: string;
      configPath: string;
    }>();
    fake.discover.mockReturnValue(discovery.promise);
    const h = harness();
    await h.state.start();
    expect(h.daemons).toHaveLength(1);
    const [local] = h.daemons;
    expect(local!.suspend).toHaveBeenCalledTimes(1);
    expect(h.published).toHaveLength(1);
    expect(h.epochOf(h.published[0], "local")).toBe(local!.epoch);
    expect(local!.useEndpoint).not.toHaveBeenCalled();
    discovery.resolve({
      baseUrl: "fake://new",
      token: "mock-only",
      configPath: "fake"
    });
    await flush();
    expect(local!.useEndpoint).toHaveBeenCalledTimes(1);
    expect(h.epochOf(await h.state.hosts(), "local")).toBe(local!.epoch);
    expect(h.state.connection("local")!.daemon).toBe(local);
  });
  it.each([false, true])("old A discovery cannot replace or suspend A2 after ABA (failure=%s)", async failure => {
    const old = deferred<{
      baseUrl: string;
      token: string;
      configPath: string;
    }>();
    fake.discover.mockReset();
    fake.discover.mockReturnValueOnce(old.promise).mockResolvedValue({
      baseUrl: "fake://current",
      token: "mock-only",
      configPath: "fake"
    });
    // This machine does not auto-connect: leaving it closes its connection, coming back opens a new one.
    const h = harness(false);
    await h.state.start();
    const first = h.daemons[0]!;
    await h.state.switchHost(SSH);
    expect(first.stop).toHaveBeenCalledTimes(1);
    expect(h.state.connection("local")).toBeUndefined();
    await h.state.switchHost("local");
    await flush();
    const current = h.state.connection("local")!;
    expect(current.routingEpoch).not.toBe(first.epoch);
    const second = current.daemon as unknown as FakeDaemon;
    expect(second.useEndpoint).toHaveBeenCalledTimes(1);
    second.suspend.mockClear();
    second.useEndpoint.mockClear();
    if (failure) old.reject(Error("old discovery failed"));else old.resolve({
      baseUrl: "fake://old",
      token: "mock-only",
      configPath: "fake"
    });
    await flush();
    expect(h.state.connection("local")!.routingEpoch).toBe(current.routingEpoch);
    expect(second.suspend).not.toHaveBeenCalled();
    expect(second.useEndpoint).not.toHaveBeenCalled();
    expect(first.useEndpoint).not.toHaveBeenCalled();
    expect(first.suspend).toHaveBeenCalledTimes(1);
  });
  it("a host outside the scope stays connected when it auto-connects; leaving the focus detaches its views", async () => {
    fake.discover.mockReset();
    fake.discover.mockResolvedValue({ baseUrl: "fake://local", token: "mock-only", configPath: "fake" });
    const h = harness(true);
    await h.state.start();
    const local = h.daemons[0]!;
    await h.state.switchHost(SSH);
    const state = await h.state.hosts();
    expect(state.active).toBe(SSH);
    expect(state.scope).toEqual({ kind: "host", id: SSH });
    expect(h.epochOf(state, "local")).toBe(local.epoch);
    expect(h.epochOf(state, SSH)).not.toBeNull();
    expect(local.stop).not.toHaveBeenCalled();
    expect(local.detachViews).toHaveBeenCalledTimes(1);
    // Back to this machine: the same connection (no new epoch); the SSH host (no auto-connect) closes.
    await h.state.switchHost("local");
    const back = await h.state.hosts();
    expect(h.epochOf(back, "local")).toBe(local.epoch);
    expect(h.epochOf(back, SSH)).toBeNull();
    expect(h.daemons.find(d => d.hostId === SSH)!.stop).toHaveBeenCalledTimes(1);
  });
});
