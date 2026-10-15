import { describe, expect, it } from "vitest";
import { classifyFontRuns, type FontRun } from "../src/renderer/src/lib/fontRuns";

type Kind = FontRun["kind"];
function kindAt(text: string, offset: number, ownerLang = ""): Kind {
  let at = 0;
  for (const run of classifyFontRuns(text, ownerLang)) {
    at += run.text.length;
    if (offset < at) return run.kind;
  }
  throw new Error("Offset past input");
}
function quoteKinds(text: string, ownerLang = ""): Kind[] {
  return [...text.matchAll(/[‘’“”]/gu)].map((m) => kindAt(text, m.index, ownerLang));
}

describe("classifyFontRuns: quotation owner, not quoted-language voting", () => {
  const cases: [string, Kind[]][] = [
    ["他说：“run job’s task。”", ["cjk", "latin", "cjk"]],
    ["She said, “中文。”", ["latin", "latin"]],
    ["他说：“中文。”", ["cjk", "cjk"]],
    ["She said, “English.”", ["latin", "latin"]],
    ["“run job’s task”，他说。", ["cjk", "latin", "cjk"]],
    ["“中文”, she said.", ["latin", "latin"]],
    ["他说：“She replied, ‘hello’.”", ["cjk", "cjk", "cjk", "cjk"]],
    ["She said, “他说：‘中文’。”", ["latin", "latin", "latin", "latin"]],
    ["他说：“Read ‘job’s guide’.”", ["cjk", "cjk", "latin", "cjk", "cjk"]],
    ["他说：“Hello”。She said, “中文”.", ["cjk", "cjk", "latin", "latin"]],
    ["“中文” “English”", ["cjk", "cjk", "latin", "latin"]],
    ["“English”", ["latin", "latin"]],
    ["“中文”", ["cjk", "cjk"]],
    ["“English 中文中文中文”", ["latin", "latin"]],
    ["“中文 English English English”", ["cjk", "cjk"]],
    ["“”", ["latin", "latin"]],
    ["他说：“", ["cjk"]],
    ["他说：“very long English", ["cjk"]],
    ["She said, “中文中文", ["latin"]],
    ["“English 中文中文", ["latin"]],
    ["打开 API “reference”", ["cjk", "cjk"]],
    ["The term 中文 means “Chinese”", ["latin", "latin"]],
    ["Cutex 表示：“hello”", ["cjk", "cjk"]],
    // Deliberate, documented ambiguity: the first host letter wins without
    // trusted owner metadata; do not silently switch to a CJK-anywhere heuristic.
    ["API “设置”界面", ["latin", "latin"]],
  ];
  it.each(cases)("routes %s", (text, expected) => {
    expect(quoteKinds(text)).toEqual(expected);
  });

  it("accepts explicit prose ownership, without changing the scripts inside", () => {
    expect(classifyFontRuns("“English”", "zh-CN")).toEqual([
      { kind: "cjk", text: "“" }, { kind: "latin", text: "English" }, { kind: "cjk", text: "”" },
    ]);
    expect(quoteKinds("“中文”", "en")).toEqual(["latin", "latin"]);
    expect(quoteKinds("“”", "zh-CN")).toEqual(["cjk", "cjk"]);
    expect(quoteKinds("API “设置”界面", "zh-CN")).toEqual(["cjk", "cjk"]);
    expect(quoteKinds("“English”", "und")).toEqual(["latin", "latin"]);
    expect(quoteKinds("“中文”", "  ")).toEqual(["cjk", "cjk"]);
  });

  it("does not borrow host evidence from resources or another sentence", () => {
    expect(quoteKinds("https://中文.example “English”")).toEqual(["latin", "latin"]);
    expect(quoteKinds("他说：https://docs.example “English”")).toEqual(["cjk", "cjk"]);
    expect(quoteKinds("She said https://中文.example “中文”")).toEqual(["latin", "latin"]);
    expect(quoteKinds("C:\\项目\\file.txt “English”")).toEqual(["latin", "latin"]);
    expect(quoteKinds("/项目/file.txt “English”")).toEqual(["latin", "latin"]);
    expect(quoteKinds("他说。 “English”")).toEqual(["latin", "latin"]);
    expect(quoteKinds("She said. “中文”")).toEqual(["cjk", "cjk"]);
  });

  it("recovers mismatched nesting without contaminating a following quotation", () => {
    expect(quoteKinds("他说：“未闭合‘文本”。 She said, “中文”.")).toEqual(["cjk", "cjk", "cjk", "latin", "latin"]);
    expect(quoteKinds("他说：“未闭合\n\nShe said, “中文”.")).toEqual(["cjk", "latin", "latin"]);
    expect(quoteKinds("他说：“未闭合\r\n \r\nShe said, “中文”.")).toEqual(["cjk", "latin", "latin"]);
    expect(quoteKinds("他说：“未闭合\u2029She said, “中文”.")).toEqual(["cjk", "latin", "latin"]);
    expect(quoteKinds("他说：“line one\nline two”")).toEqual(["cjk", "cjk"]);
    expect(quoteKinds("She said, ”中文")).toEqual(["latin"]);
    expect(quoteKinds("他说：”English")).toEqual(["cjk"]);
  });

  it("uses bounded narration while preserving all text", () => {
    const text = `他说 ${"x".repeat(200)} “中文”`;
    expect(quoteKinds(text)).toEqual(["latin", "latin"]);
    expect(classifyFontRuns(text).map((r) => r.text).join("")).toBe(text);
  });
});

describe("classifyFontRuns: scripts and original graphemes", () => {
  it.each(["job's", "job’s", "e\u0301’s", "123’456", "dogs’ toys", "developer’s guide"])("keeps %s in one Latin run", (text) => {
    expect(classifyFontRuns(text, "zh-CN")).toEqual([{ kind: "latin", text }]);
  });

  it("separates CJK characters and fullwidth punctuation without splitting an English word", () => {
    expect(classifyFontRuns("中文，job’s，中文")).toEqual([
      { kind: "cjk", text: "中文，" }, { kind: "latin", text: "job’s" }, { kind: "cjk", text: "，中文" },
    ]);
    expect(classifyFontRuns("他说：「English」")).toEqual([
      { kind: "cjk", text: "他说：「" }, { kind: "latin", text: "English" }, { kind: "cjk", text: "」" },
    ]);
    expect(classifyFontRuns("汉字かなカナ한글ㄅㄆ，。！？")).toEqual([{ kind: "cjk", text: "汉字かなカナ한글ㄅㄆ，。！？" }]);
    expect(classifyFontRuns("123 ABC Ελληνικά العربية ()[]{}!?")).toEqual([{ kind: "latin", text: "123 ABC Ελληνικά العربية ()[]{}!?" }]);
  });

  it("does not change mono, empty input, whitespace, emoji, or variation selectors", () => {
    expect(classifyFontRuns("")).toEqual([]);
    expect(classifyFontRuns("const 中文 = “job’s”;", "zh", "mono")).toEqual([{ kind: "mono", text: "const 中文 = “job’s”;" }]);
    expect(classifyFontRuns("👩‍💻 😀 e\u0301")).toEqual([{ kind: "latin", text: "👩‍💻 😀 e\u0301" }]);
    expect(classifyFontRuns("𠀀汉\u{E0100}")).toEqual([{ kind: "cjk", text: "𠀀汉\u{E0100}" }]);
    expect(classifyFontRuns("\r\n \t").map((r) => r.text).join("")).toBe("\r\n \t");
  });

  it("preserves grapheme boundaries and merges adjacent equal kinds over varied inputs", () => {
    const parts = ["中文", "job’s", "e\u0301", "👨‍👩‍👧‍👦", "🇨🇳", "𠀀", "汉\u{E0100}", "\r\n", "“", "”", "‘", "’", "。", "API ", "https://中文.example"];
    const segmenter = new Intl.Segmenter("und", { granularity: "grapheme" });
    let seed = 17;
    for (let sample = 0; sample < 150; sample++) {
      let text = "";
      for (let i = 0; i < 15; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        text += parts[seed % parts.length];
      }
      const boundaries = new Set([...segmenter.segment(text)].map((s) => s.index));
      boundaries.add(text.length);
      const runs = classifyFontRuns(text);
      expect(runs.map((r) => r.text).join("")).toBe(text);
      let offset = 0;
      runs.forEach((run, i) => {
        expect(run.text.length).toBeGreaterThan(0);
        expect(boundaries.has(offset)).toBe(true);
        offset += run.text.length;
        expect(boundaries.has(offset)).toBe(true);
        if (i) expect(run.kind).not.toBe(runs[i - 1]!.kind);
      });
    }
  });
});

describe("classifyFontRuns: streaming prefixes", () => {
  it("keeps a known Chinese host stable as English content streams", () => {
    const text = "他说：“run job’s task with very long English content。”";
    const opening = text.indexOf("“");
    for (let end = opening + 1; end <= text.length; end++) {
      const prefix = text.slice(0, end);
      expect(kindAt(prefix, opening)).toBe("cjk");
      if (prefix.includes("’")) expect(kindAt(prefix, prefix.indexOf("’"))).toBe("latin");
      expect(classifyFontRuns(prefix).map((r) => r.text).join("")).toBe(prefix);
    }
  });

  it("permits new following narration to correct an isolated fallback", () => {
    expect(quoteKinds("“hello”")).toEqual(["latin", "latin"]);
    expect(quoteKinds("“hello”，他说")).toEqual(["cjk", "cjk"]);
    expect(quoteKinds("She said, “中文中文中文中文")).toEqual(["latin"]);
    expect(quoteKinds("“English 中文中文中文中文")).toEqual(["latin"]);
  });
});
