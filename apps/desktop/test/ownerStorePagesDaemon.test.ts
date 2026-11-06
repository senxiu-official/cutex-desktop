import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("electron", () => ({ BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] }, dialog: {}, shell: {} }));
import { DaemonService } from "../src/main/daemon";
import { SSE_EVENT } from "@cutex-desktop/protocol";
import { NOTIFICATION_PAGES_FEATURE } from "../src/shared/notificationPaging";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });
const record = (id: string) => ({ notificationId: id, agentId: "agent", text: id, level: "info", state: "open" });
async function setup(paged: boolean, fail = false, holdContinuation = false) {
  const requests: URL[] = [];
  let release: (() => void) | undefined;
  let send: ((data: string) => void) | undefined;
  const server = createServer((req, res) => {
    const url = new URL(req.url!, "http://127.0.0.1"); requests.push(url);
    const json = (value: unknown) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(value)); };
    if (url.pathname === "/v2/host") return json({ hostId: "host" });
    if (url.pathname === "/v2/capabilities") return json({ featureList: paged ? [NOTIFICATION_PAGES_FEATURE] : [] });
    if (url.pathname === "/v2/sessions") return json({ sessions: [], management: { eventStream: { streamId: "stream", latest: { cursor: "c0" } } } });
    if (url.pathname === "/v2/events") return json({ streamId: "stream", events: [], nextCursor: "c0", hasMore: false });
    if (url.pathname === "/v2/events/stream") { res.writeHead(200, { "Content-Type": "text/event-stream" }); res.write(": connected\n\n"); send = data => res.write(data); return; }
    if (url.pathname === "/v2/approvals" || url.pathname === "/v2/owner-notifications") {
      const key = url.pathname === "/v2/approvals" ? "approvals" : "notifications";
      if (fail && url.searchParams.has("limit")) { res.statusCode = 403; return json({ contractVersion: 2, error: { code: "forbidden", message: "denied" } }); }
      const first = key === "approvals" ? { approvalId: "one" } : record("one");
      const second = key === "approvals" ? { approvalId: "two" } : record("two");
      if (!url.searchParams.has("limit")) return json({ [key]: [first, second] });
      if (holdContinuation && key === "approvals" && url.searchParams.has("cursor")) { release = () => json({ approvals: [second] }); return; }
      return json(url.searchParams.has("cursor") ? { [key]: [second] } : { [key]: [first], nextCursor: "opaque+/=&" });
    }
    res.writeHead(404); res.end();
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const emitted = vi.fn();
  const service = new DaemonService(emitted);
  const port = (server.address() as { port: number }).port;
  service.useEndpoint({ baseUrl: `http://127.0.0.1:${port}`, token: "test-only" }, { remote: true });
  cleanup.push(async () => { service.stop(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  await vi.waitFor(() => expect(requests.some(url => url.pathname === "/v2/host")).toBe(true));
  return { service, requests, emitted, held: () => release, send: (data: string) => send?.(data) };
}
describe("desktop owner-store capability gate over real loopback HTTP", () => {
  it("uses bounded requests for pending approvals and byte-short notification results", async () => {
    const { service, requests } = await setup(true);
    expect(await service.approvals("pending")).toEqual([{ approvalId: "one" }, { approvalId: "two" }]);
    expect((await service.ownerNotifications({ filter: "pending", limit: 2 })).map(r => r.notificationId)).toEqual(["one", "two"]);
    const reads = requests.filter(url => ["/v2/approvals", "/v2/owner-notifications"].includes(url.pathname));
    expect(reads).toHaveLength(4);
    expect(reads.every(url => url.searchParams.has("limit"))).toBe(true);
    expect(reads[1]!.searchParams.get("cursor")).toBe("opaque+/=&");
    const page = await service.approvalsPage("all", { limit: 10 });
    expect(page?.nextCursor).toBe("opaque+/=&"); // history reads one page only
    expect(requests.filter(url => url.pathname === "/v2/approvals")).toHaveLength(3);
  });
  it("keeps old-host requests unchanged", async () => {
    const { service, requests } = await setup(false);
    await service.approvals("pending"); await service.ownerNotifications({ filter: "pending", limit: 2 });
    const approval = requests.find(url => url.pathname === "/v2/approvals")!;
    expect(approval.searchParams.has("limit")).toBe(false);
    expect(approval.searchParams.has("cursor")).toBe(false);
    expect(requests.find(url => url.pathname === "/v2/owner-notifications")!.searchParams.get("limit")).toBe("2");
  });
  it("never falls back to the unbounded approvals route after a paged refusal", async () => {
    const { service, requests } = await setup(true, true);
    await expect(service.approvals("pending")).rejects.toThrow();
    const reads = requests.filter(url => url.pathname === "/v2/approvals");
    expect(reads).toHaveLength(1); expect(reads[0]!.searchParams.has("limit")).toBe(true);
  });
  it("a live decision received between pages wins over an earlier pending page", async () => {
    const h = await setup(true, false, true);
    const pending = h.service.approvals("pending");
    await vi.waitFor(() => expect(h.held()).toBeDefined());
    const envelope = { contractVersion: 2, eventId: "decision", cursor: "c1", streamId: "stream", sequence: 1,
      receivedAt: "2026-11-04T00:00:00Z", cutexSessionId: "cutex.host", hostId: "host", source: "cutex", sensitivity: "owner", correlation: {},
      cutex: { method: "cutex/approvals/changed", params: { reason: "approved", approval: { approvalId: "one", state: "approved" } } } };
    h.send(`id: c1\nevent: ${SSE_EVENT}\ndata: ${JSON.stringify(envelope)}\n\n`);
    await vi.waitFor(() => expect(h.emitted.mock.calls.some(([name]) => name === "hostEvent")).toBe(true));
    h.held()!();
    expect(await pending).toEqual([{ approvalId: "two" }]);
  });
});
