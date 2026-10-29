// CJK inside monospace text (code blocks, inline code, diffs, the terminal, the file view) uses the UI's CJK
// faces by default: the mono stack ends with exactly the UI stack's CJK aliases, whatever the 外观 fonts. The app region
// (zh-CN, zh-Hant 大陆/香港/澳门/台湾, ja, en) is no input of the font plan, so it cannot split them either.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_APPEARANCE, type Appearance } from "../src/renderer/src/lib/appearanceModel";
import { buildFontPlan, FontRoutingController, uiCjkFamilies, type FontVariables, type RoutedFace } from "../src/renderer/src/lib/fontFaces";
import { FONT_UNICODE_RANGES } from "../src/renderer/src/lib/fontRanges";

const CJK_RANGE = FONT_UNICODE_RANGES.latinContext.cjk;

/** The stack's routed families, split at the first CJK-range alias. */
function split(plan: ReturnType<typeof buildFontPlan>, variable: keyof FontVariables) {
  const aliases = [...plan.variables[variable].matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
  const range = (alias: string) => plan.faces.find((face) => face.alias === alias)!.descriptors.unicodeRange;
  const first = aliases.findIndex((alias) => range(alias) === CJK_RANGE);
  const family = (alias: string) => plan.faces.find((face) => face.alias === alias)!.family;
  return { latin: aliases.slice(0, first).map(family), cjkAliases: aliases.slice(first), cjk: aliases.slice(first).map(family) };
}

// Per region the CJK face an owner would typically pick, plus the defaults and an arbitrary custom face.
const CASES: [string, Partial<Appearance>][] = [
  ["defaults (any region)", {}],
  ["zh-CN · Noto Sans SC, custom UI / mono / chat fonts", { uiFont: "Segoe UI", cjkFont: "Noto Sans SC", chatCjkFont: "KingHwa_OldSong", monoFont: "Cascadia Code" }],
  ["zh-Hant 台湾 / 香港 / 澳门 · Microsoft JhengHei", { cjkFont: "Microsoft JhengHei" }],
  ["zh-Hant 大陆 · PingFang TC", { cjkFont: "PingFang TC", uiFont: "Georgia" }],
  ["ja · Yu Gothic, custom mono", { cjkFont: "Yu Gothic", monoFont: "Sarasa Mono J" }],
  ["custom CJK serif", { cjkFont: "KingHwa_OldSong", uiFont: "Inter" }],
];

describe("monospace CJK follows the UI CJK font", () => {
  it.each(CASES)("%s: the mono stack ends with the UI stack's CJK faces, Latin mono first", (_name, patch) => {
    const appearance = { ...DEFAULT_APPEARANCE, ...patch };
    const plan = buildFontPlan(appearance, 3);
    const ui = split(plan, "--font-sans"), mono = split(plan, "--font-mono");
    expect(mono.cjk).toEqual(uiCjkFamilies(appearance));
    expect(mono.cjk).toEqual(ui.cjk);
    // The very same @font-face aliases, not merely equal family names.
    expect(mono.cjkAliases).toEqual(ui.cjkAliases);
    expect(plan.variables["--font-mono"]).toMatch(/, monospace$/);
    // Latin mono fonts stay in front (code alignment unchanged); the owner's code font leads.
    expect(mono.latin[0]).toBe(appearance.monoFont || "JetBrains Mono");
    expect(mono.latin).toContain("Consolas");
    expect(mono.latin.some((family) => uiCjkFamilies(appearance).includes(family))).toBe(false);
    if (appearance.cjkFont) expect(mono.cjk[0]).toBe(appearance.cjkFont);
  });

  it("a code CJK override leaves UI, chat and Latin code choices intact", () => {
    const appearance = { ...DEFAULT_APPEARANCE, cjkFont: "Microsoft YaHei", chatCjkFont: "SimSun" };
    const before = buildFontPlan(appearance, 1);
    const after = buildFontPlan({ ...appearance, monoCjkFont: "KingHwa_OldSong" }, 1);
    expect(split(after, "--font-mono").cjk).toEqual(["KingHwa_OldSong", ...uiCjkFamilies(DEFAULT_APPEARANCE)]);
    expect(split(after, "--font-mono").latin).toEqual(split(before, "--font-mono").latin);
    expect(after.variables["--font-sans"]).toBe(before.variables["--font-sans"]);
    expect(after.variables["--font-chat"]).toBe(before.variables["--font-chat"]);
    expect(after.requestedFamilies).toContain("KingHwa_OldSong");
  });

  it("changing and clearing only the code CJK choice republishes the shared stack", async () => {
    const published: FontVariables[] = [];
    const controller = new FontRoutingController({
      createFace: (_spec: RoutedFace) => ({ load: async () => {} }),
      add: () => {}, remove: () => {}, publish: (variables) => { published.push(variables); },
    });
    const appearance = { ...DEFAULT_APPEARANCE, cjkFont: "Microsoft YaHei" };
    await controller.update(appearance);
    await controller.update({ ...appearance, monoCjkFont: "KingHwa_OldSong" });
    await controller.update(appearance);
    expect(published).toHaveLength(3);
    expect(published.map((v) => v["--font-mono"])).toEqual([
      buildFontPlan(appearance, 1),
      buildFontPlan({ ...appearance, monoCjkFont: "KingHwa_OldSong" }, 2),
      buildFontPlan(appearance, 3),
    ].map((plan) => plan.variables["--font-mono"]));
    controller.dispose();
  });

  it("a code-font change keeps the CJK side; a 中文字体 change republishes mono with the new CJK face", async () => {
    const published: FontVariables[] = [];
    const controller = new FontRoutingController({
      createFace: (_spec: RoutedFace) => ({ load: async () => {} }),
      add: () => {}, remove: () => {}, publish: (variables) => { published.push(variables); },
    });
    await controller.update({ ...DEFAULT_APPEARANCE, monoFont: "Cascadia Code" });
    await controller.update({ ...DEFAULT_APPEARANCE, monoFont: "Cascadia Code", cjkFont: "Microsoft JhengHei" });
    expect(published).toHaveLength(2);
    const plans = [
      buildFontPlan({ ...DEFAULT_APPEARANCE, monoFont: "Cascadia Code" }, 1),
      buildFontPlan({ ...DEFAULT_APPEARANCE, monoFont: "Cascadia Code", cjkFont: "Microsoft JhengHei" }, 2),
    ];
    expect(published.map((v) => v["--font-mono"])).toEqual(plans.map((p) => p.variables["--font-mono"]));
    expect(split(plans[1]!, "--font-mono").cjk[0]).toBe("Microsoft JhengHei");
    expect(split(plans[0]!, "--font-mono").latin).toEqual(split(plans[1]!, "--font-mono").latin);
  });
});

// ---- Guard: no second hard-coded CJK family list in any monospace stack ----

const SRC = join(__dirname, "../src");
const CJK_FAMILY = /YaHei|PingFang|Hiragino|JhengHei|Yu Gothic|Meiryo|MS Gothic|MingLiU|SimSun|SimHei|Noto Sans (Mono )?CJK|Noto Sans (SC|TC|HK|JP|KR)|Source Han|Sarasa|Malgun|Apple SD Gothic/i;
const SKIP = /[\\/](dev|i18n|mockPages|test)[\\/]|[\\/]mock[^\\/]*\.ts$|\.test\.tsx?$/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(css|ts|tsx|html)$/.test(name) && !SKIP.test(path) ? [path] : [];
  });
}

describe("monospace stacks guard", () => {
  it("no monospace font stack names a CJK family of its own", () => {
    const offenders: string[] = [];
    for (const file of sources(SRC)) {
      readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        const mono = /monospace|--font-mono\s*:|\bMONO_/.test(line);
        if (!mono || !CJK_FAMILY.test(line)) return;
        const rel = relative(SRC, file).replace(/\\/g, "/");
        // The static stylesheet default: allowed only as the --font-sans CJK tail (checked below).
        if (rel === "renderer/src/styles.css" && /^\s*--font-mono\s*:/.test(line)) return;
        offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it("fontFaces.ts has exactly one built-in CJK list, used by UI and mono alike", () => {
    const text = readFileSync(join(SRC, "renderer/src/lib/fontFaces.ts"), "utf8");
    const lists = text.split("\n").filter((line) => /^const \w+ = \[/.test(line) && CJK_FAMILY.test(line));
    expect(lists).toHaveLength(1);
    expect(lists[0]).toMatch(/^const SANS_CJK = \[/);
    expect(text).not.toMatch(/MONO_CJK/);
  });

  it("the stylesheet's default --font-mono ends with the same CJK faces as its --font-sans", () => {
    const css = readFileSync(join(SRC, "renderer/src/styles.css"), "utf8");
    const stack = (name: string) => /^\s*--font-[a-z]+\s*:\s*(.*);$/m.exec(css.split("\n").find((l) => new RegExp(`^\\s*${name}\\s*:`).test(l))!)![1]!
      .split(",").map((f) => f.trim().replace(/^"|"$/g, ""));
    const cjk = (families: string[]) => families.filter((f) => CJK_FAMILY.test(f));
    const sans = stack("--font-sans"), mono = stack("--font-mono");
    expect(cjk(mono)).toEqual(cjk(sans));
    expect(cjk(mono).length).toBeGreaterThan(0);
    // CJK after every Latin mono font, right before the generic.
    expect(mono.slice(-1 - cjk(mono).length, -1)).toEqual(cjk(sans));
  });
});
