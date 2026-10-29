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
import { parseSshTarget } from "../src/shared/hosts";

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
});
