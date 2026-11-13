// Windows paths in Markdown prose keep the backslashes they were written with (lib/workspace writtenWindowsText):
// a rehype step reads each text node's markdown source back by its position. Components/Markdown runs it in its own
// source-aware step (with the link / image hrefs); a bare <Streamdown> (notes, side chat) adds `rehypeWindowsPathText`
// in front of streamdown's default rehype plugins.
import { defaultRehypePlugins } from "streamdown";
import { writtenWindowsText } from "./workspace";

export interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}

/** One hast text node: its value as written when CommonMark's escapes changed a Windows path in it. */
export function restoreWindowsText(node: HastNode, source: string): void {
  const { start, end } = node.position ?? {};
  if (typeof node.value !== "string" || start?.offset === undefined || end?.offset === undefined) return;
  const restored = writtenWindowsText(source.slice(start.offset, end.offset), node.value);
  if (restored !== null) node.value = restored;
}

/** Text nodes outside code spans / blocks (and math, a `code` element), against the parsed file's source. */
export function restoreWindowsTextIn(tree: HastNode, source: string): void {
  if (!source.includes("\\")) return;
  const walk = (node: HastNode) => {
    if (node.type === "text") return restoreWindowsText(node, source);
    if (node.type === "element" && (node.tagName === "code" || node.tagName === "pre")) return;
    node.children?.forEach(walk);
  };
  walk(tree);
}

export function rehypeWindowsPathText() {
  return (tree: HastNode, file: { value?: unknown }) => restoreWindowsTextIn(tree, typeof file?.value === "string" ? file.value : "");
}

/** streamdown's own rehype plugins (raw, sanitize, harden) with the path text step first: for a bare <Streamdown>. */
export const BARE_STREAMDOWN_REHYPE = [rehypeWindowsPathText, ...Object.values(defaultRehypePlugins)];
