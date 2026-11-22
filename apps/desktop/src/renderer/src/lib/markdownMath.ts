// Markdown math (LaTeX-style syntax rendered by KaTeX, components/MathNode.tsx): the parser side.
// A micromark text construct, so math is recognised while the paragraph is tokenized: before emphasis
// (`$a^*+e$` keeps its `*`), never inside code spans or code blocks, and backslash escapes inside a formula
// stay TeX (`\{`, `\\`). Delimiters:
//   `$…$`    one line; the opening `$` is not followed by whitespace nor preceded by an ASCII letter / digit,
//            the closing `$` (the first unescaped one) is not preceded by whitespace nor followed by an ASCII
//            letter / digit: `$5 and $10`, `$HOME/$PATH`, `$A$B`, `cost $3.` stay text; `$x$。` `$x$的` are math.
//   `$$…$$`  may span lines of one paragraph; `\(…\)` likewise; `\[…\]` too.
// `$$…$$` and `\[…\]` are display math: a paragraph is split around them (a block of its own, even written
// mid-sentence); in a heading or table cell they stay inline. While a reply streams, an opener whose closer
// has not arrived yet (or a `$` closer that is the last character so far: the next one may still reject it)
// becomes a pending node that shows its source as plain text, with no Markdown inside it.
// Display math whose `$$` / `\[` opens a line is also a block construct (like a fenced code block), read before
// Markdown decides the block structure: lines inside it (`=`, `---`, `- x`, `> x`) never become a Setext
// heading, a rule, a list or a quote (owner report 2026-11-17). Its closer must end a line, before any blank line.
// Limits: a `|` inside math in a GFM table row still splits the cell; multi-line display math opened mid-line
// (`text \[` …) is the text construct only, so a line inside it that would start a block still interrupts it.

type Code = number | null;
interface Token {
  type: string;
}
interface Effects {
  enter(type: string): Token;
  exit(type: string): Token;
  consume(code: Code): void;
}
type State = (code: Code) => State | undefined;
interface TokenizeContext {
  previous: Code;
  now(): { offset: number };
}
interface MdastNode {
  type: string;
  value?: string;
  children?: MdastNode[];
  data?: { hName?: string; hProperties?: Record<string, unknown>; hChildren?: unknown[] };
  position?: unknown;
}
interface FromMarkdownContext {
  stack: MdastNode[];
  enter(node: MdastNode, token: Token): void;
  exit(token: Token): void;
  sliceSerialize(token: Token): string;
}

/** Class names on the `code` element a formula becomes in hast; components/MathNode.tsx renders them. */
export const MATH_INLINE_CLASS = "language-cutex-math-inline";
export const MATH_DISPLAY_CLASS = "language-cutex-math-display";
export const MATH_PENDING_CLASS = "language-cutex-math-pending";
export type MathKind = "inline" | "display" | "pending";

export function mathKindOf(className: unknown): MathKind | null {
  const names = typeof className === "string" ? className.split(/\s+/) : Array.isArray(className) ? className : [];
  if (names.includes(MATH_DISPLAY_CLASS)) return "display";
  if (names.includes(MATH_INLINE_CLASS)) return "inline";
  if (names.includes(MATH_PENDING_CLASS)) return "pending";
  return null;
}

/** The TeX inside a formula's source (delimiters removed) and whether its delimiters ask for display math. */
export function splitMathSource(source: string): { tex: string; display: boolean } {
  if (source.startsWith("$$") && source.endsWith("$$") && source.length >= 4) return { tex: source.slice(2, -2), display: true };
  if (source.startsWith("\\[") && source.endsWith("\\]") && source.length >= 4) return { tex: source.slice(2, -2), display: true };
  if (source.startsWith("\\(") && source.endsWith("\\)") && source.length >= 4) return { tex: source.slice(2, -2), display: false };
  if (source.startsWith("$") && source.endsWith("$") && source.length >= 2) return { tex: source.slice(1, -1), display: false };
  return { tex: source, display: false };
}

const DOLLAR = 36;
const BACKSLASH = 92;
const LEFT_PAREN = 40;
const RIGHT_PAREN = 41;
const LEFT_BRACKET = 91;
const RIGHT_BRACKET = 93;
const lineEnding = (code: Code) => code !== null && code < -2;
const whitespace = (code: Code) => code !== null && (code < 0 || code === 32);
const asciiAlphanumeric = (code: Code) => code !== null && ((code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122));

const MATH = "cutexMath";
const PENDING = "cutexMathPending";
const DATA = "cutexMathData";

interface SyntaxOptions {
  /** Streaming: true when the tokenizer stands at the end of the whole text received so far. */
  atStreamEnd?: (offset: number) => boolean;
  /** The text being parsed (to look ahead for a display block's closer), when the parser is known. */
  source?: () => string | undefined;
}

function syntax(options: SyntaxOptions) {
  function tokenize(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
    const self = this;
    // "$" | "$$" | ")" (closes `\(`) | "]" (closes `\[`)
    let kind: "$" | "$$" | ")" | "]" = "$";
    let math: Token;
    let inData = false;
    let hasContent = false;
    let last: Code = null;
    let closing = 0;
    const atEnd = () => !!options.atStreamEnd?.(self.now().offset);

    const start: State = (code) => {
      // `$` after a letter / digit (`US$5`, `a$b`) or after another `$` (`$$$`, the 2nd `$` of a failed `$$`) is text.
      if (code === DOLLAR && (asciiAlphanumeric(self.previous) || self.previous === DOLLAR)) return nok(code);
      math = effects.enter(MATH);
      effects.enter(DATA);
      inData = true;
      effects.consume(code);
      return code === DOLLAR ? dollarOpen : backslashOpen;
    };
    const dollarOpen: State = (code) => {
      if (code === DOLLAR) {
        effects.consume(code);
        kind = "$$";
        return afterOpen;
      }
      if (code !== null && whitespace(code)) return nok(code);
      kind = "$";
      return content(code);
    };
    const afterOpen: State = (code) => (code === DOLLAR ? nok(code) : content(code));
    const backslashOpen: State = (code) => {
      if (code !== LEFT_PAREN && code !== LEFT_BRACKET) return nok(code);
      kind = code === LEFT_PAREN ? ")" : "]";
      effects.consume(code);
      return content;
    };
    const content: State = (code) => {
      if (code === null) return end(code);
      if (lineEnding(code)) {
        if (kind === "$") return nok(code);
        if (inData) effects.exit(DATA);
        inData = false;
        effects.enter("lineEnding");
        effects.consume(code);
        effects.exit("lineEnding");
        last = code;
        return content;
      }
      if (!inData) {
        effects.enter(DATA);
        inData = true;
      }
      if (code === BACKSLASH) {
        effects.consume(code);
        return escaped;
      }
      if (code === DOLLAR && (kind === "$" || kind === "$$")) {
        // The first unescaped `$` closes or rejects: `$HOME/$PATH` is not a formula followed by more.
        if (!hasContent || (kind === "$" && whitespace(last))) return nok(code);
        closing = 0;
        return dollarClose(code);
      }
      effects.consume(code);
      if (!whitespace(code)) hasContent = true;
      last = code;
      return content;
    };
    // After a backslash: `\)` / `\]` close their kind; any other character is TeX (`\$` included).
    const escaped: State = (code) => {
      if ((kind === ")" && code === RIGHT_PAREN) || (kind === "]" && code === RIGHT_BRACKET)) {
        if (!hasContent) return nok(code);
        effects.consume(code);
        return close;
      }
      hasContent = true;
      last = BACKSLASH;
      if (code === null || lineEnding(code)) return content(code);
      effects.consume(code);
      last = code;
      return content;
    };
    const dollarClose: State = (code) => {
      if (code === DOLLAR) {
        closing += 1;
        if (closing > kind.length) return nok(code);
        effects.consume(code);
        return dollarClose;
      }
      if (closing !== kind.length) return nok(code);
      // Not followed by a letter / digit (`$A$B`). At the end of a still streaming text the next
      // character is unknown: wait for it.
      if (code === null && atEnd()) return pending(code);
      if (asciiAlphanumeric(code)) return nok(code);
      return close(code);
    };
    const close: State = (code) => {
      effects.exit(DATA);
      effects.exit(MATH);
      return ok(code);
    };
    const end: State = (code) => (atEnd() ? pending(code) : nok(code));
    const pending: State = (code) => {
      if (inData) effects.exit(DATA);
      math.type = PENDING;
      effects.exit(PENDING);
      return ok(code);
    };
    return start;
  }
  const construct = { name: "cutexMath", tokenize };
  const flow = { name: "cutexMathFlow", concrete: true, tokenize: tokenizeFlow(options) };
  return { text: { [DOLLAR]: construct, [BACKSLASH]: construct }, flow: { [DOLLAR]: flow, [BACKSLASH]: flow } };
}

// Display math opening a line (`$$` or `\[`, after at most three spaces) is a block of its own, read like a
// fenced code block: before Markdown decides the block structure, so its lines never become a Setext
// heading (`=`), a rule (`---`), a list or a quote, and `_` / `*` stay TeX. It may interrupt a paragraph.
// It ends at the line whose closer (`$$` / `\]`) is followed only by spaces; a blank line, the end of its
// list item / quote, or the end of the text without a closer leaves it to the paragraph (and the text
// construct above), as before. While a reply streams, an opener whose closer has not arrived is pending.
const FLOW = "cutexMathFlow";
const FLOW_VALUE = "cutexMathFlowValue";

interface FlowContext extends TokenizeContext {
  interrupt?: boolean;
  parser: { lazy: Record<number, boolean> };
  now(): { offset: number; line: number };
}
interface FlowEffects extends Effects {
  check(construct: unknown, ok: State, nok: State): State;
}

/** A line ending that is not a lazy line (one outside the list item / quote the block started in). */
const nonLazyLineEnding = {
  partial: true,
  tokenize(this: FlowContext, effects: Effects, ok: State, nok: State): State {
    const self = this;
    const after: State = (code) => (self.parser.lazy[self.now().line] ? nok(code) : ok(code));
    return (code) => {
      if (!lineEnding(code)) return nok(code);
      effects.enter("lineEnding");
      effects.consume(code);
      effects.exit("lineEnding");
      return after;
    };
  },
};

const horizontalSpace = (code: Code) => code === -2 || code === -1 || code === 32;

function tokenizeFlow(options: SyntaxOptions) {
  return function tokenize(this: FlowContext, flowEffects: Effects, ok: State, nok: State): State {
    const self = this;
    const effects = flowEffects as FlowEffects;
    let kind: "$$" | "]" = "$$";
    let hasContent = false;
    let inValue = false;
    let run = 0;
    let block: Token;
    const atEnd = () => !!options.atStreamEnd?.(self.now().offset);
    const value = () => {
      if (!inValue) effects.enter(FLOW_VALUE);
      inValue = true;
    };
    const endValue = () => {
      if (inValue) effects.exit(FLOW_VALUE);
      inValue = false;
    };

    const start: State = (code) => {
      // Cheap look at the text first: no closer before the next blank line means no block (and no
      // multi-line attempt that the list / quote bookkeeping would have to undo).
      // The opener itself first (O(1)): `$5` / `\(` at a line start costs nothing more.
      const text = options.source?.();
      const offset = self.now().offset;
      if (text !== undefined) {
        const opener = text.slice(offset, offset + 3);
        if (!(opener.startsWith("\\[") || (opener.startsWith("$$") && opener[2] !== "$"))) return nok(code);
        if (!closerAhead(closerIndex(text), offset, code === DOLLAR ? "$$" : "]", !!options.atStreamEnd)) return nok(code);
      }
      block = effects.enter(FLOW);
      value();
      effects.consume(code);
      return code === DOLLAR ? dollarOpen : backslashOpen;
    };
    const dollarOpen: State = (code) => {
      if (code !== DOLLAR) return nok(code);
      effects.consume(code);
      return (next) => (next === DOLLAR ? nok(next) : content(next));
    };
    const backslashOpen: State = (code) => {
      if (code !== LEFT_BRACKET) return nok(code);
      kind = "]";
      effects.consume(code);
      return content;
    };
    const content: State = (code) => {
      if (code === null) return unclosed(code);
      if (lineEnding(code)) {
        endValue();
        return effects.check(nonLazyLineEnding, nextLine, unclosed)(code);
      }
      value();
      if (code === BACKSLASH) {
        effects.consume(code);
        return escaped;
      }
      if (code === DOLLAR && kind === "$$") {
        run = 0;
        return dollars(code);
      }
      if (!whitespace(code)) hasContent = true;
      effects.consume(code);
      return content;
    };
    // After a backslash: `\]` closes `\[`; anything else is TeX (`\$`, `\\`).
    const escaped: State = (code) => {
      if (kind === "]" && code === RIGHT_BRACKET && hasContent) {
        effects.consume(code);
        return afterClose;
      }
      hasContent = true;
      if (code === null || lineEnding(code)) return content(code);
      effects.consume(code);
      return content;
    };
    // `$$` closes; a single `$` (or three) inside display math is TeX.
    const dollars: State = (code) => {
      if (code === DOLLAR) {
        run += 1;
        effects.consume(code);
        return dollars;
      }
      if (run === 2 && hasContent) return afterClose(code);
      hasContent = true;
      return content(code);
    };
    // Only spaces may follow the closer on its line; `\[a\] and b` stays inline (the text construct).
    const afterClose: State = (code) => {
      if (code !== null && horizontalSpace(code)) {
        effects.consume(code);
        return afterClose;
      }
      if (code !== null && !lineEnding(code)) return nok(code);
      endValue();
      effects.exit(FLOW);
      return ok(code);
    };
    const nextLine: State = (code) => {
      effects.enter("lineEnding");
      effects.consume(code);
      effects.exit("lineEnding");
      return lineStart;
    };
    // A blank line (spaces only) ends the attempt: display math does not span paragraphs.
    const lineStart: State = (code) => {
      if (code !== null && horizontalSpace(code)) {
        value();
        effects.consume(code);
        return lineStart;
      }
      if (code === null || lineEnding(code)) return unclosed(code);
      return content(code);
    };
    // No closer: still arriving (streaming, at the very end) → pending source; otherwise not a block.
    const unclosed: State = (code) => {
      if (code !== null || !atEnd()) return nok(code);
      endValue();
      block.type = PENDING_FLOW;
      effects.exit(PENDING_FLOW);
      return ok(code);
    };
    return start;
  };
}

/** Where blank lines and line-ending closers are in one text: found in one pass, then looked up per opener. */
interface CloserIndex {
  text: string;
  /** Offsets of the line end before each blank line (spaces / `>` only). */
  blanks: number[];
  /** Offsets of `$$` / `\]` followed only by spaces up to a line end or the end of the text. */
  dollars: number[];
  brackets: number[];
}

/** Characters read to build closer indexes (tests check the work stays linear in the text). */
export const mathFlowScan = { chars: 0 };

let lastIndex: CloserIndex | null = null;

function closerIndex(text: string): CloserIndex {
  if (lastIndex?.text === text) return lastIndex;
  mathFlowScan.chars += text.length;
  const all = (pattern: RegExp) => Array.from(text.matchAll(pattern), (match) => match.index);
  lastIndex = {
    text,
    blanks: all(/\n(?=[ \t>]*\r?\n)/g),
    dollars: all(/\$\$(?=[ \t]*(?:\r?\n|$))/g),
    brackets: all(/\\\](?=[ \t]*(?:\r?\n|$))/g),
  };
  return lastIndex;
}

/** The first entry of a sorted list at or after `offset` (or Infinity). */
function firstAtOrAfter(list: number[], offset: number): number {
  let low = 0;
  let high = list.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (list[mid]! < offset) low = mid + 1;
    else high = mid;
  }
  return list[low] ?? Infinity;
}

/**
 * Whether the closer of a display block opened at `offset` ends a line before the next blank line (or, while
 * streaming, whether there is no blank line after it: the closer may still come).
 */
function closerAhead(index: CloserIndex, offset: number, kind: "$$" | "]", streaming: boolean): boolean {
  const blank = firstAtOrAfter(index.blanks, offset + 2);
  const closer = firstAtOrAfter(kind === "]" ? index.brackets : index.dollars, offset + 2);
  return closer < blank || (streaming && blank === Infinity);
}
const PENDING_FLOW = "cutexMathFlowPending";

function mathNode(kind: MathKind, source: string): MdastNode {
  const className = kind === "display" ? MATH_DISPLAY_CLASS : kind === "pending" ? MATH_PENDING_CLASS : MATH_INLINE_CLASS;
  return { type: "cutexMath", value: source, data: { hName: "code", hProperties: { className: [className] }, hChildren: [{ type: "text", value: source }] } };
}

const fromMarkdown = {
  enter: {
    [MATH](this: FromMarkdownContext, token: Token) {
      this.enter(mathNode("inline", ""), token);
    },
    [PENDING](this: FromMarkdownContext, token: Token) {
      this.enter(mathNode("pending", ""), token);
    },
    [FLOW](this: FromMarkdownContext, token: Token) {
      this.enter({ ...mathNode("display", ""), lines: [] } as MdastNode, token);
    },
    [PENDING_FLOW](this: FromMarkdownContext, token: Token) {
      this.enter({ type: "paragraph", children: [] }, token);
      this.enter({ ...mathNode("pending", ""), lines: [] } as MdastNode, token);
    },
  },
  exit: {
    [MATH](this: FromMarkdownContext, token: Token) {
      const node = this.stack[this.stack.length - 1]!;
      const source = this.sliceSerialize(token);
      Object.assign(node, mathNode("inline", source), { position: node.position });
      this.exit(token);
    },
    [PENDING](this: FromMarkdownContext, token: Token) {
      const node = this.stack[this.stack.length - 1]!;
      Object.assign(node, mathNode("pending", this.sliceSerialize(token)), { position: node.position });
      this.exit(token);
    },
    // A display block's source: its lines without the list / quote prefixes, joined by line ends.
    [FLOW_VALUE](this: FromMarkdownContext, token: Token) {
      const node = this.stack[this.stack.length - 1] as MdastNode & { lines?: { line: number; text: string }[] };
      node.lines?.push({ line: (token as FlowToken).start.line, text: this.sliceSerialize(token) });
    },
    [FLOW](this: FromMarkdownContext, token: Token) {
      exitFlow(this, token, "display");
    },
    [PENDING_FLOW](this: FromMarkdownContext, token: Token) {
      exitFlow(this, token, "pending");
      this.exit(token);
    },
  },
};

interface FlowToken extends Token {
  start: { line: number };
}

function exitFlow(context: FromMarkdownContext, token: Token, kind: MathKind): void {
  const node = context.stack[context.stack.length - 1] as MdastNode & { lines?: { line: number; text: string }[] };
  const lines = node.lines ?? [];
  let source = "";
  lines.forEach(({ line, text }, i) => {
    if (i > 0) source += "\n".repeat(Math.max(1, line - lines[i - 1]!.line));
    source += text;
  });
  delete node.lines;
  Object.assign(node, mathNode(kind, source), { position: node.position });
  context.exit(token);
}

const FLOW_PARENTS = new Set(["root", "listItem", "blockquote", "footnoteDefinition"]);
const isDisplay = (node: MdastNode) => node.type === "cutexMath" && splitMathSource(node.value ?? "").display && mathKindOf(node.data?.hProperties?.className) === "inline";

/** Text at a split edge loses its line end / spaces; an edge that is only that disappears. */
function trimEdge(nodes: MdastNode[], side: "start" | "end"): MdastNode[] {
  const list = [...nodes];
  for (;;) {
    const i = side === "start" ? 0 : list.length - 1;
    const node = list[i];
    if (!node) return list;
    if (node.type === "break") {
      list.splice(i, 1);
      continue;
    }
    if (node.type !== "text") return list;
    const value = side === "start" ? (node.value ?? "").replace(/^\s+/, "") : (node.value ?? "").replace(/\s+$/, "");
    if (value) {
      list[i] = { ...node, value };
      return list;
    }
    list.splice(i, 1);
  }
}

/** Display math leaves its paragraph: [text, $$…$$, text] → paragraph, display block, paragraph. */
function liftDisplayMath(tree: MdastNode): void {
  const walk = (parent: MdastNode) => {
    const children = parent.children;
    if (!children) return;
    const next: MdastNode[] = [];
    for (const child of children) {
      if (child.type === "paragraph" && FLOW_PARENTS.has(parent.type) && child.children?.some(isDisplay)) {
        let run: MdastNode[] = [];
        const flush = () => {
          const kept = trimEdge(trimEdge(run, "start"), "end");
          if (kept.length) next.push({ type: "paragraph", children: kept });
          run = [];
        };
        for (const inline of child.children) {
          if (!isDisplay(inline)) {
            run.push(inline);
            continue;
          }
          flush();
          next.push(mathNode("display", inline.value ?? ""));
        }
        flush();
        continue;
      }
      walk(child);
      next.push(child);
    }
    parent.children = next;
  };
  walk(tree);
}

interface Processor {
  data(): Record<string, unknown[] | undefined>;
  parser?: (document: string, file?: unknown) => unknown;
}

/**
 * The remark plugin. `streaming`: the text is a reply still arriving, so an opener without its closer at the
 * very end of the text is pending (plain source) instead of text that turns into a formula a moment later.
 */
export function remarkMarkdownMath(this: unknown, options: { streaming?: boolean } = {}) {
  const processor = this as Processor;
  const data = processor.data();
  let length = -1;
  let text: string | undefined;
  const atStreamEnd = options.streaming ? (offset: number) => offset >= length : undefined;
  (data.micromarkExtensions ??= []).push(syntax({ atStreamEnd, source: () => text }));
  (data.fromMarkdownExtensions ??= []).push(fromMarkdown);
  // The text being parsed (and where it ends): remark-parse (attached first) installed the parser.
  const parse = processor.parser;
  if (parse)
    processor.parser = (document, file) => {
      text = String(document);
      length = text.length;
      try {
        return parse(document, file);
      } finally {
        length = -1;
        text = undefined;
      }
    };
  return (tree: MdastNode) => liftDisplayMath(tree);
}

/**
 * While a reply streams, remend completes the last unmatched `[` as a link (`](streamdown:incomplete-link)`),
 * also the `[` of an unfinished `\[` formula, whose pending source then showed that suffix. True when the last
 * unmatched `[` is that escaped one: the caller turns remend's link completion off for this text.
 */
export function endsInOpenDisplayBracket(text: string): boolean {
  if (!text.includes("\\[")) return false;
  // Unmatched `[`s, each marked escaped or not; `]` and `\]` close the latest.
  const open: boolean[] = [];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "\\") {
      if (text[i + 1] === "[") open.push(true);
      else if (text[i + 1] === "]") open.pop();
      i += 1;
    } else if (text[i] === "[") open.push(false);
    else if (text[i] === "]") open.pop();
  }
  return open.at(-1) === true;
}

/** Quick test before loading anything: can this text contain a formula at all? */
export function mayContainMath(text: string): boolean {
  return text.includes("$") || text.includes("\\(") || text.includes("\\[");
}
