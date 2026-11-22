// Windows paths in Markdown prose keep the backslashes they were written with (lib/workspace writtenWindowsText):
// a rehype step reads each text node's markdown source back by its position. Components/Markdown runs it in its own
// source-aware step (with the link / image hrefs).
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
