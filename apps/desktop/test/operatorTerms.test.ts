import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { applyTerms, DEFAULT_TERMS, TERM_IDS, TERM_LOCALES, resolveTerms, type TermOverrides } from "../src/renderer/src/lib/terms";
import { termPresets, presetOverrides, currentTermPreset } from "../src/renderer/src/lib/termPresets";
import { migrateMaidTerms } from "../src/renderer/src/lib/termPresetMigration";
import { APP_LOCALES } from "../src/shared/locales";

it("defines independent singular and plural operator terms in every shipped locale", () => {
  expect(TERM_IDS).toContain("operator");
  expect(TERM_LOCALES).toEqual(APP_LOCALES);
  for (const locale of TERM_LOCALES) {
    const terms = DEFAULT_TERMS[locale];
    expect(terms.operator.one.length).toBeGreaterThan(0);
    expect(terms.operator.many.length).toBeGreaterThan(0);
    expect(applyTerms("{{operator}} / {{operators}}", terms, locale)).toBe(`${terms.operator.one} / ${terms.operator.many}`);
  }
  expect(DEFAULT_TERMS["zh-CN"].operator).toEqual({ one: "副主管", many: "副主管" });
  expect(DEFAULT_TERMS["zh-Hant-CN"].operator.one).toBe("副主管");
  expect(DEFAULT_TERMS.en.operator).toEqual({ one: "operator", many: "operators" });
  expect(DEFAULT_TERMS["en-AU"].operator).toEqual(DEFAULT_TERMS.en.operator);
  expect(applyTerms("{{An operator}} / {{Operators}}", DEFAULT_TERMS.en, "en")).toBe("An operator / Operators");
});

it("applies operator in every preset and keeps Mentor Maid distinct from Chief Maid", () => {
  for (const locale of TERM_LOCALES) for (const preset of termPresets(locale)) {
    const terms = resolveTerms(presetOverrides(locale, preset), locale);
    expect(terms.operator.one).toBeTruthy();
    if (preset.id !== "default") expect(preset.terms.operator).toBeDefined();
    if (preset.id === "maid") {
      expect(terms.operator).toEqual({ one: "Deputy Maid", many: locale.startsWith("zh") ? "Deputy Maid" : "Deputy Maids" });
      expect(terms.parentagent.one).toBe("Mentor Maid");
      expect(terms.director.one).toBe("Chief Maid");
    }
  }
});

it("migrates the complete old Maid signature while preserving unrelated overrides", () => {
  const old: TermOverrides = { en: { agent: { one: "Maid", many: "Maids" }, subagent: { one: "Maidling", many: "Maidlings" }, parentagent: { one: "Head Maid", many: "Head Maids" }, director: { one: "Chief Maid", many: "Chief Maids" }, owner: { one: "Master", many: "Masters" }, shelf: { one: "Desk", many: "Desks" } }, "zh-CN": { parentagent: { one: "Head Maid" } } };
  const migrated = migrateMaidTerms(old);
  expect(migrated.en?.parentagent).toEqual({ one: "Mentor Maid", many: "Mentor Maids" });
  expect(migrated.en?.operator).toEqual({ one: "Deputy Maid", many: "Deputy Maids" });
  expect(migrated.en?.shelf).toEqual(old.en?.shelf);
  expect(migrated["zh-CN"]).toBe(old["zh-CN"]);
  expect(old.en?.parentagent?.one).toBe("Head Maid");
  expect(currentTermPreset("en", migrated)).toBe("maid");
  expect(migrateMaidTerms(migrated)).toBe(migrated);
  expect(migrateMaidTerms({ en: { ...old.en, operator: { one: "Deputy", many: "Deputies" } } }).en?.operator).toEqual({ one: "Deputy", many: "Deputies" });
  expect(migrateMaidTerms({ en: { ...old.en, owner: { one: "Custom", many: "Customs" } } }).en?.parentagent?.one).toBe("Head Maid");
});

it("contains no hard-coded visible Operator labels outside the term table", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../src/renderer/src");
  const bad: string[] = [];
  function scan(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) { if (entry.name !== "dev") scan(path); continue; }
      if (!/\.tsx?$/.test(entry.name) || ["terms.ts", "mock.ts"].includes(entry.name)) continue;
      const prose = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "").replace(/\{\{[^}]+\}\}/g, "");
      if (/\bOperators?\b/.test(prose)) bad.push(path.slice(root.length + 1));
    }
  }
  scan(root);
  expect(bad).toEqual([]);
});
