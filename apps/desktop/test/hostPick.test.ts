// Multi-host P1 step 2c: the host choice of create forms and host settings pages (renderer lib/hostPick).
import { describe, expect, it } from "vitest";
import { HOST_PALETTE, type HostsState, type HostView, type ViewScope } from "../src/shared/hosts";
import type { DaemonState } from "../src/shared/ipc";
import { canTargetHost, defaultCreateHost, hostPickerMode, keepTargetHost } from "../src/renderer/src/lib/hostPick";
import { resolveHostScope, type HostScope } from "../src/renderer/src/lib/hostScope";

const online = (hostId: string): DaemonState => ({ kind: "connected", baseUrl: "mock://", hostId });
const WORKSTATION = "ssh-aaaa1111";
const ALPHA = "ssh-bbbb2222";
const up = { status: "up" as const, localPort: 1, error: null, attempt: 0, retryAt: null, upSince: 1 };

/** HOST-A (local) online; workstation online when `workstation`; alpha connecting forever (retrying tunnel). */
function scopeOf(scope: ViewScope, opts: { workstation?: boolean; marks?: boolean; groups?: HostsState["groups"]; active?: string } = {}): HostScope {
  const workstation = opts.workstation ?? true;
  const hosts: HostView[] = [
    { id: "local", kind: "local", label: "HOST-A", target: null, remotePort: null, cutexPath: null, paired: true, lastConnectedAt: null, autoConnect: true, color: HOST_PALETTE[0], platform: "windows", conn: { epoch: "e-local", tunnel: null, daemon: online("HOST-A"), cutexBuild: null } },
    { id: WORKSTATION, kind: "ssh", label: "workstation", target: "workstation", remotePort: 24270, cutexPath: "cutex", paired: true, lastConnectedAt: null, autoConnect: false, color: HOST_PALETTE[1], platform: "linux", ...(workstation ? { conn: { epoch: "e-t", tunnel: up, daemon: online("WORKSTATION"), cutexBuild: null } } : {}) },
    { id: ALPHA, kind: "ssh", label: "alpha", target: "alpha", remotePort: 24270, cutexPath: "cutex", paired: true, lastConnectedAt: null, autoConnect: true, color: HOST_PALETTE[2], platform: "macos", conn: { epoch: "e-a", tunnel: { ...up, status: "retrying", retryAt: 9 }, daemon: { kind: "unreachable", baseUrl: "", message: "timeout" }, cutexBuild: null } },
  ];
  const state: HostsState = { scope, active: opts.active ?? (scope.kind === "host" ? scope.id : "local"), startOn: "last", hosts, groups: opts.groups ?? [], tunnel: null, weakSecretStorage: false };
  const byHost: Record<string, { daemon: DaemonState }> = workstation && state.active !== WORKSTATION ? { [WORKSTATION]: { daemon: online("WORKSTATION") } } : {};
  return resolveHostScope({ hosts: state, daemon: online(state.active), byHost }, opts.marks ?? false);
}

const none = { selectedHost: null, lastUsed: null };

describe("create host default (★ RFC Q10)", () => {
  it("a one-host scope creates on that host", () => {
    expect(defaultCreateHost(scopeOf({ kind: "host", id: WORKSTATION }), { selectedHost: "local", lastUsed: "local" })).toBe(WORKSTATION);
    expect(defaultCreateHost(scopeOf({ kind: "host", id: "local" }), { selectedHost: WORKSTATION, lastUsed: WORKSTATION })).toBe("local");
  });

  it("all devices: the selected agent's host, then the last used host, then this machine", () => {
    const all = scopeOf({ kind: "all" });
    expect(defaultCreateHost(all, { selectedHost: WORKSTATION, lastUsed: "local" })).toBe(WORKSTATION);
    expect(defaultCreateHost(all, { selectedHost: null, lastUsed: WORKSTATION })).toBe(WORKSTATION);
    expect(defaultCreateHost(all, none)).toBe("local");
  });

  it("「本机」 mode: this machine first, then the selected / last host when this machine is unusable", () => {
    const all = scopeOf({ kind: "all" });
    expect(defaultCreateHost(all, { selectedHost: WORKSTATION, lastUsed: WORKSTATION, mode: "local" })).toBe("local");
    expect(defaultCreateHost(scopeOf({ kind: "host", id: WORKSTATION }), { selectedHost: null, lastUsed: null, mode: "local" })).toBe(WORKSTATION);
  });

  it("skips hosts that are not online or not in the scope", () => {
    // alpha is retrying: never a default, even when it was used last.
    expect(defaultCreateHost(scopeOf({ kind: "all" }), { selectedHost: ALPHA, lastUsed: ALPHA })).toBe("local");
    // workstation disconnected (⏻ off): the last used host does not count.
    expect(defaultCreateHost(scopeOf({ kind: "all" }, { workstation: false }), { selectedHost: null, lastUsed: WORKSTATION })).toBe("local");
    // A group without this machine: its first online member.
    const group = scopeOf({ kind: "group", id: "g" }, { groups: [{ id: "g", name: "g", hosts: [ALPHA, WORKSTATION] }], active: ALPHA });
    expect(defaultCreateHost(group, { selectedHost: null, lastUsed: "local" })).toBe(WORKSTATION);
  });

  it("a one-host scope whose host is not online falls back to an online host", () => {
    expect(defaultCreateHost(scopeOf({ kind: "host", id: ALPHA }), none)).toBe("local");
  });
});

describe("create host default without a local host (macOS without a local cutex)", () => {
  it("「本机」 mode falls back to the first online remote host in the scope", () => {
    const hosts: HostView[] = [
      { id: ALPHA, kind: "ssh", label: "alpha", target: "alpha", remotePort: 24270, cutexPath: "cutex", paired: true, lastConnectedAt: null, autoConnect: true, color: HOST_PALETTE[2], platform: "macos", conn: { epoch: "e-a", tunnel: { ...up, status: "retrying", retryAt: 9 }, daemon: { kind: "unreachable", baseUrl: "", message: "timeout" }, cutexBuild: null } },
      { id: WORKSTATION, kind: "ssh", label: "workstation", target: "workstation", remotePort: 24270, cutexPath: "cutex", paired: true, lastConnectedAt: null, autoConnect: true, color: HOST_PALETTE[1], platform: "linux", conn: { epoch: "e-t", tunnel: up, daemon: online("WORKSTATION"), cutexBuild: null } },
      { id: "ssh-cccc3333", kind: "ssh", label: "buildbox", target: "buildbox", remotePort: 24270, cutexPath: "cutex", paired: true, lastConnectedAt: null, autoConnect: true, color: HOST_PALETTE[3], platform: "linux", conn: { epoch: "e-c", tunnel: up, daemon: online("BUILDBOX"), cutexBuild: null } },
    ];
    const state: HostsState = { scope: { kind: "all" }, active: WORKSTATION, startOn: "last", hosts, groups: [], tunnel: null, weakSecretStorage: false };
    const all = resolveHostScope({ hosts: state, daemon: online("WORKSTATION"), byHost: { "ssh-cccc3333": { daemon: online("BUILDBOX") } } }, false);
    // alpha (first) only retries: the first online host, not the selected / last one.
    expect(defaultCreateHost(all, { selectedHost: "ssh-cccc3333", lastUsed: "ssh-cccc3333", mode: "local" })).toBe(WORKSTATION);
    // 「跟随当前」 is unchanged.
    expect(defaultCreateHost(all, { selectedHost: "ssh-cccc3333", lastUsed: null, mode: "context" })).toBe("ssh-cccc3333");
  });
});

describe("picker mode", () => {
  it("shows a picker when the scope spans hosts or another host is connected", () => {
    expect(hostPickerMode(scopeOf({ kind: "all" }))).toBe("picker");
    // One-host scope, but workstation is online too: another host can be chosen.
    expect(hostPickerMode(scopeOf({ kind: "host", id: "local" }))).toBe("picker");
  });

  it("only one online host (alpha only retries): nothing, or a read-only label with host marks on (★ Q7)", () => {
    expect(hostPickerMode(scopeOf({ kind: "host", id: "local" }, { workstation: false }))).toBe("none");
    expect(hostPickerMode(scopeOf({ kind: "host", id: "local" }, { workstation: false, marks: true }))).toBe("label");
  });
});

describe("chosen host", () => {
  it("only online hosts can be targeted", () => {
    const all = scopeOf({ kind: "all" });
    expect(canTargetHost(all.host("local")!)).toBe(true);
    expect(canTargetHost(all.host(WORKSTATION)!)).toBe(true);
    expect(canTargetHost(all.host(ALPHA)!)).toBe(false);
    expect(canTargetHost(scopeOf({ kind: "all" }, { workstation: false }).host(WORKSTATION)!)).toBe(false);
  });

  it("a picked host stays while configured (also offline: the form waits); a removed one falls back", () => {
    const all = scopeOf({ kind: "all" }, { workstation: false });
    expect(keepTargetHost(all, WORKSTATION, "local")).toBe(WORKSTATION);
    expect(keepTargetHost(all, "ssh-gone", "local")).toBe("local");
    expect(keepTargetHost(all, null, "local")).toBe("local");
  });
});

describe("picker mode keeps the way back", () => {
  it("another host than the focus host keeps its picker even when it is the only choice left", () => {
    expect(hostPickerMode(scopeOf({ kind: "host", id: "local" }, { workstation: false }), WORKSTATION)).toBe("picker");
    expect(hostPickerMode(scopeOf({ kind: "host", id: "local" }, { workstation: false }), "local")).toBe("none");
  });
});
