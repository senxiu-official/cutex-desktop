import { createServer, type ServerResponse } from "node:http";
import { expect, it, vi } from "vitest";
vi.mock("electron", () => ({ BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] }, dialog: {}, shell: {} }));
import { DaemonService } from "../src/main/daemon";

it("real HTTP → main sidebar applies keyed edits and a gap without whole lists or write actions", async () => {
  let stream: ServerResponse | undefined;
  let name = "before", id = "cutex.a", sequence = 1, gap = false;
  const calls: { method: string; path: string }[] = [];
  const metadata = { hostId: "fixture", claudeRuntime: { selectedRelease: "claude-r21" } };
  const server = createServer((req, res) => {
    const url = new URL(req.url!, "http://127.0.0.1"); calls.push({ method: req.method!, path: url.pathname });
    const json = (value: unknown) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(value)); };
    if (url.pathname === "/v2/host") return json({ hostId: "fixture" });
    if (url.pathname === "/v2/capabilities") return json({ featureList: ["session-deltas-v1", "session-deltas-host-v1"], user: { isOwner: true } });
    if (url.pathname === "/v2/events/stream") {
      stream = res; res.writeHead(200, { "Content-Type": "text/event-stream" }); res.write(": connected\n\n"); return;
    }
    if (url.pathname === "/v2/events") return json({ streamId: "stream", events: [], nextCursor: "tail", hasMore: false });
    if (url.pathname === "/v2/sessions/page") return json({
      ...metadata, sessions: url.searchParams.get("lifecycle") === "active" ? [{ cutexSessionId: id, revision: sequence }] : [],
      changeCursor: String(sequence), nextCursor: null, oversizeFirst: false,
    });
    if (url.pathname === "/v2/sessions/changes") {
      if (gap) { gap = false; return json({ ...metadata, resyncRequired: true, reason: "BelowRetention" }); }
      return json({ ...metadata, resyncRequired: false,
        changes: Number(url.searchParams.get("cursor")) < sequence ? [{ seq: sequence, key: id, revision: sequence, deleted: false }] : [],
        nextCursor: String(sequence), watermark: sequence, more: false, oversizeFirst: false,
      });
    }
    if (url.pathname === `/v2/sessions/${id}`) return json({
      cutexSessionId: id, lifecycle: "active", visible: true, displayName: name, revision: 9000 + sequence,
      runtime: { status: "offline", runtimeGeneration: 0 },
    });
    if (url.pathname === `/v2/host/sessions/${id}`) return json({ schema: "cutex/host-sessions/v1", data: [{ id, name, projectId: "p" }], nextCursor: null });
    if (url.pathname === "/v2/agent-management/projects") return json({ projects: [] });
    res.writeHead(404); res.end();
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const emit = vi.fn();
  const service = new DaemonService(emit);
  try {
    const port = (server.address() as { port: number }).port;
    service.useEndpoint({ baseUrl: `http://127.0.0.1:${port}`, token: "fixture" }, { remote: true });
    await vi.waitFor(() => expect(stream).toBeDefined());
    await vi.waitFor(() => expect(emit).toHaveBeenCalledWith("hostResync", { reason: "session_status_reconnected" }));
    const first = await service.sidebar();
    expect(first.active[0]?.displayName).toBe("before"); expect(first.claudeRuntime).toEqual(metadata.claudeRuntime);
    name = "after"; sequence++;
    const updated = await service.sidebar();
    expect(updated.active[0]?.displayName).toBe("after"); expect(updated.hostRows?.[id]?.name).toBe("after");
    expect(calls.filter(call => call.path === "/v2/agent-management/projects")).toHaveLength(1);
    id = "cutex.replacement"; name = "replacement"; sequence++; gap = true;
    const resynced = await service.sidebar();
    expect(resynced.active.map(row => row.cutexSessionId)).toEqual([id]);
    expect(Object.keys(resynced.hostRows!)).toEqual([id]);
    expect(calls.filter(call => call.path === "/v2/sessions/page")).toHaveLength(4);
    expect(calls.some(call => call.path === "/v2/sessions" || call.path === "/v2/host/sessions")).toBe(false);
    expect(calls.every(call => call.method === "GET")).toBe(true);
  } finally {
    service.stop(); stream?.end(); server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}, 20_000);
