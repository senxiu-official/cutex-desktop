import { describe, expect, it } from "vitest";
import { effectiveDefaultEffort } from "./effortFallback";

describe("effective default effort (design 028 (b), owner 10-22 Zooey)", () => {
  it("keeps an offered profile default", () => {
    expect(effectiveDefaultEffort("glm-5.3", "max", ["low", "high", "max"], "max")).toBe("max");
    expect(effectiveDefaultEffort("glm-5.3", "max", [], null)).toBe("max");
  });
  it("falls back like cutex when the model does not offer it", () => {
    // Stale Zooey row: low/medium/high, default medium; profile default max.
    expect(effectiveDefaultEffort("glm-5.3", "max", ["low", "medium", "high"], "medium")).toBe("medium");
    expect(effectiveDefaultEffort("glm-5.3", "xhigh", ["low", "high", "max"], "max")).toBe("max");
    expect(effectiveDefaultEffort("glm-5.3", "medium", ["low", "high", "max"], "max")).toBe("high");
    expect(effectiveDefaultEffort("other", "max", ["low", "medium"], "medium")).toBe("medium");
    expect(effectiveDefaultEffort("other", "max", ["low", "medium"], null)).toBe("medium");
  });
  it("uses the row default when the profile has none", () => {
    expect(effectiveDefaultEffort("glm-5.3", null, ["low", "high", "max"], "max")).toBe("max");
    expect(effectiveDefaultEffort("glm-5.3", null, ["low", "high"], "max")).toBeNull();
  });
});
