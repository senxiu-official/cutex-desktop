// Bare desktop widgets (少框, owner 2026-10-24) on a light wallpaper (owner 2026-11-10): the small second line
// (运行中, 成果, host names) has a tighter, darker edge than the title so it stays readable on the light sky.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const css = readFileSync(join(__dirname, "../src/renderer/src/modules/home/home.css"), "utf8");
const rule = (sel: string) => {
  const at = css.indexOf("\n" + sel + " {");
  return at < 0 ? "" : css.slice(at, css.indexOf("}", at));
};
const alphas = (s: string) => [...s.matchAll(/rgba\(16, 24, 48, ([\d.]+)\)/g)].map((m) => Number(m[1]));

it("the bare second line has its own dark edge, stronger than the title's", () => {
  const sub = rule(".home-bare .home-sub");
  const title = rule(".home-bare");
  expect(sub).toMatch(/text-shadow:/);
  expect(alphas(sub).length).toBeGreaterThanOrEqual(3);
  expect(Math.max(...alphas(sub))).toBeGreaterThan(Math.max(...alphas(title)));
});
