import { afterEach, describe, expect, it, vi } from "vitest";
import { CutexApiError, CutexClient, CutexUnreachableError, type SubmitHttpTraceEvent } from "../src/index";

const success = { cutex: { result: { disposition: "started", turnId: "turn-1" } } };
const capacity = { error: { code: "idempotency_capacity_exceeded", message: "private server error", retryable: true } };
const endpoint = { baseUrl: "http://private-host:123", token: "secret-token" };
function client(fetch: typeof globalThis.fetch, options: ConstructorParameters<typeof CutexClient>[1] = {}) {
  return new CutexClient(endpoint, { fetch, clientId: "desktop-test", ...options });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

afterEach(() => vi.restoreAllMocks());

describe("per-submit HTTP diagnostics", () => {
  it("separates delayed headers from delayed body and emits only bounded metadata", async () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const headers = deferred<Response>();
    const body = deferred<string>();
    const response = new Response();
    vi.spyOn(response, "text").mockImplementation(() => body.promise);
    const events: SubmitHttpTraceEvent[] = [];
    const pending = client(async () => headers.promise).submitInput("private-session", [{ text: "private prompt" }], "auto", {
      onHttpTrace: (event) => { events.push(event); },
    });
    expect(events).toEqual([]);
    now = 1200;
    headers.resolve(response);
    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(events[0]).toMatchObject({ stage: "fetch-headers", elapsedMs: 1200, outcome: "completed", status: 200, attempt: 1 });
    now = 2700;
    body.resolve(JSON.stringify(success));
    expect(await pending).toEqual(success.cutex.result);
    expect(events).toHaveLength(3);
    expect(events[1]).toMatchObject({ stage: "fetch-body", elapsedMs: 1500, outcome: "completed", status: 200 });
    expect(events[2]).toMatchObject({ stage: "response-parse", elapsedMs: 0, outcome: "completed", status: 200, parsed: true });
    expect(new Set(events.map((event) => event.requestId)).size).toBe(1);
    for (const event of events) {
      expect(Object.keys(event).every((key) => ["requestId", "attempt", "stage", "elapsedMs", "outcome", "status", "parsed"].includes(key))).toBe(true);
    }
    expect(JSON.stringify(events)).not.toMatch(/private|secret-token|turn-1/);
  });

  it("preserves fetch failures, aborts and body errors without retrying uncertain submissions", async () => {
    for (const kind of ["fetch", "abort", "body"] as const) {
      const events: SubmitHttpTraceEvent[] = [];
      const failure = kind === "abort" ? new DOMException("secret failure", "AbortError") : new Error("secret failure");
      const fetch = vi.fn(async () => {
        if (kind !== "body") throw failure;
        const response = new Response();
        vi.spyOn(response, "text").mockRejectedValue(failure);
        return response;
      });
      const pending = client(fetch).submitInput("s", [], "auto", { onHttpTrace: (event) => { events.push(event); } });
      if (kind === "fetch") await expect(pending).rejects.toBeInstanceOf(CutexUnreachableError);
      else await expect(pending).rejects.toBe(failure);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(events.at(-1)).toMatchObject({ stage: kind === "body" ? "fetch-body" : "fetch-headers", outcome: "failed", attempt: 1 });
      expect(events).toHaveLength(kind === "body" ? 2 : 1);
      expect(JSON.stringify(events)).not.toContain("secret failure");
    }
  });

  it("reports HTTP error status and malformed JSON without changing raw-text error behavior", async () => {
    const events: SubmitHttpTraceEvent[] = [];
    const pending = client(async () => new Response("private non-json error", { status: 502 })).submitInput("s", [], "auto", {
      onHttpTrace: (event) => { events.push(event); },
    });
    await expect(pending).rejects.toBeInstanceOf(CutexApiError);
    expect(events).toHaveLength(3);
    expect(events.every((event) => event.status === 502)).toBe(true);
    expect(events.at(-1)).toMatchObject({ stage: "response-parse", outcome: "completed", parsed: false });
    expect(JSON.stringify(events)).not.toContain("private");
  });

  it("correlates capacity retries with identical request and input IDs and increasing attempts", async () => {
    const events: SubmitHttpTraceEvent[] = [];
    const bodies: unknown[] = [];
    const waits: number[] = [];
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify(bodies.length === 1 ? capacity : success), { status: bodies.length === 1 ? 503 : 200 });
    });
    const result = await client(fetch, { capacityRetryDelaysMs: [400], sleep: async (ms) => { waits.push(ms); } }).submitInput("s", [], "auto", {
      clientUserMessageId: "input-1", onHttpTrace: (event) => { events.push(event); },
    });
    expect(result).toEqual(success.cutex.result);
    expect(waits).toEqual([400]);
    expect(bodies[0]).toEqual(bodies[1]);
    expect(events.map((event) => event.attempt)).toEqual([1, 1, 1, 2, 2, 2]);
    expect(events.map((event) => event.status)).toEqual([503, 503, 503, 200, 200, 200]);
    expect(new Set(events.map((event) => event.requestId)).size).toBe(1);
    expect(events[0]?.requestId).toBe((bodies[0] as { requestId: string }).requestId);
    expect(JSON.stringify(bodies)).not.toContain("onHttpTrace");
  });

  it("isolates throwing and asynchronously rejecting observers from successful retry semantics", async () => {
    for (const observer of [() => { throw new Error("sink failure"); }, async () => { throw new Error("sink failure"); }]) {
      let count = 0;
      const fetch = vi.fn(async () => {
        count++;
        return new Response(JSON.stringify(count === 1 ? capacity : success), { status: count === 1 ? 503 : 200 });
      });
      await expect(client(fetch, { capacityRetryDelaysMs: [0], sleep: async () => {} }).submitInput("s", [], "auto", { onHttpTrace: observer })).resolves.toEqual(success.cutex.result);
      expect(fetch).toHaveBeenCalledTimes(2);
    }
  });

  it("does not retain a submit observer for subsequent unrelated requests", async () => {
    const events: SubmitHttpTraceEvent[] = [];
    const c = client(async () => new Response(JSON.stringify(success)));
    await c.submitInput("s", [], "auto", { onHttpTrace: (event) => { events.push(event); } });
    await c.host();
    await c.sessions();
    await c.submitInput("s", [], "auto");
    expect(events).toHaveLength(3);
  });
});

describe("lifecycle read cancellation", () => {
  it("forwards explicit abort signals for host and sessions without changing defaults", async () => {
    const calls: { url: string; signal: AbortSignal | null | undefined }[] = [];
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), signal: init?.signal });
      return new Response("{}");
    });
    const c = client(fetch);
    const signal = new AbortController().signal;
    await c.host({ signal });
    await c.sessions("retired", { signal });
    await c.host();
    await c.sessions();
    expect(calls).toEqual([
      { url: "http://private-host:123/v2/host", signal },
      { url: "http://private-host:123/v2/sessions?lifecycle=retired", signal },
      { url: "http://private-host:123/v2/host", signal: undefined },
      { url: "http://private-host:123/v2/sessions?lifecycle=active", signal: undefined },
    ]);
  });

  it("asks for hidden sessions only when told to", async () => {
    const urls: string[] = [];
    const c = client(vi.fn(async (url: string | URL | Request) => { urls.push(String(url)); return new Response("{}"); }));
    await c.sessions("active", { includeHidden: true });
    await c.sessions("active", { includeHidden: false });
    expect(urls).toEqual([
      "http://private-host:123/v2/sessions?lifecycle=active&includeHidden=true",
      "http://private-host:123/v2/sessions?lifecycle=active",
    ]);
  });
});
