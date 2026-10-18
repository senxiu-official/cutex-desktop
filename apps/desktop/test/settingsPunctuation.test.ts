// Settings punctuation by place (owner 2026-10-18): what a text is decides its full stop, not its grammar.
//   labels, buttons ............................ no full stop (not checked here)
//   row hints (SettingRow hint) ................ short, no full stop
//   section hints, page hints .................. sentences, end with 。 / "."
//   popover bodies (scope chips) ............... sentences, end with 。 / "."
// Hints written before the rule are listed below and fixed page by page; a listed key that already
// follows the rule fails too, so the lists only shrink.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { LEGACY_ROW_HINTS, LEGACY_SECTION_HINTS } from "./settingsPunctuation.legacy";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));

const { MODULES } = await import("../src/renderer/src/modules/registry");
const { zhCN } = await import("../src/renderer/src/i18n/zh-CN");
const { en } = await import("../src/renderer/src/i18n/en");
const zh = zhCN as Record<string, string>;
const enCat = en as Record<string, string>;

const RENDERER = fileURLToPath(new URL("../src/renderer/src/", import.meta.url));

/** Keys passed as `hint={t("…")}` to `<tag …>` in the renderer sources (attributes before it hold no JSX). */
function hintKeys(tag: string): Set<string> {
  const re = new RegExp(`<${tag}\\b[^<]*?\\bhint=\\{t\\("([^"]+)"`, "g");
  const keys = new Set<string>();
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, e.name);
      if (e.isDirectory()) walk(path);
      else if (e.name.endsWith(".tsx") && !e.name.includes(".test.") && !path.includes(`${join("src", "dev")}`)) {
        for (const m of readFileSync(path, "utf8").matchAll(re)) keys.add(m[1]!);
      }
    }
  };
  walk(RENDERER);
  return keys;
}

const zhSentence = (s: string) => s.trimEnd().endsWith("。");
const enSentence = (s: string) => /[.!?]["”']?$/.test(s.trimEnd());
const isSentence = (key: string) => zhSentence(zh[key] ?? "") && enSentence(enCat[key] ?? "");
const hasStop = (key: string) => zhSentence(zh[key] ?? "") || enSentence(enCat[key] ?? "");

describe("settings punctuation", () => {
  it("section hints are sentences", () => {
    const keys = [...hintKeys("Section")].filter((k) => k in zh);
    expect(keys.length).toBeGreaterThan(20);
    expect(keys.filter((k) => !LEGACY_SECTION_HINTS.has(k) && !isSentence(k))).toEqual([]);
    expect([...LEGACY_SECTION_HINTS].filter((k) => isSentence(k)), "fixed: remove from the legacy list").toEqual([]);
  });

  it("row hints have no full stop", () => {
    const keys = [...hintKeys("SettingRow")].filter((k) => k in zh);
    expect(keys.length).toBeGreaterThan(50);
    expect(keys.filter((k) => !LEGACY_ROW_HINTS.has(k) && hasStop(k))).toEqual([]);
    expect([...LEGACY_ROW_HINTS].filter((k) => !hasStop(k)), "fixed: remove from the legacy list").toEqual([]);
  });

  it("reviewed pages (with an agents chip) have a sentence as their page hint", () => {
    const pages = MODULES.flatMap((m) => m.contributes?.["settings.page"] ?? []).filter((p) => p.agents);
    expect(pages.length).toBeGreaterThan(0);
    for (const p of pages) {
      expect(p.hintKey, p.page).toBeTruthy();
      expect(isSentence(p.hintKey!), `${p.page}: ${zh[p.hintKey!]} / ${enCat[p.hintKey!]}`).toBe(true);
    }
  });

  it("scope chip explanations are sentences", () => {
    const keys = Object.keys(zh).filter((k) => /^settings\.scope\..+\.body$/.test(k) || k === "settings.scope.mixed");
    expect(keys.length).toBeGreaterThan(5);
    expect(keys.filter((k) => !isSentence(k))).toEqual([]);
  });
});
