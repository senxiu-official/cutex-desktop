import { describe, expect, it } from "vitest";
import { effortFallbackOf, validActionId } from "./createAbandon";

describe("create abandon / effort fallback wire", () => {
  it("reads an effort fallback strictly", () => {
    expect(effortFallbackOf({ model: "glm-5.3", requested: "max", used: "high", reason: "not_offered_by_model" })).toEqual({ model: "glm-5.3", requested: "max", used: "high", reason: "not_offered_by_model" });
    expect(effortFallbackOf({ model: "glm-5.3", requested: "max" })).toBeNull();
    expect(effortFallbackOf(null)).toBeNull();
  });
  it("accepts cutex action ids only", () => {
    expect(validActionId("auto-87e029fcf075de20b1857380ff969c04")).toBe(true);
    expect(validActionId("a/b@c:d.e_f")).toBe(true);
    expect(validActionId("bad id")).toBe(false);
    expect(validActionId("")).toBe(false);
  });
});
