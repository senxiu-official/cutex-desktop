// Per-message block split while streaming (lib/markdownBlocks, perf baseline 2026-10-20 fix order 4):
// the same blocks as streamdown's own split of the whole text, at every point of a stream, while only the
// unsettled tail is split again.
import { describe, expect, it, vi } from "vitest";
import { parseMarkdownIntoBlocks } from "streamdown";
import { createBlockParser, settledCount, withoutPartialFence } from "../src/renderer/src/lib/markdownBlocks";

const SAMPLE = [
  "# Title\n\nSome **bold** text and `code`.\n\n",
  "- one\n- two\n\n  continued item\n- three\n\n",
  "```ts\nconst x = 1;\n\nconst y = 2;\n```\n\n",
  "| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n\n",
  "Paragraph\nUnderlined\n===\n\n",
  "> quote\n> more\n\n",
  "<details>\n<summary>more</summary>\n\nhidden **text**\n\n</details>\n\n",
  "$$\na^2\n\n+ b^2\n$$\n\n",
  "1. first\n2. second\n\n",
  "Last paragraph with a [link](https://example.com) and ~~strike~~.",
].join("");

/** Streams `text` in chunks of `size`, comparing every step with a fresh whole split. */
function stream(text: string, size: number, mutate: (s: string) => string = (s) => s) {
  const parse = createBlockParser();
  for (let n = size; n < text.length + size; n += size) {
    const shown = mutate(text.slice(0, n));
    expect(parse(shown)).toEqual(parseMarkdownIntoBlocks(shown));
  }
}

describe("markdown block split per streaming message", () => {
  it("matches the whole-text split at every step", () => {
    for (const size of [1, 3, 7, 40]) stream(SAMPLE, size);
  });

  it("matches when the tail is repaired differently each time (closing markers the stream does not have yet)", () => {
    stream(SAMPLE, 5, (s) => s + (s.split("**").length % 2 === 0 ? "**" : "") + (s.split("```").length % 2 === 0 ? "\n```" : ""));
  });

  it("re-splits only after the settled blocks", () => {
    const split = vi.fn(parseMarkdownIntoBlocks);
    const parse = createBlockParser(split);
    const head = "one\n\ntwo\n\nthree\n\nfour\n\n";
    parse(head);
    const first = split.mock.calls.length;
    parse(head + "five");
    expect(split.mock.calls.length).toBe(first + 1);
    // Only the tail after the settled blocks went to the splitter.
    expect(split.mock.calls.at(-1)![0].length).toBeLessThan((head + "five").length);
    expect(parse(head + "five")).toEqual(parseMarkdownIntoBlocks(head + "five"));
  });

  it("two messages streaming at once keep their own split (no shared cache)", () => {
    const a = createBlockParser();
    const b = createBlockParser();
    const ta = "alpha one\n\nalpha two\n\nalpha three\n\n";
    const tb = "beta one\n\nbeta two\n\nbeta three\n\n";
    for (let i = 0; i < 20; i++) {
      expect(a(ta + "x".repeat(i))).toEqual(parseMarkdownIntoBlocks(ta + "x".repeat(i)));
      expect(b(tb + "y".repeat(i))).toEqual(parseMarkdownIntoBlocks(tb + "y".repeat(i)));
    }
  });

  it("splits footnotes, reference definitions and CR text whole", () => {
    const parse = createBlockParser();
    for (const t of ["a\n\nb\n\nc\n\nd [^1]\n\n[^1]: note", "a\n\nb\n\nc\n\n[x]: https://x\n\nd", "a\r\n\r\nb\r\n\r\nc\r\n\r\nd"]) {
      expect(parse(t)).toEqual(parseMarkdownIntoBlocks(t));
    }
  });

  it("settled: up to the last block ending in a blank line, two from the end", () => {
    expect(settledCount(["a\n\n", "b\n\n", "c"])).toBe(1);
    expect(settledCount(["a\n\n", "b"])).toBe(0);
    expect(settledCount(["a\n", "b\n\n", "c", "d"])).toBe(2);
  });
});

describe("withoutPartialFence", () => {
  it("holds back a last line that is only fence characters (a fence still arriving)", () => {
    expect(withoutPartialFence("```ts\nconst a = 1;\n``")).toBe("```ts\nconst a = 1;\n");
    expect(withoutPartialFence("text\n\n`")).toBe("text\n\n");
    expect(withoutPartialFence("text\n   ~~")).toBe("text\n");
  });
  it("keeps everything else", () => {
    for (const s of ["```ts\nconst a = 1;\n```\n", "a `b`", "```ts", "x\n``x", "text\n    ``", ""]) expect(withoutPartialFence(s)).toBe(s);
  });
});
