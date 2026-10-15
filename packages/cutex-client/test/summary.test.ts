import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CutexApiError, CutexClient, readSse, type HostSummary } from "../src/index";

const TOKEN = "cxm1.test";

const summary: HostSummary = {
  hostId: "HOST-A",
  hostName: "HOST-A",
  capabilities: ["host-summary", "device-pairing"],
  cursor: { streamId: "s1", after: "3" },
  generatedAt: "2026-10-08T00:00:00Z",
  projects: [],
  agents: [],
  needsYouCount: 0,
};

let server: Server;
let baseUrl = "";
let seen: { method: string; url: string; headers: IncomingMessage["headers"]; body: string }[] = [];

function handle(req: IncomingMessage, res: ServerResponse, body: string) {
  seen.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body });
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname === "/v2/pair") {
    const parsed = JSON.parse(body) as { code: string };
    if (parsed.code !== "K7QM2XPA") {
      res.writeHead(401, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ contractVersion: 2, error: { source: "cutex", code: "invalid_pairing_code", message: "no", retryable: false } }));
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ device: { tokenId: "mct-1", kind: "device" }, token: TOKEN, hostId: "HOST-A", hostName: "HOST-A" }));
  }
  if (req.headers.authorization !== `Bearer ${TOKEN}`) {
    res.writeHead(401, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ contractVersion: 2, error: { source: "cutex", code: "unauthorized", message: "no", retryable: false } }));
  }
  if (url.pathname === "/v2/summary") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(summary));
  }
  if (url.pathname === "/v2/summary/read" && req.method === "POST") {
    const parsed = JSON.parse(body) as { agentId?: string };
    if (parsed.agentId !== "cutex.a") {
      res.writeHead(404, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ contractVersion: 2, error: { source: "cutex", code: "session_not_found", message: "no", retryable: false } }));
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ agentId: parsed.agentId, readAt: "2026-10-08T00:00:01Z", summaryQueued: true, notificationAcknowledged: false }));
  }
  if (url.pathname === "/v2/summary/events") {
    if (req.headers["last-event-id"] === "1") {
      res.writeHead(409, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ contractVersion: 2, error: { source: "cutex", code: "cursor_expired", message: "old", retryable: false, details: { earliestCursor: "2" } } }));
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(": keepalive\n\n");
    res.write('id: 4\nevent: cutex/summary/agentRemoved\ndata: {"id":"a"}\n\n');
    res.write('id: 5\nevent: cutex/summary/approvalsChanged\ndata: {"count":2}\n\n');
    return res.end();
  }
  res.writeHead(404);
  res.end();
}

beforeEach(async () => {
  seen = [];
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => handle(req, res, body));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe("mobile API", () => {
  it("pairs without a credential", async () => {
    const r = await CutexClient.pair(`${baseUrl}/`, { code: "K7QM2XPA", deviceName: "Pixel", platform: "android" });
    expect(r.token).toBe(TOKEN);
    expect(seen[0]!.headers.authorization).toBeUndefined();
    expect(JSON.parse(seen[0]!.body)).toEqual({ code: "K7QM2XPA", deviceName: "Pixel", platform: "android" });
    await expect(CutexClient.pair(baseUrl, { code: "WRONG000" })).rejects.toMatchObject({ status: 401, code: "invalid_pairing_code" });
  });

  it("reads the summary and streams events with Last-Event-ID", async () => {
    const client = new CutexClient({ baseUrl, token: TOKEN });
    expect((await client.summary()).cursor.after).toBe("3");
    const comments: string[] = [];
    const response = await client.summaryEvents({ after: "3", streamId: "s1" });
    const got = [];
    for await (const m of readSse(response, (c) => comments.push(c))) got.push(m);
    expect(got.map((m) => [m.id, m.event])).toEqual([
      ["4", "cutex/summary/agentRemoved"],
      ["5", "cutex/summary/approvalsChanged"],
    ]);
    expect(comments).toEqual(["keepalive"]);
    const req = seen.at(-1)!;
    expect(req.headers["last-event-id"]).toBe("3");
    expect(req.url).toContain("streamId=s1");
  });

  it("marks an agent read (summary-read)", async () => {
    const client = new CutexClient({ baseUrl, token: TOKEN });
    const r = await client.summaryRead("cutex.a");
    expect(r).toEqual({ agentId: "cutex.a", readAt: "2026-10-08T00:00:01Z", summaryQueued: true, notificationAcknowledged: false });
    const req = seen.at(-1)!;
    expect(req.method).toBe("POST");
    expect(req.url).toBe("/v2/summary/read");
    expect(JSON.parse(req.body)).toEqual({ agentId: "cutex.a" });
    await expect(client.summaryRead("cutex.missing")).rejects.toMatchObject({ status: 404, code: "session_not_found" });
  });

  it("starts live without a cursor and reports cursor_expired", async () => {
    const client = new CutexClient({ baseUrl, token: TOKEN });
    const live = await client.summaryEvents();
    await live.body?.cancel();
    expect(seen.at(-1)!.headers["last-event-id"]).toBeUndefined();
    expect(seen.at(-1)!.url).toBe("/v2/summary/events");
    const error = await client.summaryEvents({ after: "1" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CutexApiError);
    expect((error as CutexApiError).code).toBe("cursor_expired");
    expect((error as CutexApiError).requiresResync).toBe(true);
  });
});
