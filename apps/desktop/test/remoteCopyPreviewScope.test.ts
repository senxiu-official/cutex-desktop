import { describe, expect, it } from "vitest";
import { initPreview, parsePreviewParams, previewKey, restorePreview } from "../src/renderer/src/modules/workspace/previewState";
describe("remote original preview scope", () => {
  it("keeps the explicit source scope on restore and separates equal relative paths in different roots", () => {
    const first = parsePreviewParams({ path: "data.bin", scope: { kind: "project", id: "a" } })!;
    const second = parsePreviewParams({ path: "data.bin", scope: { kind: "project", id: "b" } })!;
    expect(previewKey(first)).not.toBe(previewKey(second));
    expect(restorePreview(initPreview(first, null), 1)?.scope).toEqual({ kind: "project", id: "a" });
  });
  it("rejects malformed or conflicting scope rather than reading the currently selected workspace", () => {
    expect(parsePreviewParams({ path: "data.bin", scope: { kind: "other", id: "a" } })).toBeNull();
    expect(parsePreviewParams({ path: "/data.bin", host: true, scope: { kind: "project", id: "a" } })).toBeNull();
  });
});
