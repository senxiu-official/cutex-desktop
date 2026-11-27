// Callout quotes (Markdown alerts; part of normal message rendering since 2026-11-27): a blockquote whose first line starts with a GitHub-style
// marker — `> [!EXPLAIN] 标题`, `> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]` — is marked for
// components/MarkdownCallout. The tree change keeps every character in place: the marker and the title stay as an inline
// `<span data-callout-head>` at the start of the first paragraph, so a reader that ignores the attributes (mobile, or
// an older client) renders the quote exactly as plain Markdown; only the card hides that span and shows the title in its head.
// Append after sanitize (fixed attribute names, text copied from the tree, no HTML).
import type { HastNode } from "./markdownPathText";

export const CALLOUT_KINDS = ["explain", "note", "tip", "important", "warning", "caution"] as const;
export type CalloutKind = (typeof CALLOUT_KINDS)[number];
const MARKER = /^[ \t]*\[!([A-Za-z]+)\]/;
const TITLE_MAX = 200;

const text = (value: string): HastNode => ({ type: "text", value });
function plain(node: HastNode): string {
  return node.type === "text" ? node.value ?? "" : (node.children ?? []).map(plain).join("");
}

/** The callout kind of a marker line (`[!Note]` included), or null. */
export function calloutKind(line: string): CalloutKind | null {
  const m = MARKER.exec(line);
  const kind = m?.[1]!.toLowerCase();
  return kind && (CALLOUT_KINDS as readonly string[]).includes(kind) ? (kind as CalloutKind) : null;
}

function mark(quote: HastNode): void {
  const kids = quote.children ?? [];
  const para = kids.find((c) => c.type === "element");
  if (para?.tagName !== "p") return;
  const inline = para.children ?? [];
  const first = inline[0];
  if (first?.type !== "text" || typeof first.value !== "string") return;
  const kind = calloutKind(first.value);
  if (!kind) return;
  const { head, rest } = splitLine(inline);
  const title = head.map(plain).join("").replace(MARKER, "").trim().slice(0, TITLE_MAX);
  para.children = [{ type: "element", tagName: "span", properties: { dataCalloutHead: "" }, children: head }, ...rest];
  // A marker-only first paragraph (`> [!NOTE]` then a blank `>` line): the card drops it, leaving no gap.
  if (rest.every((n) => n.type === "text" && !n.value!.trim() || n.type === "element" && n.tagName === "br")) para.properties = { ...para.properties, dataCalloutHeadOnly: "" };
  quote.properties = { ...quote.properties, dataCallout: kind, ...(title ? { dataCalloutTitle: title } : {}) };
}

/**
 * The marker line and the rest of the paragraph, split at the first line break (a newline in a text node, or a <br>)
 * at any inline depth: an element the break falls inside (`*Title⏎body*`, a link) is split into two copies of itself,
 * the title part and the body part, so the body keeps its formatting and is never hidden with the title.
 */
function splitLine(nodes: HastNode[]): { head: HastNode[]; rest: HastNode[]; found: boolean } {
  const head: HastNode[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    if (node.type === "text" && node.value!.includes("\n")) {
      const at = node.value!.indexOf("\n");
      head.push(text(node.value!.slice(0, at)));
      return { head, rest: [text(node.value!.slice(at)), ...nodes.slice(i + 1)], found: true };
    }
    if (node.type === "element" && node.tagName === "br") return { head, rest: nodes.slice(i), found: true };
    if (node.type === "element" && node.children?.length) {
      const inner = splitLine(node.children);
      if (inner.found) {
        if (inner.head.length) head.push({ ...node, properties: { ...node.properties }, children: inner.head });
        return { head, rest: [{ ...node, properties: { ...node.properties }, children: inner.rest }, ...nodes.slice(i + 1)], found: true };
      }
    }
    head.push(node);
  }
  return { head, rest: [], found: false };
}

function walk(node: HastNode): void {
  for (const child of node.children ?? []) {
    if (child.type !== "element") continue;
    if (child.tagName === "pre" || child.tagName === "code") continue;
    if (child.tagName === "blockquote") mark(child);
    walk(child);
  }
}

export function rehypeCallouts() {
  return (tree: HastNode): void => walk(tree);
}
