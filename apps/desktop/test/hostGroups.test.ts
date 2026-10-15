// Multi-host P2: host groups — shared validation / hosts.json round trip, main HostManager
// saveHostGroups (scope fallback, connections), renderer edits (lib/hostGroups) and the switcher /
// Settings helpers.
import { describe, expect, it, vi } from "vitest";
vi.mock("electron", () => ({ app: {}, safeStorage: { isEncryptionAvailable: () => false } }));
vi.mock("@cutex-desktop/cutex-client/node", () => ({ discoverLocalDaemon: () => new Promise(() => {}) }));
import { HostManager } from "../src/main/hosts";
import { emptyHostsFile, groupsOfHost, normalizeHostGroups, parseHostsFile, switcherGroups, type HostGroup, type HostsFile, type HostsState, type HostView, type ViewScope } from "../src/shared/hosts";
import { HOST_METHOD_NAMES } from "../src/shared/ipc";
import { applyGroupEdit, checkGroupDrafts, freeGroupName } from "../src/renderer/src/lib/hostGroups";
import { resolveHostScope, scopeKey } from "../src/renderer/src/lib/hostScope";

const WORKSTATION = "ssh-aaaa1111";
const ALPHA = "ssh-bbbb2222";
const known = (id: string) => ["local", WORKSTATION, ALPHA].includes(id);
let n = 0;
const newId = () => `grp-test${String(++n).padStart(4, "0")}`;

describe("normalizeHostGroups (shared, main + renderer)", () => {
  it("trims names, keeps ids, assigns new ones, drops duplicate members, lower-cases colors", () => {
    const r = normalizeHostGroups(
      [
        { id: "grp-work0001", name: " 工作 ", hosts: ["local", WORKSTATION, "local"], color: "#F97316" },
        { name: "Linux", hosts: [WORKSTATION] },
        { name: "空", hosts: [], color: null },
      ],
      known,
      // A generator that repeats itself: drafts still never share an id.
      (() => {
        const ids = ["grp-fresh001", "grp-fresh001", "grp-fresh002"];
        return () => ids.shift()!;
      })(),
    );
    expect(r).toEqual({
      ok: true,
      groups: [
        { id: "grp-work0001", name: "工作", hosts: ["local", WORKSTATION], color: "#f97316" },
        { id: "grp-fresh001", name: "Linux", hosts: [WORKSTATION] },
        { id: "grp-fresh002", name: "空", hosts: [] },
      ],
    });
  });

  it("refuses empty / long names, duplicate names (case-insensitive), unknown hosts, bad colors, bad / duplicate ids", () => {
    const err = (drafts: unknown) => {
      const r = normalizeHostGroups(drafts, known, newId);
      return r.ok ? null : [r.error, r.index];
    };
    expect(err([{ name: "  ", hosts: [] }])).toEqual(["name", 0]);
    expect(err([{ name: "x".repeat(65), hosts: [] }])).toEqual(["name", 0]);
    expect(err([{ name: "Work", hosts: [] }, { name: " work ", hosts: [] }])).toEqual(["duplicateName", 1]);
    expect(err([{ name: "A", hosts: ["ssh-gone0000"] }])).toEqual(["unknownHost", 0]);
    expect(err([{ name: "A", hosts: "local" }])).toEqual(["unknownHost", 0]);
    expect(err([{ name: "A", hosts: [], color: "red" }])).toEqual(["badColor", 0]);
    expect(err([{ id: "nope", name: "A", hosts: [] }])).toEqual(["badId", 0]);
    expect(err([{ id: "grp-same0001", name: "A", hosts: [] }, { id: "grp-same0001", name: "B", hosts: [] }])).toEqual(["badId", 1]);
    expect(err(Array.from({ length: 51 }, (_, i) => ({ name: `g${i}`, hosts: [] })))).toEqual(["tooMany", 50]);
    expect(err("x")).toEqual(["name", -1]);
  });
});

describe("hosts.json groups round trip", () => {
  it("saves and reads groups (color, order, members); duplicate names / unknown members dropped", () => {
    const file = emptyHostsFile();
    file.hosts.push({ id: WORKSTATION, label: "workstation", target: "workstation", remotePort: 24270, cutexPath: "cutex", tokenId: null, createdAt: "", lastConnectedAt: null, autoConnect: true, color: "#f97316", platform: "linux" });
    file.groups = [
      { id: "grp-work0001", name: "工作", hosts: ["local", WORKSTATION], color: "#14b8a6" },
      { id: "grp-lin00001", name: "Linux", hosts: [WORKSTATION] },
    ];
    file.scope = { kind: "group", id: "grp-work0001" };
    const read = parseHostsFile(JSON.parse(JSON.stringify(file)));
    expect(read.groups).toEqual(file.groups);
    expect(read.scope).toEqual(file.scope);
    const messy = parseHostsFile({
      ...JSON.parse(JSON.stringify(file)),
      groups: [
        { id: "grp-work0001", name: "工作", hosts: ["local", "ssh-gone0000", "dev-two"], color: "teal" },
        { id: "grp-dupe0001", name: " 工作 ", hosts: [] },
      ],
    });
    // DEV ONLY dev-… members are kept (dev hosts are not in hosts.json); a bad color is dropped.
    expect(messy.groups).toEqual([{ id: "grp-work0001", name: "工作", hosts: ["local", "dev-two"] }]);
  });
});

describe("HostManager.saveHostGroups (main)", () => {
  function harness(scope: ViewScope, groups: HostGroup[] = []) {
    const file = emptyHostsFile();
    file.hosts.push({ id: WORKSTATION, label: "workstation", target: "workstation", remotePort: 24270, cutexPath: "cutex", tokenId: null, createdAt: "", lastConnectedAt: null, autoConnect: false, color: "#f97316", platform: "linux" });
    file.hosts.push({ id: ALPHA, label: "alpha", target: "alpha", remotePort: 24270, cutexPath: "cutex", tokenId: null, createdAt: "", lastConnectedAt: null, autoConnect: false, color: "#a855f7", platform: null });
    file.local = { ...file.local, autoConnect: false };
    file.groups = groups;
    file.scope = scope;
    const saved: HostsFile[] = [];
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
      save(this: { file: HostsFile }) {
        saved.push(JSON.parse(JSON.stringify(this.file)));
      },
    }) as HostManager;
    const connected = () => published.at(-1)!.hosts.filter((h) => h.conn?.epoch).map((h) => h.id);
    return { manager, saved, published, connected, file: () => (manager as unknown as { file: HostsFile }).file };
  }

  it("creates groups (ids assigned), saves hosts.json and publishes; then the group can be the scope", async () => {
    const { manager, saved, published, file } = harness({ kind: "host", id: "local" });
    const next = await manager.saveHostGroups([{ name: "工作", hosts: ["local", WORKSTATION], color: "#14b8a6" }]);
    expect(next.groups).toHaveLength(1);
    expect(next.groups[0]).toMatchObject({ name: "工作", hosts: ["local", WORKSTATION], color: "#14b8a6" });
    expect(next.groups[0]!.id).toMatch(/^grp-[a-z0-9]{10}$/);
    expect(saved.at(-1)!.groups).toEqual(next.groups);
    expect(published.at(-1)!.groups).toEqual(next.groups);
    await manager.setScope({ kind: "group", id: next.groups[0]!.id });
    expect(file().scope).toEqual({ kind: "group", id: next.groups[0]!.id });
    // The group's hosts get connected; the focus host is its first member.
    expect(published.at(-1)!.active).toBe("local");
    expect(published.at(-1)!.hosts.filter((h) => h.conn?.epoch).map((h) => h.id)).toEqual(["local", WORKSTATION]);
  });

  it("refuses an invalid list and changes nothing", async () => {
    const groups = [{ id: "grp-work0001", name: "工作", hosts: ["local"] }];
    const { manager, saved, file } = harness({ kind: "host", id: "local" }, groups);
    await expect(manager.saveHostGroups([{ name: "a", hosts: [] }, { name: "A", hosts: [] }])).rejects.toThrow("bad groups: duplicateName");
    await expect(manager.saveHostGroups([{ name: "a", hosts: ["ssh-gone0000"] }])).rejects.toThrow("bad groups: unknownHost");
    expect(file().groups).toEqual(groups);
    expect(saved).toHaveLength(0);
  });

  it("membership edits of the scope's group connect new members and close those that left (no auto-connect)", async () => {
    const group = { id: "grp-work0001", name: "工作", hosts: ["local", WORKSTATION] };
    const { manager, connected } = harness({ kind: "group", id: group.id }, [group]);
    await manager.setScope({ kind: "group", id: group.id });
    expect(connected()).toEqual(["local", WORKSTATION]);
    await manager.saveHostGroups([{ ...group, hosts: ["local", ALPHA] }]);
    expect(connected()).toEqual(["local", ALPHA]);
    // A new first member becomes the focus host.
    const state = await manager.saveHostGroups([{ ...group, hosts: [ALPHA, "local"] }]);
    expect(state.active).toBe(ALPHA);
  });

  it("★ Q20: deleting the scope's group, or removing its last member, falls back to all devices", async () => {
    const group = { id: "grp-work0001", name: "工作", hosts: [WORKSTATION] };
    const a = harness({ kind: "group", id: group.id }, [group]);
    expect((await a.manager.saveHostGroups([])).scope).toEqual({ kind: "all" });
    expect(a.file().scope).toEqual({ kind: "all" });
    const b = harness({ kind: "group", id: group.id }, [group]);
    expect((await b.manager.saveHostGroups([{ ...group, hosts: [] }])).scope).toEqual({ kind: "all" });
    // The empty group itself is kept (RFC §11), only hidden from the switcher.
    expect(b.file().groups).toEqual([{ id: group.id, name: "工作", hosts: [] }]);
    // Another scope is untouched.
    const c = harness({ kind: "host", id: WORKSTATION }, [group]);
    expect((await c.manager.saveHostGroups([])).scope).toEqual({ kind: "host", id: WORKSTATION });
  });

  it("removing a host drops it from every group; a group scope left empty falls back", async () => {
    const groups = [
      { id: "grp-work0001", name: "工作", hosts: [WORKSTATION] },
      { id: "grp-both0001", name: "both", hosts: ["local", WORKSTATION] },
    ];
    const { manager, file } = harness({ kind: "group", id: "grp-work0001" }, groups);
    await manager.removeSshHost(WORKSTATION);
    expect(file().groups.map((g) => g.hosts)).toEqual([[], ["local"]]);
    expect(file().scope).toEqual({ kind: "all" });
    const kept = harness({ kind: "group", id: "grp-both0001" }, groups);
    await kept.manager.removeSshHost(WORKSTATION);
    expect(kept.file().scope).toEqual({ kind: "group", id: "grp-both0001" });
  });

  it("is a main HostApi method (not routed to a daemon)", () => {
    expect(HOST_METHOD_NAMES).toContain("saveHostGroups");
  });
});

describe("group edits (renderer lib/hostGroups)", () => {
  const order = ["local", WORKSTATION, ALPHA];
  const groups: HostGroup[] = [
    { id: "grp-work0001", name: "工作", hosts: ["local", WORKSTATION] },
    { id: "grp-lin00001", name: "Linux", hosts: [WORKSTATION], color: "#f97316" },
  ];

  it("create / rename / recolor / toggle (host order kept) / move / delete", () => {
    expect(applyGroupEdit(groups, { kind: "create", name: "Mac", hosts: [ALPHA, "local"], color: null }, order).at(-1)).toEqual({ name: "Mac", hosts: ["local", ALPHA], color: null });
    expect(applyGroupEdit(groups, { kind: "rename", id: "grp-lin00001", name: "Penguins" }, order)[1]!.name).toBe("Penguins");
    expect(applyGroupEdit(groups, { kind: "recolor", id: "grp-lin00001", color: null }, order)[1]!.color).toBeNull();
    expect(applyGroupEdit(groups, { kind: "toggleMember", id: "grp-lin00001", hostId: "local" }, order)[1]!.hosts).toEqual(["local", WORKSTATION]);
    expect(applyGroupEdit(groups, { kind: "toggleMember", id: "grp-work0001", hostId: "local" }, order)[0]!.hosts).toEqual([WORKSTATION]);
    expect(applyGroupEdit(groups, { kind: "move", id: "grp-lin00001", delta: -1 }, order).map((g) => g.id)).toEqual(["grp-lin00001", "grp-work0001"]);
    expect(applyGroupEdit(groups, { kind: "move", id: "grp-work0001", delta: -1 }, order).map((g) => g.id)).toEqual(["grp-work0001", "grp-lin00001"]);
    expect(applyGroupEdit(groups, { kind: "delete", id: "grp-work0001" }, order).map((g) => g.id)).toEqual(["grp-lin00001"]);
    // The input list is never mutated.
    expect(groups[0]!.hosts).toEqual(["local", WORKSTATION]);
  });

  it("checks drafts like main (inline errors before sending)", () => {
    expect(checkGroupDrafts(applyGroupEdit(groups, { kind: "rename", id: "grp-lin00001", name: "工作" }, order), order)).toEqual({ ok: false, error: "duplicateName", index: 1 });
    expect(checkGroupDrafts(applyGroupEdit(groups, { kind: "create", name: "New", hosts: [], color: null }, order), order)).toEqual({ ok: true });
  });

  it("a free default name", () => {
    expect(freeGroupName(groups, "新分组")).toBe("新分组");
    expect(freeGroupName([...groups, { id: "grp-x0000001", name: "新分组", hosts: [] }, { id: "grp-x0000002", name: "新分组 2", hosts: [] }], "新分组")).toBe("新分组 3");
  });
});

describe("switcher / settings helpers with groups", () => {
  const view = (id: string): HostView => ({ id, kind: id === "local" ? "local" : "ssh", label: id, target: null, remotePort: null, cutexPath: null, paired: true, lastConnectedAt: null, autoConnect: true, color: "#64748b", platform: null, conn: { epoch: `e-${id}`, tunnel: null, daemon: { kind: "connected", baseUrl: "mock://", hostId: id }, cutexBuild: null } });
  const groups: HostGroup[] = [
    { id: "grp-work0001", name: "工作", hosts: ["local", WORKSTATION] },
    { id: "grp-empty001", name: "空", hosts: [] },
    { id: "grp-gone0001", name: "gone", hosts: ["ssh-gone0000"] },
  ];
  const st = (scope: ViewScope): HostsState => ({ scope, active: "local", startOn: "last", hosts: [view("local"), view(WORKSTATION), view(ALPHA)], groups, tunnel: null, weakSecretStorage: false });

  it("the switcher offers only groups with a known member", () => {
    expect(switcherGroups(st({ kind: "all" })).map((g) => g.id)).toEqual(["grp-work0001"]);
    expect(switcherGroups(null)).toEqual([]);
  });

  it("host cards list the groups a host is in", () => {
    expect(groupsOfHost(groups, WORKSTATION).map((g) => g.name)).toEqual(["工作"]);
    expect(groupsOfHost(groups, ALPHA)).toEqual([]);
  });

  it("a group scope: its members in scope, marks shown, scope key group:<id>", () => {
    const scope = resolveHostScope({ hosts: st({ kind: "group", id: "grp-work0001" }), daemon: { kind: "connected", baseUrl: "mock://", hostId: "local" }, byHost: {} });
    expect(scope.ids).toEqual(["local", WORKSTATION]);
    expect(scope.isInScope(ALPHA)).toBe(false);
    expect(scope.multi).toBe(true);
    expect(scope.showHostMarks).toBe(true);
    expect(scope.key).toBe("group:grp-work0001");
    expect(scopeKey(scope.scope)).toBe("group:grp-work0001");
    // A one-member group is not "multi" (no marks unless the single-host pref).
    const one = resolveHostScope({ hosts: { ...st({ kind: "group", id: "grp-work0001" }), groups: [{ id: "grp-work0001", name: "w", hosts: [WORKSTATION] }] }, daemon: { kind: "connected", baseUrl: "mock://", hostId: "local" }, byHost: {} });
    expect(one.ids).toEqual([WORKSTATION]);
  });
});
