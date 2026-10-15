// After the daemon answers again (SSH tunnel back), session feeds waiting out their backoff reconnect
// at once (main/daemon.ts connect → kickSessionFeeds), also when the state was already "connected".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ feeds: [] as any[], host: null as null | ((options: { signal: AbortSignal }) => Promise<unknown>), sessions: null as null | ((options: { signal: AbortSignal }) => Promise<unknown>) }));
vi.mock("electron", () => ({
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  dialog: {},
  shell: {},
}));
vi.mock("@cutex-desktop/cutex-client", () => ({
  CutexClient: class {
    constructor(public endpoint: unknown) {}
    host(options: { signal: AbortSignal }) { return fixture.host!(options); }
    sessions(_lifecycle: unknown, options: { signal: AbortSignal }) { return fixture.sessions!(options); }
  },
  CutexApiError: class extends Error {},
  CutexUnreachableError: class extends Error {},
  EventFeed: class {
    reconnectNow = vi.fn();
    start = vi.fn();
    stop = vi.fn();
    constructor(public client: unknown, public handlers: any, public options: { cutexSessionId?: string }) { fixture.feeds.push(this); }
  },
  openStream: vi.fn(),
}));
import { DaemonService } from "../src/main/daemon";

async function settle() { for (let i = 0; i < 10; i++) await Promise.resolve(); }
const sessionFeeds = () => fixture.feeds.filter((f) => f.options?.cutexSessionId);

let service: DaemonService;
beforeEach(() => {
  fixture.feeds.length = 0;
  fixture.sessions = () => Promise.resolve({ sessions: [], management: null });
  vi.useFakeTimers();
  service = new DaemonService(() => {});
});

describe("connection reads and host feed ownership", () => {
  const endpoint = { baseUrl: "http://a.invalid", token: "t" } as any;
  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
  }
  function stalled({ signal }: { signal: AbortSignal }) {
    return new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true }));
  }

  it("retries a stalled host probe instead of remaining connecting forever", async () => {
    fixture.host = vi.fn().mockImplementationOnce(stalled).mockResolvedValue({ hostId: "h" });
    service.useEndpoint(endpoint, { remote: true });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(service.currentState.kind).toBe("error");
    await vi.advanceTimersByTimeAsync(5000);
    expect(service.currentState.kind).toBe("connected");
    expect(fixture.feeds).toHaveLength(1);
  });

  it("falls back to paged tail recovery when the initial sessions read stalls", async () => {
    fixture.host = async () => ({ hostId: "h" });
    fixture.sessions = stalled;
    service.useEndpoint(endpoint, { remote: true });
    await settle();
    expect(fixture.feeds).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(fixture.feeds).toHaveLength(1);
    expect(fixture.feeds[0].options.fromLatest).toBe(true);
  });

  it("does not attach an old endpoint's tail read after switching endpoints", async () => {
    const old = deferred<unknown>();
    fixture.host = async () => ({ hostId: "h" });
    fixture.sessions = () => old.promise; // Deliberately ignores abort to test the generation fence.
    service.useEndpoint(endpoint, { remote: true });
    await settle();
    fixture.sessions = async () => ({ management: { eventStream: { streamId: "new" } } });
    service.useEndpoint({ ...endpoint, baseUrl: "http://b.invalid" }, { remote: true });
    await settle();
    old.resolve({ management: { eventStream: { streamId: "old" } } });
    await settle();
    expect(fixture.feeds).toHaveLength(1);
    expect(fixture.feeds[0].options.streamId).toBe("new");
    expect(fixture.feeds[0].start).toHaveBeenCalledTimes(1);
  });

  it("drops an older same-endpoint failed probe after the newer one succeeds", async () => {
    const old = deferred<unknown>();
    fixture.host = () => old.promise;
    service.useEndpoint(endpoint, { remote: true });
    fixture.host = async () => ({ hostId: "h" });
    service.reconnectNow();
    await settle();
    old.reject(new Error("old connection failed"));
    await settle();
    expect(service.currentState.kind).toBe("connected");
    await vi.advanceTimersByTimeAsync(5000);
    expect(fixture.feeds).toHaveLength(1);
  });

  it("fences overlapping tail restarts and stopped-feed callbacks", async () => {
    fixture.host = async () => ({ hostId: "h" });
    service.useEndpoint(endpoint, { remote: true });
    await settle();
    const first = fixture.feeds[0];
    const old = deferred<unknown>();
    fixture.sessions = () => old.promise;
    first.handlers.resync();
    // A second callback from the stopped feed cannot start another read/feed.
    first.handlers.resync();
    service.stop();
    old.resolve({ management: null });
    await settle();
    expect(fixture.feeds).toHaveLength(1);
    expect(first.stop).toHaveBeenCalled();
  });
});
afterEach(() => {
  service.stop();
  vi.useRealTimers();
});

describe("session feeds after a reconnect", () => {
  it("are kicked when the daemon becomes connected again", async () => {
    let up = true;
    fixture.host = () => (up ? Promise.resolve({ hostId: "h" }) : Promise.reject(new Error("down")));
    service.useEndpoint({ baseUrl: "http://a.invalid", token: "t" } as any, { remote: true });
    await settle();
    await service.subscribe("s1", { streamId: "x", after: null });
    const [feed] = sessionFeeds();
    expect(feed.reconnectNow).not.toHaveBeenCalled();
    // The tunnel drops: connect fails, the 5 s retry is pending; then the tunnel is back.
    up = false;
    (service as any).state = { kind: "unreachable", baseUrl: "", message: "" };
    service.reconnectNow();
    await settle();
    up = true;
    service.reconnectNow();
    await settle();
    expect(feed.reconnectNow).toHaveBeenCalled();
  });

  it("are kicked by reconnectNow / retarget while the state still says connected", async () => {
    fixture.host = () => Promise.resolve({ hostId: "h" });
    service.useEndpoint({ baseUrl: "http://a.invalid", token: "t" } as any, { remote: true });
    await settle();
    await service.subscribe("s1", { streamId: "x", after: null });
    const [feed] = sessionFeeds();
    service.retarget("http://b.invalid");
    expect(feed.reconnectNow).toHaveBeenCalledTimes(1);
  });
});
