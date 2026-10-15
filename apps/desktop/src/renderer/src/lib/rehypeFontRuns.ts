import { classifyFontRuns, hasSharedQuote, type FontRun } from "./fontRuns";

/** Structural HAST subset: no runtime dependency on the Markdown parser. */
interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

export interface FontRunsOptions {
  /** Trusted prose-owner metadata only; never the UI locale or raw HTML lang. */
  ownerLang?: string;
}

const excluded = new Set(["code", "pre", "kbd", "samp", "script", "style", "svg", "math", "img", "picture", "video", "audio", "canvas", "iframe", "object", "embed", "input", "textarea", "select", "button"]);
const blocks = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "div", "section", "article", "aside", "header", "footer", "main", "nav", "blockquote", "ul", "ol", "li", "dl", "dt", "dd", "table", "thead", "tbody", "tfoot", "tr", "td", "th", "figure", "figcaption", "address", "details", "summary", "hr"]);
const routed = new Set(["font-run-cjk", "font-run-latin", "font-run-mono"]);

function excludedNode(node: HastNode): boolean {
  if (excluded.has(node.tagName ?? "")) return true;
  const classes = node.properties?.className;
  const names = Array.isArray(classes) ? classes : typeof classes === "string" ? classes.split(/\s+/) : [];
  return names.some((name) => typeof name === "string" && (routed.has(name) || /^(?:katex(?:-|$)|math(?:-|$)|language-math$)/.test(name)));
}

interface Leaf {
  node: HastNode;
  parent: HastNode;
  index: number;
  start: number;
  end: number;
}

/**
 * Append after sanitize. Only generates spans with fixed classes and original
 * text, never HTML, style, URLs, or copied user attributes. Inline emphasis/links
 * share quotation context; block and code/media boundaries do not.
 */
export function rehypeFontRuns(options: FontRunsOptions = {}) {
  return (tree: HastNode): void => {
    const pending: HastNode[] = excludedNode(tree) ? [] : [tree];
    function scope(root: HastNode): void {
      let leaves: Leaf[] = [];
      let length = 0;
      const replacements = new Map<HastNode, Map<number, HastNode[]>>();

      function flush(): void {
        if (!leaves.length) return;
        const text = leaves.map((leaf) => leaf.node.value ?? "").join("");
        // Structural whitespace between paragraphs/table rows is not prose. In
        // particular, never insert spans directly into a table for its newlines.
        // Both run stacks route every character the same way except the shared curly quotes
        // (fontRanges.ts FONT_RANGES), and a prose scope already uses the Latin-context stack.
        // Without one of those quotes the spans would change nothing, so leave the text alone
        // instead of roughly doubling the element count of mixed CJK / English messages.
        if (!text.trim() || !hasSharedQuote(text)) {
          leaves = [];
          length = 0;
          return;
        }
        const runs = classifyFontRuns(text, options.ownerLang);
        let at = 0;
        const ranges = runs.map((run: FontRun) => {
          const start = at;
          at += run.text.length;
          return { kind: run.kind, start, end: at };
        });
        let cursor = 0;
        for (const leaf of leaves) {
          while (cursor < ranges.length && ranges[cursor]!.end <= leaf.start) cursor++;
          const nodes: HastNode[] = [];
          for (let i = cursor; i < ranges.length && ranges[i]!.start < leaf.end; i++) {
            const run = ranges[i]!;
            const value = (leaf.node.value ?? "").slice(Math.max(0, run.start - leaf.start), Math.min(leaf.end, run.end) - leaf.start);
            if (value) nodes.push({ type: "element", tagName: "span", properties: { className: [`font-run-${run.kind}`] }, children: [{ type: "text", value }] });
          }
          if (nodes.length) {
            let parent = replacements.get(leaf.parent);
            if (!parent) replacements.set(leaf.parent, parent = new Map());
            parent.set(leaf.index, nodes);
          }
        }
        leaves = [];
        length = 0;
      }

      // An explicit stack avoids adding another recursive walk to an untrusted,
      // deeply nested Markdown tree. Nested blocks become independent scopes.
      const frames = [{ node: root, index: 0 }];
      while (frames.length) {
        const frame = frames.at(-1)!;
        const node = frame.node;
        if (!node.children || frame.index >= node.children.length) {
          frames.pop();
          continue;
        }
        const i = frame.index++;
        const child = node.children[i]!;
        if (child.type === "text" && typeof child.value === "string") {
          leaves.push({ node: child, parent: node, index: i, start: length, end: length + child.value.length });
          length += child.value.length;
        } else if (excludedNode(child) || child.type === "raw" || child.type === "comment") {
          flush();
        } else if (child.tagName === "br") {
          // A Markdown hard break ends narration evidence without inserting a
          // character into the DOM or matching quotes across the boundary.
          flush();
        } else if (blocks.has(child.tagName ?? "")) {
          flush();
          pending.push(child);
        } else if (child.children) frames.push({ node: child, index: 0 });
      }
      flush();
      for (const [parent, indices] of replacements) parent.children = parent.children!.flatMap((child, i) => indices.get(i) ?? [child]);
    }
    while (pending.length) scope(pending.pop()!);
  };
}
