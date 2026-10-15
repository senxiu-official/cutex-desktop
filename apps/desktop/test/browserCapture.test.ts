import { describe, expect, it } from "vitest";
import { MAX_SCREENSHOT_BASE64_LENGTH } from "@cutex-desktop/browser-protocol";
import { browserScreenshotDimensions } from "../src/main/browser/capture";

function png(width = 1280, height = 720): Buffer {
  const bytes = Buffer.alloc(33);
  Buffer.from("89504e470d0a1a0a", "hex").copy(bytes); bytes.writeUInt32BE(13, 8); bytes.write("IHDR", 12);
  bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20); return bytes;
}
function jpeg(width = 1280, height = 720, marker = 0xc0): Buffer {
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, marker, 0, 11, 8, 0, 0, 0, 0, 1, 1, 0x11, 0]);
  bytes.writeUInt16BE(height, 13); bytes.writeUInt16BE(width, 15); return bytes;
}
describe("bounded browser screenshot headers", () => {
  it("takes PNG pixel dimensions from bytes", () => {
    expect(browserScreenshotDimensions("image/png", png(1920, 1080).toString("base64"))).toEqual({ width: 1920, height: 1080 });
  });
  it.each([0xc0, 0xc2])("takes JPEG SOF dimensions across metadata segments (%i)", marker => {
    expect(browserScreenshotDimensions("image/jpeg", jpeg(640, 480, marker).toString("base64"))).toEqual({ width: 640, height: 480 });
  });
  it.each([[0, 720], [1280, 0], [16385, 1], [4097, 4097]])("rejects invalid or oversized dimensions %s x %s", (w, h) => {
    expect(() => browserScreenshotDimensions("image/png", png(w, h).toString("base64"))).toThrow();
    expect(() => browserScreenshotDimensions("image/jpeg", jpeg(w, h).toString("base64"))).toThrow();
  });
  it.each(["", "YQ", "YQ==\n", "YR==", "!===", "data:image/png;base64,AAAA"])("refuses noncanonical base64 %s", value => {
    expect(() => browserScreenshotDimensions("image/png", value)).toThrow();
  });
  it("refuses oversized encoded input before decoding", () => {
    expect(() => browserScreenshotDimensions("image/png", "A".repeat(MAX_SCREENSHOT_BASE64_LENGTH + 4))).toThrow();
  });
  it("requires MIME, PNG signature, IHDR type and exact header length", () => {
    expect(() => browserScreenshotDimensions("image/jpeg", png().toString("base64"))).toThrow();
    expect(() => browserScreenshotDimensions("image/png", jpeg().toString("base64"))).toThrow();
    for (const mutate of [(b: Buffer) => { b[0] = 0; }, (b: Buffer) => b.writeUInt32BE(12, 8), (b: Buffer) => b.write("IDAT", 12)]) {
      const bytes = png(); mutate(bytes); expect(() => browserScreenshotDimensions("image/png", bytes.toString("base64"))).toThrow();
    }
    expect(() => browserScreenshotDimensions("image/png", png().subarray(0, 24).toString("base64"))).toThrow();
  });
  it("refuses truncated, inconsistent, or absent JPEG SOF", () => {
    for (const bytes of [jpeg().subarray(0, 18), Buffer.from([0xff, 0xd8, 0xff, 0xda, 0, 2]), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 1])])
      expect(() => browserScreenshotDimensions("image/jpeg", bytes.toString("base64"))).toThrow();
    const wrongComponents = jpeg(); wrongComponents[17] = 3;
    expect(() => browserScreenshotDimensions("image/jpeg", wrongComponents.toString("base64"))).toThrow();
  });
});
