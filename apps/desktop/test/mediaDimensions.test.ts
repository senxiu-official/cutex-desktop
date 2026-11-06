import { expect, it } from "vitest";
import { mediaDimensions, parseMediaBlob } from "../src/shared/mediaBlobs";
import { imageBox, zoomImageBox } from "../src/renderer/src/lib/imageDimensions";

const hash = "a".repeat(64);
const blob = { type: "cutexBlob", blobId: hash, sha256: hash, url: `cutex-blob:session/${hash}`, mime: "image/png", size: 300 };
it("preserves paired positive u32 pixel hints without changing the blob's authority", () => {
  expect(parseMediaBlob({ ...blob, width: 640, height: 320 })).toEqual({ ...blob, width: 640, height: 320 });
  expect(parseMediaBlob({ ...blob, width: 0xffffffff, height: 1 })).toMatchObject({ width: 0xffffffff, height: 1 });
});
it.each([{ width: 640 }, { width: 0, height: 320 }, { width: -1, height: 320 }, { width: 1.5, height: 1 }, { width: Infinity, height: 1 }, { width: "640", height: 320 }, { width: 640, height: null }, { width: 0x100000000, height: 1 }])("ignores malformed optional dimensions: %j", dimensions => {
  expect(mediaDimensions(dimensions)).toBeUndefined();
  expect(parseMediaBlob({ ...blob, ...dimensions })).toEqual(blob);
});
it("caps portrait, landscape and small boxes without upscaling or changing their ratio", () => {
  expect(imageBox({ width: 640, height: 320 })).toMatchObject({ width: "640px", aspectRatio: "640 / 320" });
  expect(imageBox({ width: 320, height: 640 })).toMatchObject({ width: "160px", aspectRatio: "320 / 640" });
  expect(imageBox({ width: 640, height: 320 }, { maxWidth: 240, maxHeight: 160 })).toMatchObject({ width: "240px" });
  expect(imageBox({ width: 32, height: 16 })).toMatchObject({ width: "32px" });
  expect(imageBox(undefined)).toBeUndefined();
  expect(zoomImageBox(undefined)).toBeUndefined();
});
