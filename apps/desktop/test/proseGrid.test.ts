// Streaming prose keeps every block's vertical sizes on the device grid (`--prose-pixel`, components/Markdown): a
// block that sets its own line height, margin or padding off the grid makes the followed bottom cycle at fractional
// ratios (hachimi 2026-11-06: headings, code, tables). The browser regression is scripts/qa-fractional-prose.mjs.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(__dirname, "../src/renderer/src/styles.css"), "utf8");
/** The declarations of the last rule whose selector contains `selector`. */
function lastRule(selector: string): string {
  const at = css.lastIndexOf(selector);
  expect(at, selector).toBeGreaterThan(-1);
  return css.slice(css.indexOf("{", at) + 1, css.indexOf("}", at));
}
const onGrid = /^round\((?:nearest|up|down), .+, var\(--prose-pixel, 1px\)\)$/;
const values = (decls: string) => Object.fromEntries(decls.split(";").map((d) => d.trim()).filter(Boolean).map((d) => [d.slice(0, d.indexOf(":")).trim(), d.slice(d.indexOf(":") + 1).trim()]));

describe("streaming prose blocks on the device grid", () => {
  it.each([
    [".markdown-streaming-prose {", ["line-height"]],
    [":where(.markdown-streaming-prose > :not(:last-child)) {", ["margin-block-end"]],
    [".markdown-streaming-prose:not(.markdown-document) :is(h1, h2, h3, h4, h5, h6)", ["line-height", "margin-top", "margin-bottom"]],
    ['.markdown-streaming-prose [data-streamdown="list-item"] {', ["padding-top", "padding-bottom"]],
    ['[data-streamdown="table-wrapper"]) {', ["margin-block"]],
    ['.markdown-streaming-prose [data-streamdown="horizontal-rule"] {', ["margin-block"]],
    ['.markdown-streaming-prose [data-streamdown="code-block-header"] {', ["height"]],
    ['.markdown-streaming-prose [data-streamdown="code-block-body"] {', ["padding-top", "padding-bottom"]],
    ['[data-streamdown="table-cell"]) {\n  line-height', ["line-height"]],
    ['[data-streamdown="table-cell"]) {\n  padding-top', ["padding-top", "padding-bottom"]],
  ])("%s", (selector, props) => {
    const v = values(lastRule(selector));
    for (const p of props) expect(v[p], `${selector} ${p}`).toMatch(onGrid);
  });

  it("the grid rules come after the .markdown block rules they override (same specificity)", () => {
    const grid = css.indexOf("The blocks that set their own vertical sizes go on the same grid");
    for (const earlier of [".markdown:not(.markdown-document) :is(h1, h2, h3, h4, h5, h6)", '.markdown [data-streamdown="code-block-body"] {', '.markdown [data-streamdown="code-block-header"] {'])
      expect(css.lastIndexOf(earlier), earlier).toBeLessThan(grid);
  });
});
