import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { expect, it } from "vitest";
import { CutexClient } from "@cutex-desktop/cutex-client";
import { RemoteCopyManager } from "../src/main/remoteCopies";
import { remoteCopyTransport } from "../src/main/remoteCopyTransport";

it("downloads >10MiB over authenticated HTTP with exact bytes while control requests remain responsive", async () => {
  const bytes = Uint8Array.from({ length: 11 * 1024 * 1024 + 37 }, (_, i) => (i * 17) & 255);
  const meta = { path: "/test/中文.bin", name: "中文.bin", size: bytes.length, modifiedAt: "2026-10-28T00:00:00Z", revision: "a".repeat(64), maxChunkBytes: 4194304 };
  const server = createServer(async (req, res) => {
    if (req.headers.authorization !== "Bearer synthetic-copy-test") { res.writeHead(401).end(); return; }
    const url = new URL(req.url!, "http://localhost");
    if (url.pathname === "/v2/control") { res.writeHead(200).end("ok"); return; }
    if (url.pathname === "/v2/fs/transfer") { res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(meta)); return; }
    if (url.pathname !== "/v2/fs/transfer/chunk" || url.searchParams.get("revision") !== meta.revision) { res.writeHead(409).end(); return; }
    const offset = Number(url.searchParams.get("offset")), count = Math.min(Number(url.searchParams.get("maxBytes")), bytes.length - offset);
    res.writeHead(200, { "content-type": "application/octet-stream", "content-length": count, etag: `"${meta.revision}"`, "x-cutex-file-offset": offset, "x-cutex-file-bytes": count, "x-cutex-file-total-bytes": bytes.length, "x-cutex-file-next-offset": offset + count, "x-cutex-file-eof": String(offset + count === bytes.length) });
    for (let n = offset; n < offset + count && !res.destroyed; n += 65536) { res.write(bytes.subarray(n, Math.min(n + 65536, offset + count))); await delay(1); }
    res.end();
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("missing fixture address");
  const client = new CutexClient({ baseUrl: `http://127.0.0.1:${address.port}`, token: "synthetic-copy-test" });
  const root = await mkdtemp(join(tmpdir(), "copy-http-"));
  const manager = new RemoteCopyManager({ root: join(root, "copies"), transport: async source => remoteCopyTransport(client, source, () => {}) });
  try {
    const source = { hostId: "remote-test", hostIdentity: "synthetic-host", hostLabel: "Test", path: meta.path };
    const inspected = await manager.inspect(source);
    const id = await manager.start(source, inspected);
    const times: number[] = [];
    const deadline = performance.now() + 10000;
    while ((await manager.list()).copies.find(c => c.id === id)?.status === "downloading") {
      const start = performance.now();
      expect(await client.fetchRaw(client.url("/v2/control"), { headers: client.headers() }).then(r => r.text())).toBe("ok");
      times.push(performance.now() - start);
      if (performance.now() > deadline) throw Error("transfer fixture timed out");
      await delay(5);
    }
    const row = (await manager.list()).copies.find(c => c.id === id)!;
    expect(row.status).toBe("complete");
    expect((await readFile(await manager.file(id))).equals(Buffer.from(bytes))).toBe(true);
    expect(row.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(times.length).toBeGreaterThan(1);
    times.sort((a, b) => a - b);
    console.info(`copy-http ${bytes.length} bytes exact; control n=${times.length} p95=${times[Math.floor(times.length * 0.95)]!.toFixed(1)}ms max=${times.at(-1)!.toFixed(1)}ms`);
  } finally {
    await manager.dispose();
    server.closeAllConnections();
    await new Promise<void>(r => server.close(() => r()));
    await rm(root, { recursive: true, force: true });
  }
}, 20000);
