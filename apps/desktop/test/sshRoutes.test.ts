// Hosts with several SSH routes: address forms (xn-- stored, Unicode shown), route kinds, the tunnel
// reducer's pass and switch events, the labels the UI shows.
import { describe, expect, it } from "vitest";
import {
  ROUTE_NEXT_MS,
  classifySshFailure,
  defaultHostLabel,
  displaySshTarget,
  initialTunnel,
  normalizeSshTarget,
  normalizeSshTargets,
  parseHostsFile,
  parseSshConfigDump,
  parseSshTarget,
  sshRouteKind,
  tunnelArgs,
  tunnelReduce,
  type HostView,
  type TunnelView,
} from "../src/shared/hosts";
import { currentRoute, routesExhausted } from "../src/renderer/src/lib/hosts";
import { routeLabel } from "../src/renderer/src/lib/hostRoute";

const ASCII = "remote-work.xn--fsqu00a.test";
const UNICODE = "remote-work.例子.test";

describe("internationalised addresses", () => {
  it("shows xn-- labels in Unicode and leaves everything else alone", () => {
    expect(displaySshTarget(ASCII)).toBe(UNICODE);
    expect(displaySshTarget(`developer@${ASCII}:22221`)).toBe(`developer@${UNICODE}:22221`);
    expect(displaySshTarget("remote-lan")).toBe("remote-lan");
    expect(displaySshTarget("me@[fd7a::1]:22")).toBe("me@[fd7a::1]:22");
  });

  it("decodes other scripts and keeps a label that does not encode back to itself", () => {
    expect(displaySshTarget("xn--mnchen-3ya.de")).toBe("münchen.de");
    expect(displaySshTarget("xn--bcher-kva.example")).toBe("bücher.example");
    expect(displaySshTarget("xn--80ak6aa92e.com")).toBe("аррӏе.com");
    expect(displaySshTarget("xn--!!!.love")).toBe("xn--!!!.love");
    expect(displaySshTarget("xn--a.love")).toBe("xn--a.love");
    // Not a label start: part of a longer word.
    expect(displaySshTarget("abc-xn--fsqu00a.test")).toBe("abc-xn--fsqu00a.test");
  });

  it("stores and compares the xn-- form whichever way it was typed", () => {
    expect(normalizeSshTarget(` ${UNICODE} `)).toBe(ASCII);
    expect(normalizeSshTarget(`developer@${UNICODE}:22221`)).toBe(`developer@${ASCII}:22221`);
    expect(normalizeSshTarget(ASCII)).toBe(ASCII);
    expect(normalizeSshTarget("Remote-LAN")).toBe("Remote-LAN");
    expect(normalizeSshTargets([UNICODE, ASCII, "remote"])).toEqual([ASCII, "remote"]);
    expect(parseSshTarget(`developer@${UNICODE}:22221`)).toEqual({ destination: `developer@${ASCII}`, port: 22221 });
    expect(parseSshTarget("爱 弥斯.love")).toBeNull();
  });

  it("ssh arguments and hosts.json hold the xn-- form; the default label is readable", () => {
    expect(tunnelArgs(parseSshTarget(UNICODE)!, 1, 2).at(-1)).toBe(ASCII);
    const file = parseHostsFile({ version: 2, hosts: [{ id: "ssh-abcd", target: UNICODE, targets: ["remote-lan", UNICODE] }] });
    expect(file.hosts[0]!.targets).toEqual(["remote-lan", ASCII]);
    const old = parseHostsFile({ version: 2, hosts: [{ id: "ssh-abcd", target: UNICODE }] });
    expect(old.hosts[0]).toMatchObject({ target: ASCII, targets: [ASCII], label: UNICODE });
    expect(defaultHostLabel(`me@${ASCII}`)).toBe(UNICODE);
  });
});

describe("route kinds", () => {
  it.each([
    ["remote-lan", null, "lan"],
    ["remote-lan", "10.0.0.3", "lan"],
    ["remote-ovh", ASCII, "relay"],
    ["public-relay", null, "relay"],
    ["remote", "100.64.0.7", "tailscale"],
    ["remote", "remote.tail1234.ts.net", "tailscale"],
    ["box", "10.0.0.5", "lan"],
    ["box", "example.org", null],
    ["box", "100.128.0.0", null],
    ["remote", null, null],
    ["me@remote-lan:2222", null, "lan"],
  ])("%s via %s is %s", (target, host, kind) => {
    expect(sshRouteKind(target, host)).toBe(kind);
  });

  it("reads the host name from ssh -G output", () => {
    expect(parseSshConfigDump("user developer\nhostname remote-work.xn--fsqu00a.test\r\nport 22221\n")).toBe(ASCII);
    expect(parseSshConfigDump("user developer\n")).toBeNull();
  });
});

describe("tunnel timing arguments", () => {
  const target = parseSshTarget("remote")!;
  it("keeps the single-route defaults", () => {
    const args = tunnelArgs(target, 1, 2);
    expect(args).toContain("ConnectTimeout=15");
    expect(args).toContain("ServerAliveInterval=15");
    expect(args).toContain("ServerAliveCountMax=3");
  });
  it("uses the given limits for a route", () => {
    const args = tunnelArgs(target, 1, 2, false, { connectTimeoutSec: 8, aliveIntervalSec: 5 });
    expect(args).toContain("ConnectTimeout=8");
    expect(args).toContain("ServerAliveInterval=5");
    expect(args).toContain("ServerAliveCountMax=3");
    expect(args).toContain("BatchMode=yes");
  });
});

describe("tunnel reducer with several routes", () => {
  const up: TunnelView = { ...initialTunnel("remote-ovh"), status: "up", localPort: 53122, routeIndex: 1, upSince: 1000 };
  const timeout = { code: "timeout" as const, detail: "" };

  it("goes to the next route almost at once without counting a backoff step", () => {
    const next = tunnelReduce({ ...up, upSince: null, status: "starting" }, { type: "exit", error: timeout, now: 5000, nextRoute: true });
    expect(next).toMatchObject({ status: "retrying", attempt: 0, retryAt: 5000 + ROUTE_NEXT_MS });
    expect(next.routesExhausted).toBeUndefined();
  });

  it("backs off between whole passes, capped, and remembers that every route failed", () => {
    let view: TunnelView = { ...up, upSince: null, status: "starting", attempt: 6 };
    view = tunnelReduce(view, { type: "exit", error: timeout, now: 5000, exhausted: true, maxBackoffMs: 10_000 });
    expect(view).toMatchObject({ status: "retrying", attempt: 7, retryAt: 15_000, routesExhausted: true });
    view = tunnelReduce(view, { type: "spawn", localPort: 53122, target: "remote-lan", routeIndex: 0 });
    expect(view).toMatchObject({ status: "starting", routesExhausted: true, routeIndex: 0 });
    view = tunnelReduce(view, { type: "ready", now: 6000 });
    expect(view.status).toBe("up");
    expect(view.routesExhausted).toBeUndefined();
  });

  it("a switch stays up, moves the route and keeps the shown port", () => {
    const view = tunnelReduce({ ...up, attempt: 3 }, { type: "switch", target: "remote-lan", routeIndex: 0, now: 9000 });
    expect(view).toMatchObject({ status: "up", target: "remote-lan", routeIndex: 0, localPort: 53122, upSince: 9000, attempt: 0, error: null });
  });
});

describe("route labels", () => {
  const t = (key: string, values: Record<string, string | number> = {}) => `${key}|${JSON.stringify(values)}`;
  const host = (tunnel: Partial<TunnelView>, extra: Partial<HostView> = {}): HostView => ({
    id: "ssh-1", kind: "ssh", label: "remote", target: "remote-lan", targets: ["remote-lan", "remote-ovh", "remote"],
    routes: [{ target: "remote-lan", host: null, kind: "lan" }, { target: "remote-ovh", host: ASCII, kind: "relay" }, { target: "remote", host: "100.64.0.7", kind: "tailscale" }],
    remotePort: 24270, cutexPath: "cutex", paired: true, lastConnectedAt: null,
    conn: { epoch: "e", tunnel: { ...initialTunnel("remote-ovh"), status: "up", routeIndex: 1, ...tunnel }, daemon: { kind: "connected", baseUrl: "", hostId: "H" }, cutexBuild: null },
    ...extra,
  });

  it("names the kind, the Unicode address and the place in the list", () => {
    expect(currentRoute(host({}))).toEqual({ kind: "relay", address: UNICODE, position: 2, total: 3 });
    expect(routeLabel(t as never, host({}))).toBe(`host.route.label|${JSON.stringify({ kind: 'host.route.kind.relay|{}', address: UNICODE, position: 2, total: 3 })}`);
  });

  it("falls back to the configured name until ssh -G answered, and to no route line for one address", () => {
    expect(currentRoute(host({ routeIndex: 0, target: "remote-lan" }, { routes: undefined }))).toEqual({ kind: null, address: "remote-lan", position: 1, total: 3 });
    expect(currentRoute(host({}, { targets: ["remote-ovh"] }))).toBeNull();
    expect(routeLabel(t as never, host({}, { targets: ["remote-ovh"] }))).toBeNull();
  });

  it("the all-routes hint shows until a route is up", () => {
    expect(routesExhausted({ ...initialTunnel(), status: "retrying", routesExhausted: true })).toBe(true);
    expect(routesExhausted({ ...initialTunnel(), status: "starting", routesExhausted: true })).toBe(true);
    expect(routesExhausted({ ...initialTunnel(), status: "up", routesExhausted: true })).toBe(false);
    expect(routesExhausted({ ...initialTunnel(), status: "retrying" })).toBe(false);
    expect(routesExhausted(null)).toBe(false);
  });
});

describe("failure classification over ProxyJump", () => {
  it("reads Windows OpenSSH's timeout through a jump host as a timeout", () => {
    expect(classifySshFailure(255, "Connection to UNKNOWN port 65535 timed out\r\n", "tunnel").code).toBe("timeout");
  });
});
