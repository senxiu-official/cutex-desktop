import { describe, expect, it } from "vitest";
import { MASK_DOTS, maskDigest } from "./maskedText";

describe("maskDigest", () => {
  it("keeps the first 4 characters and masks the rest", () => {
    expect(maskDigest("a1b2c3d4e5f6a7b8")).toBe(`a1b2${MASK_DOTS}`);
  });
  it("ignores grouping spaces", () => {
    expect(maskDigest("a1b2 c3d4 e5f6")).toBe(`a1b2${MASK_DOTS}`);
  });
  it("is empty for nothing", () => {
    expect(maskDigest("")).toBe("");
    expect(maskDigest(null)).toBe("");
  });
  it("keeps an ssh algorithm label in front", () => {
    expect(maskDigest("SHA256:Mock+host/generated")).toBe(`SHA256:Mock${MASK_DOTS}`);
  });
  it("honours a custom prefix length", () => {
    expect(maskDigest("ci-e7a0021b", 7)).toBe(`ci-e7a0${MASK_DOTS}`);
  });
});
