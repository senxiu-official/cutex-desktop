// A large HTML file page from a remote host (owner 2026-11-14): main's DaemonService reads it from that host's cutex
// over HTTP in windows (fs/file `offset`, capability fs-file-window) — the workspace route and the host route —
// and the page service assembles one offline document. Nothing touches the local file system; the token stays in main.
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CutexClient } from "@cutex-desktop/cutex-client";
import { createFrameDocumentStore } from "@cutex-desktop/opaque-frame/documents";
vi.mock("electron", () => ({ BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] }, dialog: {}, shell: {} }));
import { DaemonService } from "../src/main/daemon";
import { createArtifactPageService } from "../src/main/frames";
import { FILE_PAGE_MAX_BYTES, FILE_PAGE_WINDOW_BYTES } from "../src/shared/frames";
import { bigPage, cutexFileWindow, MiB } from "./helpers/cutexFileWindow";

const TOKEN = "private-remote-test-token";
let server: Server, baseUrl: string, page: Buffer, windowed: boolean;
let requests: { route: string; path: string | null; offset: string | null; maxBytes: string | null; auth: string | undefined }[];

beforeEach(async () => {
  requests = [];
  windowed = true;
  page = bigPage(Math.round(11.3 * MiB));
  server = createServer((req, res) => {
    const url = new URL(req.url!, "http://127.0.0.1");
    res.setHeader("content-type", "application/json");
    const route = url.pathname;
    if (route === "/v2/fs/file" || route === "/v2/projects/proj_remote/fs/file") {
      requests.push({ route, path: url.searchParams.get("path"), offset: url.searchParams.get("offset"), maxBytes: url.searchParams.get("maxBytes"), auth: req.headers.authorization });
      const max = Number(url.searchParams.get("maxBytes"));
      if (!(max >= 1 && max <= 10 * MiB)) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: { code: "invalid_request", message: "maxBytes" } }));
      }
      // An older cutex ignores `offset` and answers from byte 0 without echoing it.
      const offset = windowed ? Number(url.searchParams.get("offset") ?? 0) : 0;
      return res.end(JSON.stringify(cutexFileWindow(page, offset, max, { windowed, path: url.searchParams.get("path") ?? "" })));
    }
    res.statusCode = 404;
    res.end("{}");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});

function remote() {
  const daemon = new DaemonService(() => {});
  (daemon as unknown as { client: CutexClient }).client = new CutexClient({ baseUrl, token: TOKEN });
  (daemon as unknown as { state: unknown }).state = { kind: "connected", hostId: "remote", instanceId: "remote-instance" };
  const documents = createFrameDocumentStore({ scheme: "cutex-plugin" });
  const service = createArtifactPageService({
    documents,
    contentReader: () => null,
    ensureContained: async () => {},
    fileReader: (hostId) => (hostId === "remote" ? daemon : null),
  });
  return { documents, service };
}

describe("a large file page from a remote host", () => {
  it("workspace route: asks first, then reads 10 MiB windows over HTTP and serves the whole page", async () => {
    const { documents, service } = remote();
    const input = { hostId: "remote", path: "review/grow-wide.html", scope: { kind: "project" as const, id: "proj_remote" } };
    expect(await service.prepareFile(3, input)).toMatchObject({ ok: false, reason: "too-large", totalBytes: page.length, maxBytes: FILE_PAGE_MAX_BYTES });
    const r = await service.prepareFile(3, { ...input, large: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const html = await documents.respond(new Request(r.frame.url)).text();
    expect(html.endsWith(page.toString("utf8").replace(/^<!doctype html>/i, ""))).toBe(true);
    // One read to ask, then the windows: every one through that host's workspace route with main's token.
    expect(requests.map((q) => q.route).every((route) => route === "/v2/projects/proj_remote/fs/file")).toBe(true);
    expect(requests.every((q) => q.auth === `Bearer ${TOKEN}` && q.path === "review/grow-wide.html")).toBe(true);
    const windows = requests.slice(1);
    expect(windows.map((q) => q.maxBytes)).toEqual(windows.map(() => String(FILE_PAGE_WINDOW_BYTES)));
    expect(windows[0]!.offset).toBe("0");
    expect(windows.length).toBe(2);
    expect(Number(windows[1]!.offset)).toBeGreaterThan(FILE_PAGE_WINDOW_BYTES - 4);
  });

  it("host route (an absolute path on that host) reads the same windows", async () => {
    const { service } = remote();
    const r = await service.prepareFile(3, { hostId: "remote", path: "/srv/decisions-site/review/grow-wide.html", large: true });
    expect(r.ok).toBe(true);
    expect(requests.map((q) => q.route)).toEqual(["/v2/fs/file", "/v2/fs/file"]);
  });

  it("an older remote cutex: one read, over 10 MiB source only", async () => {
    windowed = false;
    const { service } = remote();
    expect(await service.prepareFile(3, { hostId: "remote", path: "/srv/a.html", large: true })).toMatchObject({ ok: false, reason: "too-large", maxBytes: FILE_PAGE_WINDOW_BYTES });
    expect(requests.length).toBe(1);
  });

  it("the window reader is main-only: not in the renderer's daemon method list", () => {
    const index = readFileSync(join(__dirname, "../src/main/index.ts"), "utf8");
    expect(index).not.toContain('"fileWindow"');
  });
});
