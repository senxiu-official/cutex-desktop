// Block splitting for a streaming message, kept per message (perf baseline 2026-10-20, fix order 4).
// streamdown splits the whole text into blocks on every update; its own incremental path (re-lex only
// after the last settled block) keeps ONE cache for the whole app, so two messages streaming at once
// (two panes, or a reply and its reasoning) evict each other and every update re-lexes everything. It
// also only applies when the new text extends the old one, which its own incomplete-markdown repair
// (closing `**`, fences … at the end) often breaks.
// Here each message keeps its last split. The blocks before the last block ending in a blank line
// (all but the last two at least) are settled — the same rule streamdown uses — and kept when the new
// text still starts with them at the same offsets; only the rest is split again (by streamdown's own
// parser). Anything unusual (footnotes, link reference definitions, CR line ends) is split whole.
import { parseMarkdownIntoBlocks } from "streamdown";

const FOOTNOTE = /\[\^[\w-]{1,200}\]/;
const REFERENCE_DEFINITION = /^ {0,3}\[[^\]]+\]:/m;

/** How many leading blocks are settled: up to the last block ending in a blank line, two from the end. */
export function settledCount(blocks: readonly string[]): number {
  for (let i = blocks.length - 3; i >= 0; i -= 1) if (blocks[i]!.endsWith("\n\n")) return i + 1;
  return 0;
}

export function createBlockParser(split: (markdown: string) => string[] = parseMarkdownIntoBlocks): (markdown: string) => string[] {
  let last: { input: string; blocks: string[] } | null = null;
  return (markdown) => {
    if (last?.input === markdown) return last.blocks;
    let blocks: string[] | null = null;
    if (last && !FOOTNOTE.test(markdown) && !REFERENCE_DEFINITION.test(markdown) && !markdown.includes("\r")) {
      const keep = settledCount(last.blocks);
      let offset = 0;
      let n = 0;
      while (n < keep && markdown.startsWith(last.blocks[n]!, offset)) offset += last.blocks[n++]!.length;
      if (n === keep && keep > 0 && offset < markdown.length) blocks = last.blocks.slice(0, keep).concat(split(markdown.slice(offset)));
    }
    blocks ??= split(markdown);
    last = { input: markdown, blocks };
    return blocks;
  };
}

/**
 * While a message streams, a last line made only of fence characters (`` ` ``, ``` `` ```, `~~` …, up to three
 * spaces in front) is a fence still arriving. Shown, it is a stray code line (or literal backticks) for one
 * update and then vanishes, so the block grew a line, shrank and grew again (flicker recorder 2026-10-26).
 * It waits for the rest of its line.
 */
export function withoutPartialFence(markdown: string): string {
  const at = markdown.lastIndexOf("\n") + 1;
  return /^ {0,3}(?:`+|~+)$/.test(markdown.slice(at)) ? markdown.slice(0, at) : markdown;
}
