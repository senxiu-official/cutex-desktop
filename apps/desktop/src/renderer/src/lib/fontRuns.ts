import { isCjkGrapheme } from "./fontRanges";

export type FontRun = { kind: "latin" | "cjk" | "mono"; text: string };
type ProseKind = Exclude<FontRun["kind"], "mono">;

const graphemes = new Intl.Segmenter("und", { granularity: "grapheme" });
const letter = /\p{L}/u;
const wordPart = /^[\p{Script=Latin}\p{N}]\p{M}*$/u;
const whitespace = /^\s+$/u;
const lineBreak = /[\r\n\u2028\u2029]/u;
const sentenceEnd = /^[。！？；.!?;\r\n\u2028\u2029]/u;
const quoteMark = /^[‘’“”]$/u;
const HOST_LIMIT = 160;

/**
 * The Latin- and CJK-context stacks differ only for U+2018/2019/201C/201D (fontRanges.ts), and
 * prose already inherits the Latin-context stack: text without these needs no font-run spans.
 */
export function hasSharedQuote(text: string): boolean {
  return /[‘’“”]/u.test(text);
}

interface Quote {
  start: number;
  end: number | null;
  /** Exclusive end of an unclosed quotation's paragraph / recovered parent. */
  limit: number;
  close: "’" | "”";
  parent: Quote | null;
  kind: ProseKind;
}

function languageKind(ownerLang: string): ProseKind | null {
  const lang = ownerLang.trim().toLowerCase();
  if (!/^[a-z]{2,8}(?:-[a-z\d]{1,8})*$/.test(lang) || /^(und|mul|zxx)(-|$)/.test(lang)) return null;
  return /^(zh|ja|ko)(-|$)/.test(lang) ? "cjk" : "latin";
}

/** Obvious resources are not narration, including the dots inside their URLs. */
function resourceRanges(text: string): [number, number][] {
  const ranges: [number, number][] = [];
  for (const match of text.matchAll(/[^\s“”‘’<>，。！？；、]+/gu)) {
    const token = match[0];
    let start = -1;
    const scheme = token.indexOf("://");
    if (scheme > 0) {
      let i = scheme - 1;
      while (i >= 0 && /[a-z\d+.-]/i.test(token[i]!)) i--;
      if (/[a-z]/i.test(token[i + 1]!)) start = i + 1;
    }
    const drive = /[a-z]:[\\/]/i.exec(token);
    if (drive && (start < 0 || drive.index < start)) start = drive.index;
    if (start < 0 && /^(?:\.{0,2}\/|\\\\)/.test(token)) start = 0;
    if (start >= 0) ranges.push([match.index + start, match.index + token.length]);
  }
  return ranges;
}

/**
 * Route prose without changing its text or splitting a grapheme. `ownerLang` is
 * trusted quotation-style metadata for the containing prose, NOT the UI locale
 * or the language of an embedded quotation. Leave it empty for ordinary chat.
 *
 * Curly quotes use preceding narration, then following narration, then the first
 * letter inside an isolated quote. Nested quotes inherit their outer style;
 * quoted content never votes by length. Mixed narration uses the first letter
 * (a final fullwidth colon selects CJK). This is a bounded, conservative heuristic,
 * not language detection: e.g. `API “设置”界面` needs ownerLang to disambiguate.
 *
 * Linear segmentation / mapping plus at most 160 graphemes of host context on
 * each side of a quotation. Existing Markdown style boundaries remain boundaries
 * for shaping; callers must not split these runs into individual characters.
 */
export function classifyFontRuns(text: string, ownerLang = "", mode: "prose" | "mono" = "prose"): FontRun[] {
  if (!text) return [];
  if (mode === "mono") return [{ kind: "mono", text }];

  const segments = Array.from(graphemes.segment(text));
  const chars = segments.map((s) => s.segment);
  const n = chars.length;
  const cjk = chars.map(isCjkGrapheme);
  const kinds: (ProseKind | null)[] = chars.map((g, i) => cjk[i] ? "cjk" : quoteMark.test(g) || whitespace.test(g) ? null : "latin");
  const resources = resourceRanges(text);
  let resourceIndex = 0;
  const inResource = segments.map((s) => {
    while (resourceIndex < resources.length && resources[resourceIndex]![1] <= s.index) resourceIndex++;
    const r = resources[resourceIndex];
    return !!r && r[0] <= s.index && s.index < r[1];
  });

  const quotes: Quote[] = [];
  const roots: Quote[] = [];
  const stack: Quote[] = [];
  const singles: Quote[] = [];
  const doubles: Quote[] = [];
  const stray: number[] = [];
  let previousBreak = false;
  const pop = (limit: number) => {
    const q = stack.pop()!;
    (q.close === "’" ? singles : doubles).pop();
    q.limit = limit;
    return q;
  };

  for (let i = 0; i < n; i++) {
    const g = chars[i]!;
    if (lineBreak.test(g)) {
      // A soft line break may occur inside a Markdown paragraph; blank lines may
      // not carry an unmatched quote's ownership into the next paragraph.
      if (previousBreak || g.includes("\u2029")) while (stack.length) pop(i);
      previousBreak = true;
    } else if (!whitespace.test(g)) previousBreak = false;

    if (g === "’" && i > 0 && wordPart.test(chars[i - 1]!) && i + 1 < n && wordPart.test(chars[i + 1]!)) {
      kinds[i] = "latin";
      continue;
    }
    if (g === "‘" || g === "“") {
      const q: Quote = { start: i, end: null, limit: n, close: g === "‘" ? "’" : "”", parent: stack.at(-1) ?? null, kind: "latin" };
      if (!q.parent) roots.push(q);
      quotes.push(q);
      stack.push(q);
      (q.close === "’" ? singles : doubles).push(q);
    } else if (g === "’" || g === "”") {
      const matching = (g === "’" ? singles : doubles).at(-1);
      if (matching) {
        // Recover a mismatched inner opener instead of leaving the outer quote
        // open forever. Each opener is popped once, including malformed input.
        while (stack.at(-1) !== matching) pop(i);
        pop(i + 1).end = i;
      } else if (g === "’" && i > 0 && wordPart.test(chars[i - 1]!)) {
        kinds[i] = "latin"; // dogs’ toys, but a pending single quote takes priority.
      } else stray.push(i);
    }
  }

  const nextLetter = new Int32Array(n + 1).fill(-1);
  for (let i = n - 1; i >= 0; i--) nextLetter[i] = letter.test(chars[i]!) && !inResource[i] ? i : nextLetter[i + 1]!;
  const explicit = languageKind(ownerLang);

  function host(from: number, until: number, direction: -1 | 1): ProseKind | null {
    let first: ProseKind | null = null;
    let hasCjk = false;
    let hasLatin = false;
    let lastNonSpace = "";
    let count = 0;
    for (let i = from; direction < 0 ? i >= until : i <= until; i += direction) {
      if (count++ >= HOST_LIMIT) break;
      if (inResource[i]) continue;
      const g = chars[i]!;
      if (sentenceEnd.test(g)) break;
      if (!whitespace.test(g)) {
        if (direction > 0 || !lastNonSpace) lastNonSpace = g;
      }
      if (letter.test(g)) {
        const k = cjk[i] ? "cjk" : "latin";
        if (direction < 0 || first === null) first = k;
        if (k === "cjk") hasCjk = true;
        else hasLatin = true;
      }
    }
    return hasCjk && hasLatin && lastNonSpace === "：" ? "cjk" : first;
  }

  for (let i = 0; i < roots.length; i++) {
    const q = roots[i]!;
    const previous = roots[i - 1];
    const lower = previous ? previous.end === null ? previous.limit : previous.end + 1 : 0;
    const upper = roots[i + 1]?.start ?? n;
    const left = q.start > lower ? host(q.start - 1, lower, -1) : null;
    const right = q.end !== null && q.end + 1 < upper ? host(q.end + 1, upper - 1, 1) : null;
    const inner = nextLetter[q.start + 1]!;
    q.kind = explicit ?? left ?? right ?? (inner >= 0 && inner < (q.end ?? q.limit) && cjk[inner] ? "cjk" : "latin");
  }
  for (const q of quotes) {
    if (q.parent) q.kind = q.parent.kind;
    kinds[q.start] = q.kind;
    if (q.end !== null) kinds[q.end] = q.kind;
  }

  // Stray closing marks should not borrow letters from inside another quotation.
  // Sorted nonoverlapping root spans allow both sides to stay linear to locate.
  let rootIndex = 0;
  for (const i of stray) {
    while (rootIndex < roots.length) {
      const candidate = roots[rootIndex]!;
      if ((candidate.end === null ? candidate.limit : candidate.end + 1) > i) break;
      rootIndex++;
    }
    const enclosing = roots[rootIndex];
    if (enclosing && enclosing.start < i && i < (enclosing.end ?? enclosing.limit)) {
      kinds[i] = enclosing.kind;
      continue;
    }
    const previous = roots[rootIndex - 1];
    const lower = previous ? previous.end === null ? previous.limit : previous.end + 1 : 0;
    const upper = enclosing?.start ?? n;
    kinds[i] = explicit ?? host(i - 1, lower, -1) ?? host(i + 1, upper - 1, 1) ?? "latin";
  }

  const runs: FontRun[] = [];
  let runKind: ProseKind = kinds[0] ?? "latin";
  let runStart = 0;
  for (let i = 1; i < n; i++) {
    const kind = kinds[i] ?? runKind;
    if (kind === runKind) continue;
    runs.push({ kind: runKind, text: text.slice(runStart, segments[i]!.index) });
    runStart = segments[i]!.index;
    runKind = kind;
  }
  runs.push({ kind: runKind, text: text.slice(runStart) });
  return runs;
}
