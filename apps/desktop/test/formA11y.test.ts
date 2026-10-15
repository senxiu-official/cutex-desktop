import { describe, expect, it } from "vitest";
import { parseClamped, radioKeyTarget } from "../src/renderer/src/lib/formA11y";

describe("radioKeyTarget", () => {
  it("moves and wraps with the arrow keys", () => {
    expect(radioKeyTarget("ArrowRight", 0, 3)).toBe(1);
    expect(radioKeyTarget("ArrowDown", 2, 3)).toBe(0);
    expect(radioKeyTarget("ArrowLeft", 0, 3)).toBe(2);
    expect(radioKeyTarget("ArrowUp", 1, 3)).toBe(0);
  });
  it("jumps with Home / End and ignores other keys", () => {
    expect(radioKeyTarget("Home", 2, 4)).toBe(0);
    expect(radioKeyTarget("End", 0, 4)).toBe(3);
    expect(radioKeyTarget("Enter", 1, 4)).toBeNull();
    expect(radioKeyTarget("ArrowRight", 0, 0)).toBeNull();
  });
});

describe("parseClamped", () => {
  it("clamps and rounds", () => {
    expect(parseClamped("120", [50, 100])).toBe(100);
    expect(parseClamped("10", [50, 100])).toBe(50);
    expect(parseClamped(" 72.6 ", [0, 100])).toBe(73);
  });
  it("returns null for empty or non-numeric text", () => {
    expect(parseClamped("", [0, 10])).toBeNull();
    expect(parseClamped("abc", [0, 10])).toBeNull();
  });
});
