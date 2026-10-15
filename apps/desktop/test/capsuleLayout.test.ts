import { describe, expect, it } from "vitest";
import { isLeft, isTop, migrateCapsuleAnchor } from "../src/renderer/src/lib/capsuleLayout";

describe("capsule layout", () => {
  it("maps the old single anchor to corner + edge (old default → new default)", () => {
    expect(migrateCapsuleAnchor("windowBottom")).toEqual({ corner: "topRight", edge: "window" });
    expect(migrateCapsuleAnchor("windowMiddle")).toEqual({ corner: "topRight", edge: "window" });
    expect(migrateCapsuleAnchor("window")).toEqual({ corner: "topRight", edge: "window" });
    expect(migrateCapsuleAnchor("composer")).toEqual({ corner: "bottomRight", edge: "content" });
    expect(migrateCapsuleAnchor("content")).toEqual({ corner: "topRight", edge: "content" });
    expect(migrateCapsuleAnchor(undefined)).toBeNull();
    expect(migrateCapsuleAnchor("bogus")).toBeNull();
  });

  it("knows each corner's sides", () => {
    expect([isTop("topLeft"), isLeft("topLeft")]).toEqual([true, true]);
    expect([isTop("bottomRight"), isLeft("bottomRight")]).toEqual([false, false]);
  });
});
