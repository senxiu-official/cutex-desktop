import { describe, expect, it } from "vitest";
import {
  backoffMs,
  classifySshFailure,
  connectedHosts,
  defaultHostLabel,
  deviceLabel,
  execArgs,
  focusHostOf,
  hostEpoch,
  HOST_PALETTE,
  initialScope,
  initialTunnel,
  isValidCutexPath,
  parseHostsFile,
  parseSshConfigHosts,
  parseSshTarget,
  parseTokenIssue,
  scopeHosts,
  tokenIssueCommand,
  tunnelArgs,
  tunnelReduce,
  TUNNEL_MAX_BACKOFF_MS,
  TUNNEL_STABLE_MS,
  type HostsState,
} from "../src/shared/hosts";
import { hostIndicator, isRemote, missingRemoteFeatures } from "../src/renderer/src/lib/hosts";

describe("ssh targets", () => {
  it("parses aliases, user@host and ports", () => {
    expect(parseSshTarget("workstation")).toEqual({ destination: "workstation", port: null });
    expect(parseSshTarget(" me@workstation.local ")).toEqual({ destination: "me@workstation.local", port: null });
    expect(parseSshTarget("me@10.0.0.5:2222")).toEqual({ destination: "me@10.0.0.5", port: 2222 });
    expect(parseSshTarget("me@[fe80::1]:22")).toEqual({ destination: "me@fe80::1", port: 22 });
  });

  it("rejects option injection and junk", () => {
    for (const bad of ["", "-oProxyCommand=calc", "me@-oProxyCommand=x", "host name", "a;rm -rf /", "host:0", "host:70000", "$(id)@h", "h`x`"]) expect(parseSshTarget(bad)).toBeNull();
  });

  it("validates the remote cutex path", () => {
    expect(isValidCutexPath("cutex")).toBe(true);
    expect(isValidCutexPath("~/.local/bin/cutex")).toBe(true);
    expect(isValidCutexPath("C:\\Apps\\cutex\\cutex.exe")).toBe(true);
    for (const bad of ["", "-x", "cutex; id", "cu tex", "$(id)", "a|b", "'x'"]) expect(isValidCutexPath(bad)).toBe(false);
  });

  it("labels", () => {
    expect(deviceLabel("HOST-A")).toBe("desktop-HOST-A");
    expect(deviceLabel("my laptop (2)")).toBe("desktop-my-laptop-2");
    expect(deviceLabel("")).toBe("desktop-unknown");
    // Two instances of one machine (installed app vs a side instance) get different labels.
    const app = deviceLabel("HOST-A", "C:\\Users\\me\\AppData\\Roaming\\Cutex");
    const side = deviceLabel("HOST-A", "C:\\Users\\me\\.cxa\\desktop-migration");
    expect(app).toMatch(/^desktop-HOST-A-Cutex-[0-9a-f]{6}$/);
    expect(side).toMatch(/^desktop-HOST-A-desktop-migration-[0-9a-f]{6}$/);
    expect(deviceLabel("HOST-A", "/a/Cutex")).not.toBe(deviceLabel("HOST-A", "/b/Cutex"));    expect(defaultHostLabel("me@workstation:2222")).toBe("workstation");
    expect(defaultHostLabel("workstation")).toBe("workstation");
  });
});

describe("ssh command lines", () => {
  it("builds the tunnel: batch mode, keepalives, loopback on both ends, -- before the host", () => {
    const args = tunnelArgs({ destination: "me@workstation", port: 2222 }, 53122, 24270);
    expect(args.slice(0, 2)).toEqual(["-N", "-T"]);
    expect(args).toContain("BatchMode=yes");
    expect(args).toContain("ExitOnForwardFailure=yes");
    expect(args).toContain("ServerAliveInterval=15");
    expect(args).toContain("ServerAliveCountMax=3");
    expect(args[args.indexOf("-L") + 1]).toBe("127.0.0.1:53122:127.0.0.1:24270");
    expect(args[args.indexOf("-p") + 1]).toBe("2222");
    expect(args.slice(-2)).toEqual(["--", "me@workstation"]);
  });

  it("builds a one-shot command without a port flag for aliases", () => {
    const args = execArgs({ destination: "workstation", port: null }, tokenIssueCommand("cutex", "desktop-HOST-A"));
    expect(args).not.toContain("-p");
    expect(args).not.toContain("-N");
    expect(args).toContain("BatchMode=yes");
    expect(args.slice(-3)).toEqual(["--", "workstation", "cutex management client-token issue --label desktop-HOST-A"]);
  });
});

describe("remote output and ssh_config", () => {
  it("parses the issued token, also after banner lines", () => {
    const json = '{"tokenId":"ct_01","label":"desktop-HOST-A","token":"secret-abc","createdAt":"2026-10-07T00:00:00Z"}';
    expect(parseTokenIssue(json)).toEqual({ tokenId: "ct_01", label: "desktop-HOST-A", token: "secret-abc", createdAt: "2026-10-07T00:00:00Z" });
    expect(parseTokenIssue(`Welcome to workstation\n${json}\n`)?.token).toBe("secret-abc");
    expect(parseTokenIssue("ok")).toBeNull();
    expect(parseTokenIssue('{"tokenId":"bad id!","token":"x"}')).toBeNull();
    expect(parseTokenIssue('{"tokenId":"ct_1","token":""}')).toBeNull();
  });

  it("lists concrete Host aliases only", () => {
    const text = [
      "# my hosts",
      "Host workstation",
      "  HostName 10.0.0.5",
      "Host eva-01 lab-gpu # two names",
      "host=flaky",
      "Host *.internal !bad",
      "Host *",
      "Match host foo",
      "Host workstation",
      '  Host "quoted"',
    ].join("\n");
    expect(parseSshConfigHosts(text)).toEqual(["workstation", "eva-01", "lab-gpu", "flaky", "quoted"]);
  });
});

describe("ssh failure classification", () => {
  it("recognises the common failures", () => {
    expect(classifySshFailure(255, "me@workstation: Permission denied (publickey).", "tunnel").code).toBe("auth");
    expect(classifySshFailure(255, "Host key verification failed.", "exec").code).toBe("hostKey");
    expect(classifySshFailure(255, "ssh: Could not resolve hostname nosuch: Name or service not known", "exec").code).toBe("resolve");
    expect(classifySshFailure(255, "ssh: connect to host 10.0.0.5 port 22: Connection refused", "tunnel").code).toBe("refused");
    expect(classifySshFailure(255, "banner exchange: Connection to UNKNOWN port -1: Connection refused", "tunnel").code).toBe("refused");
    expect(classifySshFailure(255, "channel 2: open failed: connect failed: Connection refused\nConnection reset", "tunnel").code).toBe("exited");
    expect(classifySshFailure(255, "ssh: connect to host 10.0.0.5 port 22: Connection timed out", "tunnel").code).toBe("timeout");
    expect(classifySshFailure(255, "bind [127.0.0.1]:53122: Address already in use\nchannel_setup_fwd_listener_tcpip: cannot listen to port: 53122\nCould not request local forwarding.", "tunnel").code).toBe("forward");
  });

  it("blames the remote cutex only when the remote command ran", () => {
    expect(classifySshFailure(2, "error: unrecognized subcommand 'client-token'", "exec").code).toBe("cutexTooOld");
    expect(classifySshFailure(127, "bash: line 1: cutex: command not found", "exec").code).toBe("cutexNotFound");
    expect(classifySshFailure(1, "'cutex' is not recognized as an internal or external command", "exec").code).toBe("cutexNotFound");
    // A tunnel never runs a remote command.
    expect(classifySshFailure(127, "cutex: command not found", "tunnel").code).toBe("exited");
  });

  it("keeps a short stderr tail without ssh noise", () => {
    const e = classifySshFailure(255, "Warning: Permanently added 'x' (ED25519) to the list of known hosts.\nme@x: Permission denied (publickey).\n", "exec");
    expect(e.detail).toBe("me@x: Permission denied (publickey).");
    expect(classifySshFailure(1, "", "exec").detail).toBe("exit code 1");
  });
});

describe("tunnel state", () => {
  const exit = (code: Parameters<typeof classifySshFailure>[0], stderr: string, now: number) => ({ type: "exit" as const, error: classifySshFailure(code, stderr, "tunnel"), now });

  it("backs off exponentially up to the cap", () => {
    expect([1, 2, 3, 4].map(backoffMs)).toEqual([1000, 2000, 4000, 8000]);
    expect(backoffMs(20)).toBe(TUNNEL_MAX_BACKOFF_MS);
  });

  it("starts, comes up, drops and retries on the same port", () => {
    let s = tunnelReduce(initialTunnel(), { type: "spawn", localPort: 53122 });
    expect(s).toMatchObject({ status: "starting", localPort: 53122 });
    s = tunnelReduce(s, { type: "ready", now: 1000 });
    expect(s).toMatchObject({ status: "up", error: null, upSince: 1000 });
    s = tunnelReduce(s, exit(255, "Connection to workstation closed by remote host.", 2000));
    expect(s).toMatchObject({ status: "retrying", attempt: 1, retryAt: 3000, localPort: 53122 });
    s = tunnelReduce(s, { type: "spawn", localPort: 53122 });
    s = tunnelReduce(s, exit(255, "ssh: connect to host workstation port 22: Connection timed out", 5000));
    expect(s).toMatchObject({ status: "retrying", attempt: 2, retryAt: 7000 });
  });

  it("resets the backoff after a stable period", () => {
    let s = { ...initialTunnel(), attempt: 4 };
    s = tunnelReduce(s, { type: "ready", now: 0 });
    s = tunnelReduce(s, exit(255, "Connection reset", TUNNEL_STABLE_MS + 1));
    expect(s.attempt).toBe(1);
  });

  it("stops retrying on errors that need the user", () => {
    const s = tunnelReduce(tunnelReduce(initialTunnel(), { type: "spawn", localPort: 1 }), exit(255, "Permission denied (publickey).", 10));
    expect(s).toMatchObject({ status: "error", retryAt: null });
    expect(s.error?.code).toBe("auth");
    expect(tunnelReduce(s, { type: "stop" })).toMatchObject({ status: "idle", error: null, localPort: 1 });
  });
});

describe("hosts file", () => {
  it("drops bad entries and fills defaults", () => {
    const f = parseHostsFile({
      startOn: "local",
      lastActive: "ssh-gone",
      hosts: [
        { id: "ssh-aaaa1111", label: " Workstation ", target: "workstation", remotePort: 24271, cutexPath: "~/bin/cutex", tokenId: "ct_1" },
        { id: "ssh-bbbb2222", target: "-oProxyCommand=x" },
        { id: "nope", target: "x" },
        { id: "ssh-aaaa1111", target: "dup" },
        { id: "ssh-cccc3333", target: "me@h:2222", remotePort: 0, cutexPath: "a;b" },
      ],
    });
    expect(f.startOn).toBe("local");
    expect(f.scope).toEqual({ kind: "host", id: "local" });
    expect(f.hosts.map((h) => h.id)).toEqual(["ssh-aaaa1111", "ssh-cccc3333"]);
    expect(f.hosts[0]).toMatchObject({ label: "Workstation", remotePort: 24271, cutexPath: "~/bin/cutex", tokenId: "ct_1" });
    expect(f.hosts[1]).toMatchObject({ label: "h", remotePort: 24270, cutexPath: "cutex", tokenId: null });
    expect(parseHostsFile(null)).toMatchObject({ version: 2, startOn: "last", scope: { kind: "host", id: "local" }, hosts: [], groups: [] });
  });

  it("starts on the last host only when asked and it still exists", () => {
    const base = parseHostsFile({ hosts: [{ id: "ssh-aaaa1111", target: "workstation" }], lastActive: "ssh-aaaa1111" });
    expect(initialScope(base)).toEqual({ kind: "host", id: "ssh-aaaa1111" });
    expect(focusHostOf(initialScope(base), base)).toBe("ssh-aaaa1111");
    expect(initialScope({ ...base, startOn: "local" })).toEqual({ kind: "host", id: "local" });
    expect(focusHostOf({ kind: "host", id: "ssh-gone" }, base)).toBe("local");
  });

  it("v1 → v2 (one way): lastActive becomes the scope, every host auto-connects, palette colors in order", () => {
    const f = parseHostsFile({
      version: 1,
      startOn: "last",
      lastActive: "ssh-bbbb2222",
      hosts: [
        { id: "ssh-aaaa1111", target: "workstation", autoConnect: false, color: "#123456", platform: "linux" },
        { id: "ssh-bbbb2222", target: "eva-01" },
      ],
    });
    expect(f.version).toBe(2);
    expect(f.scope).toEqual({ kind: "host", id: "ssh-bbbb2222" });
    expect(f.groups).toEqual([]);
    expect(f.local).toEqual({ autoConnect: true, color: HOST_PALETTE[0], platform: null });
    // v1 fields that look like v2 ones are not trusted: defaults instead.
    expect(f.hosts.map((h) => [h.autoConnect, h.color, h.platform])).toEqual([[true, HOST_PALETTE[1], null], [true, HOST_PALETTE[2], null]]);
    expect("lastActive" in f).toBe(false);
  });

  it("v2: keeps per-host settings, groups and the scope; bad ones fall back", () => {
    const f = parseHostsFile({
      version: 2,
      startOn: "last",
      local: { autoConnect: false, color: "#abcdef", platform: "windows" },
      hosts: [
        { id: "ssh-aaaa1111", target: "workstation", autoConnect: false, color: "#123456", platform: "linux" },
        { id: "ssh-bbbb2222", target: "eva-01", color: "red", platform: "plan9" },
      ],
      groups: [
        { id: "grp-work1", name: " Work ", hosts: ["local", "ssh-aaaa1111", "ssh-gone", "ssh-aaaa1111"] },
        { id: "bad", name: "x", hosts: [] },
        { id: "grp-empty", name: "  ", hosts: [] },
      ],
      scope: { kind: "group", id: "grp-work1" },
    });
    expect(f.local).toEqual({ autoConnect: false, color: "#abcdef", platform: "windows" });
    expect(f.hosts.map((h) => [h.autoConnect, h.color, h.platform])).toEqual([[false, "#123456", "linux"], [true, HOST_PALETTE[1], null]]);
    expect(f.groups).toEqual([{ id: "grp-work1", name: "Work", hosts: ["local", "ssh-aaaa1111"] }]);
    expect(f.scope).toEqual({ kind: "group", id: "grp-work1" });
    expect(focusHostOf(f.scope, f)).toBe("local");
    expect(parseHostsFile({ version: 2, scope: { kind: "group", id: "grp-gone" } }).scope).toEqual({ kind: "host", id: "local" });
    expect(parseHostsFile({ version: 2, scope: { kind: "all" } }).scope).toEqual({ kind: "all" });
    expect(focusHostOf({ kind: "all" }, f)).toBe("local");
  });
});

describe("hosts state helpers", () => {
  const conn = (epoch: string | null) => ({ epoch, tunnel: null, daemon: { kind: "connecting" as const, baseUrl: "" }, cutexBuild: null });
  const view = (id: string, epoch?: string | null) => ({ id, kind: id === "local" ? ("local" as const) : ("ssh" as const), label: id, target: null, remotePort: null, cutexPath: null, paired: true, lastConnectedAt: null, ...(epoch !== undefined ? { conn: conn(epoch) } : {}) });
  const state: HostsState = {
    scope: { kind: "host", id: "ssh-b" },
    active: "ssh-b",
    startOn: "last",
    hosts: [view("local", "e-local"), view("ssh-a", null), view("ssh-b", "e-b"), view("ssh-c")],
    groups: [{ id: "grp-x", name: "X", hosts: ["ssh-a", "ssh-c", "ssh-gone"] }],
    tunnel: null,
    weakSecretStorage: false,
  };

  it("epochs and the connected hosts (focus first)", () => {
    expect(hostEpoch(state, "local")).toBe("e-local");
    expect(hostEpoch(state, "ssh-a")).toBeNull();
    expect(hostEpoch(state, "ssh-c")).toBeNull();
    expect(hostEpoch(null, "local")).toBeNull();
    expect(connectedHosts(state)).toEqual(["ssh-b", "local"]);
  });

  it("scope hosts: one host, a group's known members, every host", () => {
    expect(scopeHosts(state)).toEqual(["ssh-b"]);
    expect(scopeHosts({ ...state, scope: { kind: "host", id: "ssh-gone" } })).toEqual([]);
    expect(scopeHosts({ ...state, scope: { kind: "group", id: "grp-x" } })).toEqual(["ssh-a", "ssh-c"]);
    expect(scopeHosts({ ...state, scope: { kind: "all" } })).toEqual(["local", "ssh-a", "ssh-b", "ssh-c"]);
  });
});

describe("host indicator (renderer)", () => {
  const ssh = (tunnel: HostsState["tunnel"]): HostsState => ({
    scope: { kind: "host", id: "ssh-aaaa1111" },
    active: "ssh-aaaa1111",
    groups: [],
    startOn: "last",
    hosts: [
      { id: "local", kind: "local", label: "HOST-A", target: null, remotePort: null, cutexPath: null, paired: true, lastConnectedAt: null },
      { id: "ssh-aaaa1111", kind: "ssh", label: "workstation", target: "workstation", remotePort: 24270, cutexPath: "cutex", paired: true, lastConnectedAt: null },
    ],
    tunnel,
    weakSecretStorage: false,
  });
  const up = { ...initialTunnel(), status: "up" as const, localPort: 53122, upSince: 1 };
  const connected = { kind: "connected" as const, baseUrl: "http://127.0.0.1:53122", hostId: "WORKSTATION" };

  it("local host follows the daemon state", () => {
    expect(isRemote(null)).toBe(false);
    expect(hostIndicator(null, connected).status).toBe("online");
    expect(hostIndicator(null, { kind: "unreachable", baseUrl: "x", message: "m" })).toMatchObject({ status: "offline", problem: "daemon" });
  });

  it("ssh host: tunnel first, then the daemon behind it", () => {
    expect(isRemote(ssh(null))).toBe(true);
    expect(hostIndicator(ssh({ ...initialTunnel(), status: "starting" }), connected).status).toBe("connecting");
    expect(hostIndicator(ssh({ ...initialTunnel(), status: "retrying", attempt: 2, retryAt: 99, error: { code: "timeout", detail: "t" } }), connected)).toMatchObject({ status: "retrying", problem: "timeout", detail: "t", retryAt: 99 });
    expect(hostIndicator(ssh({ ...initialTunnel(), status: "error", error: { code: "auth", detail: "" } }), connected)).toMatchObject({ status: "error", problem: "auth", detail: null });
    expect(hostIndicator(ssh(up), connected).status).toBe("online");
    expect(hostIndicator(ssh(up), { kind: "unreachable", baseUrl: "x", message: "m" })).toMatchObject({ status: "offline", problem: "remoteDaemon" });
    expect(hostIndicator(ssh(up), { kind: "error", baseUrl: "x", message: "unauthorized", status: 401 })).toMatchObject({ status: "error", problem: "tokenRejected" });
  });

  it("lists remote features the connected cutex lacks", () => {
    expect(missingRemoteFeatures(ssh(up), new Set(["management-client-tokens", "fs-dir-browse"]))).toEqual(["session-attachments"]);
    expect(missingRemoteFeatures(ssh(up), new Set())).toEqual([]);
    expect(missingRemoteFeatures(null, new Set(["x"]))).toEqual([]);
  });
});
