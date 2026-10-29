import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CutexApiError, CutexClient, ProjectEventFollower, projectBackground, projectCursorSeq, projectEventsPage, projectNextCursor, type ProjectEvent, type ProjectEventPage } from "../src/index";

const TOKEN = "cxm1.test";

const row = (seq: number, extra: Partial<ProjectEvent> = {}): ProjectEvent => ({
  cursor: `pe:${seq}`,
  at: "2026-10-23T03:00:00.000Z",
  projectId: "p1",
  cutexSessionId: "cutex.a",
  agentName: "a",
  kind: "turn.completed",
  status: "completed",
  title: `turn ${seq}`,
  detail: null,
  parent: { turnId: `t${seq}`, taskId: null, threadId: null },
  refs: { askId: null, jobId: null, artifactId: null, workflowRunId: null, approvalId: null, notificationId: null },
  source: { method: "turn/completed", eventCursor: null },
  ...extra,
});

const frame = (r: ProjectEvent) => `id: ${r.cursor}\nevent: cutex/projectEvents/event\ndata: ${JSON.stringify(r)}\n\n`;
const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};
const err = (code: string, details: unknown = {}) => ({ contractVersion: 2, error: { source: "cutex", code, message: code, retryable: false, details } });

let server: Server;
let baseUrl = "";
let seen: { url: string; lastEventId: string | undefined }[] = [];
/** Per stream request: what to answer (shifted per connection). */
let streamScript: ((res: ServerResponse, url: URL) => void)[] = [];
let pageAnswer: (url: URL, res: ServerResponse) => void = () => undefined;

beforeEach(async () => {
  seen = [];
  streamScript = [];
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://x");
    seen.push({ url: req.url ?? "", lastEventId: req.headers["last-event-id"] as string | undefined });
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return json(res, 401, err("unauthorized"));
    if (url.pathname === "/v2/projects/p1/events") return pageAnswer(url, res);
    if (url.pathname === "/v2/projects/p1/events/stream") {
      const next = streamScript.shift();
      if (!next) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(": keepalive\n\n");
        return; // held open
      }
      return next(res, url);
    }
    if (url.pathname === "/v2/projects/p1/background") return json(res, 200, { projectId: "p1", generatedAt: "2026-10-23T03:00:00Z", jobsAvailable: false, agents: [] });
    if (url.pathname.startsWith("/v2/projects/")) return json(res, 404, err("project_not_found"));
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});

const until = async (check: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 10));
  }
};

const quickSleep = (_ms: number, signal: AbortSignal) => new Promise<void>((r) => (signal.aborted ? r() : setTimeout(r, 5)));

describe("project events", () => {
  it("reads a page with filters and cursors", async () => {
    pageAnswer = (url, res) => json(res, 200, { projectId: "p1", streamId: "s1", cursor: "pe:9", earliestCursor: "pe:1", order: "newestFirst", hasMore: true, events: [row(9), row(8)], q: url.search });
    const client = new CutexClient({ baseUrl, token: TOKEN });
    const page = await projectEventsPage(client, "p1", { before: "pe:10", limit: 2, kinds: ["turn", "ask"], sessionId: "cutex.a", streamId: "s1" });
    expect(page.events.map((e) => e.cursor)).toEqual(["pe:9", "pe:8"]);
    const q = new URL(seen.at(-1)!.url, "http://x").searchParams;
    expect(Object.fromEntries(q)).toEqual({ before: "pe:10", limit: "2", kinds: "turn,ask", sessionId: "cutex.a", streamId: "s1" });
    expect(projectCursorSeq("pe:42")).toBe(42);
    expect(projectCursorSeq("c2:1")).toBeNaN();
  });

  it("maps 409 cursor_expired and 404 to CutexApiError", async () => {
    pageAnswer = (_url, res) => json(res, 409, err("cursor_expired", { streamId: "s2", earliestCursor: "pe:5", latestCursor: "pe:9" }));
    const client = new CutexClient({ baseUrl, token: TOKEN });
    const e = await projectEventsPage(client, "p1", { after: "pe:1" }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(CutexApiError);
    expect((e as CutexApiError).status).toBe(409);
    expect((e as CutexApiError).code).toBe("cursor_expired");
    await expect(projectBackground(client, "nope")).rejects.toMatchObject({ status: 404, code: "project_not_found" });
    expect((await projectBackground(client, "p1")).jobsAvailable).toBe(false);
  });

  it("follows the stream, resumes from the last cursor after a drop and skips duplicates", async () => {
    streamScript.push((res) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end(frame(row(11)) + frame(row(12)));
    });
    streamScript.push((res) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      // A replayed row is dropped; the new one comes through.
      res.write(frame(row(12)) + frame(row(13)));
    });
    const client = new CutexClient({ baseUrl, token: TOKEN });
    const got: string[] = [];
    const statuses: string[] = [];
    const f = new ProjectEventFollower(client, "p1", { event: (r) => got.push(r.cursor), status: (s) => statuses.push(s) }, { after: "pe:10", streamId: "s1", kinds: ["turn"], sleep: quickSleep }).start();
    await until(() => got.length === 3);
    f.stop();
    expect(got).toEqual(["pe:11", "pe:12", "pe:13"]);
    const streams = seen.filter((s) => s.url.includes("/events/stream"));
    expect(streams[0]!.lastEventId).toBe("pe:10");
    expect(streams[1]!.lastEventId).toBe("pe:12");
    expect(new URL(streams[0]!.url, "http://x").searchParams.get("kinds")).toBe("turn");
    expect(new URL(streams[0]!.url, "http://x").searchParams.get("streamId")).toBe("s1");
    expect(statuses).toContain("live");
    expect(statuses).toContain("retrying");
  });

  it("catches up with after= pages on lagged, then reconnects", async () => {
    streamScript.push((res) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end(frame(row(21)) + `event: cutex_management_stream_error\ndata: ${JSON.stringify(err("lagged", { lastDeliveredCursor: "pe:22", resyncRequired: false }))}\n\n`);
    });
    const afters: string[] = [];
    pageAnswer = (url, res) => {
      const after = url.searchParams.get("after")!;
      afters.push(after);
      if (after === "pe:22") return json(res, 200, { projectId: "p1", streamId: "s1", cursor: "pe:30", earliestCursor: "pe:1", order: "oldestFirst", hasMore: true, events: [row(23), row(24)] });
      return json(res, 200, { projectId: "p1", streamId: "s1", cursor: "pe:30", earliestCursor: "pe:1", order: "oldestFirst", hasMore: false, events: [row(25)] });
    };
    const client = new CutexClient({ baseUrl, token: TOKEN });
    const got: string[] = [];
    const f = new ProjectEventFollower(client, "p1", { event: (r) => got.push(r.cursor) }, { after: "pe:20", sleep: quickSleep }).start();
    await until(() => got.length === 4 && seen.filter((s) => s.url.includes("/events/stream")).length === 2);
    f.stop();
    expect(got).toEqual(["pe:21", "pe:23", "pe:24", "pe:25"]);
    expect(afters).toEqual(["pe:22", "pe:24"]);
    expect(seen.filter((s) => s.url.includes("/events/stream"))[1]!.lastEventId).toBe("pe:25");
  });

  it("lagged catch-up goes on from r252 nextCursor past an empty page", async () => {
    streamScript.push((res) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end(`event: cutex_management_stream_error
data: ${JSON.stringify(err("lagged", { lastDeliveredCursor: "pe:20", resyncRequired: false }))}

`);
    });
    const afters: string[] = [];
    pageAnswer = (url, res) => {
      const after = url.searchParams.get("after")!;
      afters.push(after);
      const base = { projectId: "p1", streamId: "s1", cursor: "pe:20000", earliestCursor: "pe:1", order: "oldestFirst" };
      // The scan budget ran out before a visible row: empty, hasMore, continue after the rows read.
      if (after === "pe:20") return json(res, 200, { ...base, hasMore: true, nextCursor: "pe:10020", events: [] });
      if (after === "pe:10020") return json(res, 200, { ...base, hasMore: true, nextCursor: "pe:15000", events: [row(12000)] });
      return json(res, 200, { ...base, hasMore: false, nextCursor: null, events: [row(15001)] });
    };
    const client = new CutexClient({ baseUrl, token: TOKEN });
    const got: string[] = [];
    const f = new ProjectEventFollower(client, "p1", { event: (r) => got.push(r.cursor) }, { after: "pe:20", sleep: quickSleep }).start();
    await until(() => got.length === 2 && seen.filter((s) => s.url.includes("/events/stream")).length === 2);
    f.stop();
    expect(afters).toEqual(["pe:20", "pe:10020", "pe:15000"]);
    expect(got).toEqual(["pe:12000", "pe:15001"]);
  });

  it("stops with reset on 409 and with failed on 404", async () => {
    streamScript.push((res) => json(res, 409, err("cursor_expired", { streamId: "s2" })));
    const client = new CutexClient({ baseUrl, token: TOKEN });
    let reset = 0;
    new ProjectEventFollower(client, "p1", { event: () => undefined, reset: () => reset++ }, { after: "pe:1", sleep: quickSleep }).start();
    await until(() => reset === 1);
    let failed: CutexApiError | null = null;
    new ProjectEventFollower(client, "gone", { event: () => undefined, failed: (e) => (failed = e) }, { after: null, sleep: quickSleep }).start();
    await until(() => failed !== null);
    expect(failed!.code).toBe("project_not_found");
  });

  it("starts live without a cursor", async () => {
    const client = new CutexClient({ baseUrl, token: TOKEN });
    const statuses: string[] = [];
    const f = new ProjectEventFollower(client, "p1", { event: () => undefined, status: (s) => statuses.push(s) }, { after: null }).start();
    await until(() => statuses.includes("live"));
    f.stop();
    const s = seen.find((x) => x.url.includes("/events/stream"))!;
    expect(s.lastEventId).toBeUndefined();
    expect(s.url).toBe("/v2/projects/p1/events/stream");
  });
});

describe("projectNextCursor", () => {
  const page = (over: Partial<ProjectEventPage>): ProjectEventPage => ({ projectId: "p1", streamId: "s1", cursor: "pe:900", earliestCursor: "pe:1", order: "newestFirst", hasMore: true, events: [], ...over });

  it("follows r252 nextCursor, also on a short or empty page", () => {
    expect(projectNextCursor(page({ events: [row(500), row(499)], nextCursor: "pe:300" }), "pe:501")).toBe("pe:300");
    expect(projectNextCursor(page({ events: [], nextCursor: "pe:300" }), "pe:501")).toBe("pe:300");
    expect(projectNextCursor(page({ order: "oldestFirst", events: [], nextCursor: "pe:700" }), "pe:501")).toBe("pe:700");
  });

  it("without nextCursor (before r252) continues from the last event; an empty page ends", () => {
    expect(projectNextCursor(page({ events: [row(500), row(499)] }), "pe:501")).toBe("pe:499");
    expect(projectNextCursor(page({ order: "oldestFirst", events: [row(502), row(503)] }), "pe:501")).toBe("pe:503");
    expect(projectNextCursor(page({ events: [] }), "pe:501")).toBeNull();
    expect(projectNextCursor(page({ hasMore: false, events: [row(500)], nextCursor: null }), "pe:501")).toBeNull();
  });

  it("stops on a cursor that does not move on", () => {
    expect(projectNextCursor(page({ nextCursor: "pe:501" }), "pe:501")).toBeNull();
    expect(projectNextCursor(page({ nextCursor: "pe:600" }), "pe:501")).toBeNull();
    expect(projectNextCursor(page({ order: "oldestFirst", nextCursor: "pe:400" }), "pe:501")).toBeNull();
    expect(projectNextCursor(page({ nextCursor: "weird" }), "weird")).toBeNull();
  });
});
