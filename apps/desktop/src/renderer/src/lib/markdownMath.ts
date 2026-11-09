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
// Limits: a `|` inside math in a GFM table row still splits the cell; a line inside multi-line display math
// that would start a list / quote / heading (`- x`, `> x`) still interrupts the paragraph.

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
  return { text: { [DOLLAR]: construct, [BACKSLASH]: construct } };
}

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
  },
};

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
  const atStreamEnd = options.streaming ? (offset: number) => offset >= length : undefined;
  (data.micromarkExtensions ??= []).push(syntax({ atStreamEnd }));
  (data.fromMarkdownExtensions ??= []).push(fromMarkdown);
  // Where the text ends: remark-parse (attached first) installed the parser; note each document's length.
  const parse = processor.parser;
  if (atStreamEnd && parse)
    processor.parser = (document, file) => {
      length = String(document).length;
      try {
        return parse(document, file);
      } finally {
        length = -1;
      }
    };
  return (tree: MdastNode) => liftDisplayMath(tree);
}

/** Quick test before loading anything: can this text contain a formula at all? */
export function mayContainMath(text: string): boolean {
  return text.includes("$") || text.includes("\\(") || text.includes("\\[");
}
