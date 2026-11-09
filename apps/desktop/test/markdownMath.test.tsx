// Markdown math (lib/markdownMath.ts, components/MathNode.tsx): which `$` / `\(` / `\[` text becomes a formula,
// code untouched, streaming tails as plain source, CJK neighbours, invalid TeX as source, copy as source.
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({
  api: { openExternal: () => Promise.resolve() },
  bridge: { on: () => () => {} },
  onEvent: () => () => {},
  cleanIpcMessage: (m: string) => m,
}));

vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
}));

const { Markdown } = await import("../src/renderer/src/components/Markdown");
const { loadKatex } = await import("../src/renderer/src/lib/katexRender");
const { splitMathSource } = await import("../src/renderer/src/lib/markdownMath");
const { replaceMathSources, plainFragmentText } = await import("../src/renderer/src/lib/mathCopy");

beforeAll(async () => {
  await loadKatex();
});

const render = (text: string, streaming = false) => renderToStaticMarkup(h(Markdown, { text, streaming }));
/** The TeX sources KaTeX typeset (its MathML annotation). */
const formulas = (html: string) => [...html.matchAll(/<annotation encoding="application\/x-tex">([^<]*)<\/annotation>/g)].map((m) => m[1]!.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"));
const sources = (html: string) => [...html.matchAll(/data-math-source="([^"]*)"/g)].map((m) => m[1]!.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">"));
const pending = (html: string) => [...html.matchAll(/<span class="math-source"[^>]*>([^<]*)<\/span>/g)].map((m) => m[1]!.replace(/&amp;/g, "&"));

describe("Markdown math delimiters", () => {
  it.each([
    ["$5 and $10", "whitespace before the closing $"],
    ["$HOME/$PATH", "closing $ followed by a letter"],
    ["$HOME/bin:$PATH/x", "closing $ followed by a letter"],
    ["$A$B", "closing $ followed by a letter"],
    ["cost $3.", "no closing $"],
    ["costs $3 or $4 total", "whitespace before the closing $"],
    ["US$5 and US$6", "opening $ after a letter"],
    ["a$b$ c", "opening $ after a letter"],
    ["$ x$", "whitespace after the opening $"],
    ["$x $", "whitespace before the closing $"],
    ["$1$2", "closing $ followed by a digit"],
    ["$$", "empty"],
    ["$$$x$$$", "three dollars"],
    ["echo $(pwd)/$x", "closing $ followed by a letter"],
    ["total: 5$\nand 6$ more", "opening $ after a digit"],
    ["price $5\nand 6$ x", "single $ does not cross a line"],
  ])("keeps %j as text (%s)", (text) => {
    const html = render(text);
    expect(formulas(html)).toEqual([]);
    expect(html).not.toContain("katex");
  });

  it.each([
    ["其中 $E\\varepsilon_c=0$。", ["E\\varepsilon_c=0"]],
    ["$x$的", ["x"]],
    ["$x$,", ["x"]],
    ["$x$, $y$ and $z$.", ["x", "y", "z"]],
    ["the cost $\\$5$ here", ["\\$5"]],
    ["$y_c=\\mu_c+\\varepsilon_c$", ["y_c=\\mu_c+\\varepsilon_c"]],
    ["norm $\\lVert\\Delta\\rVert^2$ here", ["\\lVert\\Delta\\rVert^2"]],
    ["inline \\(a+b\\) too", ["a+b"]],
    ["a set $\\{x \\mid x>0\\}$ and $a\\\\b$", ["\\{x \\mid x>0\\}", "a\\\\b"]],
  ])("typesets %j", (text, expected) => {
    expect(formulas(render(text))).toEqual(expected);
  });

  it("reads math before emphasis: `*` and `_` stay TeX", () => {
    const html = render("$a=y_A+y_B-y_0=a^*+e$ and *b* $c_1 * d_1$");
    expect(formulas(html)).toEqual(["a=y_A+y_B-y_0=a^*+e", "c_1 * d_1"]);
    expect(html.match(/<em/g)?.length).toBe(1);
  });

  it("never touches inline code or code blocks", () => {
    const html = render("Run `echo $x$` and `\\(y\\)`.\n\n```\n$z$ \\[w\\]\n```\n\n    $indented$\n");
    expect(formulas(html)).toEqual([]);
    expect(html).toContain("echo $x$");
    expect(html).toContain("$z$ \\[w\\]");
  });

  it("keeps a ```math fence a code block", () => {
    expect(formulas(render("```math\nx^2\n```"))).toEqual([]);
  });

  it("puts $$…$$ and \\[…\\] in display blocks, splitting the paragraph around them", () => {
    const html = render("The formula is:\n$$\nE = mc^2\n$$\nwhere m is mass, and \\[ a^2+b^2 \\] holds.");
    expect(formulas(html)).toEqual(["\nE = mc^2\n", " a^2+b^2 "]);
    expect(html.match(/<div class="math-display"/g)?.length).toBe(2);
    expect(html).toMatch(/<p[^>]*>The formula is:<\/p>/);
    expect(html).toMatch(/<p[^>]*>where m is mass, and<\/p>/);
    expect(html).toMatch(/<p[^>]*>holds\.<\/p>/);
    expect(sources(html)).toEqual(["$$\nE = mc^2\n$$", "\\[ a^2+b^2 \\]"]);
  });

  it("handles display math in lists, quotes and a multi-line aligned block", () => {
    const html = render("- item\n\n  $$\n  \\begin{aligned}\n  a &= b \\\\\n  &= c\n  \\end{aligned}\n  $$\n\n> quote $$x+1$$");
    expect(formulas(html).map((f) => f.replace(/\s+/g, " ").trim())).toEqual(["\\begin{aligned} a &= b \\\\ &= c \\end{aligned}", "x+1"]);
    expect(html.match(/<div class="math-display"/g)?.length).toBe(2);
  });

  it("keeps display delimiters inline where no block can go (table cell, heading)", () => {
    const html = render("| a | b |\n|---|---|\n| $x^2$ | $$y$$ |\n\n## Title $\\alpha$");
    expect(formulas(html)).toEqual(["x^2", "y", "\\alpha"]);
    expect(html).not.toContain('class="math-display"');
  });

  it("falls back to the source text for TeX KaTeX rejects, with no error block", () => {
    const html = render("bad $\\frac{a$ and $\\undefinedcommand{x}$ ok $x$");
    expect(html).not.toContain("katex-error");
    expect(html).toContain('<span class="math-source"');
    expect(formulas(html)).toEqual(["x"]);
  });

  it("does not let TeX make links or HTML (trust off)", () => {
    const html = render("$\\href{javascript:alert(1)}{x}$ $\\url{https://x.y}$ $\\htmlClass{evil}{x}$ $\\includegraphics{a.png}$");
    expect(html).not.toMatch(/<a\s/);
    expect(html).not.toMatch(/\shref=/);
    expect(html).not.toContain('class="evil"');
    expect(html).not.toMatch(/<img\s/);
  });

  it("splits sources by delimiter", () => {
    expect(splitMathSource("$x$")).toEqual({ tex: "x", display: false });
    expect(splitMathSource("$$x$$")).toEqual({ tex: "x", display: true });
    expect(splitMathSource("\\(x\\)")).toEqual({ tex: "x", display: false });
    expect(splitMathSource("\\[x\\]")).toEqual({ tex: "x", display: true });
  });
});

describe("Markdown math while streaming", () => {
  it("shows an unclosed `$` as plain source with no Markdown inside it", () => {
    const html = render("其中 $a=y_A+y_B-y_0=a^*+e", true);
    expect(formulas(html)).toEqual([]);
    expect(pending(html)).toEqual(["$a=y_A+y_B-y_0=a^*+e"]);
    expect(html).not.toContain("<em");
  });

  it("waits for the character after a closing `$` at the end", () => {
    expect(formulas(render("so $x$", true))).toEqual([]);
    expect(pending(render("so $x$", true))).toEqual(["$x$"]);
    expect(formulas(render("so $x$ and", true))).toEqual(["x"]);
    expect(formulas(render("so $x$。", true))).toEqual(["x"]);
    expect(formulas(render("so $HOME/$P", true))).toEqual([]);
    expect(formulas(render("so $x$", false))).toEqual(["x"]);
  });

  it("shows an unclosed `$$` block as source until its closer arrives", () => {
    const open = render("Then\n$$\n\\begin{aligned}\na &= b", true);
    expect(formulas(open)).toEqual([]);
    expect(pending(open)).toEqual(["$$\n\\begin{aligned}\na &amp;= b".replace("&amp;", "&")]);
    const closed = render("Then\n$$\n\\begin{aligned}\na &= b\n\\end{aligned}\n$$\n", true);
    expect(formulas(closed).map((f) => f.trim())).toEqual(["\\begin{aligned}\na &= b\n\\end{aligned}"]);
  });

  it("keeps prices plain once their line has moved on", () => {
    const html = render("cost $3 and *more*\nnext", true);
    expect(pending(html)).toEqual([]);
    expect(html).toContain("<em");
  });

  it("renders an earlier closed formula while a later one is open", () => {
    const html = render("$x$ then \\(y", true);
    expect(formulas(html)).toEqual(["x"]);
    expect(pending(html)).toEqual(["\\(y"]);
  });
});

describe("copying Markdown math", () => {
  const dom = () => {
    const { window } = new JSDOM("<!doctype html><body></body>");
    return window.document;
  };

  it("copies a selected formula, even partly selected, as its source", () => {
    const doc = dom();
    doc.body.innerHTML = '<p>其中 <span class="math-inline" data-math-source="$E\\varepsilon_c=0$"><span class="katex">E ε c = 0</span></span>。</p><div class="math-display" data-math-source="$$\na=b\n$$"><span class="katex">a = b</span></div>';
    const range = doc.createRange();
    range.setStart(doc.body.querySelector("p")!.firstChild!, 0);
    range.setEnd(doc.body.querySelector(".math-display .katex")!.firstChild!, 2);
    const fragment = range.cloneContents();
    expect(replaceMathSources(fragment, range)).toBe(true);
    expect(plainFragmentText(fragment)).toBe("其中 $E\\varepsilon_c=0$。\n$$\na=b\n$$\n");
  });

  it("copies a selection inside one formula as the whole formula", () => {
    const doc = dom();
    doc.body.innerHTML = '<p>a <span class="math-inline" data-math-source="$x^2$"><span class="katex"><span>x</span><span>2</span></span></span> b</p>';
    const range = doc.createRange();
    range.selectNodeContents(doc.body.querySelector(".katex span")!);
    const fragment = range.cloneContents();
    expect(replaceMathSources(fragment, range)).toBe(true);
    expect(plainFragmentText(fragment)).toBe("$x^2$");
  });
});
