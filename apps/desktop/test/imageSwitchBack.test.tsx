// @vitest-environment jsdom
// Owner 2026-10-26: a Codex agent's generated images showed while it was open and turned into
// 图片读取失败 after switching to another conversation and back. Live, an image is an event blob
// (`cutex-blob:`, bytes digest); the rebuilt view (bootstrap with media=ref) names it
// `cutex-media:<session>/<sha256 of the base64 text>`. The client's byte-digest check refused that
// (packages/cutex-client test/media-bytes.test.ts); here: the renderer side of the same round trip, and
// a transient read failure is never kept as a sticky 读取失败.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const env = vi.hoisted(() => ({ eventBlob: vi.fn(), historyMedia: vi.fn() }));
vi.mock("../src/renderer/src/store", () => ({
  featuresOf: () => new Set(["event-media-blobs"]),
  hostApi: () => ({ eventBlob: env.eventBlob, historyMedia: env.historyMedia, hostFile: vi.fn() }),
  useApp: Object.assign((select: (s: unknown) => unknown) => select({}), { getState: () => ({ hosts: { hosts: [{ id: "local", conn: { epoch: 1 } }] } }), subscribe: () => () => {} }),
}));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
import { ItemMedia } from "../src/renderer/src/components/ItemMedia";
import { loadThumbnail, resetThumbnailCache } from "../src/renderer/src/lib/fileThumbnails";

const bytes = () => ({ bytes: new Uint8Array([137, 80, 78, 71]), mime: "image/png", size: 4 });
const blobSha = "b".repeat(64), textSha = "c".repeat(64);
const live = { type: "imageGeneration", id: "ig1", status: "completed", result: { type: "cutexBlob", blobId: blobSha, sha256: blobSha, mime: "image/png", size: 4, url: `cutex-blob:cutex.avatar/${blobSha}` } };
const rebuilt = { ...live, result: `cutex-media:cutex.avatar/${textSha}` };
let host: HTMLDivElement; let root: Root;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => {
  resetThumbnailCache();
  env.eventBlob.mockReset().mockResolvedValue(bytes()); env.historyMedia.mockReset().mockResolvedValue(bytes());
  let count = 0; Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => `blob:img-${++count}`) });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); resetThumbnailCache(); });
const show = async (item: Record<string, unknown>) => {
  await act(async () => root.render(h(ItemMedia, { item, hostId: "local" })));
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};
const away = () => { act(() => root.unmount()); root = createRoot(host); };
const src = () => host.querySelector("img")?.getAttribute("src") ?? null;

it("live image → another conversation → back: the rebuilt history reference resolves", async () => {
  await show(live);
  expect(env.eventBlob).toHaveBeenCalledWith("cutex.avatar", blobSha, { mime: "image/png", size: 4 });
  expect(src()).toBe("blob:img-1");
  away();
  // Coming back shows the cached timeline first: the same object URL, never a revoked one.
  await show(live);
  expect(src()).toBe("blob:img-1");
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  // Then the fresh bootstrap replaces the item: read through the history media route.
  await show(rebuilt);
  expect(env.historyMedia).toHaveBeenCalledWith("cutex.avatar", textSha);
  expect(src()).toBe("blob:img-2");
  expect(host.textContent).not.toContain("image.failed");
});

it("a transient read failure is not cached: coming back reads again", async () => {
  env.historyMedia.mockRejectedValueOnce(new Error("Error invoking remote method 'cutex:historyMedia': cutex unreachable"));
  await show(rebuilt);
  expect(host.textContent).toContain("image.failed");
  away();
  await show(rebuilt);
  expect(env.historyMedia).toHaveBeenCalledTimes(2);
  expect(src()).toBe("blob:img-1");
});

it("an answered not-found stays failed until its retry (no request storm while scrolling)", async () => {
  env.historyMedia.mockResolvedValueOnce(null);
  await show(rebuilt);
  expect(host.textContent).toContain("image.failed");
  away();
  await show(rebuilt);
  expect(env.historyMedia).toHaveBeenCalledTimes(1);
  await act(async () => host.querySelector("button")!.click());
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  expect(env.historyMedia).toHaveBeenCalledTimes(2);
  expect(src()).toBe("blob:img-1");
});

it("a full read queue is not remembered as a failed image", async () => {
  const stalled: (() => void)[] = [];
  const slow = () => new Promise<ReturnType<typeof bytes> & { encoding: "bytes"; truncated: false }>((done) => stalled.push(() => done({ ...bytes(), encoding: "bytes", truncated: false })));
  const busy = Array.from({ length: 4 + 64 }, (_, i) => loadThumbnail(`busy-${i}`, slow));
  const read = vi.fn(async () => ({ ...bytes(), encoding: "bytes" as const, truncated: false }));
  expect(await loadThumbnail("late", read)).toBeNull();
  expect(read).not.toHaveBeenCalled();
  while (stalled.length) { stalled.shift()!(); await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); }
  await Promise.all(busy);
  expect(await loadThumbnail("late", read)).toMatch(/^blob:img-/);
  expect(read).toHaveBeenCalledTimes(1);
});
