import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { EventEnvelope } from "@cutex-desktop/protocol";

/** Minimal in-memory imitation of cutex Management v2 event routes for tests. */
export class FakeDaemon {
  readonly token = "test-token";
  streamId = "stream-1";
  /** Answer every nonzero cursor with the r210 "streamId is required" 400 (simulates a lost streamId). */
  refuseCursors = false;
  events: EventEnvelope[] = [];
  requests: { method: string; url: string; headers: IncomingMessage["headers"]; body: string }[] = [];
  private live = new Set<ServerResponse>();
  private server: Server;
  baseUrl = "";

  constructor() {
    this.server = createServer((req, res) => void this.handle(req, res));
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    this.baseUrl = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async close(): Promise<void> {
    for (const res of this.live) res.destroy();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  emit(sessionId = "s1", method = "turn/started"): EventEnvelope {
    const sequence = this.events.length + 1;
    const envelope: EventEnvelope = {
      contractVersion: 2,
      eventId: `e${sequence}`,
      cursor: `c${sequence}`,
      streamId: this.streamId,
      sequence,
      receivedAt: new Date().toISOString(),
      cutexSessionId: sessionId,
      hostId: "host",
      source: "app_server",
      sensitivity: "owner",
      correlation: { runtimeGeneration: 1 },
      native: { kind: "notification", message: { method, params: {} } },
    };
    this.events.push(envelope);
    for (const res of this.live) res.write(sse(envelope));
    return envelope;
  }

  /** Drop all live SSE connections (simulates server dropping a lagging subscriber). */
  dropLive(): void {
    for (const res of this.live) res.destroy();
    this.live.clear();
  }

  private after(cursor: string | undefined, session: string | null): EventEnvelope[] | "expired" {
    let start = 0;
    if (cursor) {
      const index = this.events.findIndex((e) => e.cursor === cursor);
      if (index < 0) return "expired";
      start = index + 1;
    }
    return this.events.slice(start).filter((e) => !session || e.cutexSessionId === session);
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let body = "";
    for await (const chunk of req) body += chunk;
    this.requests.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body });
    if (req.headers.authorization !== `Bearer ${this.token}`) return json(res, 401, err("unauthorized"));

    const url = new URL(req.url ?? "/", "http://x");
    const streamId = url.searchParams.get("streamId");
    // cutex ≥ r210: a nonzero cursor (query or Last-Event-ID) requires streamId.
    const cursor = url.searchParams.get("after") ?? (req.headers["last-event-id"] as string | undefined) ?? "";
    if (url.pathname.startsWith("/v2/events") && cursor && cursor !== "0" && (!streamId || this.refuseCursors)) {
      return json(res, 400, { contractVersion: 2, error: { source: "cutex", code: "invalid_request", message: "streamId is required with a nonzero after cursor", retryable: false, details: {} } });
    }
    if (streamId && streamId !== this.streamId) return json(res, 409, { ...err("stream_changed"), error: { ...err("stream_changed").error, details: { resyncRequired: true } } });
    const session = url.searchParams.get("cutexSessionId");

    if (url.pathname === "/v2/events") {
      const limit = Number(url.searchParams.get("limit") ?? 100);
      const list = this.after(url.searchParams.get("after") ?? undefined, session);
      if (list === "expired") return json(res, 409, err("cursor_expired"));
      const page = list.slice(0, limit);
      return json(res, 200, {
        contractVersion: 2,
        hostId: "host",
        streamId: this.streamId,
        scope: { cutexSessionId: session },
        events: page,
        nextCursor: page.at(-1)?.cursor ?? url.searchParams.get("after"),
        checkpoint: { streamId: this.streamId, sequence: this.events.length, cursor: this.events.at(-1)?.cursor ?? null },
        scannedCount: page.length,
        hasMore: list.length > limit,
      });
    }
    if (url.pathname === "/v2/events/stream") {
      const cursor = (req.headers["last-event-id"] as string | undefined) ?? undefined;
      const list = this.after(cursor, session);
      if (list === "expired") return json(res, 409, err("cursor_expired"));
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.flushHeaders(); // real cutex flushes SSE headers immediately (write_sse_headers)
      for (const e of list) res.write(sse(e));
      this.live.add(res);
      req.on("close", () => this.live.delete(res));
      return;
    }
    return json(res, 404, err("not_found"));
  }
}

function sse(e: EventEnvelope): string {
  return `id: ${e.cursor}\nevent: cutex_management_event_v2\ndata: ${JSON.stringify(e)}\n\n`;
}

function err(code: string) {
  return { contractVersion: 2, error: { source: "cutex", code, message: code, retryable: false, details: {} } };
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}
