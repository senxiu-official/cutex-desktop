// main/daemon.ts watchWorkspace: the watch stream reconnects on a silent connection (idle timeout)
// and a second `ready` (stream re-opened, changes in the gap unknown) tells the views to reload all.
import { describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ streams: [] as { path: string; handlers: { onMessage(m: { event: string; data: string }): void }; options: Record<string, unknown> }[] }));
vi.mock("electron", () => ({
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  dialog: {},
  shell: {},
}));
vi.mock("@cutex-desktop/cutex-client", () => ({
  CutexClient: class {
    constructor(public endpoint: unknown) {}
    host() { return new Promise(() => {}); }
    sessions() { return new Promise(() => {}); }
  },
  CutexApiError: class extends Error {},
  CutexUnreachableError: class extends Error {},
  EventFeed: class {
    reconnectNow = vi.fn();
    start = vi.fn();
    stop = vi.fn();
  },
  openStream: (_client: unknown, path: string, handlers: never, options: Record<string, unknown>) => {
    fixture.streams.push({ path, handlers, options });
    return { close: vi.fn() };
  },
}));
import { DaemonService } from "../src/main/daemon";

describe("watchWorkspace", () => {
  it("forwards batches, turns a re-sent ready into a full reload and sets an idle timeout", async () => {
    const events: [string, unknown][] = [];
    const service = new DaemonService(((event: string, payload: unknown) => events.push([event, payload])) as never);
    service.useEndpoint({ baseUrl: "http://a.invalid", token: "t" } as never, { remote: false });
    const watchId = await service.watchWorkspace({ kind: "project", id: "p1" });
    const stream = fixture.streams.at(-1)!;
    expect(stream.path).toBe("/v2/projects/p1/fs/watch");
    expect(stream.options).toMatchObject({ reconnect: true, idleTimeoutMs: 45_000 });
    const changed = () => events.filter(([e]) => e === "workspaceChanged").map(([, p]) => p);
    stream.handlers.onMessage({ event: "ready", data: "{}" });
    expect(changed()).toEqual([]);
    stream.handlers.onMessage({ event: "changed", data: JSON.stringify({ paths: ["a.txt"], gitChanged: false, overflow: false }) });
    stream.handlers.onMessage({ event: "ready", data: "{}" });
    expect(changed()).toEqual([
      { watchId, paths: ["a.txt"], gitChanged: false, overflow: false },
      { watchId, paths: [], gitChanged: true, overflow: true },
    ]);
  });
});
