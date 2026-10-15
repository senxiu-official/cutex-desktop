/**
 * Pinned Unicode 17.0.0 CJK routing policy. Source: Unicode Scripts.txt and
 * ScriptExtensions.txt (https://www.unicode.org/Public/17.0.0/ucd/).
 * Script extensions shared with Latin stay on the non-CJK side, as do shared
 * curly quotes. Explicit fullwidth / vertical CJK punctuation is included.
 * Tables are compiled once, never discovered by scanning Unicode at runtime.
 * Regenerate with: python scripts/generate-font-ranges.py
 * Unicode data copyright Unicode, Inc.; https://www.unicode.org/license.txt
 */
export const FONT_UNICODE_VERSION = "17.0.0";
export type CodePointRange = readonly [number, number];
// Scripts.txt SHA-256: 9f5e50d3abaee7d6ce09480f325c706f485ae3240912527e651954d2d6b035bf
// ScriptExtensions.txt SHA-256: ec2107e58825a1586acee8e0911ce18260394ac8b87e535ca325f1ccbeb06bc6
// BEGIN GENERATED CJK RANGES
export const CJK_RANGES: readonly CodePointRange[] = [
  [0x2EA, 0x2EB],
  [0x1100, 0x11FF],
  [0x2E80, 0x2E99],
  [0x2E9B, 0x2EF3],
  [0x2F00, 0x2FD5],
  [0x2FF0, 0x303F],
  [0x3041, 0x3096],
  [0x3099, 0x30FF],
  [0x3105, 0x312F],
  [0x3131, 0x318E],
  [0x3190, 0x31E5],
  [0x31EF, 0x321E],
  [0x3220, 0x3247],
  [0x3260, 0x327E],
  [0x3280, 0x32B0],
  [0x32C0, 0x32CB],
  [0x32D0, 0x3370],
  [0x337B, 0x337F],
  [0x33E0, 0x33FE],
  [0x3400, 0x4DBF],
  [0x4E00, 0x9FFF],
  [0xA960, 0xA97C],
  [0xAC00, 0xD7A3],
  [0xD7B0, 0xD7C6],
  [0xD7CB, 0xD7FB],
  [0xF900, 0xFA6D],
  [0xFA70, 0xFAD9],
  [0xFE10, 0xFE1F],
  [0xFE30, 0xFE4F],
  [0xFF01, 0xFFBE],
  [0xFFC2, 0xFFC7],
  [0xFFCA, 0xFFCF],
  [0xFFD2, 0xFFD7],
  [0xFFDA, 0xFFDC],
  [0xFFE0, 0xFFE6],
  [0x16FE2, 0x16FE3],
  [0x16FF0, 0x16FF6],
  [0x1AFF0, 0x1AFF3],
  [0x1AFF5, 0x1AFFB],
  [0x1AFFD, 0x1AFFE],
  [0x1B000, 0x1B122],
  [0x1B132, 0x1B132],
  [0x1B150, 0x1B152],
  [0x1B155, 0x1B155],
  [0x1B164, 0x1B167],
  [0x1D360, 0x1D371],
  [0x1F200, 0x1F200],
  [0x1F250, 0x1F251],
  [0x20000, 0x2A6DF],
  [0x2A700, 0x2B81D],
  [0x2B820, 0x2CEAD],
  [0x2CEB0, 0x2EBE0],
  [0x2EBF0, 0x2EE5D],
  [0x2F800, 0x2FA1D],
  [0x30000, 0x3134A],
  [0x31350, 0x33479],
];
// END GENERATED CJK RANGES

export const SHARED_QUOTE_RANGES: readonly CodePointRange[] = [[0x2018, 0x2019], [0x201C, 0x201D]];

function union(ranges: readonly CodePointRange[]): CodePointRange[] {
  const merged: [number, number][] = [];
  for (const [lo, hi] of [...ranges].sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1);
    if (last && lo <= last[1] + 1) last[1] = Math.max(last[1], hi);
    else merged.push([lo, hi]);
  }
  return merged;
}

function complement(ranges: readonly CodePointRange[]): CodePointRange[] {
  const result: CodePointRange[] = [];
  let next = 0;
  // Surrogates are not Unicode scalar values and cannot occur in a valid font cmap.
  for (const [lo, hi] of union([...ranges, [0xD800, 0xDFFF]])) {
    if (next < lo) result.push([next, lo - 1]);
    next = hi + 1;
  }
  if (next <= 0x10FFFF) result.push([next, 0x10FFFF]);
  return result;
}

export function codePointInRanges(cp: number, ranges: readonly CodePointRange[]): boolean {
  let lo = 0, hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const range = ranges[mid]!;
    if (cp < range[0]) hi = mid - 1;
    else if (cp > range[1]) lo = mid + 1;
    else return true;
  }
  return false;
}

export function cssUnicodeRange(ranges: readonly CodePointRange[]): string {
  const hex = (n: number) => n.toString(16).toUpperCase();
  return ranges.map(([lo, hi]) => `U+${hex(lo)}${hi === lo ? "" : `-${hex(hi)}`}`).join(",");
}

const cjkWithQuotes = union([...CJK_RANGES, ...SHARED_QUOTE_RANGES]);
/** Context variants change only U+2018/19/1C/1D ownership. */
export const FONT_RANGES = {
  latinContext: { latin: complement(CJK_RANGES), cjk: CJK_RANGES },
  cjkContext: { latin: complement(cjkWithQuotes), cjk: cjkWithQuotes },
} as const;
export const FONT_UNICODE_RANGES = {
  latinContext: { latin: cssUnicodeRange(FONT_RANGES.latinContext.latin), cjk: cssUnicodeRange(FONT_RANGES.latinContext.cjk) },
  cjkContext: { latin: cssUnicodeRange(FONT_RANGES.cjkContext.latin), cjk: cssUnicodeRange(FONT_RANGES.cjkContext.cjk) },
} as const;

/** A grapheme's base determines the script; variation selectors never create runs. */
export function isCjkGrapheme(grapheme: string): boolean {
  const base = grapheme.codePointAt(0);
  if (base === undefined) return false;
  // Keep emoji-presentation CJK symbols neutral to the prose quote classifier.
  // CSS ranges remain code-point based; native font fallback handles VS/ZWJ.
  if ((grapheme.includes("\uFE0F") || grapheme.includes("\u200D")) &&
      (base === 0x3030 || base === 0x303D || base === 0x3297 || base === 0x3299 || base >= 0x1F000)) return false;
  return codePointInRanges(base, CJK_RANGES);
}
export const isCjkFontCharacter = isCjkGrapheme;
