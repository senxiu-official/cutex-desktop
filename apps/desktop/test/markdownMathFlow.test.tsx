// Display math as its own block (lib/markdownMath.ts flow construct, lib/markdownBlocks.ts split): a `\[`
// or `$$` that opens a line is read before Markdown decides the block structure, so lines inside the
// formula (`=`, `---`, `- x`, `> x`) never become headings, rules, lists or quotes, and `_` / `*` stay TeX.
// Owner report 2026-11-17: a multi-line `\[ … \]` with a line of only `=` became a Setext heading.
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
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
const { mergeOpenDisplayMath } = await import("../src/renderer/src/lib/markdownBlocks");
const { endsInOpenDisplayBracket, mathFlowScan } = await import("../src/renderer/src/lib/markdownMath");
const { parseMarkdownIntoBlocks } = await import("streamdown");

beforeAll(async () => {
  await loadKatex();
});

const render = (text: string, streaming = false) => renderToStaticMarkup(h(Markdown, { text, streaming }));
const unescape = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
const formulas = (html: string) => [...html.matchAll(/<annotation encoding="application\/x-tex">([^<]*)<\/annotation>/g)].map((m) => unescape(m[1]!));
const sources = (html: string) => [...html.matchAll(/data-math-source="([^"]*)"/g)].map((m) => unescape(m[1]!));
const pending = (html: string) => [...html.matchAll(/<span class="math-source"[^>]*>([^<]*)<\/span>/g)].map((m) => unescape(m[1]!));
const displays = (html: string) => html.match(/<div class="math-display"/g)?.length ?? 0;
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

const OWNER =
  "其中\n\\[ \\mathbb E[\\lVert y_{AB}-a\\rVert^2]\n=\n\\underbrace{S}_{\\text{真实非加性}} + \\underbrace{N_{AB}+N_a}_{\\text{噪声贡献}}. \\]\n后文。";
const OWNER_TEX = "\\mathbb E[\\lVert y_{AB}-a\\rVert^2] = \\underbrace{S}_{\\text{真实非加性}} + \\underbrace{N_{AB}+N_a}_{\\text{噪声贡献}}.";

/** Static (finished message), streaming, and a message that was streamed (block split, finished). */
const modes = [
  ["static", (t: string) => render(t)],
  ["streaming", (t: string) => render(t, true)],
] as const;

describe.each(modes)("display math blocks (%s)", (_mode, view) => {
  it("keeps the owner's multi-line \\[ … \\] one formula: no Setext heading, no emphasis, delimiters kept", () => {
    const html = view(OWNER);
    expect(formulas(html).map(squash)).toEqual([OWNER_TEX]);
    expect(displays(html)).toBe(1);
    expect(html).not.toMatch(/<h[1-6]/);
    expect(html).not.toContain("<em");
    expect(html).toMatch(/<p[^>]*>其中<\/p>/);
    expect(html).toMatch(/<p[^>]*>后文。<\/p>/);
    expect(sources(html)[0]).toMatch(/^\\\[ \\mathbb E/);
    expect(sources(html)[0]).toMatch(/\\\]$/);
  });

  it.each([
    ["\\[\nf(x)\n=\na_1 + b_2 + c_3\n\\]", "f(x) = a_1 + b_2 + c_3"],
    ["$$\nf(x)\n=\na_1 + b_2 + c_3\n$$", "f(x) = a_1 + b_2 + c_3"],
    ["\\[\na_1\n---\nb_2 * c_3 * d\n\\]", "a_1 --- b_2 * c_3 * d"],
    ["$$\na_1\n***\nb_2\n$$", "a_1 *** b_2"],
    ["\\[\na\n- b_1\n> c_2\n\\]", "a - b_1 > c_2"],
  ])("reads %j as one display formula", (text, tex) => {
    const html = view(text);
    expect(formulas(html).map(squash)).toEqual([tex]);
    expect(displays(html)).toBe(1);
    expect(html).not.toMatch(/<(h[1-6]|hr|em|strong|ul|blockquote)[\s>]/);
  });

  it("interrupts a paragraph and resumes after the closer", () => {
    const html = view("Thus\n\\[\na_1\n=\nb_2\n\\]\nafter _it_.");
    expect(formulas(html).map(squash)).toEqual(["a_1 = b_2"]);
    expect(html).toMatch(/<p[^>]*>Thus<\/p>/);
    expect(html).toMatch(/<p[^>]*>after <em>it<\/em>\.<\/p>/);
  });

  it("works inside a list item and a block quote", () => {
    const html = view("- item\n  \\[\n  a_1\n  =\n  b_2\n  \\]\n\n> \\[\n> c_1\n> =\n> d_2\n> \\]");
    expect(formulas(html).map(squash)).toEqual(["a_1 = b_2", "c_1 = d_2"]);
    expect(displays(html)).toBe(2);
    expect(html).not.toMatch(/<h[1-6]/);
  });

  it("never reads math inside code fences or code spans", () => {
    const html = view("```\n\\[\nx\n=\ny\n\\]\n```\n\nUse `\\[` and `$$`.");
    expect(formulas(html)).toEqual([]);
    expect(html).not.toContain("math-display");
    expect(html).not.toMatch(/<h[1-6]/);
    // The highlighted code block renders one element per line.
    expect(html.replace(/<[^>]+>/g, "")).toContain("\\[x=y\\]");
    expect(html).toMatch(/<code[^>]*>\\\[<\/code>/);
  });

  it("keeps inline \\( … \\) with subscripts TeX", () => {
    expect(formulas(view("so \\( a_1 + b_2 \\) and \\( c_3 \\)"))).toEqual([" a_1 + b_2 ", " c_3 "]);
  });
});

describe("display math blocks: limits", () => {
  it("leaves an opener without a closer before the next blank line as Markdown text", () => {
    const html = render("\\[\na\n\nmore _text_");
    expect(formulas(html)).toEqual([]);
    expect(html).toContain("<em>text</em>");
  });

  it("shows an unclosed multi-line \\[ as plain source while it streams", () => {
    const html = render("Then\n\\[\na_1\n=\nb", true);
    expect(formulas(html)).toEqual([]);
    expect(html).not.toMatch(/<h[1-6]/);
    expect(pending(html)).toEqual(["\\[\na_1\n=\nb"]);
    // remend's unfinished-link completion is not applied to the `[` of `\[` (inline too).
    expect(pending(render("so \\[ \\mathbb E[x] + b", true))).toEqual(["\\[ \\mathbb E[x] + b"]);
  });

  it("still completes a real unfinished link while streaming", () => {
    expect(endsInOpenDisplayBracket("see [docs")).toBe(false);
    expect(endsInOpenDisplayBracket("\\[ a \\] and [b")).toBe(false);
    expect(endsInOpenDisplayBracket("\\[ E[x] + b")).toBe(true);
    expect(endsInOpenDisplayBracket("a \\\\[b")).toBe(false);
    expect(render("see [docs", true)).not.toContain("[docs");
  });

  it("keeps the display block unsplit in a streamed message's block split", () => {
    const blocks = mergeOpenDisplayMath(parseMarkdownIntoBlocks(OWNER));
    expect(blocks.join("")).toBe(OWNER);
    expect(blocks.some((b) => b.includes("\\[ \\mathbb E") && b.includes("噪声贡献}}. \\]"))).toBe(true);
    // Nothing to merge: the split is unchanged.
    const plain = "# a\n\nb\n\n```\n\\[\n```\n\nc";
    expect(mergeOpenDisplayMath(parseMarkdownIntoBlocks(plain))).toEqual(parseMarkdownIntoBlocks(plain));
  });
});

describe("display math blocks: cost", () => {
  // Cross-review 2026-11-17: every line-start `$5` used to scan the rest of the text for a blank line
  // (400 lines → 881,400 characters). The closer lookup now reads each text once.
  it.each([
    ["prices at line starts", (n: number) => "$5 and $10\n".repeat(n)],
    ["unclosed display openers", (n: number) => "$$ x\n".repeat(n)],
    ["closed display blocks", (n: number) => "$$\nx_1\n$$\n".repeat(n)],
  ])("reads %s in linear work", (_name, make) => {
    for (const streaming of [false, true]) {
      const text = make(2000);
      mathFlowScan.chars = 0;
      render(text, streaming);
      expect(mathFlowScan.chars).toBeLessThanOrEqual(2 * text.length);
    }
  });
});
