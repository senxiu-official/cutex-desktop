// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Parse the running-avatar rules alone: the full stylesheet also contains Tailwind directives.
const css = readFileSync(resolve(__dirname, "../src/renderer/src/styles.css"), "utf8");
const style = document.createElement("style");
style.textContent = css.slice(css.indexOf(".agent-ring {"), css.indexOf("/* ── Layers"));
document.head.append(style);
const rules = Array.from(style.sheet!.cssRules);
const tile = rules.find((rule) => (rule as CSSStyleRule).selectorText === ".agent-ring-tile") as CSSStyleRule;
const pulse = rules.find((rule) => (rule as CSSKeyframesRule).name === "agent-ring-tile-pulse") as CSSKeyframesRule;

describe("small-avatar breathing border", () => {
  it("keeps the shadow fixed and animates only opacity, with the original quarter-strength midpoint", () => {
    expect(tile.style.getPropertyValue("box-shadow")).toBe("0 0 0 1.5px var(--accent)");
    expect(tile.style.opacity).toBe("1");
    expect(tile.style.getPropertyValue("will-change")).toBe("opacity");
    expect(tile.style.animation).toBe("agent-ring-tile-pulse 1.4s ease-in-out infinite");
    const frames = Array.from(pulse.cssRules) as CSSKeyframeRule[];
    expect(frames).toHaveLength(1);
    const midpoint = frames[0]!; // The length assertion above guarantees this frame exists.
    expect(midpoint.keyText).toBe("50%");
    expect(midpoint.style.length).toBe(1);
    expect(midpoint.style[0]).toBe("opacity");
    expect(midpoint.style.opacity).toBe("0.25");
  });

  it("leaves a full-strength static border without a layer hint for reduced motion", () => {
    const reduced = rules.find((rule) => (rule as CSSMediaRule).conditionText === "(prefers-reduced-motion: reduce)") as CSSMediaRule;
    const reducedTile = Array.from(reduced.cssRules).find((rule) => (rule as CSSStyleRule).selectorText === ".agent-ring-tile") as CSSStyleRule;
    expect(reducedTile.style.animation).toBe("none");
    expect(reducedTile.style.getPropertyValue("will-change")).toBe("auto");
    expect(reducedTile.style.getPropertyValue("opacity")).toBe("");
    expect(reducedTile.style.getPropertyValue("box-shadow")).toBe("");
  });
});
