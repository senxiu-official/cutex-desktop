// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvN8AAAAASUVORK5CYII=", "base64"));
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubGlobal("location", { search: "?mediaBlobs&mediaDelay=1200" });
  vi.stubGlobal("OffscreenCanvas", class {
    getContext() { return { createImageData: () => ({ data: new Uint8ClampedArray(640 * 320 * 4) }), putImageData() {}, fillRect() {}, fillText() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} }; }
    async convertToBlob() { return new Blob([png], { type: "image/png" }); }
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("prepares dimensions and canonical history before delayed bytes resolve", async () => {
  const scene = await import("../src/renderer/src/dev/devMediaBlobs");
  const value = await scene.prepareMediaBlobs();
  expect(value.image).toMatchObject({ width: 640, height: 320 });
  expect(scene.mediaBlobsThread()).toBe(value.thread);
  let resolved = false;
  const response = scene.mockEventBlob("eva", value.image.sha256).then(result => { resolved = true; return result; });
  await Promise.resolve();
  expect(resolved).toBe(false);
  await vi.advanceTimersByTimeAsync(1199);
  expect(resolved).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(await response).toEqual({ bytes: png, mime: "image/png", size: png.length });
});

it("keeps the existing immediate response when delay is absent or invalid", async () => {
  const scene = await import("../src/renderer/src/dev/devMediaBlobs");
  const value = await scene.prepareMediaBlobs();
  for (const search of ["?mediaBlobs", "?mediaBlobs&mediaDelay=invalid", "?mediaBlobs&mediaDelay=-100"]) {
    vi.stubGlobal("location", { search });
    expect(await scene.mockEventBlob("eva", value.image.sha256)).toMatchObject({ size: png.length });
    expect(vi.getTimerCount()).toBe(0);
  }
});
