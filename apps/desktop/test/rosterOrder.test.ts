// The desktop's name order (lib/rosterOrder over @cutex-desktop/cutex-client/nameOrder, design 060 §5.1):
// the two Appearance settings, defaulting from the UI language, and the roster's online-first order.
import { afterEach, describe, expect, it } from "vitest";
import { compareNames, compareRoster, nameOrderOf } from "../src/renderer/src/lib/rosterOrder";
import { setUiPref } from "../src/renderer/src/lib/prefs";

afterEach(() => {
  setUiPref("nameGrouping", null);
  setUiPref("nameReading", null);
});

describe("nameOrderOf", () => {
  it("follows the UI language until a setting is picked", () => {
    const none = { nameGrouping: null, nameReading: null };
    expect(nameOrderOf("zh-CN", none)).toEqual({ grouping: "letter", reading: "zh" });
    expect(nameOrderOf("zh-Hant-TW", none)).toEqual({ grouping: "letter", reading: "zh" });
    expect(nameOrderOf("en", none)).toEqual({ grouping: "script", reading: "zh" });
    expect(nameOrderOf("ko-KR", none)).toEqual({ grouping: "script", reading: "ko" });
    expect(nameOrderOf("ja-JP", none)).toEqual({ grouping: "script", reading: "ja" });
    expect(nameOrderOf("ja-JP", { nameGrouping: "letter", nameReading: null })).toEqual({ grouping: "letter", reading: "ja" });
    expect(nameOrderOf("en", { nameGrouping: null, nameReading: "ko" })).toEqual({ grouping: "script", reading: "ko" });
  });
});

describe("compareNames follows the settings", () => {
  const names = ["zed", "张三", "bob", "Alice", "李四", "agent10", "agent2"];
  it("by first letter: Latin then Han inside each letter", () => {
    setUiPref("nameGrouping", "letter");
    setUiPref("nameReading", "zh");
    expect([...names].sort(compareNames)).toEqual(["agent2", "agent10", "Alice", "bob", "李四", "zed", "张三"]);
  });
  it("by script: Latin names, then Han by pinyin", () => {
    setUiPref("nameGrouping", "script");
    setUiPref("nameReading", "zh");
    expect([...names].sort(compareNames)).toEqual(["agent2", "agent10", "Alice", "bob", "zed", "李四", "张三"]);
  });
});

describe("compareRoster", () => {
  const rows = [
    { id: "3", name: "bob", online: false },
    { id: "2", name: "张三", online: true },
    { id: "1", name: "Bob", online: false },
    { id: "4", name: "alice", online: true },
  ];
  it("online first, then name, then id (stable)", () => {
    setUiPref("nameGrouping", "letter");
    setUiPref("nameReading", "zh");
    expect([...rows].sort(compareRoster((r) => r.online)).map((r) => r.id)).toEqual(["4", "2", "1", "3"]);
  });
});
