import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ImageCache } from "../src/main/imageCache";
let root: string;
const image = (size = 12, value = 1) => ({ bytes: new Uint8Array(size).fill(value), mime: "image/png" });
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "cutex-image-cache-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const key = (name: string) => ["remote-host", name];
describe("persistent image cache", () => {
  it("hits across repeated views, restart and host isolation; verifies source digest", async () => {
    let reads = 0; const value = image(); const load = async () => { reads++; return value; };
    const sha = createHash("sha256").update(value.bytes).digest("hex");
    const cache = new ImageCache(root);
    await cache.read(key("a"), load, sha); await cache.read(key("a"), load, sha);
    await new ImageCache(root).read(key("a"), load, sha);
    expect(reads).toBe(1);
    await cache.read(["other-host", "a"], load, sha); expect(reads).toBe(2);
    await expect(cache.read(key("bad"), load, "0".repeat(64))).rejects.toThrow("sha256");
  });
  it("expires seven days since the last view, including across restart", async () => {
    let now = 100, reads = 0; const load = async () => { reads++; return image(); };
    const cache = new ImageCache(root, () => now);
    await cache.read(key("a"), load); now += 6 * 86400000;
    await cache.read(key("a"), load); now += 6 * 86400000;
    const restarted = new ImageCache(root, () => now);
    await restarted.read(key("a"), load); expect(reads).toBe(1);
    now += 7 * 86400000;
    await restarted.read(key("a"), load); expect(reads).toBe(2);
  });
  it("evicts least recently viewed bytes at the configured cap", async () => {
    let now = 1; const cache = new ImageCache(root, () => now++);
    await cache.configure({ days: 7, maxBytes: 1024 ** 2 });
    const load = async () => image(400000);
    await cache.read(key("a"), load); await cache.read(key("b"), load);
    await cache.read(key("a"), load); await cache.read(key("c"), load);
    let misses = 0;
    await cache.read(key("a"), async () => { misses++; return load(); }); expect(misses).toBe(0);
    await cache.read(key("b"), async () => { misses++; return load(); }); expect(misses).toBe(1);
    expect((await cache.state()).bytes).toBeLessThanOrEqual(1024 ** 2);
  });
  it("repairs corrupt bytes, incomplete entries, temp files and malformed metadata", async () => {
    const cache = new ImageCache(root); let reads = 0;
    const load = async () => { reads++; return image(); };
    await cache.read(key("a"), load);
    const bin = (await readdir(root)).find(n => n.endsWith(".bin"))!;
    await writeFile(join(root, bin), image(12, 2).bytes);
    await cache.read(key("a"), load); expect(reads).toBe(2);
    await writeFile(join(root, bin), "partial");
    await writeFile(join(root, `${"a".repeat(64)}.json`), "bad json");
    await writeFile(join(root, `${"b".repeat(64)}.aabb-1234.tmp`), "partial");
    const restarted = new ImageCache(root); expect((await restarted.state()).entries).toBe(0);
    expect(await readdir(root)).toEqual([]);
    await restarted.read(key("a"), load); expect(reads).toBe(3);
  });
  it("clear fences pending writes and preserves settings, downloads and unrelated files", async () => {
    const cache = new ImageCache(root); await cache.configure({ days: 3, maxBytes: 2 * 1024 ** 2 });
    await writeFile(join(root, "saved-image.png"), "download");
    let resolve!: (v: ReturnType<typeof image>) => void;
    const pending = cache.read(key("pending"), () => new Promise(r => { resolve = r; }));
    while (!resolve) await new Promise(r => setTimeout(r, 1));
    await cache.clear(); resolve(image()); await pending;
    expect(await cache.state()).toMatchObject({ entries: 0, days: 3 });
    expect(await readFile(join(root, "saved-image.png"), "utf8")).toBe("download");
    expect(await new ImageCache(root).state()).toMatchObject({ entries: 0, days: 3 });
  });
  it("rejects invalid settings and does not store null/non-image responses", async () => {
    const cache = new ImageCache(root);
    await expect(cache.configure({ days: 0, maxBytes: 1024 ** 3 })).rejects.toThrow("invalid");
    await expect(cache.configure({ days: 1, maxBytes: NaN })).rejects.toThrow("invalid");
    await cache.read(key("gone"), async () => null);
    await cache.read(key("text"), async () => ({ bytes: new Uint8Array([1]), mime: "text/plain" }));
    expect((await cache.state()).entries).toBe(0);
  });
  it("records a view in memory at once and on disk at most hourly", async () => {
    let now = 1000; const cache = new ImageCache(root, () => now);
    await cache.read(key("a"), async () => image());
    const entry = async () => { const name = (await readdir(root)).find(n => n.endsWith(".json") && n !== "settings.json")!; return JSON.parse(await readFile(join(root, name), "utf8")).viewed; };
    now += 60_000; await cache.read(key("a"), async () => image()); expect(await entry()).toBe(1000);
    now += 2 * 3600_000; await cache.read(key("a"), async () => image()); expect(await entry()).toBe(now);
  });
  it("deduplicates parallel reads", async () => {
    const cache = new ImageCache(root); let reads = 0;
    await Promise.all(Array.from({ length: 10 }, () => cache.read(key("a"), async () => { reads++; return image(); })));
    expect(reads).toBe(1);
  });
});

it("serves bounded windows across chunk boundaries and repairs a damaged chunk", async () => {
  const cache = new ImageCache(root); let reads = 0;
  const source = image(4 * 1024 * 1024 + 24);
  source.bytes[source.bytes.length - 1] = 9;
  const load = async () => { reads++; return source; };
  const window = { offset: 4 * 1024 * 1024 - 4, maxBytes: 28 };
  const first = await cache.read(key("large"), load, undefined, window);
  expect(first!.bytes).toEqual(source.bytes.subarray(window.offset));
  const again = await new ImageCache(root).read(key("large"), load, undefined, window);
  expect(again!.bytes).toEqual(first!.bytes); expect(again!.size).toBe(source.bytes.length); expect(reads).toBe(1);
  const bin = (await readdir(root)).find(n => n.endsWith(".bin"))!;
  await writeFile(join(root, bin), new Uint8Array(source.bytes.length));
  const repaired = await cache.read(key("large"), load, undefined, window);
  expect(repaired!.bytes).toEqual(first!.bytes); expect(reads).toBe(2);
}, 20_000);
