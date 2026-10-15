import { describe, expect, it, vi } from "vitest";
import { croppedPicture, INITIAL_CROP, squareCrop } from "../src/renderer/src/lib/imageCrop";

describe("square avatar crops", () => {
  it("starts centred for landscape and portrait pictures", () => {
    expect(squareCrop(800, 400, INITIAL_CROP)).toEqual({ x: 200, y: 0, size: 400 });
    expect(squareCrop(400, 800, INITIAL_CROP)).toEqual({ x: 0, y: 200, size: 400 });
  });

  it("keeps every crop inside the picture while panning and zooming", () => {
    for (const [width, height] of [[800, 400], [400, 800], [1, 1]]) {
      for (const zoom of [-1, 1, 2, 4, 20]) for (const x of [-5, 0, 0.5, 1, 5]) for (const y of [-5, 0, 0.5, 1, 5]) {
        const crop = squareCrop(width!, height!, { x, y, zoom });
        expect(crop.size).toBeGreaterThan(0);
        expect(crop.x).toBeGreaterThanOrEqual(0);
        expect(crop.y).toBeGreaterThanOrEqual(0);
        expect(crop.x + crop.size).toBeLessThanOrEqual(width!);
        expect(crop.y + crop.size).toBeLessThanOrEqual(height!);
      }
    }
  });

  it("crops the selected region rather than reverting to the image centre", () => {
    expect(squareCrop(800, 400, { x: 1, y: 0, zoom: 2 })).toEqual({ x: 600, y: 0, size: 200 });
  });

  it("rejects unreadable dimensions and handles non-finite positions", () => {
    expect(() => squareCrop(0, 400, INITIAL_CROP)).toThrow();
    expect(() => squareCrop(400, NaN, INITIAL_CROP)).toThrow();
    expect(squareCrop(800, 400, { x: NaN, y: NaN, zoom: NaN })).toEqual({ x: 200, y: 0, size: 400 });
  });

  it("exports the chosen source rectangle and releases the image on canvas errors", async () => {
    const close = vi.fn();
    const bitmap = { width: 800, height: 400, close };
    const drawImage = vi.fn();
    const canvas = { width: 0, height: 0, getContext: vi.fn(() => ({ drawImage })), toDataURL: vi.fn(() => "data:image/webp;test") };
    vi.stubGlobal("createImageBitmap", vi.fn(async () => bitmap));
    vi.stubGlobal("document", { createElement: () => canvas });
    try {
      await expect(croppedPicture(new Blob(), { x: 1, y: 0, zoom: 2 }, 128)).resolves.toBe("data:image/webp;test");
      expect(drawImage).toHaveBeenCalledWith(bitmap, 600, 0, 200, 200, 0, 0, 128, 128);
      expect(canvas.width).toBe(128);
      expect(canvas.height).toBe(128);
      expect(close).toHaveBeenCalledTimes(1);
      canvas.getContext.mockImplementation(() => { throw new Error("canvas unavailable"); });
      await expect(croppedPicture(new Blob(), INITIAL_CROP, 128)).rejects.toThrow("canvas unavailable");
      expect(close).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
