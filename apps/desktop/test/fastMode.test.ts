import { describe, expect, it } from "vitest";
import { fastModePatch, fastTierOf, isFastTier, STANDARD_SERVICE_TIER } from "../src/shared/fastMode";

describe("fastTierOf", () => {
  it("takes the tier named Fast from model/list serviceTiers", () => {
    expect(fastTierOf({ serviceTiers: [{ id: "priority", name: "Fast" }] })).toBe("priority");
    expect(fastTierOf({ serviceTiers: [{ id: "flex", name: "Flex" }, { id: "turbo", name: "fast" }] })).toBe("turbo");
  });

  it("falls back to the priority id and the deprecated speed tiers", () => {
    expect(fastTierOf({ serviceTiers: [{ id: "priority", name: "Priority" }] })).toBe("priority");
    expect(fastTierOf({ serviceTiers: [], additionalSpeedTiers: ["fast"] })).toBe("priority");
  });

  it("is null for models without a Fast tier (custom providers, Claude)", () => {
    expect(fastTierOf({ serviceTiers: [] })).toBeNull();
    expect(fastTierOf({ serviceTiers: [{ id: "flex", name: "Flex" }] })).toBeNull();
    expect(fastTierOf({})).toBeNull();
  });
});

describe("isFastTier / fastModePatch", () => {
  it("reads the thread's selected tier", () => {
    expect(isFastTier("priority", "priority")).toBe(true);
    expect(isFastTier("fast", "priority")).toBe(true);
    expect(isFastTier("default", "priority")).toBe(false);
    expect(isFastTier(null, "priority")).toBe(false);
    expect(isFastTier("priority", null)).toBe(false);
  });

  it("turns Fast off with the explicit standard tier, not null (null = profile config)", () => {
    expect(fastModePatch(true, "priority")).toEqual({ serviceTier: "priority" });
    expect(fastModePatch(false, "priority")).toEqual({ serviceTier: STANDARD_SERVICE_TIER });
    expect(STANDARD_SERVICE_TIER).toBe("default");
  });
});
