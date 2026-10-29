// #25: secondary text on 亚克力 cards meets WCAG AA (4.5:1) at the lowest card opacity (70 %) over any desktop
// picture, for every palette — the styles.css acrylic overrides of --fg-muted / --fg-subtle, checked with the
// same model as test/deskGaps.test.tsx (lib/workSurface: the backdrop through --acrylic-filter, the card colour
// at --card-alpha over it). The 宣纸 palette at 70 % was 4.07:1 (muted) and 3.17:1 (subtle) before.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as ws from "../src/renderer/src/lib/workSurface";

const css = readFileSync(join(__dirname, "../src/renderer/src/styles.css"), "utf8");
const vars = (body: string) => Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1]!, m[2]!])) as Record<string, string>;
const block = (head: string) => {
  const at = css.indexOf(head);
  return at < 0 ? {} : vars(css.slice(css.indexOf("{", at) + 1, css.indexOf("}", at)));
};

function palettes() {
  const light = block(":root {");
  const dark = block(':root[data-theme="dark"] {');
  const out: { name: string; theme: "light" | "dark"; v: Record<string, string> }[] = [
    { name: "plain", theme: "light", v: light },
    { name: "graphite", theme: "dark", v: dark },
  ];
  for (const p of css.matchAll(/:root\[data-light-palette="(\w+)"\] \{/g)) out.push({ name: p[1]!, theme: "light", v: { ...light, ...block(p[0]) } });
  for (const p of css.matchAll(/:root:not\(\[data-theme="light"\]\)\[data-dark-palette="(\w+)"\] \{/g)) out.push({ name: p[1]!, theme: "dark", v: { ...dark, ...block(p[0]) } });
  return out;
}

/** The acrylic overrides by palette (the data-theme="dark" rules for the dark ones; the media copies must agree). */
function overrides(): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>();
  const media = new Map<string, Record<string, string>>();
  for (const m of css.matchAll(/^(\s*):root([^{]*)\[data-card-material="acrylic"\]:not\(\[data-contrast\]\)([^{]*)\{([^}]*)\}/gm)) {
    const sel = m[2]! + m[3]!;
    const name = /palette="(\w+)"/.exec(sel)?.[1] ?? (/data-theme|not\(\[data-theme/.test(sel) ? "graphite" : "plain");
    (m[1] ? media : out).set(name, vars(m[4]!));
  }
  for (const [name, v] of media) expect(out.get(name), `${name}: the prefers-color-scheme copy matches`).toEqual(v);
  return out;
}

const backdrops = ["#000000", "#ffffff", "#ff0000", "#00ff00", "#0000ff", "#ffff00", "#00ffff", "#ff00ff", "#808080", "#bcd3f5", "#f6d9c4", "#8fa9d6", "#1b2440", "#3b2a4a", "#2c3a63"].map(ws.hexRgb);

describe("亚克力 secondary text (#25)", () => {
  it("every palette has acrylic overrides, and secondary text meets AA at 70 % over any backdrop", () => {
    const over = overrides();
    const all = palettes();
    expect(all.length).toBe(9);
    const lowest = ws.ACRYLIC_RANGE[0] / 100;
    for (const p of all) {
      const o = over.get(p.name);
      expect(o, p.name).toBeDefined();
      const at = (c: string) => ws.worstAcrylicContrast(ws.hexRgb(c), ws.hexRgb(p.v.bg!), lowest, p.theme, backdrops);
      expect(at(o!["fg-muted"]!), `${p.name} muted`).toBeGreaterThanOrEqual(5.2);
      expect(at(o!["fg-subtle"]!), `${p.name} subtle`).toBeGreaterThanOrEqual(4.5);
      // Never weaker than the palette's own colour, and muted stays at least as strong as subtle.
      expect(at(o!["fg-muted"]!)).toBeGreaterThanOrEqual(at(p.v["fg-muted"]!) - 1e-9);
      expect(at(o!["fg-subtle"]!)).toBeGreaterThanOrEqual(at(p.v["fg-subtle"]!) - 1e-9);
      expect(at(o!["fg-muted"]!)).toBeGreaterThanOrEqual(at(o!["fg-subtle"]!));
    }
  });
  it("the overrides come before the 高 / 最高 contrast rules and leave them alone", () => {
    expect(css.indexOf('[data-card-material="acrylic"]:not([data-contrast])')).toBeLessThan(css.indexOf(':root[data-contrast="high"]'));
  });
});
