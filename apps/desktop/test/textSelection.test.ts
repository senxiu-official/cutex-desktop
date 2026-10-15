import { describe, expect, it } from "vitest";
import { mapTextSelection } from "../src/renderer/src/lib/textSelection";

describe("mapTextSelection", () => {
  it("preserves offsets across font-run and streaming/static markup replacements", () => {
    expect(mapTextSelection("他说：“job’s task。”", "他说：“job’s task。”", { anchor: 4, focus: 14 }))
      .toEqual({ anchor: 4, focus: 14 });
  });

  it("keeps both selection directions when text is appended", () => {
    expect(mapTextSelection("中文 English", "中文 English more", { anchor: 3, focus: 10 })).toEqual({ anchor: 3, focus: 10 });
    expect(mapTextSelection("中文 English", "中文 English more", { anchor: 10, focus: 3 })).toEqual({ anchor: 10, focus: 3 });
  });

  it("uses UTF-16 offsets, including surrogate pairs and combining characters", () => {
    expect(mapTextSelection("a😀é中文", "prefix a😀é中文", { anchor: 1, focus: 5 })).toEqual({ anchor: 8, focus: 12 });
  });

  it("shifts a surviving selection when the only edit precedes it", () => {
    expect(mapTextSelection("old: selected", "new prefix: selected", { anchor: 13, focus: 5 })).toEqual({ anchor: 20, focus: 12 });
    expect(mapTextSelection("prefix selected", "selected", { anchor: 7, focus: 15 })).toEqual({ anchor: 0, focus: 8 });
  });

  it("excludes inserted text at either edge of the selected characters", () => {
    expect(mapTextSelection("ab", "Xab", { anchor: 0, focus: 2 })).toEqual({ anchor: 1, focus: 3 });
    expect(mapTextSelection("ab", "abX", { anchor: 0, focus: 2 })).toEqual({ anchor: 0, focus: 2 });
  });

  it("does not guess if an edit overlaps or removes the selection", () => {
    expect(mapTextSelection("abcdef", "abXdef", { anchor: 1, focus: 4 })).toBeNull();
    expect(mapTextSelection("abcdef", "abXcdef", { anchor: 1, focus: 4 })).toBeNull();
    expect(mapTextSelection("abcdef", "af", { anchor: 1, focus: 4 })).toBeNull();
    expect(mapTextSelection("abcdef", "", { anchor: 1, focus: 4 })).toBeNull();
  });

  it("declines disjoint edits rather than accidentally selecting different characters", () => {
    expect(mapTextSelection("a selected z", "b selected y", { anchor: 2, focus: 10 })).toBeNull();
  });

  it("does not strip actual newlines when an edit changes selected prose or code", () => {
    expect(mapTextSelection("A\nB", "AB", { anchor: 0, focus: 3 })).toBeNull();
    expect(mapTextSelection("A\nB", "AXB", { anchor: 0, focus: 3 })).toBeNull();
    expect(mapTextSelection("A\nB", "A\nB\nC", { anchor: 0, focus: 3 })).toEqual({ anchor: 0, focus: 3 });
  });

  it("ignores carets and invalid offsets", () => {
    for (const offsets of [{ anchor: 1, focus: 1 }, { anchor: -1, focus: 2 }, { anchor: 0, focus: 4 }, { anchor: 0.5, focus: 2 }, { anchor: NaN, focus: 2 }]) {
      expect(mapTextSelection("abc", "abcd", offsets)).toBeNull();
    }
  });
});
