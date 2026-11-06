// The shared name order (src/nameOrder.ts, design 060 §5.1). Node and Electron 44 ship the same ICU data
// for zh-u-co-pinyin / ko / ja (checked 2026-11-05: ICU 78.3 / 78.2, identical results).
import { describe, expect, it } from "vitest";
import { byName, defaultNameOrder, nameBlock, nameComparer, type NameOrder } from "../src/nameOrder";

const sortIn = (order: NameOrder, names: string[], locale = "en") => [...names].sort(nameComparer(order, locale));
const AA: NameOrder = { grouping: "letter", reading: "zh" };
const BA: NameOrder = { grouping: "script", reading: "zh" };
const AB: NameOrder = { grouping: "letter", reading: "ko" };
const BB: NameOrder = { grouping: "script", reading: "ko" };
const AC: NameOrder = { grouping: "letter", reading: "ja" };
const BC: NameOrder = { grouping: "script", reading: "ja" };

describe("defaults by UI language", () => {
  it("Chinese letter + zh; Korean script + ko; Japanese script + ja; everything else script + zh", () => {
    for (const l of ["zh-CN", "zh-Hant-CN", "zh-Hant-TW", "zh-Hant-HK", "zh-Hant-MO"]) expect(defaultNameOrder(l)).toEqual(AA);
    expect(defaultNameOrder("ko-KR")).toEqual(BB);
    expect(defaultNameOrder("ja-JP")).toEqual(BC);
    for (const l of ["en", "en-AU", "ru-RU", "fr-FR", "es-ES", "pt-BR", "it-IT", "de-DE"]) expect(defaultNameOrder(l)).toEqual(BA);
  });
});

describe("pinyin boundaries (reading zh)", () => {
  const bounds = [..."阿八嚓哒妸发旮哈讥咔垃妈拏噢妑七呥仨它穵夕丫帀"];
  const letters = [..."ABCDEFGHJKLMNOPQRSTWXYZ"];
  it("each boundary character starts its letter; they increase in the collator", () => {
    bounds.forEach((ch, i) => expect(nameBlock(ch, "zh"), ch).toBe(letters[i]));
    const c = new Intl.Collator("zh-u-co-pinyin");
    for (let i = 1; i < bounds.length; i++) expect(c.compare(bounds[i - 1]!, bounds[i]!)).toBeLessThan(0);
  });
  it("common surnames land under their initial; no Han block for I, U, V", () => {
    expect(["张", "李", "王", "刘", "陈", "杨", "赵", "黄", "周", "吴", "欧阳", "爱"].map((n) => nameBlock(n, "zh")).join("")).toBe("ZLWLCYZHZWOA");
    const all = new Set(Array.from({ length: 0x9fa5 - 0x4e00 }, (_, i) => nameBlock(String.fromCharCode(0x4e00 + i), "zh")));
    for (const l of ["I", "U", "V"]) expect(all.has(l)).toBe(false);
  });
  it("polyphones take ICU's default reading (accepted limit)", () => {
    expect(nameBlock("长安", "zh")).toBe("Z");
    expect(nameBlock("重楼", "zh")).toBe("Z");
  });
});

describe("grouping letter (AA)", () => {
  it("A–Z blocks; inside a block Latin first, then Han; anything else before A", () => {
    expect(sortIn(AA, ["zed", "张三", "bob", "爱丽丝", "Alice", "白", "李四", "lisa", "1st", "😀 x", "あき", "Ärger", "agent10", "agent2"])).toEqual([
      "😀 x", "1st", "あき", "agent2", "agent10", "Alice", "Ärger", "爱丽丝", "bob", "白", "lisa", "李四", "zed", "张三",
    ]);
  });
  it("does not change with the UI language", () => {
    const names = ["zed", "张三", "bob", "Ärger", "李四"];
    expect(sortIn(AA, names, "de-DE")).toEqual(sortIn(AA, names, "zh-CN"));
  });
});

describe("grouping script (BA)", () => {
  it("every non-Han name in the UI language's order, then the Han names by pinyin", () => {
    expect(sortIn(BA, ["艾丽", "agent2", "Alice", "八云", "Ada", "安娜", "Zoe", "阿狸", "Bob", "agent10"])).toEqual(["Ada", "agent2", "agent10", "Alice", "Bob", "Zoe", "阿狸", "艾丽", "安娜", "八云"]);
  });
  it("the UI language orders the non-Han names (Swedish puts Ä after Z)", () => {
    expect(sortIn(BA, ["Ärger", "Zoe", "Anna"], "sv")).toEqual(["Anna", "Zoe", "Ärger"]);
    expect(sortIn(BA, ["Ärger", "Zoe", "Anna"], "de-DE")).toEqual(["Anna", "Ärger", "Zoe"]);
  });
});

describe("Korean reading", () => {
  it("Hangul and Hanja by Revised Romanization initial (박 B, 김 G; 李 R)", () => {
    expect(["박", "김", "이", "최", "정", "朴", "金", "李", "韓"].map((n) => nameBlock(n, "ko")).join("")).toBe("BGICJBGRH");
  });
  it("characters with no Korean reading (simplified) have no letter", () => {
    expect(nameBlock("张三", "ko")).toBe("");
    expect(nameBlock("长安", "ko")).toBe("");
    expect(nameBlock("金", "ko")).toBe("G");
  });
  it("AB: letter blocks with Hangul and Hanja after the Latin names", () => {
    expect(sortIn(AB, ["Kim", "김민수", "Bob", "박", "金民秀", "Gil"])).toEqual(["Bob", "박", "Gil", "김민수", "金民秀", "Kim"]);
  });
  it("BB: the ko collator's own order (Hangul with Hanja by reading, then Latin)", () => {
    expect(sortIn(BB, ["Alice", "나라", "金民秀", "가나", "Zoe", "Bob"])).toEqual(["가나", "金民秀", "나라", "Alice", "Bob", "Zoe"]);
  });
});

describe("Japanese reading", () => {
  it("kana exactly; kanji by JIS row (roughly on'yomi, voiced stays in its row)", () => {
    expect(["たなか", "ガク", "じろう", "ちか", "ふじ"].map((n) => nameBlock(n, "ja")).join("")).toBe("TGJCF");
    expect(["田中", "山田", "佐藤", "鈴木", "高橋", "伊藤", "後藤", "長谷川"].map((n) => nameBlock(n, "ja")).join("")).toBe("TSSRKIKC");
  });
  it("level-2 kanji and simplified characters outside JIS have no letter", () => {
    expect(nameBlock("弌", "ja")).toBe("");
    expect(nameBlock("张三", "ja")).toBe("");
  });
  it("AC: letter blocks; BC: the ja collator's own order (Latin, kana, kanji)", () => {
    expect(sortIn(AC, ["Tom", "田中", "Sam", "山田", "たろう"])).toEqual(["Sam", "山田", "Tom", "たろう", "田中"]);
    expect(sortIn(BC, ["田中", "Tom", "たろう", "Sam"])).toEqual(["Sam", "Tom", "たろう", "田中"]);
  });
});

describe("byName", () => {
  it("breaks ties on the id", () => {
    const rows = [{ id: "b", name: "Alice" }, { id: "a", name: "alice" }, { id: "c", name: "Bob" }];
    expect([...rows].sort(byName(AA, "en", (r) => r.name, (r) => r.id)).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
});
