import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CutexClient } from "@cutex-desktop/cutex-client";
vi.mock("electron", () => ({ BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] }, dialog: {}, shell: {} }));
import { DaemonService } from "../src/main/daemon";
import { ImageCache, installImageCache } from "../src/main/imageCache";
let server: Server, root: string, endpoint: { baseUrl: string; token: string }, daemon: DaemonService;
let artifactExternal = false, artifactChanged = false, artifactMedia = "image/png", detailReads = 0;
let full = 0, metadata = 0, mediaReads = 0, artifactReads = 0, gone = false, revision = "v1";
const bytes = Buffer.from("89504e470d0a1a0a", "hex"), sha = createHash("sha256").update(bytes).digest("hex");
const id = `af-${"a".repeat(32)}`, session = `cutex.${"b".repeat(32)}`;
function service() {
  const d = new DaemonService(() => {});
  (d as any).client = new CutexClient(endpoint);
  (d as any).state = { kind: "connected", hostId: "remote", instanceId: "remote-instance" };
  return d;
}
beforeEach(async () => {
  full = metadata = mediaReads = artifactReads = 0; gone = false; revision = "v1"; artifactExternal = artifactChanged = false; artifactMedia = "image/png"; detailReads = 0;
  root = await mkdtemp(join(tmpdir(), "cutex-image-cache-http-"));
  server = createServer((req, res) => {
    const url = new URL(req.url!, "http://127.0.0.1");
    res.setHeader("content-type", "application/json");
    if (url.pathname.endsWith("/fs/file")) {
      const limit = Number(url.searchParams.get("maxBytes") ?? bytes.length);
      if (limit === 1) metadata++; else full++;
      if (gone) { res.statusCode = 404; res.end(JSON.stringify({ error: { code: "path_not_found", message: "gone" } })); return; }
      res.end(JSON.stringify({ path: url.searchParams.get("path"), size: bytes.length, modifiedAt: revision, mime: "image/png", encoding: "base64", content: bytes.subarray(0, limit).toString("base64"), truncated: limit < bytes.length })); return;
    }
    if (url.pathname.includes("/media/") || url.pathname.includes("/blobs/")) {
      mediaReads++; res.setHeader("content-type", "image/png"); res.setHeader("content-length", bytes.length); res.end(bytes); return;
    }
    if (url.pathname === `/v2/artifact-store/${id}`) {
      detailReads++;
      res.end(JSON.stringify({ versions: [{ artifactId: id, version: 1, storage: artifactExternal ? "external" : "blob", bytes: bytes.length, sha256: sha, mediaType: artifactMedia }] })); return;
    }
    if (url.pathname.endsWith("/content")) {
      artifactReads++;
      if (artifactChanged) { res.end(JSON.stringify({ version: 1, offset: 0, totalBytes: bytes.length, mediaType: "image/png", sha256: sha, encoding: "base64", content: "", truncated: false, externalChanged: true })); return; }
      const offset = Number(url.searchParams.get("offset") ?? 0), max = Number(url.searchParams.get("maxBytes") ?? bytes.length);
      res.end(JSON.stringify({ version: 1, offset, totalBytes: bytes.length, mediaType: "image/png", sha256: sha, encoding: "base64", content: bytes.subarray(offset, offset + max).toString("base64"), truncated: offset + max < bytes.length, externalChanged: null })); return;
    }
    res.statusCode = 404; res.end("{}");
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  endpoint = { baseUrl: `http://127.0.0.1:${(server.address() as any).port}`, token: "private-test-token" };
  installImageCache(new ImageCache(root)); daemon = service();
});
afterEach(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); await rm(root, { recursive: true, force: true }); });
describe("daemon image cache integration over loopback", () => {
  it("measures 50 remote file previews twice and across a main-process cache restart", async () => {
    const view = async () => { for (let n = 0; n < 50; n++) await daemon.hostFile(`/images/${n}.png`, 1024); };
    await view(); expect([full, metadata]).toEqual([50, 50]);
    await view(); expect([full, metadata]).toEqual([50, 100]);
    installImageCache(new ImageCache(root)); daemon = service(); await view();
    expect([full, metadata]).toEqual([50, 150]);
    console.info("50 image remote reads: first=50 full + 50 metadata; repeat=0 full + 50 metadata; restart=0 full + 50 metadata");
  });
  it("revalidates changed files and refuses cached bytes after deletion", async () => {
    await daemon.hostFile("/a.png", 1024); revision = "v2";
    await daemon.hostFile("/a.png", 1024); expect(full).toBe(2);
    gone = true; await expect(daemon.hostFile("/a.png", 1024)).rejects.toThrow();
    expect(full).toBe(2);
  });
  it("keeps workspace scopes distinct, respects read bounds and isolates credentials", async () => {
    const scope = { kind: "session" as const, id: session };
    await daemon.fsFile(scope, "/a.png", 1024); await daemon.hostFile("/a.png", 1024);
    expect(full).toBe(2);
    expect((await daemon.hostFile("/a.png", 2)).truncated).toBe(true);
    expect(full).toBe(3);
    endpoint = { ...endpoint, token: "different-test-token" }; daemon = service();
    await daemon.hostFile("/a.png", 1024); expect(full).toBe(4);
  });
  it("caches immutable history references even when their id is not a byte digest; blobs and artifact windows verify sha", async () => {
    await daemon.historyMedia(session, "e".repeat(64)); await daemon.historyMedia(session, "e".repeat(64));
    await daemon.eventBlob(session, sha); await daemon.eventBlob(session, sha);
    expect(mediaReads).toBe(2);
    const first = await daemon.artifactStoreContent(id, 1, { maxBytes: 4, imagePreview: true });
    const second = await daemon.artifactStoreContent(id, 1, { offset: 4, maxBytes: 4 });
    expect(Buffer.from(first!.content + "", "base64").length).toBe(4);
    expect(second!.truncated).toBe(false); expect(artifactReads).toBe(1);
    installImageCache(new ImageCache(root)); daemon = service();
    await daemon.historyMedia(session, "e".repeat(64)); await daemon.eventBlob(session, sha); await daemon.artifactStoreContent(id, 1);
    expect([mediaReads, artifactReads]).toEqual([2, 1]);
  });
});

it("revalidates external artifacts and never substitutes cached content when their source changes", async () => {
  artifactExternal = true;
  await daemon.artifactStoreContent(id, 1); expect(artifactReads).toBe(2);
  const hit = await daemon.artifactStoreContent(id, 1); expect(hit!.content).toBe(bytes.toString("base64")); expect(artifactReads).toBe(3);
  artifactChanged = true;
  const changed = await daemon.artifactStoreContent(id, 1);
  expect(changed).toMatchObject({ externalChanged: true, content: "" });
});

it("asks a pinned artifact version once whether it is an image, not on every window read", async () => {
  artifactMedia = "text/markdown";
  await daemon.artifactStoreContent(id, 1, { maxBytes: 4 }); await daemon.artifactStoreContent(id, 1, { offset: 4, maxBytes: 4 });
  expect([detailReads, artifactReads]).toEqual([1, 2]);
});
