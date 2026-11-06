// @vitest-environment jsdom
// Sidebar layout B 「现在 / 全部」 (design 040 §4 B, step 14): an optional layout (Settings → 侧栏 → 侧栏布局, default
// 花名册). 「现在」: one card per agent that needs the owner, longest waiting first, in a stable order (a card moves only
// when its own need changes), then the agents open in the conversation columns (左 / 右); at most 5, the rest behind
// 「还有 N」; each card has a direct button (回复 / 批准… / 回答 / 打开). 「全部」: the roster in compact rows with a filter.
// The divider's place is kept in prefs. No icon row of its own (the entries are in the window bar).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AttentionChip } from "../src/renderer/src/lib/agentAttention";
import { NOW_MAX, nowAction, nowCards, stableOrder } from "../src/renderer/src/lib/nowCards";
import { clampNowHeight, NOW_HEIGHT } from "../src/renderer/src/lib/prefs";
import { availableChoices, FIRST_CHOICES } from "../src/renderer/src/lib/firstChoices";

const chip = (key: string, extra: Partial<AttentionChip> = {}): AttentionChip => ({ id: key, key, name: key, signal: "needsYou", reason: "confirm", count: 1, askId: null, at: 0, ...extra });

describe("lib/nowCards", () => {
  it("the direct button: 回答 for a question, 回复 for a message, 批准… for approvals / reviews, 打开 otherwise", () => {
    expect(nowAction(chip("a", { reason: "question" }))).toBe("answer");
    expect(nowAction(chip("a", { reason: "ownerMessage" }))).toBe("reply");
    expect(nowAction(chip("a", { reason: "approval" }))).toBe("approve");
    expect(nowAction(chip("a", { reason: "review" }))).toBe("approve");
    expect(nowAction(chip("a", { reason: null }))).toBe("open");
    expect(nowAction(chip("a", { signal: "error", reason: null }))).toBe("open");
  });

  it("stable order: longest waiting first; a card moves only when its own need changes", () => {
    const first = stableOrder(new Map(), [
      { key: "b", fp: "1", at: 200 },
      { key: "a", fp: "1", at: 100 },
      { key: "c", fp: "1", at: null },
    ], 300);
    expect(first.order).toEqual(["a", "b", "c"]);
    // Live times changing (a, b get newer activity) do not reorder: the need is the same.
    const same = stableOrder(first.memo, [
      { key: "a", fp: "1", at: 900 },
      { key: "b", fp: "1", at: 50 },
      { key: "c", fp: "1", at: 10 },
    ], 1000);
    expect(same.order).toEqual(["a", "b", "c"]);
    // a's need changed: a new event, so it goes after the others.
    const changed = stableOrder(same.memo, [
      { key: "a", fp: "2", at: 900 },
      { key: "b", fp: "1", at: 50 },
      { key: "c", fp: "1", at: 10 },
    ], 1000);
    expect(changed.order).toEqual(["b", "c", "a"]);
    // One that left is forgotten.
    expect([...stableOrder(changed.memo, [{ key: "b", fp: "1", at: 0 }], 1000).memo.keys()]).toEqual(["b"]);
  });

  it("needs first (in order), then the open agents that are not needs; 左 / 右 only with two columns; at most NOW_MAX", () => {
    const needs = ["a", "b", "c", "d", "e", "f"].map((k) => chip(k));
    const { shown, rest } = nowCards(needs, ["f", "e", "d", "c", "b", "a"], ["b", "x"]);
    expect(NOW_MAX).toBe(5);
    expect(shown.map((c) => c.key)).toEqual(["f", "e", "d", "c", "b"]);
    expect(rest.map((c) => c.key)).toEqual(["a", "x"]);
    expect(shown.find((c) => c.key === "b")).toMatchObject({ column: "left", open: true, action: "approve" });
    expect(rest.find((c) => c.key === "x")).toMatchObject({ column: "right", open: true, chip: null, action: null });
    expect(nowCards([], [], ["x"]).shown).toEqual([{ key: "x", chip: null, column: null, open: true, action: null }]);
  });
});

describe("prefs and choices", () => {
  it("the 现在 height is clamped and defaults to 300 px", () => {
    expect(clampNowHeight(undefined)).toBe(NOW_HEIGHT.def);
    expect(clampNowHeight(20)).toBe(NOW_HEIGHT.min);
    expect(clampNowHeight(99999)).toBe(NOW_HEIGHT.max);
    expect(clampNowHeight(333.4)).toBe(333);
  });

  it("侧栏布局 is a first-contact choice (its own onboarding card), recommended 花名册", () => {
    const c = FIRST_CHOICES.find((x) => x.id === "sidebarLayout")!;
    expect(c.recommended).toBe("roster");
    expect(c.options.map((o) => o.value)).toEqual(["roster", "now-all"]);
    expect(availableChoices(["sidebarLayout"]).map((x) => x.id)).toEqual(["sidebarLayout"]);
    expect(readFileSync("src/renderer/src/components/OnboardingFlow.tsx", "utf8")).toMatch(/sidebar: \{[^}]*choices: \["sidebarLayout"\]/);
  });
});

describe("wiring (source)", () => {
  const src = (rel: string) => readFileSync(`src/renderer/src/${rel}`, "utf8");
  it("Settings → 侧栏 has the 侧栏布局 row; the default is 花名册", () => {
    expect(src("components/settings/regions/SidebarSettings.tsx")).toMatch(/label=\{t\("appearance\.sidebarLayout"\)\}[\s\S]*?setUiPref\("sidebarLayout", v\)/);
    expect(src("lib/prefs.ts")).toMatch(/sidebarLayout: "roster", sidebarNowHeight: NOW_HEIGHT\.def/);
    expect(src("lib/prefs.ts")).toMatch(/sidebarLayout: stored\.sidebarLayout === "now-all" \? "now-all" : "roster"/);
  });
  it("layout B: 现在, the divider, 全部 with its filter, then the same roster in compact rows; no icon row of its own", () => {
    const s = src("components/Sidebar.tsx");
    const b = s.slice(s.indexOf("{nowAll ? ("), s.indexOf(") : (", s.indexOf("{nowAll ? (")));
    expect(b).toMatch(/<NowSection [^>]*notice=\{<RestoreBanner compact \/>\}/);
    expect(b.indexOf("<NowSection")).toBeLessThan(b.indexOf("<NowSplitter"));
    expect(b.indexOf("<NowSplitter")).toBeLessThan(b.indexOf('searchField(t("sidebar.all.filter")'));
    expect(b).not.toMatch(/TopNav|TitleBarEntries/);
    expect(s).toMatch(/<AllRowsCompact\.Provider value=\{nowAll\}>/);
  });
  it("the cards open where the need is handled, as the 需要你 list does (one shared function)", () => {
    expect(src("components/SidebarNowAll.tsx")).toMatch(/activateAttention\(card\.chip/);
    expect(src("components/NeedsYou.tsx")).toContain("activateAttention(item.chip, item.need, item.host)");
  });
});
