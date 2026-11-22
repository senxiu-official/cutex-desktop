// Cross-review 2026-11-15 (gate-notice-review): main's cancel ends a real stalled response and its socket; a retry works.
import { createServer } from "node:http";
import { once } from "node:events";
import { expect, it, vi } from "vitest";
vi.mock("electron", () => ({ BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] }, dialog: {}, shell: {} }));
import { CutexClient } from "@cutex-desktop/cutex-client";
import { DaemonService } from "../src/main/daemon";

it("main cancellation aborts a real stalled response body, closes its socket, and allows retry", async () => {
  let accepted!: () => void;
  const received = new Promise<void>(resolve => { accepted = resolve; });
  let closed!: () => void;
  const disconnected = new Promise<void>(resolve => { closed = resolve; });
  let calls = 0;
  const server = createServer((req, res) => {
    expect(req.url).toBe("/v2/runtimes/prune");
    if (++calls === 1) {
      req.socket.once("close", closed);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.flushHeaders();
      res.write('{"versions":');
      accepted();
    } else {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"versions":[]}');
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  const daemon = new DaemonService(() => {});
  const client = new CutexClient({ baseUrl: `http://127.0.0.1:${port}`, token: null });
  (daemon as unknown as { client: CutexClient }).client = client;
  try {
    const operation = daemon.runtimePrunePlan().catch(error => error);
    await received;
    daemon.cancelRuntimePrunePlan();
    const error = await operation;
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain("cancelled");
    await disconnected;
    expect((daemon as unknown as { prunePlanReads: Set<unknown> }).prunePlanReads.size).toBe(0);
    expect(await daemon.runtimePrunePlan()).toEqual({ versions: [] });
    expect(calls).toBe(2);
    expect((daemon as unknown as { prunePlanReads: Set<unknown> }).prunePlanReads.size).toBe(0);
  } finally {
    daemon.cancelRuntimePrunePlan();
    client.dispose();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}, 10_000);
