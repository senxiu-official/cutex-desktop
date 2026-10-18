// Guards from the localization audit (docs/research/i18n-terms-audit-20261013.md, owner 2026-10-13):
// zh prose treats Profile as the product noun (the settings nav page is "Profile"), and the
// tray / taskbar text speaks the UI's own agent word, never a hard-coded latin "agent".
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { overlayDescription, trayTooltip } from "../src/shared/shell";

const { zhCN } = await import("../src/renderer/src/i18n/zh-CN");
const { en } = await import("../src/renderer/src/i18n/en");
const { applyTerms, DEFAULT_TERMS, parseOverrides, resolveTerms, resetTerm, setTerm, splitTerms } = await import("../src/renderer/src/lib/terms");

/** Strips what is not prose: term placeholders, {var}s. */
function prose(text: string): string {
  return text
    .replace(/\{\{[^}]*\}\}/g, " ")
    .replace(/\{[^}]*\}/g, " ");
}

describe("localization audit guards (2026-10-13)", () => {
  it("zh strings contain no control characters (placeholder-mangling guard)", () => {
    const bad = Object.entries(zhCN as Record<string, string>)
      .filter(([, v]) => /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v))
      .map(([k]) => k);
    expect(bad).toEqual([]);
  });

  it("zh strings spell the product noun Profile capitalized", () => {
    const bad = Object.entries(zhCN as Record<string, string>)
      .filter(([, v]) => /[\u4e00-\u9fff]/.test(v) && /\bprofile\b/.test(prose(v)))
      .map(([k, v]) => `${k}: ${v}`);
    expect(bad).toEqual([]);
  });

  it("zh strings write a term placeholder flush against Chinese text (settings audit 2026-10-15: 「主 智能体」)", () => {
    const bad = Object.entries(zhCN as Record<string, string>)
      .filter(([, v]) => /[\u4e00-\u9fff，。；：（）「」] \{\{|\}\} [\u4e00-\u9fff，。；：（）「」]/.test(v))
      .map(([k, v]) => `${k}: ${v}`);
    expect(bad).toEqual([]);
  });

  it("keeps the audited sentences capitalized (spot checks)", () => {
    expect(zhCN["settings.profiles.new.title"]).toBe("新建 Profile");
    expect(zhCN["composer.quota.none"]).toContain("该 Profile");
    expect(zhCN["composer.quota.none"]).toContain("设置 → Profile");
    expect(zhCN["refusal.profile_is_default"]).toBe("不能删除默认 Profile。先把别的 Profile 设为默认。");
  });

  it("zh tray / taskbar text uses the agent term, not a hard-coded latin word", () => {
    for (const locale of ["zh-CN", "zh-Hant-CN"] as const) {
      for (const text of [trayTooltip(2, locale), overlayDescription(2, locale), trayTooltip(0, locale)]) {
        expect(text, `${locale}: ${text}`).not.toMatch(/agent/i);
      }
      expect(trayTooltip(2, locale)).toMatch(/智能/);
    }
  });

  // The parent agent has its own term (owner 2026-10-13): a custom agent word must not leak into
  // it (Maid → not 「父Maid」), and an old terms store without the term keeps the default.
  it("parentagent is an independent term with its own default in every language", () => {
    expect(DEFAULT_TERMS["zh-CN"].parentagent).toEqual({ one: "父智能体", many: "父智能体" });
    expect(DEFAULT_TERMS["zh-Hant-CN"].parentagent).toEqual({ one: "父智能體", many: "父智能體" });
    expect(DEFAULT_TERMS.en.parentagent).toEqual({ one: "parent agent", many: "parent agents" });
    // Translated 2026-10-18 (they were the en words before).
    expect(DEFAULT_TERMS["ru-RU"].parentagent).toEqual({ one: "родительский агент", many: "родительские агенты" });
    expect(DEFAULT_TERMS["fr-FR"].parentagent).toEqual({ one: "agent parent", many: "agents parents" });
    expect(DEFAULT_TERMS["es-ES"].parentagent).toEqual({ one: "agente padre", many: "agentes padre" });
    expect(DEFAULT_TERMS["pt-BR"].parentagent).toEqual({ one: "agente pai", many: "agentes pai" });
    expect(DEFAULT_TERMS["it-IT"].parentagent).toEqual({ one: "agente padre", many: "agenti padre" });
    expect(DEFAULT_TERMS["de-DE"].parentagent).toEqual({ one: "übergeordneter Agent", many: "übergeordnete Agenten" });
    expect(DEFAULT_TERMS["ja-JP"].parentagent).toEqual({ one: "親エージェント", many: "親エージェント" });
    expect(DEFAULT_TERMS["ko-KR"].parentagent).toEqual({ one: "상위 에이전트", many: "상위 에이전트" });
  });

  it("a custom agent word never leaks into parentagent (Maid → not 父Maid)", () => {
    const overrides = parseOverrides({ "zh-CN": { agent: { one: "Maid" } } });
    const terms = resolveTerms(overrides, "zh-CN");
    expect(terms.agent.one).toBe("Maid");
    expect(terms.parentagent.one).toBe("父智能体");
    expect(applyTerms(zhCN["sub.readOnly"], terms, "zh-CN")).toContain("父智能体");
    expect(applyTerms(zhCN["sub.readOnly"], terms, "zh-CN")).not.toContain("父Maid");
  });

  it("parentagent can be overridden and reset; an old store keeps the default", () => {
    let saved: string | null = null;
    Object.defineProperty(globalThis, "localStorage", { value: { getItem: () => saved, setItem: (_k: unknown, v: string) => { saved = v; } }, configurable: true });
    expect(parseOverrides({ en: { agent: { one: "Butler" } } }).en?.parentagent).toBeUndefined();
    setTerm("en", "parentagent", "one", "boss agent");
    expect(resolveTerms(parseOverrides(JSON.parse(localStorage.getItem("cutex-desktop.terms") ?? "{}")), "en").parentagent.one).toBe("boss agent");
    resetTerm("en", "parentagent");
    expect(resolveTerms({}, "en").parentagent.one).toBe("parent agent");
    Reflect.deleteProperty(globalThis, "localStorage");
  });

  it("the 术语 preview shows the parentagent word and marks it (review 2026-10-13; preview band 2026-10-18)", () => {
    const sample = zhCN["terms.sample.reportsTo"];
    expect(sample).toContain("{{parentagent}}");
    const custom = resolveTerms(parseOverrides({ "zh-CN": { parentagent: { one: "上司" } } }), "zh-CN");
    const shown = applyTerms(sample, custom, "zh-CN");
    expect(shown).toContain("上司");
    expect(shown).not.toContain("父智能体");
    expect(applyTerms(sample, resolveTerms({}, "zh-CN"), "zh-CN")).toContain("父智能体");
    // the sample word never derives from the agent term
    const maid = resolveTerms(parseOverrides({ "zh-CN": { agent: { one: "Maid" }, parentagent: { one: "上司" } } }), "zh-CN");
    expect(applyTerms(sample, maid, "zh-CN")).toContain("上司");
    const enSample = applyTerms(en["terms.sample.reportsTo"], resolveTerms(parseOverrides({ en: { parentagent: { one: "boss agent" } } }), "en"), "en");
    expect(enSample).toContain("boss agent");
    // the pieces carry the term id, and join back to applyTerms
    const pieces = splitTerms(sample, custom, "zh-CN");
    expect(pieces).toEqual(["汇报给", { id: "parentagent", text: "上司" }]);
    expect(pieces.map((p) => (typeof p === "string" ? p : p.text)).join("")).toBe(shown);
    expect(splitTerms("Waiting for {{an owner}} · {{Agents}}", resolveTerms({}, "en"), "en")).toEqual(["Waiting for ", { id: "owner", text: "an owner" }, " · ", { id: "agent", text: "Agents" }]);
  });
});
