// Multi-host P1 step 1: the view scope model (renderer lib/hostScope), its rules in shared/hosts
// (persistence, Q20 fallback) and in main HostManager (setScope / remove / appearance).
import { describe, expect, it, vi } from "vitest";
vi.mock("electron", () => ({ app: {}, safeStorage: { isEncryptionAvailable: () => false } }));
vi.mock("@cutex-desktop/cutex-client/node", () => ({ discoverLocalDaemon: () => new Promise(() => {}) }));
import { HostManager } from "../src/main/hosts";
import { emptyHostsFile, HOST_PALETTE, isHostColor, parseHostsFile, sameScope, scopeAfterRemoval, type HostsFile, type HostsState, type HostView, type ViewScope } from "../src/shared/hosts";
import type { DaemonState } from "../src/shared/ipc";
import { hostData, hostVersion, mergeHostLists, resolveHostScope, scopedHostData, scopeKey, scopeTitle, sumHosts, versionOutliers, type HostDataSource } from "../src/renderer/src/lib/hostScope";
import { connIndicator } from "../src/renderer/src/lib/hosts";

const online = (hostId: string): DaemonState => ({ kind: "connected", baseUrl: "mock://", hostId });
const build = (release: string | null, commit = "5f30a7cad4dcd8435e797592a380349df509e35d") => ({ version: "0.1.0", release, commit, builtAt: null, profile: "release", channel: "main" }) as never;
const WORKSTATION = "ssh-aaaa1111";
const ALPHA = "ssh-bbbb2222";

function state(scope: ViewScope, active = "local"): HostsState {
  const hosts: HostView[] = [
    { id: "local", kind: "local", label: "HOST-A", target: null, remotePort: null, cutexPath: null, paired: true, lastConnectedAt: null, autoConnect: true, color: HOST_PALETTE[0], platform: "windows", conn: { epoch: "e-local", tunnel: null, daemon: online("HOST-A"), cutexBuild: build("r224") } },
    { id: WORKSTATION, kind: "ssh", label: "workstation", target: "workstation", remotePort: 24270, cutexPath: "cutex", paired: true, lastConnectedAt: null, autoConnect: false, color: "#f97316", platform: "linux", conn: { epoch: "e-t", tunnel: { status: "up", localPort: 1, error: null, attempt: 0, retryAt: null, upSince: 1 }, daemon: online("WORKSTATION"), cutexBuild: build("r217") } },
    { id: ALPHA, kind: "ssh", label: "alpha", target: "alpha", remotePort: 24270, cutexPath: "cutex", paired: true, lastConnectedAt: null, autoConnect: true, color: "#a855f7", platform: "macos" },
  ];
  return { scope, active, startOn: "last", hosts, groups: [{ id: "grp-work", name: "work", hosts: ["local", WORKSTATION] }], tunnel: null, weakSecretStorage: false };
}

const source = (hosts: HostsState, extra: Partial<HostDataSource> = {}): HostDataSource => ({
  hosts,
  daemon: online("HOST-A"),
  features: new Set(["a"]),
  featuresKnown: true,
  sidebar: null,
  approvals: [{ approvalId: "x" } as never],
  services: null,
  byHost: { [WORKSTATION]: { daemon: online("WORKSTATION"), features: new Set(["b"]), featuresKnown: true, sidebar: null, approvals: [{ approvalId: "x" } as never, { approvalId: "y" } as never], services: null } },
  ...extra,
});

describe("scope helpers (shared/hosts)", () => {
  it("compares scopes and keys them per kind (Q17 layout keys)", () => {
    expect(sameScope({ kind: "all" }, { kind: "all" })).toBe(true);
    expect(sameScope({ kind: "host", id: "a" }, { kind: "host", id: "a" })).toBe(true);
    expect(sameScope({ kind: "host", id: "a" }, { kind: "group", id: "a" })).toBe(false);
    expect(sameScope({ kind: "host", id: "a" }, null)).toBe(false);
    expect(scopeKey({ kind: "all" })).toBe("all");
    expect(scopeKey({ kind: "host", id: WORKSTATION })).toBe(`host:${WORKSTATION}`);
    expect(scopeKey({ kind: "group", id: "grp-work" })).toBe("group:grp-work");
  });

  it("Q20: a removed scope host falls back to all devices (this machine when it is the only one left)", () => {
    const groups = [{ id: "grp-work", name: "w", hosts: [WORKSTATION] }];
    expect(scopeAfterRemoval({ kind: "host", id: WORKSTATION }, { hosts: [ALPHA], groups })).toEqual({ kind: "all" });
    expect(scopeAfterRemoval({ kind: "host", id: WORKSTATION }, { hosts: [], groups })).toEqual({ kind: "host", id: "local" });
    const kept: ViewScope = { kind: "host", id: ALPHA };
    expect(scopeAfterRemoval(kept, { hosts: [ALPHA], groups })).toBe(kept);
    const local: ViewScope = { kind: "host", id: "local" };
    expect(scopeAfterRemoval(local, { hosts: [], groups })).toBe(local);
    const all: ViewScope = { kind: "all" };
    expect(scopeAfterRemoval(all, { hosts: [], groups })).toBe(all);
  });

  it("a group scope survives while a member is left, else falls back (RFC §11)", () => {
    const group: ViewScope = { kind: "group", id: "grp-work" };
    expect(scopeAfterRemoval(group, { hosts: [WORKSTATION, ALPHA], groups: [{ id: "grp-work", name: "w", hosts: [WORKSTATION] }] })).toBe(group);
    expect(scopeAfterRemoval(group, { hosts: [ALPHA], groups: [{ id: "grp-work", name: "w", hosts: [] }] })).toEqual({ kind: "all" });
    expect(scopeAfterRemoval(group, { hosts: [ALPHA], groups: [] })).toEqual({ kind: "all" });
  });

  it("persists the scope in hosts.json (all devices survives a save / load)", () => {
    const file = emptyHostsFile();
    file.hosts.push({ id: WORKSTATION, label: "workstation", target: "workstation", remotePort: 24270, cutexPath: "cutex", tokenId: null, createdAt: "", lastConnectedAt: null, autoConnect: true, color: "#f97316", platform: "linux" });
    for (const scope of [{ kind: "all" }, { kind: "host", id: WORKSTATION }] as ViewScope[]) {
      const read = parseHostsFile(JSON.parse(JSON.stringify({ ...file, scope })));
      expect(read.scope).toEqual(scope);
    }
    // A scope naming an unknown host is not trusted: this machine.
    expect(parseHostsFile(JSON.parse(JSON.stringify({ ...file, scope: { kind: "host", id: "ssh-gone0000" } }))).scope).toEqual({ kind: "host", id: "local" });
  });

  it("accepts #rrggbb host colors only", () => {
    expect(isHostColor("#A855F7")).toBe(true);
    for (const bad of ["red", "#fff", "#12345g", "", null, "url(x)"]) expect(isHostColor(bad)).toBe(false);
  });
});

describe("resolveHostScope (lib/hostScope)", () => {
  it("all devices: every host is in scope, marks shown, focus kept", () => {
    const scope = resolveHostScope(source(state({ kind: "all" })));
    expect(scope.ids).toEqual(["local", WORKSTATION, ALPHA]);
    expect(scope.multi).toBe(true);
    expect(scope.showHostMarks).toBe(true);
    expect(scope.focus).toBe("local");
    expect(scope.key).toBe("all");
    expect(scope.isInScope(ALPHA)).toBe(true);
  });

  it("one host: no marks unless the 单主机也显示 pref (★ Q7)", () => {
    const s = source(state({ kind: "host", id: WORKSTATION }, WORKSTATION), { byHost: { local: { daemon: online("HOST-A"), features: new Set(), featuresKnown: true, sidebar: null, approvals: null, services: null } } });
    const scope = resolveHostScope(s);
    expect(scope.ids).toEqual([WORKSTATION]);
    expect(scope.multi).toBe(false);
    expect(scope.showHostMarks).toBe(false);
    expect(scope.isInScope("local")).toBe(false);
    expect(resolveHostScope(s, true).showHostMarks).toBe(true);
  });

  it("a group scope resolves its members (P2-ready)", () => {
    const scope = resolveHostScope(source(state({ kind: "group", id: "grp-work" })));
    expect(scope.ids).toEqual(["local", WORKSTATION]);
    expect(scope.multi).toBe(true);
  });

  it("host looks: color, platform, version, live status; no connection = disconnected", () => {
    const s = source(state({ kind: "all" }), { daemon: { kind: "connecting", baseUrl: "" } });
    const scope = resolveHostScope(s);
    const local = scope.host("local")!;
    expect(local).toMatchObject({ label: "HOST-A", local: true, color: HOST_PALETTE[0], platform: "windows", focus: true, connected: true, version: "r224" });
    // The focus host's live daemon state comes from the store, not the (older) host notification.
    expect(local.indicator.status).toBe("connecting");
    expect(scope.host(WORKSTATION)).toMatchObject({ connected: true, version: "r217", focus: false, platform: "linux" });
    expect(scope.host(WORKSTATION)!.indicator.status).toBe("online");
    expect(scope.host(ALPHA)).toMatchObject({ connected: false, version: null, platform: "macos" });
    expect(scope.host(ALPHA)!.indicator.status).toBe("disconnected");
    expect(scope.host("ssh-nope0000")).toBeNull();
  });

  it("a slice's daemon state wins over the host notification for other hosts", () => {
    const s = source(state({ kind: "all" }));
    s.byHost[WORKSTATION]!.daemon = { kind: "unreachable", baseUrl: "", message: "down" };
    expect(resolveHostScope(s).host(WORKSTATION)!.indicator.status).toBe("offline");
  });

  it("button title: host label, group name, 所有设备", () => {
    const st = state({ kind: "all" });
    expect(scopeTitle({ kind: "all" }, st, { all: "所有设备" })).toBe("所有设备");
    expect(scopeTitle({ kind: "host", id: WORKSTATION }, st, { all: "" })).toBe("workstation");
    expect(scopeTitle({ kind: "group", id: "grp-work" }, st, { all: "" })).toBe("work");
  });
});

describe("versions", () => {
  it("short tag: release, else short commit", () => {
    expect(hostVersion(build("r224"))).toBe("r224");
    expect(hostVersion(build(null))).toBe("5f30a7c");
    expect(hostVersion(null)).toBeNull();
  });

  it("outliers: hosts whose version differs from the scope's majority (ties mark all)", () => {
    const looks = resolveHostScope(source(state({ kind: "all" }))).hosts;
    expect([...versionOutliers(looks)].sort()).toEqual(["local", WORKSTATION].sort());
    const three = [...looks, { ...looks[0]!, id: "x", version: "r224" }];
    expect([...versionOutliers(three)]).toEqual([WORKSTATION]);
    expect(versionOutliers(looks.filter((h) => h.id === "local")).size).toBe(0);
  });

  it("connIndicator: no connection is its own state", () => {
    expect(connIndicator("ssh", null, online("x"), false).status).toBe("disconnected");
    expect(connIndicator("local", null, online("x")).status).toBe("online");
  });
});

describe("per-host data + merge helpers", () => {
  it("hostData: the focus host from the top-level fields, others from byHost, unknown = null", () => {
    const s = source(state({ kind: "all" }));
    expect(hostData(s, "local")).toMatchObject({ hostId: "local", focus: true, features: new Set(["a"]) });
    expect(hostData(s, WORKSTATION)).toMatchObject({ hostId: WORKSTATION, focus: false, features: new Set(["b"]) });
    expect(hostData(s, ALPHA)).toBeNull();
  });

  it("scopedHostData: the scope's connected hosts in switcher order", () => {
    expect(scopedHostData(source(state({ kind: "all" }))).map((d) => d.hostId)).toEqual(["local", WORKSTATION]);
    expect(scopedHostData(source(state({ kind: "host", id: "local" }))).map((d) => d.hostId)).toEqual(["local"]);
    expect(scopedHostData(source(state({ kind: "host", id: "local" })), [WORKSTATION, "local"]).map((d) => d.hostId)).toEqual(["local", WORKSTATION]);
  });

  it("mergeHostLists: the same id on two hosts stays two items with distinct keys", () => {
    const data = scopedHostData(source(state({ kind: "all" })));
    const merged = mergeHostLists(
      data.map((d) => ({ hostId: d.hostId, items: d.approvals })),
      (a) => a.approvalId,
    );
    expect(merged.map((m) => [m.hostId, m.item.approvalId])).toEqual([["local", "x"], [WORKSTATION, "x"], [WORKSTATION, "y"]]);
    expect(new Set(merged.map((m) => m.key)).size).toBe(3);
    expect(merged[0]!.key).toBe(JSON.stringify(["local", "x"]));
  });

  it("mergeHostLists: stable sort across hosts; null lists are skipped", () => {
    const merged = mergeHostLists(
      [
        { hostId: "a", items: [{ id: "1", t: 3 }, { id: "2", t: 1 }] },
        { hostId: "b", items: null },
        { hostId: "c", items: [{ id: "1", t: 1 }] },
      ],
      (x) => x.id,
      (x, y) => x.item.t - y.item.t,
    );
    expect(merged.map((m) => `${m.hostId}/${m.item.id}`)).toEqual(["a/2", "c/1", "a/1"]);
  });

  it("sumHosts adds per-host counts", () => {
    const data = scopedHostData(source(state({ kind: "all" })));
    expect(sumHosts(data, (d) => d.approvals?.length ?? 0)).toBe(3);
  });
});

describe("HostManager scope rules (main)", () => {
  function harness(scope: ViewScope) {
    const file = emptyHostsFile();
    file.hosts.push({ id: WORKSTATION, label: "workstation", target: "workstation", remotePort: 24270, cutexPath: "cutex", tokenId: null, createdAt: "", lastConnectedAt: null, autoConnect: false, color: "#f97316", platform: "linux" });
    file.hosts.push({ id: ALPHA, label: "alpha", target: "alpha", remotePort: 24270, cutexPath: "cutex", tokenId: null, createdAt: "", lastConnectedAt: null, autoConnect: false, color: "#a855f7", platform: null });
    file.scope = scope;
    const saved: unknown[] = [];
    const published: HostsState[] = [];
    const manager = Object.assign(Object.create(HostManager.prototype), {
      file,
      conns: new Map(),
      scope,
      local: {},
      tokens: { get: () => null, has: () => false, delete() {} },
      pids: { reapStale() {} },
      createDaemon: () => ({ suspend: vi.fn(), useEndpoint: vi.fn(), stop: vi.fn(), detachViews: vi.fn(), currentState: { kind: "connecting", baseUrl: "" } }),
      emit: (_: string, s: HostsState) => void published.push(s),
      save(this: { file: unknown }) {
        saved.push(JSON.parse(JSON.stringify(this.file)));
      },
    }) as HostManager;
    return { manager, saved, published };
  }

  it("setScope(all) is saved to hosts.json and published", async () => {
    const { manager, saved, published } = harness({ kind: "host", id: "local" });
    await manager.setScope({ kind: "all" });
    expect((manager as unknown as { file: HostsFile }).file.scope).toEqual({ kind: "all" });
    expect((saved.at(-1) as { scope: ViewScope }).scope).toEqual({ kind: "all" });
    expect(published.at(-1)!.scope).toEqual({ kind: "all" });
    // All devices: every host is connected (scope hosts connect; RFC §3.1).
    expect(published.at(-1)!.hosts.filter((h) => h.conn?.epoch).map((h) => h.id)).toEqual(["local", WORKSTATION, ALPHA]);
    await expect(manager.setScope({ kind: "group", id: "grp-none" })).rejects.toThrow("unknown scope");
  });

  it("Q20: removing the scope host falls back to all devices", async () => {
    const { manager, published } = harness({ kind: "host", id: WORKSTATION });
    await manager.removeSshHost(WORKSTATION);
    expect((manager as unknown as { file: HostsFile }).file.scope).toEqual({ kind: "all" });
    expect(published.at(-1)!.scope).toEqual({ kind: "all" });
    expect(published.at(-1)!.hosts.map((h) => h.id)).toEqual(["local", ALPHA]);
  });

  it("removing another host keeps the scope", async () => {
    const { manager } = harness({ kind: "host", id: ALPHA });
    await manager.removeSshHost(WORKSTATION);
    expect((manager as unknown as { file: HostsFile }).file.scope).toEqual({ kind: "host", id: ALPHA });
  });

  it("setHostAppearance stores a valid color (lower case) and refuses others", async () => {
    const { manager, saved } = harness({ kind: "host", id: "local" });
    const next = await manager.setHostAppearance(WORKSTATION, { color: "#14B8A6" });
    expect(next.hosts.find((h) => h.id === WORKSTATION)!.color).toBe("#14b8a6");
    expect((saved.at(-1) as { hosts: { color: string }[] }).hosts[0]!.color).toBe("#14b8a6");
    await manager.setHostAppearance("local", { color: "#123456" });
    expect((manager as unknown as { file: HostsFile }).file.local.color).toBe("#123456");
    await expect(manager.setHostAppearance(WORKSTATION, { color: "red" })).rejects.toThrow("bad color");
    await expect(manager.setHostAppearance("ssh-nope0000", { color: "#123456" })).rejects.toThrow("unknown host");
  });
});
