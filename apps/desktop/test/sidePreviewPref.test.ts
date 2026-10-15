// 打开文件 default moved to "replace" (lead 2026-10-12): the old default migrates once (sidePreviewRev).
import { describe, expect, it } from "vitest";
import { DEFAULT_SIDE_PREVIEW, migrateSidePreview, SIDE_PREVIEW_REV } from "../src/renderer/src/lib/sidePreviewPref";

describe("migrateSidePreview", () => {
  it("missing / invalid → the default", () => {
    expect(DEFAULT_SIDE_PREVIEW).toBe("replace");
    expect(migrateSidePreview(undefined, undefined)).toBe("replace");
    expect(migrateSidePreview("bogus", SIDE_PREVIEW_REV)).toBe("replace");
  });

  it("the old default saved before the rev is migrated", () => {
    expect(migrateSidePreview("links-new-tab", undefined)).toBe("replace");
    expect(migrateSidePreview("links-new-tab", 0)).toBe("replace");
  });

  it("other choices are kept", () => {
    expect(migrateSidePreview("new-tab", undefined)).toBe("new-tab");
    expect(migrateSidePreview("replace", undefined)).toBe("replace");
  });

  it("already migrated: a later links-new-tab choice stays", () => {
    expect(migrateSidePreview("links-new-tab", SIDE_PREVIEW_REV)).toBe("links-new-tab");
  });
});
