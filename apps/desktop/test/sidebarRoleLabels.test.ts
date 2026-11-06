import { afterEach, expect, it } from "vitest";
import { DEFAULT_TERMS, TERM_LOCALES, TERM_MAX, getTermOverrides, parseOverrides, resetTerm, resolveTerms, resolveSidebarRoleLabel, setSidebarRoleLabel, setTerm } from "../src/renderer/src/lib/terms";
import { applyTermPreset, currentTermPreset, presetOverrides, termPresets } from "../src/renderer/src/lib/termPresets";
import { migrateMaidTerms } from "../src/renderer/src/lib/termPresetMigration";
afterEach(() => { resetTerm("zh-CN", "director"); resetTerm("zh-CN", "operator"); });
it("derives short Maid role labels in every locale, including existing saved presets", () => {
 for (const locale of TERM_LOCALES) {
  const maid = termPresets(locale).find(p => p.id === "maid")!;
  const overrides = presetOverrides(locale, maid);
  expect(resolveSidebarRoleLabel(overrides, locale, "director")).toBe("Chief");
  expect(resolveSidebarRoleLabel(overrides, locale, "operator")).toBe("Deputy");
  expect(resolveSidebarRoleLabel({}, locale, "director")).toBe(DEFAULT_TERMS[locale].director.one);
 }
});
it("falls back to the full custom word and keeps independently saved labels", () => {
 const saved = { "zh-CN": { director: { one: "Coordinator", sidebar: "CM" }, operator: { one: "助手" } } };
 expect(resolveSidebarRoleLabel(saved, "zh-CN", "director")).toBe("CM");
 expect(resolveSidebarRoleLabel(saved, "zh-CN", "operator")).toBe("助手");
 expect(resolveTerms(saved, "zh-CN").director.one).toBe("Coordinator");
});
it("preserves explicit empty labels through parsing, dropping invalid roles and types", () => {
 const parsed = parseOverrides({ "zh-CN": { director: { sidebar: "  " }, operator: { sidebar: 3 }, agent: { sidebar: "bad" } } });
 expect(parsed["zh-CN"]?.director?.sidebar).toBe("");
 expect(parsed["zh-CN"]?.operator).toBeUndefined();
 expect(parsed["zh-CN"]?.agent).toBeUndefined();
 expect(resolveSidebarRoleLabel(parsed, "zh-CN", "director")).toBe("");
});
it("persists short, hidden and reset states in the same term store without changing full forms", () => {
 setTerm("zh-CN", "director", "one", "Chief Maid");
 setSidebarRoleLabel("zh-CN", "director", " CM ");
 expect(getTermOverrides()["zh-CN"]?.director).toEqual({ one: "Chief Maid", sidebar: "CM" });
 setSidebarRoleLabel("zh-CN", "director", "");
 setTerm("zh-CN", "director", "one", "");
 expect(getTermOverrides()["zh-CN"]?.director).toEqual({ sidebar: "" });
 setSidebarRoleLabel("zh-CN", "director", null);
 expect(getTermOverrides()["zh-CN"]?.director).toBeUndefined();
});
it("bounds label length and leaves full-term preset matching independent of the sidebar label", () => {
 applyTermPreset("zh-CN", "maid");
 setSidebarRoleLabel("zh-CN", "director", "x".repeat(100));
 expect(getTermOverrides()["zh-CN"]?.director?.sidebar?.length).toBe(TERM_MAX);
 expect(currentTermPreset("zh-CN")).toBe("maid");
 applyTermPreset("zh-CN", "default");
 expect(getTermOverrides()["zh-CN"]?.director?.sidebar).toBeUndefined();
});
it("legacy Maid migration retains explicit hidden and custom role labels", () => {
 const old = { en: { agent:{one:"Maid",many:"Maids"}, subagent:{one:"Maidling",many:"Maidlings"}, parentagent:{one:"Head Maid",many:"Head Maids"},director:{one:"Chief Maid",many:"Chief Maids",sidebar:""},owner:{one:"Master",many:"Masters"},operator:{sidebar:"DM"} } };
 const migrated = migrateMaidTerms(old);
 expect(resolveSidebarRoleLabel(migrated, "en", "director")).toBe("");
 expect(resolveSidebarRoleLabel(migrated, "en", "operator")).toBe("DM");
});
