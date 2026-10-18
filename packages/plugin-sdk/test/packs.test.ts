import { describe, expect, it } from "vitest";
import { MODULE_API_VERSION, MODULE_PACK_HOST_GLOBAL, moduleApiSatisfies, moduleApiVerdict, parseModuleApiRange } from "../src/index";

describe("module pack ranges (§23.7)", () => {
  it("caret, tilde, comparator sets and exact versions", () => {
    expect(moduleApiSatisfies("^1.16", "1.16")).toBe(true);
    expect(moduleApiSatisfies("^1.16", "1.30")).toBe(true);
    expect(moduleApiSatisfies("^1.16", "2.0")).toBe(false);
    expect(moduleApiSatisfies("^1.16", "1.15")).toBe(false);
    expect(moduleApiSatisfies("^0.3", "0.3.4")).toBe(true);
    expect(moduleApiSatisfies("^0.3", "0.4")).toBe(false);
    expect(moduleApiSatisfies("~1.16", "1.16.9")).toBe(true);
    expect(moduleApiSatisfies("~1.16", "1.17")).toBe(false);
    expect(moduleApiSatisfies(">=1.16 <2", "1.99")).toBe(true);
    expect(moduleApiSatisfies(">1.16 <=1.18", "1.16")).toBe(false);
    expect(moduleApiSatisfies(">1.16 <=1.18", "1.18")).toBe(true);
    expect(moduleApiSatisfies("1.16", "1.16.0")).toBe(true);
    expect(moduleApiSatisfies("=1.16", "1.17")).toBe(false);
  });

  it("refuses malformed ranges and versions", () => {
    for (const bad of ["", " ", "^", "x.y", "^1.16.0-beta", ">=01.2", "1.16 || 2", "^1.16;", "a".repeat(80)]) {
      expect(parseModuleApiRange(bad)).toBeNull();
      expect(moduleApiSatisfies(bad, "1.16")).toBe(false);
    }
    expect(moduleApiSatisfies("^1.16", "1")).toBe(false);
  });

  it("says which side is too old", () => {
    expect(moduleApiVerdict("^1.16", "1.16")).toBe("ok");
    expect(moduleApiVerdict("^1.17", "1.16")).toBe("needsNewerApp");
    expect(moduleApiVerdict("^2.0", "1.16")).toBe("needsNewerApp");
    expect(moduleApiVerdict("^1.10", "2.0")).toBe("needsNewerModule");
    expect(moduleApiVerdict("~1.14", "1.16")).toBe("needsNewerModule");
    expect(moduleApiVerdict("garbage", "1.16")).toBe("needsNewerApp");
  });

  it("the current contract satisfies a pack built against it", () => {
    expect(moduleApiSatisfies(`^${MODULE_API_VERSION}`, MODULE_API_VERSION)).toBe(true);
    expect(MODULE_PACK_HOST_GLOBAL).toBe("__CUTEX_MODULE_HOST__");
  });
});
