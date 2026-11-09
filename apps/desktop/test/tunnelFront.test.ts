// The fixed local port in front of a host's SSH routes, over real loopback sockets (never a daemon).
import { createServer, connect, type Server, type Socket } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TunnelFront } from "../src/main/tunnelFront";

const servers: Server[] = [];
const sockets: Socket[] = [];

/** An echoing backend named by a prefix, so a test can see which route answered. */
async function backend(name: string): Promise<number> {
  const server = createServer({ allowHalfOpen: true }, (socket) => {
    socket.on("error", () => {});
    socket.on("data", (data) => socket.write(`${name}:${data.toString()}`));
    socket.on("end", () => socket.end(`${name}:end`));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as { port: number }).port;
}

function dial(port: number): Promise<Socket & { text(): string; ended: Promise<void> }> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port, allowHalfOpen: true }) as Socket & { text(): string; ended: Promise<void> };
    sockets.push(socket);
    let text = "";
    socket.on("data", (d) => (text += d.toString()));
    socket.text = () => text;
    socket.ended = new Promise((done) => socket.once("close", () => done()));
    socket.on("end", () => socket.end());
    socket.on("error", () => {});
    socket.once("error", reject);
    socket.once("connect", () => resolve(socket));
  });
}

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

describe("TunnelFront", () => {
  it("keeps one port; open connections stay on their route, new ones follow the current route", async () => {
    const drained = vi.fn();
    const front = new TunnelFront(drained);
    const [a, b] = [await backend("a"), await backend("b")];
    const port = await front.listen(null);
    front.use(a);
    const old = await dial(port);
    old.write("1");
    await vi.waitFor(() => expect(old.text()).toBe("a:1"));

    front.use(b);
    const fresh = await dial(port);
    fresh.write("2");
    await vi.waitFor(() => expect(fresh.text()).toBe("b:2"));
    old.write("3");
    await vi.waitFor(() => expect(old.text()).toBe("a:1a:3"));
    expect(front.connections(a)).toBe(1);
    expect(front.connections(b)).toBe(1);
    expect(drained).not.toHaveBeenCalled();
    expect(await front.listen(null)).toBe(port);

    old.end();
    await old.ended;
    await vi.waitFor(() => expect(drained).toHaveBeenCalledWith(a));
    expect(old.text()).toBe("a:1a:3a:end");
    expect(front.connections(a)).toBe(0);
    expect(drained).toHaveBeenCalledTimes(1);
    front.close();
  });

  it("does not report the current route as drained", async () => {
    const drained = vi.fn();
    const front = new TunnelFront(drained);
    const a = await backend("a");
    front.use(a);
    const socket = await dial(await front.listen(null));
    socket.write("1");
    await vi.waitFor(() => expect(socket.text()).toBe("a:1"));
    socket.end();
    await socket.ended;
    await vi.waitFor(() => expect(front.connections(a)).toBe(0));
    expect(drained).not.toHaveBeenCalled();
    front.close();
  });

  it("closes connections at once while no route is up, and when the route refuses", async () => {
    const front = new TunnelFront(() => {});
    const port = await front.listen(null);
    const none = await dial(port).catch(() => null);
    if (none) await none.ended;
    const closed = await backend("gone");
    await new Promise((resolve) => servers.pop()!.close(resolve));
    front.use(closed);
    const refused = await dial(port).catch(() => null);
    if (refused) await refused.ended;
    await vi.waitFor(() => expect(front.connections(closed)).toBe(0));
    front.close();
  });

  it("passes a large response through whole when the backend closes right after writing it", async () => {
    const payload = Buffer.alloc(8 * 1024 * 1024, 7);
    const server = createServer((socket) => {
      socket.on("error", () => {});
      socket.end(payload);
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const front = new TunnelFront(() => {});
    front.use((server.address() as { port: number }).port);
    const port = await front.listen(null);
    let received = 0;
    await new Promise<void>((resolve, reject) => {
      const socket = connect({ host: "127.0.0.1", port });
      sockets.push(socket);
      socket.on("data", (d) => (received += d.length));
      socket.on("error", reject);
      socket.on("close", () => resolve());
    });
    expect(received).toBe(payload.length);
    front.close();
  });

  it("takes a preferred port and falls back when it is taken; close ends open connections", async () => {
    const first = new TunnelFront(() => {});
    const port = await first.listen(null);
    const second = new TunnelFront(() => {});
    const other = await second.listen(port);
    expect(other).not.toBe(port);
    second.close();
    const a = await backend("a");
    first.use(a);
    const socket = await dial(port);
    socket.write("1");
    await vi.waitFor(() => expect(socket.text()).toBe("a:1"));
    first.close();
    await socket.ended;
    const third = new TunnelFront(() => {});
    await vi.waitFor(async () => expect(await third.listen(port)).toBe(port));
    third.close();
  });
});
