import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { contrastRatio, hexRgb, type Rgb } from "../src/renderer/src/lib/workSurface";

const css = readFileSync(join(__dirname, "../src/renderer/src/styles.css"), "utf8");
const vars = (body: string) => Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map(m => [m[1]!, m[2]!]));
const block = (head: string) => { const at = css.indexOf(head); return vars(css.slice(css.indexOf("{", at) + 1, css.indexOf("}", at))); };
const mix = (a: Rgb, b: Rgb, alpha: number) => a.map((v, i) => v * alpha + b[i]! * (1 - alpha)) as unknown as Rgb;

it("keeps enabled control ink above 6:1 over extreme wallpaper colours in every palette", () => {
  const light = block(":root {"), dark = block(':root[data-theme="dark"] {');
  const palettes = [light, dark,
    ...[...css.matchAll(/:root\[data-light-palette="\w+"\] \{/g)].map(m => ({ ...light, ...block(m[0]) })),
    ...[...css.matchAll(/:root:not\(\[data-theme="light"\]\)\[data-dark-palette="\w+"\] \{/g)].map(m => ({ ...dark, ...block(m[0]) })),
  ];
  const rule = css.slice(css.indexOf('/* Keep the bar'), css.indexOf('/* Every Shelf Rail'));
  const opacity = Number(/var\(--win\) (\d+)%/.exec(rule)![1]) / 100;
  const ink = Number(/var\(--fg\) (\d+)%/.exec(rule)![1]) / 100;
  expect(palettes).toHaveLength(9);
  for (const palette of palettes) for (const backdrop of ["#000000", "#ffffff", "#ff0000", "#00ff00", "#0000ff"]) {
    const win = hexRgb(palette.win!), surface = mix(win, mix(win, hexRgb(backdrop), 0.52), opacity);
    expect(contrastRatio(mix(hexRgb(palette.fg!), surface, ink), surface), `${palette.win} over ${backdrop}`).toBeGreaterThanOrEqual(6);
  }
  expect(rule).toContain(':root:not([data-edge-to-edge])');
  expect(rule).not.toContain("backdrop-filter:");
});
