// Status capsule rows (quiet pass): shared classes for the modules' Bodies.
import { describe, expect, it } from "vitest";
import { capsuleRowActions, progressWidth } from "../src/renderer/src/lib/capsuleRows";

describe("capsule rows", () => {
  it("progress width is clamped and rounded", () => {
    expect(progressWidth(0)).toBe("0%");
    expect(progressWidth(2 / 7)).toBe("28.6%");
    expect(progressWidth(1.4)).toBe("100%");
    expect(progressWidth(-1)).toBe("0%");
    expect(progressWidth(Number.NaN)).toBe("0%");
  });

  it("row actions stay in the tab order and show on hover or keyboard focus", () => {
    const hidden = capsuleRowActions();
    // Collapsed by width / opacity, never display:none or visibility:hidden (keyboard-reachable).
    expect(hidden).not.toMatch(/(^|\s)(hidden|invisible)(\s|$)/);
    expect(hidden).toContain("max-w-0");
    expect(hidden).toContain("group-hover/row:opacity-100");
    expect(hidden).toContain("group-focus-within/row:opacity-100");
    // An armed second click stays visible.
    expect(capsuleRowActions(true)).not.toContain("opacity-0");
  });
});
