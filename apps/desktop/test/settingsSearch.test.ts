// Settings search (lib/settingsSearch.ts): matching / ranking / grouping, plus the declarations of the
// built-in modules (SettingsPageItem.sections, settings.section titleKey / keywords) and their anchors.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));

const { cleanText, firstResult, flattenResults, highlightParts, resultCount, matchDoc, matchText, normalizeQuery, searchSettings } = await import("../src/renderer/src/lib/settingsSearch");
type Doc = import("../src/renderer/src/lib/settingsSearch").SettingsSearchDoc;
const { MODULES } = await import("../src/renderer/src/modules/registry");
const { zhCN } = await import("../src/renderer/src/i18n/zh-CN");
const { en } = await import("../src/renderer/src/i18n/en");

const tx = (current: string, other = current) => ({ current, other });
function doc(page: string, pageOrder: number, pageTitle: [string, string], section: [string, string] | null, keywords: [string, string][] = [], disabled: string | null = null): Doc {
  return { page: page as Doc["page"], pageOrder, pageTitle: tx(...pageTitle), anchor: section ? `${page}-${section[1]}` : null, sectionTitle: section ? tx(...section) : null, keywords: keywords.map((k) => tx(...k)), disabled };
}

const DOCS: Doc[] = [
  doc("general", 0, ["通用", "General"], null),
  doc("general", 0, ["通用", "General"], ["语言与窗口", "Language and window"], [["界面语言", "Interface language"], ["关闭窗口时", "When closing the window"]]),
  doc("appearance", 1, ["外观", "Appearance"], null),
  doc("appearance", 1, ["外观", "Appearance"], ["整体", "Overall"], [["主题", "Theme"], ["深色", "Dark"], ["界面缩放", "Interface zoom"]]),
  doc("appearance", 1, ["外观", "Appearance"], ["字体", "Fonts"], [["界面字体", "UI font"], ["对话字号", "Chat font size"]]),
  doc("remote", 2, ["远程访问", "Remote access"], null),
  doc("remote", 2, ["远程访问", "Remote access"], ["配对", "Pairing"], [], "需要升级 cutex（缺 pairing）"),
];

describe("matchText", () => {
  it("ranks equal > prefix > word start > substring > all words > subsequence", () => {
    expect(matchText("Theme", "theme")!.score).toBe(100);
    expect(matchText("Theme colors", "theme")!.score).toBe(90);
    expect(matchText("UI theme", "theme")!.score).toBe(80);
    expect(matchText("Anthem", "them")!.score).toBe(70);
    expect(matchText("Chat font size", "size font")!.score).toBe(60);
    const sub = matchText("Chat font size", "fontsi");
    expect(sub && sub.score).toBeGreaterThan(0);
    expect(sub!.score).toBeLessThan(60);
  });

  it("is case-insensitive and returns highlight ranges", () => {
    expect(matchText("Interface Language", "LANG".toLowerCase())).toEqual({ score: 80, ranges: [[10, 14]] });
    expect(matchText("界面语言", "语言")).toEqual({ score: 70, ranges: [[2, 4]] });
  });

  it("keeps fuzzy matches quiet: short queries, scattered letters, mid-word starts", () => {
    expect(matchText("Theme", "tm")).toBeNull();
    expect(matchText("abcdefghij", "acegi")).toBeNull();
    expect(matchText("Interface", "ntf")).toBeNull();
    expect(matchText("Fold older agent replies", "font")).toBeNull(); // "nt" starts mid-word
    expect(matchText("Fold older agent replies", "foag")).not.toBeNull();
    expect(matchText("", "x")).toBeNull();
    expect(matchText("x", "")).toBeNull();
  });
});

describe("matchDoc / searchSettings", () => {
  it("matches in the UI language and in English", () => {
    const zh = searchSettings(DOCS, "主题");
    const enHit = searchSettings(DOCS, "THEME");
    for (const groups of [zh, enHit]) {
      expect(groups.map((g) => g.page)).toEqual(["appearance"]);
      expect(groups[0]!.sections.map((h) => h.doc.anchor)).toEqual(["appearance-Overall"]);
      expect(groups[0]!.sections[0]!.field).toBe("keyword");
    }
    expect(zh[0]!.sections[0]!.viaOther).toBe(false);
    expect(enHit[0]!.sections[0]).toMatchObject({ viaOther: true, text: "Theme", ranges: [[0, 5]] });
  });

  it("a page title hit marks the page row and highlights it in the UI language", () => {
    const [g] = searchSettings(DOCS, "外观");
    expect(g!.page).toBe("appearance");
    expect(g!.pageHit?.field).toBe("title");
    expect(g!.pageRanges).toEqual([[0, 2]]);
    // English page title match: the page row still matches, but the zh title is not highlighted.
    const [e] = searchSettings(DOCS, "appear");
    expect(e!.pageHit?.viaOther).toBe(true);
    expect(e!.pageRanges).toEqual([]);
  });

  it("title hits outrank keyword hits; groups sort by their best hit, then nav order", () => {
    const groups = searchSettings(DOCS, "font");
    expect(groups.map((g) => g.page)).toEqual(["appearance"]);
    expect(groups[0]!.sections[0]!.field).toBe("title"); // "Fonts" (prefix) beats "UI font"
    const lang = searchSettings(DOCS, "lang");
    expect(lang[0]!.sections[0]!.doc.sectionTitle!.other).toBe("Language and window");
  });

  it("several words may hit different fields (page title + keyword)", () => {
    const hit = matchDoc(DOCS[4]!, normalizeQuery("Appearance  size"));
    // Shown: the field that explains the hit ("Chat font size"), with the word highlighted.
    expect(hit).toMatchObject({ field: "combined", text: "Chat font size", ranges: [[10, 14]], viaOther: true });
    expect(matchDoc(DOCS[4]!, "appearance nothing")).toBeNull();
  });

  it("keeps disabled entries (with the reason); Enter starts on the first available hit", () => {
    const groups = searchSettings(DOCS, "pair");
    expect(groups[0]!.sections[0]!.doc.disabled).toContain("pairing");
    const rows = flattenResults(groups);
    expect(rows).toEqual([
      { page: "remote", anchor: null, disabled: null, hit: false },
      { page: "remote", anchor: "remote-Pairing", disabled: "需要升级 cutex（缺 pairing）", hit: true },
    ]);
    expect(resultCount(rows)).toBe(1);
    expect(firstResult(rows)).toBe(0); // no available hit: the page row
    const fonts = flattenResults(searchSettings(DOCS, "字体"));
    expect(fonts[firstResult(fonts)]).toMatchObject({ page: "appearance", anchor: "appearance-Fonts" });
  });

  it("empty / blank queries return nothing; the limit caps section hits", () => {
    expect(searchSettings(DOCS, "   ")).toEqual([]);
    expect(searchSettings(DOCS, "a", 1).reduce((n, g) => n + g.sections.length, 0)).toBe(1);
  });
});

describe("text helpers", () => {
  it("cleanText drops {var} slots; highlightParts splits along ranges", () => {
    expect(cleanText("每小时最多 {n} 条  ")).toBe("每小时最多 条");
    expect(highlightParts("Interface language", [[10, 14]])).toEqual([
      { text: "Interface ", hit: false },
      { text: "lang", hit: true },
      { text: "uage", hit: false },
    ]);
    expect(highlightParts("abc", [])).toEqual([{ text: "abc", hit: false }]);
  });
});

describe("built-in search declarations", () => {
  const pages = MODULES.flatMap((m) => m.contributes?.["settings.page"] ?? []);
  const sections = MODULES.flatMap((m) => m.contributes?.["settings.section"] ?? []);

  it("every page and section is searchable by a title in both languages; keywords exist", () => {
    const keys = [
      ...pages.flatMap((p) => [p.titleKey, ...(p.keywords ?? []), ...(p.sections ?? []).flatMap((s) => [s.titleKey, ...(s.keywords ?? [])])]),
      ...sections.flatMap((s) => [s.titleKey!, ...(s.keywords ?? []), ...(s.sections ?? []).flatMap((c) => [c.titleKey, ...(c.keywords ?? [])])]),
    ];
    for (const s of sections) expect(s.titleKey, `${s.id} has no titleKey (not searchable)`).toBeTruthy();
    for (const k of keys) {
      expect(zhCN[k], k).toBeTruthy();
      expect(en[k], k).toBeTruthy();
    }
  });

  it("anchors are unique per page (declared cards and contributed section ids)", () => {
    for (const p of pages) {
      const anchors = [...(p.sections ?? []).map((s) => s.anchor), ...sections.filter((s) => s.page === p.page).flatMap((s) => [s.id, ...(s.sections ?? []).map((c) => c.anchor)])];
      expect(new Set(anchors).size, p.page).toBe(anchors.length);
    }
  });

  it("every declared card anchor is rendered by some component (settingsAnchorId)", () => {
    const SRC = join(__dirname, "../src/renderer/src");
    const all = (dir: string, ext: RegExp): string[] => readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? all(path, ext) : ext.test(name) ? [path] : [];
    });
    const code = all(SRC, /\.tsx$/).map((f) => readFileSync(f, "utf8")).join("\n");
    const ts = all(SRC, /\.ts$/).map((f) => readFileSync(f, "utf8")).join("\n");
    for (const p of pages) {
      for (const s of p.sections ?? []) {
        // Shortcut groups are rendered in a loop: settingsAnchorId(`shortcuts-${group.id}`).
        if (s.anchor.startsWith("shortcuts-")) expect(code).toContain("settingsAnchorId(`shortcuts-${group.id}`)");
        else expect(code, `${p.page} › ${s.anchor}`).toContain(`settingsAnchorId("${s.anchor}")`);
      }
    }
    // Cards inside a settings.section item: a literal anchor or an exported constant holding it.
    for (const item of sections) {
      for (const c of item.sections ?? []) {
        const constant = new RegExp(`export const (\\w+) = "${c.anchor}"`).exec(ts)?.[1];
        const rendered = code.includes(`settingsAnchorId("${c.anchor}")`) || (!!constant && code.includes(`settingsAnchorId(${constant})`));
        expect(rendered, `${item.id} › ${c.anchor}`).toBe(true);
      }
    }
  });
});
