// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const env = vi.hoisted(() => ({ epoch: "one", read: vi.fn(), subscribers: new Set<() => void>() }));
vi.mock("../src/renderer/src/store", () => ({
  hostApi: () => ({ historyMedia: env.read, eventBlob: env.read }),
  useApp: Object.assign(() => null, { getState: () => ({ hosts: { hosts: [{ id: "remote", conn: { epoch: env.epoch } }] } }), subscribe: (l: () => void) => { env.subscribers.add(l); return () => env.subscribers.delete(l); } }),
}));
import { loadThumbnail, resetThumbnailCache, THUMBNAIL_CACHE_MAX_ENTRIES, ThumbnailUnavailable, useThumbnail } from "../src/renderer/src/lib/fileThumbnails";
import { mediaKey, readHistoryMedia } from "../src/renderer/src/lib/historyMedia";
import { fireHostReset } from "../src/renderer/src/lib/hostSwitch";
const sha = "a".repeat(64);
const raw = () => ({ encoding: "bytes" as const, bytes: new Uint8Array([1, 2, 3]), mime: "image/png", size: 3, truncated: false });
let sequence = 0;
beforeEach(() => {
  resetThumbnailCache(); env.epoch = "one"; env.read.mockReset(); sequence = 0;
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => `blob:test-${++sequence}`) });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
});
afterEach(() => resetThumbnailCache());
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("isolates equal hashes by host, session grant and connection epoch", () => {
  const a = mediaKey("remote", { sessionId: "a", sha256: sha });
  expect(mediaKey("remote", { sessionId: "b", sha256: sha })).not.toBe(a);
  expect(mediaKey("remote", { sessionId: "a", sha256: sha, kind: "blob" })).not.toBe(a);
  expect(mediaKey("local", { sessionId: "a", sha256: sha })).not.toBe(a);
  env.epoch = "two";
  expect(mediaKey("remote", { sessionId: "a", sha256: sha })).not.toBe(a);
});

it("passes descriptor expectations to the bound host and fences a late read after reconnect", async () => {
  let finish!: (v: unknown) => void;
  env.read.mockReturnValue(new Promise((done) => { finish = done; }));
  const pending = readHistoryMedia("remote", { sessionId: "session", sha256: sha }, { mime: "image/png", size: 3 });
  expect(env.read).toHaveBeenCalledWith("session", sha, { mime: "image/png", size: 3 });
  env.epoch = "two"; finish({ bytes: new Uint8Array([1, 2, 3]), mime: "image/png", size: 3 });
  await expect(pending).rejects.toThrow("authority");
});

it("deduplicates bytes reads into one object URL and revokes evicted cached objects", async () => {
  const read = vi.fn(async () => raw());
  const [a, b] = await Promise.all([loadThumbnail("a", read), loadThumbnail("a", read)]);
  expect(a).toBe("blob:test-1"); expect(a).toBe(b); expect(read).toHaveBeenCalledTimes(1);
  for (let i = 0; i < THUMBNAIL_CACHE_MAX_ENTRIES; i++) await loadThumbnail(`failed-${i}`, async () => { throw new ThumbnailUnavailable("gone"); });
  expect(URL.revokeObjectURL).toHaveBeenCalledWith(a);
});

it("bounds raw cached bytes and rejects stale cache hits", async () => {
  const bytes = new Uint8Array(24 * 1024 * 1024);
  const read = async () => ({ encoding: "bytes" as const, bytes, size: bytes.byteLength, mime: "image/png", truncated: false });
  await loadThumbnail("large-a", read); await loadThumbnail("large-b", read); await loadThumbnail("large-c", read);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test-1");
  expect(await loadThumbnail("large-c", read, { isCurrent: () => false })).toBeNull();
});

it("holds an evicted visible object until the thumbnail lease unmounts", async () => {
  const div = document.createElement("div"); const root = createRoot(div);
  function Probe() { const { ref, state } = useThumbnail("visible", async () => raw()); return h("span", { ref: ref as never }, state.status === "ok" ? state.src : state.status); }
  await act(async () => root.render(h(Probe)));
  expect(div.textContent).toBe("blob:test-1");
  for (let i = 0; i < THUMBNAIL_CACHE_MAX_ENTRIES; i++) await loadThumbnail(`other-${i}`, async () => { throw new ThumbnailUnavailable("gone"); });
  expect(URL.revokeObjectURL).not.toHaveBeenCalledWith("blob:test-1");
  act(() => root.unmount()); expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test-1");
});

it("rejects malformed raw metadata and decodes legacy replies only into ephemeral bytes", async () => {
  env.read.mockResolvedValueOnce({ bytes: new Uint8Array([1]), mime: "image/png", size: 2 });
  await expect(readHistoryMedia("remote", { sessionId: "a", sha256: sha })).rejects.toThrow("invalid");
  env.read.mockResolvedValueOnce({ dataUrl: "data:image/png;base64,AQID" });
  const result = await readHistoryMedia("remote", { sessionId: "a", sha256: sha });
  expect(result).toEqual({ encoding: "bytes", bytes: new Uint8Array([1, 2, 3]), mime: "image/png", size: 3, truncated: false });
  expect(result).not.toHaveProperty("content");
});

it("does not publish or cache a response that completes after its host reset", async () => {
  let finish!: () => void;
  const pending = loadThumbnail("pending", async () => { await new Promise<void>((done) => { finish = done; }); return raw(); }, { hostId: "remote" });
  await Promise.resolve(); await Promise.resolve();
  fireHostReset("remote"); finish();
  expect(await pending).toBeNull(); expect(URL.createObjectURL).not.toHaveBeenCalled();
});

it("limits concurrent byte reads while retaining queued requests without byte payloads", async () => {
  let running = 0, peak = 0; const finish: (() => void)[] = [];
  const jobs = Array.from({ length: 8 }, (_, i) => loadThumbnail(`concurrency-${i}`, async () => {
    running++; peak = Math.max(peak, running);
    await new Promise<void>((done) => finish.push(done)); running--; return raw();
  }));
  for (let i = 0; i < 5; i++) await Promise.resolve();
  expect(finish).toHaveLength(4);
  for (const done of finish.splice(0)) done();
  for (let i = 0; i < 12; i++) await Promise.resolve();
  expect(finish).toHaveLength(4);
  for (const done of finish.splice(0)) done();
  expect((await Promise.all(jobs)).every((src) => src?.startsWith("blob:"))).toBe(true);
  expect(peak).toBe(4);
});
