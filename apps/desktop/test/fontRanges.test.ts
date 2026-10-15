import { describe, expect, it } from "vitest";
import { CJK_RANGES, codePointInRanges, FONT_RANGES, FONT_UNICODE_VERSION, isCjkGrapheme, SHARED_QUOTE_RANGES } from "../src/renderer/src/lib/fontRanges";

describe("pinned font ranges", () => {
  it("covers the five scripts, supplementary Han and fullwidth punctuation", () => {
    expect(FONT_UNICODE_VERSION).toBe("17.0.0");
    for (const sample of ["中文", "あ", "カ", "ｶ", "ㄅ", "한", "，", "。", "（", "Ａ", "\u{20000}", "\u{33479}", "中\u{E0100}", "カ\u3099"]) {
      expect(isCjkGrapheme(sample), sample).toBe(true);
    }
    for (const sample of ["", "A", "1", "'", "\"", "’", "“", "é", "e\u0305", "α", "Ж", "ع", "😀", "👩‍💻", "〰️", "㊗️"]) {
      expect(isCjkGrapheme(sample), sample).toBe(false);
    }
    // Script extensions shared with Latin must not steal accents / middle dots.
    for (const cp of [0xB7, 0x2C7, 0x305, 0x323]) expect(codePointInRanges(cp, CJK_RANGES)).toBe(false);
  });

  it("partitions all scalar values without overlaps or gaps in either context", () => {
    for (const { latin, cjk } of Object.values(FONT_RANGES)) {
      const ranges = [...latin, ...cjk, [0xD800, 0xDFFF] as const].sort((a, b) => a[0] - b[0]);
      let next = 0;
      for (const [lo, hi] of ranges) {
        expect(lo).toBe(next);
        expect(hi).toBeGreaterThanOrEqual(lo);
        next = hi + 1;
      }
      expect(next).toBe(0x110000);
    }
  });

  it("changes only four shared curly quotes between the two contexts", () => {
    const boundaries = new Set<number>();
    for (const ranges of [...Object.values(FONT_RANGES.latinContext), ...Object.values(FONT_RANGES.cjkContext)]) {
      for (const [lo, hi] of ranges) for (const cp of [lo, hi, lo - 1, hi + 1]) if (cp >= 0 && cp <= 0x10FFFF) boundaries.add(cp);
    }
    for (const cp of boundaries) {
      const differs = codePointInRanges(cp, FONT_RANGES.latinContext.latin) !== codePointInRanges(cp, FONT_RANGES.cjkContext.latin);
      expect(differs, `U+${cp.toString(16)}`).toBe(codePointInRanges(cp, SHARED_QUOTE_RANGES));
    }
  });
});
