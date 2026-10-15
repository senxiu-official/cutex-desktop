import { describe, expect, it, vi } from "vitest";
import { MODEL_SNAPSHOT_BYTES, modelScreenshot, modelSnapshot, type BrowserImage, type ProviderScreenshot } from "../src/main/browser/modelOutput";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function png(width: number, height: number) {
  const bytes = Buffer.alloc(33); Buffer.from("89504e470d0a1a0a", "hex").copy(bytes);
  bytes.writeUInt32BE(13, 8); bytes.write("IHDR", 12); bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
  return bytes;
}
describe("browser model output budgets", () => {
  it("caps UTF-8 snapshots without mutating provider data and keeps valid refs only", () => {
    const source = { pageGeneration: 1, snapshotId: 1, url: "http://localhost/?token=dummy", truncated: false,
      nodes: Array.from({ length: 1500 }, (_, i) => ({ ref: `ref-${i}`, role: "textbox", name: "界".repeat(200), value: "😀".repeat(100) })) };
    const value = modelSnapshot(source, "http://localhost/");
    expect(Buffer.byteLength(JSON.stringify(value))).toBeLessThanOrEqual(MODEL_SNAPSHOT_BYTES);
    expect(value.truncated).toBe(true); expect(value.nodes.length).toBeGreaterThan(0);
    expect(value.nodes).toEqual(source.nodes.slice(0, value.nodes.length)); expect(source.nodes).toHaveLength(1500);
    expect(source.truncated).toBe(false); expect(value.url).toBe("http://localhost/");
  });
  it("drops an oversized first node and rejects excessive metadata", () => {
    const source = { pageGeneration: 1, snapshotId: 1, url: "about:blank", truncated: false,
      nodes: [{ ref: "r", role: "text", name: "界".repeat(30_000) }] };
    expect(modelSnapshot(source, "about:blank")).toMatchObject({ nodes: [], truncated: true });
    expect(() => modelSnapshot(source, "x".repeat(MODEL_SNAPSHOT_BYTES))).toThrowError(/metadata/);
  });
  it("accounts for text-content JSON escaping, not just the inner snapshot bytes", () => {
    const source = { pageGeneration: 1, snapshotId: 1, url: "about:blank", truncated: false,
      nodes: Array.from({ length: 1000 }, (_, i) => ({ ref: `r${i}`, role: "text", name: '\\"'.repeat(100) })) };
    const value = modelSnapshot(source, "about:blank");
    expect(Buffer.byteLength(JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ kind: "tab.snapshot", ...value }) }] }))).toBeLessThan(64 * 1024);
    expect(value.truncated).toBe(true);
  });
  it("decodes once, scales once and reports actual image/CSS ratio separately from displayScale", () => {
    const source: ProviderScreenshot = { mimeType: "image/png", data: png(2400, 1800).toString("base64"), width: 2400, height: 1800,
      pageGeneration: 5, viewport: { width: 1200, height: 900 }, captureRect: { x: 0, y: 0, width: 1200, height: 900 },
      imageScale: { x: 2, y: 2 }, displayScale: .5 };
    const small: BrowserImage = { isEmpty: () => false, getSize: () => ({ width: 1600, height: 1200 }),
      resize: vi.fn(), toPNG: () => png(1600, 1200), toJPEG: vi.fn() };
    const image = { ...small, getSize: () => ({ width: 2400, height: 1800 }), resize: vi.fn(() => small) };
    const decode = vi.fn(() => image);
    expect(modelScreenshot(source, decode)).toMatchObject({ width: 1600, height: 1200, imageScale: { x: 4 / 3, y: 4 / 3 }, displayScale: .5 });
    expect(decode).toHaveBeenCalledTimes(1); expect(image.resize).toHaveBeenCalledExactlyOnceWith({ width: 1600, height: 1200, quality: "best" });
    expect(() => modelScreenshot({ ...source, width: 1 }, decode)).toThrowError(/validation/);
    expect(() => modelScreenshot(source, () => ({ ...image, isEmpty: () => true }))).toThrowError(/validation/);
    expect(() => modelScreenshot(source, () => ({ ...image, getSize: () => ({ width: 1, height: 1 }) }))).toThrowError(/validation/);
  });
});
describe("model output remains internal to the relay", () => {
  it("has no raw JavaScript/CDP escape hatch, discovery channel or executable tool projection", () => {
    const read = (name: string) => readFileSync(fileURLToPath(new URL("../src/main/browser/" + name, import.meta.url)), "utf8");
    const adapter = read("modelAdapter.ts"), output = read("modelOutput.ts");
    for (const source of [adapter, output]) {
      expect(source).not.toMatch(/devBridge|discovery\\.json|createServer|createConnection/);
      expect(source).not.toMatch(/Runtime\\.evaluate|Runtime\\.callFunctionOn|sendCommand|executeJavaScript/);
    }
    expect(adapter).toContain("BrowserTabOperation");
    expect(adapter).toContain("modelSnapshot"); expect(adapter).toContain("modelScreenshot");
  });
});
