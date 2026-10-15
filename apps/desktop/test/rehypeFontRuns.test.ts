import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { cjk } from "@streamdown/cjk";
import { defaultRehypePlugins, Streamdown } from "streamdown";
import { rehypeFontRuns } from "../src/renderer/src/lib/rehypeFontRuns";

interface Node {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: Node[];
}
const text = (value: string): Node => ({ type: "text", value });
const el = (tagName: string, children: Node[], properties: Record<string, unknown> = {}): Node => ({ type: "element", tagName, properties, children });
const root = (...children: Node[]): Node => ({ type: "root", children });
const content = (node: Node): string => node.type === "text" ? node.value ?? "" : node.children?.map(content).join("") ?? "";
function routedNodes(node: Node): Node[] {
  if (node.tagName === "span" && Array.isArray(node.properties?.className) && node.properties.className.some((c) => typeof c === "string" && c.startsWith("font-run-"))) return [node];
  return node.children?.flatMap(routedNodes) ?? [];
}
function kindAt(node: Node, index: number): string | undefined {
  let at = 0;
  for (const run of routedNodes(node)) {
    at += content(run).length;
    if (index < at) return (run.properties!.className as string[])[0];
  }
}

describe("rehypeFontRuns", () => {
  it("finds quote owners across emphasis/link leaves while preserving their elements and attributes", () => {
    const link = el("a", [text("job’s")], { href: "https://example.com/?a=1&b=2", title: "a < b" });
    const emphasis = el("em", [text("run "), link]);
    const p = el("p", [text("他说：“"), emphasis, text(" task。”")]);
    const tree = root(p);
    const before = content(tree);
    const linkProps = { ...link.properties };
    rehypeFontRuns()(tree);
    expect(content(tree)).toBe(before);
    expect(p.children).toContain(emphasis);
    expect(emphasis.children).toContain(link);
    expect(link.properties).toEqual(linkProps);
    expect(routedNodes(link).map(content)).toEqual(["job’s"]);
    expect(kindAt(p, before.indexOf("“"))).toBe("font-run-cjk");
    expect(kindAt(p, before.indexOf("’"))).toBe("font-run-latin");
    expect(kindAt(p, before.indexOf("”"))).toBe("font-run-cjk");
  });

  it("classifies an apostrophe using the next styled leaf, without removing author formatting", () => {
    const strong = el("strong", [text("s")]);
    const p = el("p", [text("中文，job’"), strong, text("，中文")]);
    rehypeFontRuns()(root(p));
    expect(p.children).toContain(strong);
    expect(content(p)).toBe("中文，job’s，中文");
    expect(kindAt(p, 6)).toBe("font-run-latin");
    expect(routedNodes(strong)[0]!.properties?.className).toEqual(["font-run-latin"]);
  });

  it("does not use raw HTML lang or the quoted leaf language as trusted owner metadata", () => {
    const p = el("p", [text("She said, “"), el("em", [text("中文")], { lang: "zh-CN" }), text("”")], { lang: "zh-CN" });
    rehypeFontRuns()(root(p));
    expect(kindAt(p, content(p).indexOf("“"))).toBe("font-run-latin");
    const explicit = el("p", [text("“English”")], { lang: "en" });
    rehypeFontRuns({ ownerLang: "zh-CN" })(root(explicit));
    expect(kindAt(explicit, 0)).toBe("font-run-cjk");
  });

  it("keeps paragraphs, headings, list-item direct text, nested lists, and table cells independent", () => {
    const lead = el("li", [text("他说：“unclosed"), el("p", [text("She said, “中文”")]), el("ul", [el("li", [text("“English”")])])]);
    const firstCell = el("td", [text("他说：“English”")]);
    const secondCell = el("td", [text("“English”")]);
    const table = el("table", [text("\n"), el("tbody", [text("\n"), el("tr", [firstCell, text("\n"), secondCell])])]);
    const heading = el("h2", [text("“English”")]);
    const p = el("p", [text("他说：“unclosed")]);
    const tree = root(p, text("\n"), heading, el("ol", [lead]), table);
    const original = content(tree);
    rehypeFontRuns()(tree);
    expect(content(tree)).toBe(original);
    expect(tree.children![1]).toEqual(text("\n"));
    expect(table.children![0]).toEqual(text("\n"));
    expect(kindAt(heading, 0)).toBe("font-run-latin");
    expect(kindAt(firstCell, 3)).toBe("font-run-cjk");
    expect(kindAt(secondCell, 0)).toBe("font-run-latin");
    const childP = lead.children!.find((n) => n.tagName === "p")!;
    expect(kindAt(childP, content(childP).indexOf("“"))).toBe("font-run-latin");
    const nestedList = lead.children!.find((n) => n.tagName === "ul")!;
    expect(kindAt(nestedList, 0)).toBe("font-run-latin");
  });

  it.each(["code", "pre", "kbd", "samp", "svg", "math", "img", "picture", "video", "audio", "canvas", "iframe", "textarea", "button"])("excludes %s and its text from neighboring quotation evidence", (tag) => {
    const excluded = el(tag, [text("他说：中文")], { title: "“unchanged”", src: "/unmodified" });
    const snapshot = structuredClone(excluded);
    const p = el("p", [excluded, text("“English”")]);
    rehypeFontRuns()(root(p));
    expect(excluded).toEqual(snapshot);
    expect(routedNodes(p).map(content)).toEqual(["“English”"]);
  });

  it.each(["katex", "katex-display", "math-inline", "math-display", "language-math"])("excludes math renderer class %s", (className) => {
    const math = el("span", [text("中文")], { className: [className] });
    const snapshot = structuredClone(math);
    const p = el("p", [math, text("“English”")]);
    rehypeFontRuns()(root(p));
    expect(math).toEqual(snapshot);
    expect(routedNodes(p).map(content)).toEqual(["“English”"]);
  });

  it("does not cross hard breaks, excluded code, or raw nodes", () => {
    for (const barrier of [el("br", []), el("code", [text("ignored")]), { type: "raw", value: "<span>ignored</span>" }]) {
      const p = el("p", [text("他说："), barrier, text("“English”")]);
      rehypeFontRuns()(root(p));
      // "他说：" alone has no shared quote, so it keeps its plain text node (no span).
      expect(routedNodes(p).map(content)).toEqual(["“English”"]);
      expect(routedNodes(p).at(-1)?.properties?.className).toEqual(["font-run-latin"]);
    }
  });

  it("leaves prose without a shared curly quote as plain text nodes", () => {
    const strong = el("strong", [text("English")]);
    const p = el("p", [text("中文 "), strong, text(" mixed 混排，job's（ASCII）「括号」。")]);
    const snapshot = structuredClone(p);
    rehypeFontRuns()(root(p));
    expect(p).toEqual(snapshot);
    // One curly quote anywhere in the paragraph routes the whole paragraph, as before.
    const quoted = el("p", [text("中文 "), el("strong", [text("English")]), text(" 说：“好”")]);
    rehypeFontRuns()(root(quoted));
    expect(routedNodes(quoted).map(content).join("")).toBe("中文 English 说：“好”");
  });

  it("is idempotent and emits only fixed classes and original text", () => {
    const p = el("p", [text("中文，job’s，<unsafe> & 👩‍💻 e\u0301 𠀀")]);
    const tree = root(p);
    const original = content(tree);
    const plugin = rehypeFontRuns();
    plugin(tree);
    const once = structuredClone(tree);
    plugin(tree);
    expect(tree).toEqual(once);
    expect(content(tree)).toBe(original);
    for (const node of routedNodes(tree)) {
      expect(Object.keys(node.properties!)).toEqual(["className"]);
      expect(node.children).toHaveLength(1);
      expect(node.children![0]!.type).toBe("text");
    }
  });

  it("handles deeply nested inline input without a recursive plugin traversal", () => {
    const inner = el("em", [text("中文，job’s")]);
    let wrapped = inner;
    for (let i = 0; i < 12_000; i++) wrapped = el("em", [wrapped]);
    expect(() => rehypeFontRuns()(root(el("p", [wrapped])))).not.toThrow();
    expect(routedNodes(inner).map(content)).toEqual(["中文，", "job’s"]);
  });

  it("preserves known-host quote ownership across streaming AST prefixes", () => {
    const prefix = "他说：“";
    for (const tail of ["", "r", "run job’", "run job’s", "run job’s task。”"]) {
      const p = el("p", [text(prefix), el("strong", [text(tail)])]);
      rehypeFontRuns()(root(p));
      expect(content(p)).toBe(prefix + tail);
      expect(kindAt(p, prefix.length - 1)).toBe("font-run-cjk");
    }
  });

  it("works after Streamdown's real sanitizer without reintroducing HTML or routing code", () => {
    const defaults = Object.entries(defaultRehypePlugins).filter(([name]) => name !== "harden").map(([, plugin]) => plugin);
    const html = renderToStaticMarkup(createElement(Streamdown, {
      mode: "static", plugins: { cjk }, rehypePlugins: [...defaults, rehypeFontRuns],
    }, '他说：“**run job’s** task。” <img src="x" onerror="alert(1)"> `中文 job’s`'));
    expect(html).toContain('class="font-run-cjk"');
    expect(html).toContain('class="font-run-latin"');
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("alert(1)");
    const inlineCode = html.match(/<code[^>]*>(.*?)<\/code>/s)?.[1];
    expect(inlineCode).toBe("中文 job’s");
  });
});
