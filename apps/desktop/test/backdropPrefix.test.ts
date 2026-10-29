// The production CSS build (Tailwind → lightningcss) keeps only `-webkit-backdrop-filter` when a rule writes it
// next to `backdrop-filter` (lightningcss 1.32 / 1.33: `.a{backdrop-filter:X;-webkit-backdrop-filter:X}` →
// `.a{-webkit-backdrop-filter:X}`), and Chromium ignores the prefixed one: the 亚克力 cards, the title bar's
// frost and the desktop's glass had no blur in built apps (found 2026-10-22, perf-baseline §10). Write only
// `backdrop-filter`; the build adds the prefix where a target needs it.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "../src/renderer/src");
function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? cssFiles(p) : p.endsWith(".css") ? [p] : [];
  });
}

describe("backdrop-filter in the app's CSS", () => {
  it("is never written with the -webkit- prefix (the build would drop the standard one)", () => {
    const offenders = cssFiles(root).filter((f) => /-webkit-backdrop-filter\s*:/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
