import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const processes = vi.hoisted(() => ({ children: [] as any[], sockets: [] as any[], args: [] as string[][] }));

vi.mock("node:child_process", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    spawn: vi.fn((_binary: string, args: string[]) => {
      const child = new EventEmitter() as any;
      child.pid = 4000 + processes.children.length;
      child.exitCode = null;
      child.signalCode = null;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn(() => {
        child.exitCode = 0;
        queueMicrotask(() => child.emit("close", 0));
      });
      processes.children.push(child);
      processes.args.push(args);
      return child;
    }),
    spawnSync: vi.fn(() => ({ stdout: "" })),
  };
});

vi.mock("node:net", async () => {
  const { EventEmitter } = await import("node:events");
  class Server extends EventEmitter {
    unref() {}
    listen(_port: number, _host: string, ready: () => void) { queueMicrotask(ready); }
    address() { return { port: 53122 }; }
    close(done: () => void) { queueMicrotask(done); }
  }
  return {
    createServer: vi.fn(() => new Server()),
    connect: vi.fn(() => {
      const socket = new EventEmitter() as any;
      socket.setTimeout = vi.fn();
      socket.destroy = vi.fn();
      processes.sockets.push(socket);
      return socket;
    }),
  };
});

import { SshTunnel } from "../src/main/ssh";
import { ROUTE_FLAP_BASE_MS, ROUTE_HOLD_MS, ROUTE_NEXT_MS, ROUTE_PROBE_INTERVAL_MS, ROUTE_PROBE_SLOW_INTERVAL_MS, ROUTE_REFUSED_RETRY_MS, parseSshTarget } from "../src/shared/hosts";

const flush = async () => {
  for (let index = 0; index < 12; index++) await Promise.resolve();
};

describe("SSH multi-address tunnels", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    processes.children = [];
    processes.sockets = [];
    processes.args = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("tries addresses in order and returns to the first after an established connection drops", async () => {
    const tunnel = new SshTunnel({
      targets: [parseSshTarget("hachimi-lan")!, parseSshTarget("hachimi-direct")!],
      remotePort: 24270,
      pids: { add() {}, remove() {} } as any,
      onChange() {},
    });
    tunnel.start();
    await flush();
    expect(processes.args[0]?.at(-1)).toBe("hachimi-lan");

    const first = processes.children[0]!;
    first.exitCode = 255;
    first.emit("close", 255);
    processes.sockets[0]!.emit("error", new Error("closed"));
    await flush();
    expect(tunnel.state).toMatchObject({ status: "retrying", target: "hachimi-lan" });
    await vi.advanceTimersByTimeAsync(1000);
    await flush();
    expect(processes.args[1]?.at(-1)).toBe("hachimi-direct");

    processes.sockets[1]!.emit("connect");
    await flush();
    expect(tunnel.state).toMatchObject({ status: "up", target: "hachimi-direct" });
    const second = processes.children[1]!;
    second.exitCode = 255;
    second.emit("close", 255);
    await flush();
    await vi.advanceTimersByTimeAsync(2000);
    await flush();
    expect(processes.args[2]?.at(-1)).toBe("hachimi-lan");
    tunnel.stop();
    await flush();
  });

  it("rejects a ready address with a specific daemon identity error", async () => {
    const tunnel = new SshTunnel({
      targets: [parseSshTarget("hachimi-lan")!, parseSshTarget("hachimi-direct")!],
      remotePort: 24270,
      pids: { add() {}, remove() {} } as any,
      onChange() {},
    });
    tunnel.start();
    await flush();
    processes.sockets[0]!.emit("connect");
    await flush();
    tunnel.rejectReady({ code: "hostMismatch", detail: "expected HOST-A, got HOST-B" });
    await flush();
    expect(tunnel.state).toMatchObject({ status: "retrying", error: { code: "hostMismatch" } });
    await vi.advanceTimersByTimeAsync(1000);
    await flush();
    expect(processes.args[1]?.at(-1)).toBe("hachimi-direct");
    tunnel.stop();
    await flush();
  });

  const route = (destination: string) => parseSshTarget(destination)!;
  const fail = async (index: number, code = 255) => {
    const child = processes.children[index]!;
    child.exitCode = code;
    child.emit("close", code);
    processes.sockets.at(-1)?.emit("error", new Error("closed"));
    await flush();
  };
  const ready = async () => {
    processes.sockets.at(-1)!.emit("connect");
    await flush();
    await vi.advanceTimersByTimeAsync(0);
  };
  const lastDestination = () => processes.args.at(-1)?.at(-1);
  /** On route `index` of three, with probing on. */
  async function onRoute(index: number, verifyRoute = vi.fn(async () => null as any), extra: object = {}) {
    const views: any[] = [];
    const switched = vi.fn();
    const tunnel = new SshTunnel({ targets: [route("lan"), route("relay"), route("tailscale")], remotePort: 24270, pids: { add() {}, remove() {} } as any, onChange: (v) => views.push(v), verifyRoute, onRouteSwitched: switched, ...extra });
    tunnel.start();
    await flush();
    for (let i = 0; i < index; i++) {
      await fail(i);
      await vi.advanceTimersByTimeAsync(ROUTE_NEXT_MS);
      await flush();
    }
    await ready();
    expect(tunnel.state).toMatchObject({ status: "up", routeIndex: index });
    return { tunnel, views, switched, verifyRoute };
  }

  it("moves to the next route within 250 ms and backs off only after a whole pass", async () => {
    const views: any[] = [];
    const tunnel = new SshTunnel({ targets: [route("lan"), route("relay"), route("tailscale")], remotePort: 24270, pids: { add() {}, remove() {} } as any, onChange: (v) => views.push(v) });
    tunnel.start();
    await flush();
    for (const [index, next] of [[0, "relay"], [1, "tailscale"]] as const) {
      await fail(index);
      expect(tunnel.state).toMatchObject({ status: "retrying", attempt: 0 });
      expect(tunnel.state.routesExhausted).toBeUndefined();
      await vi.advanceTimersByTimeAsync(ROUTE_NEXT_MS);
      await flush();
      expect(lastDestination()).toBe(next);
    }
    await fail(2);
    expect(tunnel.state).toMatchObject({ status: "retrying", attempt: 1, routesExhausted: true });
    await vi.advanceTimersByTimeAsync(ROUTE_NEXT_MS);
    await flush();
    expect(processes.args).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1000 - ROUTE_NEXT_MS);
    await flush();
    expect(lastDestination()).toBe("lan");
    tunnel.stop();
    await flush();
  });

  it("gives up on one route sooner, but every third pass allows a slow route the old limits", async () => {
    const tunnel = new SshTunnel({ targets: [route("lan"), route("relay")], remotePort: 24270, pids: { add() {}, remove() {} } as any, onChange() {} });
    tunnel.start();
    await flush();
    const seen: string[] = [];
    for (let attempt = 0; attempt < 6; attempt++) {
      seen.push(processes.args.at(-1)!.find((a) => a.startsWith("ConnectTimeout="))!);
      await fail(attempt);
      await vi.advanceTimersByTimeAsync(10_000);
      await flush();
    }
    expect(seen).toEqual(["ConnectTimeout=8", "ConnectTimeout=8", "ConnectTimeout=8", "ConnectTimeout=8", "ConnectTimeout=15", "ConnectTimeout=15"]);
    tunnel.stop();
    await flush();
  });

  it("keeps trying when a later route refused us but an earlier one failed on the network", async () => {
    const tunnel = new SshTunnel({ targets: [route("lan"), route("relay")], remotePort: 24270, pids: { add() {}, remove() {} } as any, onChange() {} });
    tunnel.start();
    await flush();
    await fail(0);
    await vi.advanceTimersByTimeAsync(ROUTE_NEXT_MS);
    await flush();
    processes.children[1]!.stderr.emit("data", Buffer.from("me@relay: Permission denied (publickey)."));
    await fail(1);
    expect(tunnel.state).toMatchObject({ status: "error", routesExhausted: true });
    await vi.advanceTimersByTimeAsync(1000);
    await flush();
    expect(lastDestination()).toBe("lan");
    tunnel.stop();
    await flush();
  });

  it("stops when every route refused us: nothing heals by itself and there is no network hint", async () => {
    const tunnel = new SshTunnel({ targets: [route("lan"), route("relay")], remotePort: 24270, pids: { add() {}, remove() {} } as any, onChange() {} });
    tunnel.start();
    await flush();
    processes.children[0]!.stderr.emit("data", Buffer.from("Permission denied (publickey)."));
    await fail(0);
    await vi.advanceTimersByTimeAsync(ROUTE_NEXT_MS);
    await flush();
    processes.children[1]!.stderr.emit("data", Buffer.from("Permission denied (publickey)."));
    await fail(1);
    expect(tunnel.state.status).toBe("error");
    expect(tunnel.state.routesExhausted).toBeUndefined();
    await vi.advanceTimersByTimeAsync(60_000);
    await flush();
    expect(processes.args).toHaveLength(2);
    tunnel.stop();
    await flush();
  });

  it("a route that drops moves on to the next one instead of the dead one again", async () => {
    const { tunnel } = await onRoute(0);
    await fail(0);
    await vi.advanceTimersByTimeAsync(ROUTE_NEXT_MS);
    await flush();
    expect(lastDestination()).toBe("relay");
    tunnel.stop();
    await flush();
  });

  it("does not probe on the best route, or without verifyRoute", async () => {
    const { tunnel } = await onRoute(0);
    await vi.advanceTimersByTimeAsync(10 * ROUTE_PROBE_INTERVAL_MS);
    expect(processes.args).toHaveLength(1);
    tunnel.stop();
    await flush();
  });

  it("returns to the better route only after it held, without a prompt; nothing is shown before", async () => {
    const askpass = { spawn: vi.fn(async () => ({ env: { SSH_ASKPASS: "x" }, done() {} })), waiting: false, lastAnswerAt: 0, reset() {}, close() {} };
    const { tunnel, switched, verifyRoute, views } = await onRoute(1, undefined, { askpass });
    const spawnsWithPrompt = askpass.spawn.mock.calls.length;
    const before = views.length;
    const { spawn } = await import("node:child_process");

    await vi.advanceTimersByTimeAsync(ROUTE_PROBE_INTERVAL_MS);
    await flush();
    expect(lastDestination()).toBe("lan");
    expect(processes.args.at(-1)).toContain("BatchMode=yes");
    expect((spawn as any).mock.calls.at(-1)[2].env).toBeUndefined();
    expect(askpass.spawn.mock.calls.length).toBe(spawnsWithPrompt);
    const old = processes.children.at(-2)!;

    processes.sockets.at(-1)!.emit("connect");
    await flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(verifyRoute).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(ROUTE_HOLD_MS - 1);
    expect(switched).not.toHaveBeenCalled();
    expect(views.length).toBe(before);
    expect(tunnel.state.target).toBe("relay");

    await vi.advanceTimersByTimeAsync(1);
    await flush();
    expect(verifyRoute).toHaveBeenCalledTimes(2);
    expect(switched).toHaveBeenCalledTimes(1);
    expect(tunnel.state).toMatchObject({ status: "up", target: "lan", routeIndex: 0 });
    expect(views.filter((v) => v.status !== "up").slice(before)).toEqual([]);
    // No connection used the old route here, so it ends right away.
    expect(old.kill).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10 * ROUTE_PROBE_INTERVAL_MS);
    expect(lastDestination()).toBe("lan");
    tunnel.stop();
    await flush();
  });

  it("does not switch when the better route goes away during the hold", async () => {
    const { tunnel, switched } = await onRoute(1);
    await vi.advanceTimersByTimeAsync(ROUTE_PROBE_INTERVAL_MS);
    await flush();
    processes.sockets.at(-1)!.emit("connect");
    await flush();
    await vi.advanceTimersByTimeAsync(5000);
    const candidate = processes.children.at(-1)!;
    candidate.exitCode = 255;
    candidate.emit("close", 255);
    await vi.advanceTimersByTimeAsync(ROUTE_HOLD_MS);
    await flush();
    expect(switched).not.toHaveBeenCalled();
    expect(tunnel.state).toMatchObject({ status: "up", target: "relay" });
    tunnel.stop();
    await flush();
  });

  it("a route answering as another cutex never takes traffic and is asked rarely", async () => {
    const verify = vi.fn(async () => ({ code: "hostMismatch", detail: "other" }) as any);
    const { tunnel, switched } = await onRoute(1, verify);
    await vi.advanceTimersByTimeAsync(ROUTE_PROBE_INTERVAL_MS);
    await flush();
    processes.sockets.at(-1)!.emit("connect");
    await flush();
    await vi.advanceTimersByTimeAsync(0);
    await flush();
    expect(verify).toHaveBeenCalledTimes(1);
    expect(switched).not.toHaveBeenCalled();
    expect(processes.children.at(-1)!.kill).toHaveBeenCalled();
    const spawned = processes.args.length;
    await vi.advanceTimersByTimeAsync(ROUTE_REFUSED_RETRY_MS - 2 * ROUTE_PROBE_INTERVAL_MS);
    expect(processes.args.length).toBe(spawned);
    await vi.advanceTimersByTimeAsync(3 * ROUTE_PROBE_SLOW_INTERVAL_MS);
    expect(processes.args.length).toBe(spawned + 1);
    tunnel.stop();
    await flush();
  });

  it("a daemon that did not answer once does not put the route off", async () => {
    const verify = vi.fn(async () => ({ code: "remoteDaemon", detail: "no answer" }) as any);
    const { tunnel, switched } = await onRoute(1, verify);
    await vi.advanceTimersByTimeAsync(ROUTE_PROBE_INTERVAL_MS);
    await flush();
    processes.sockets.at(-1)!.emit("connect");
    await flush();
    await vi.advanceTimersByTimeAsync(0);
    await flush();
    expect(switched).not.toHaveBeenCalled();
    const spawned = processes.args.length;
    await vi.advanceTimersByTimeAsync(ROUTE_PROBE_INTERVAL_MS);
    await flush();
    expect(processes.args.length).toBe(spawned + 1);
    tunnel.stop();
    await flush();
  });

  it("probes less often during a long outage, and costs one ssh per better route per round", async () => {
    const { tunnel } = await onRoute(2);
    const spawnedAt = () => processes.args.length;
    const start = spawnedAt();
    await vi.advanceTimersByTimeAsync(ROUTE_PROBE_INTERVAL_MS);
    await flush();
    expect(lastDestination()).toBe("lan");
    await fail(processes.children.length - 1);
    await flush();
    await vi.advanceTimersByTimeAsync(0);
    await flush();
    expect(lastDestination()).toBe("relay");
    await fail(processes.children.length - 1);
    await flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(spawnedAt()).toBe(start + 2);
    tunnel.stop();
    await flush();
  });

  it("a route lost soon after switching to it waits longer before the next try", async () => {
    const { tunnel } = await onRoute(1);
    await vi.advanceTimersByTimeAsync(ROUTE_PROBE_INTERVAL_MS);
    await flush();
    processes.sockets.at(-1)!.emit("connect");
    await flush();
    await vi.advanceTimersByTimeAsync(ROUTE_HOLD_MS);
    await flush();
    expect(tunnel.state.routeIndex).toBe(0);
    // Lost right after: on to the next route.
    await fail(processes.children.length - 1);
    await vi.advanceTimersByTimeAsync(ROUTE_NEXT_MS);
    await flush();
    expect(lastDestination()).toBe("relay");
    await ready();
    const spawned = processes.args.length;
    await vi.advanceTimersByTimeAsync(ROUTE_FLAP_BASE_MS - ROUTE_PROBE_INTERVAL_MS);
    expect(processes.args.length).toBe(spawned);
    await vi.advanceTimersByTimeAsync(2 * ROUTE_PROBE_INTERVAL_MS);
    expect(processes.args.length).toBe(spawned + 1);
    tunnel.stop();
    await flush();
  });

  it("names the private ports as control ports, and stop() ends every ssh", async () => {
    const { tunnel } = await onRoute(1);
    expect(tunnel.backendPorts()).toEqual([53122]);
    await vi.advanceTimersByTimeAsync(ROUTE_PROBE_INTERVAL_MS);
    await flush();
    const candidate = processes.children.at(-1)!;
    expect(tunnel.backendPorts()).toHaveLength(2);
    tunnel.stop();
    await flush();
    expect(candidate.kill).toHaveBeenCalled();
    expect(tunnel.backendPorts()).toEqual([]);
  });
});
