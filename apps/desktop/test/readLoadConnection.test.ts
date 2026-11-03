import { afterEach, expect, it, vi } from "vitest";
import type { CutexClient } from "@cutex-desktop/cutex-client";
vi.mock("../src/main/daemonFetch", () => ({ daemonFetch: (input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init) }));

vi.mock("electron", () => ({ BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] }, dialog: {}, shell: {} }));
vi.mock("@cutex-desktop/cutex-client", async original => ({
  ...await original<typeof import("@cutex-desktop/cutex-client")>(),
  // Keep the real client, admission and DaemonService connection state machine.
  // Stream transport itself is covered by foregroundRead.test.ts.
  EventFeed: class { start() {} stop() {} reconnectNow() {} },
}));
import { DaemonService } from "../src/main/daemon";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it("keeps the actual daemon connection connected when background bodies and a 30s cooldown would outlast its 15s probe", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn(async (url: string | URL | Request) => {
    const path = new URL(String(url)).pathname;
    if (path === "/v2/slow-one" || path === "/v2/slow-two") return new Response(new ReadableStream<Uint8Array>({}));
    if (path === "/v2/events/stream") return Response.json({ error: { code: "heavy_read_capacity_exceeded", retryable: true, details: { retryAfterMs: 30_000 } } }, { status: 503 });
    return Response.json(path === "/v2/host" ? { hostId: "host" } : { sessions: [], management: null });
  });
  vi.stubGlobal("fetch", fetch);
  const service = new DaemonService(() => {});
  const state = service as unknown as { client: CutexClient; connect(probe: boolean): Promise<void> };
  const bodies: Response[] = [];
  try {
    service.useEndpoint({ baseUrl: "http://connection.test", token: null }, { remote: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(service.currentState.kind).toBe("connected");
    for (const path of ["/v2/slow-one", "/v2/slow-two"]) bodies.push(await state.client.fetchRaw(state.client.url(path), {}, { background: true }));
    const refused = await state.client.fetchRaw(state.client.url("/v2/events/stream"), { headers: { Accept: "text/event-stream" } }, { background: true });
    expect(refused.status).toBe(503);
    await refused.text();
    const probe = state.connect(true);
    await vi.advanceTimersByTimeAsync(15_000);
    await probe;
    expect(service.currentState.kind).toBe("connected");
    expect(fetch.mock.calls.filter(([url]) => new URL(String(url)).pathname === "/v2/host")).toHaveLength(2);
  } finally {
    service.stop();
    await Promise.allSettled(bodies.map(response => response.body!.cancel()));
  }
});
