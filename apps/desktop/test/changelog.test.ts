// 更新记录 (Settings → 关于): CHANGELOG.md is parsed by shared/changelog.ts and bundled as
// modules/about/changelog.bundled.json; this keeps the bundled copy current (byte-identical to a fresh
// run of scripts/bundle-changelog.mjs) and pins the parser's rules.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { changelogJson, changelogText, parseChangelog, readChangelogDoc, splitBilingual } from "../src/shared/changelog";
import { BUNDLED_CHANGELOG, initialOpen, inlineTokens, newSince } from "../src/renderer/src/modules/about/changelog";

const root = join(__dirname, "../../..");

describe("bundled changelog", () => {
  it("is current with CHANGELOG.md (run: node apps/desktop/scripts/bundle-changelog.mjs)", () => {
    const fresh = changelogJson(parseChangelog(readFileSync(join(root, "CHANGELOG.md"), "utf8")));
    const bundled = readFileSync(join(root, "apps/desktop/src/renderer/src/modules/about/changelog.bundled.json"), "utf8");
    expect(bundled, "stale: run node apps/desktop/scripts/bundle-changelog.mjs").toBe(fresh);
  });

  it("holds the released versions newest first, never Unreleased", () => {
    const versions = BUNDLED_CHANGELOG.releases.map((r) => r.version);
    expect(versions.length).toBeGreaterThan(0);
    expect(versions).toContain("0.1.0");
    expect(versions.every((v) => /^\d+\.\d+\.\d+/.test(v))).toBe(true);
    expect(BUNDLED_CHANGELOG.releases.find((r) => r.version === "0.1.0")?.title).toBe("First Take");
    expect(JSON.stringify(BUNDLED_CHANGELOG)).not.toContain("Known issues:");
  });

  // English readers get `text`. Chinese UI terms in an entry's English part (「自动」, 审批, …) must use the
  // en labels; a Chinese term there can also make splitBilingual fail, showing the whole block to everyone.
  const HAN = /\p{Script=Han}/u;
  const hanInEnglish = (r: { version: string; blocks: readonly { kind: string; text: string }[] }) =>
    r.blocks.filter((b) => HAN.test(b.text)).map((b) => `${r.version} ${b.kind}: ${b.text}`);

  it("has no Chinese in any bundled block's English text", () => {
    expect(BUNDLED_CHANGELOG.releases.flatMap(hanInEnglish)).toEqual([]);
  });

  it("has no Chinese in the English part of any ## Unreleased entry (not bundled, split the same way)", () => {
    const md = readFileSync(join(root, "CHANGELOG.md"), "utf8").replace(/\r\n?/g, "\n");
    const lines = md.split("\n");
    const start = lines.findIndex((l) => /^## Unreleased\s*$/.test(l));
    if (start < 0) return;
    const next = lines.findIndex((l, i) => i > start && l.startsWith("## "));
    const section = lines.slice(start + 1, next < 0 ? undefined : next).join("\n");
    // parseChangelog splits every block with splitBilingual; a pseudo version makes it read the section.
    const unreleased = parseChangelog(`## 0.0.0-unreleased\n${section}`).releases[0]!;
    expect(unreleased.blocks.length).toBeGreaterThan(0);
    expect(hanInEnglish({ ...unreleased, version: "Unreleased" })).toEqual([]);
  });
});

describe("parseChangelog", () => {
  const md = [
    "# Changelog",
    "",
    "## Unreleased",
    "",
    "- Work in progress. 进行中。",
    "",
    '## 1.2.0 "Name" (2026-10-20)',
    "",
    "Intro sentence for the release.",
    "版本简介。",
    "",
    "**Group**",
    "",
    "- First entry wraps",
    "  over two lines. 第一条。",
    "- English only (`code`).",
    "",
    "Known issues: [doc](https://example.invalid) (also in Settings). 已知问题。",
    "",
    "## 1.1.0 (2026-10-01)",
    "",
    "- Fix. 修复。",
  ].join("\n");
  const doc = parseChangelog(md);

  it("reads sections, intros, groups and wrapped items; drops Unreleased and the known-issues pointer", () => {
    expect(doc.releases.map((r) => [r.version, r.title, r.date])).toEqual([
      ["1.2.0", "Name", "2026-10-20"],
      ["1.1.0", undefined, "2026-10-01"],
    ]);
    expect(doc.releases[0]!.blocks).toEqual([
      { kind: "text", text: "Intro sentence for the release.", zh: "版本简介。" },
      { kind: "heading", text: "Group" },
      { kind: "item", text: "First entry wraps over two lines.", zh: "第一条。" },
      { kind: "item", text: "English only (`code`)." },
    ]);
  });

  it("round-trips through the lenient reader and picks the language", () => {
    expect(readChangelogDoc(JSON.parse(changelogJson(doc)))).toEqual(doc);
    expect(readChangelogDoc({ schema: 2, releases: [] }).releases).toEqual([]);
    const b = doc.releases[1]!.blocks[0]!;
    expect(changelogText(b, "zh-CN")).toBe("修复。");
    expect(changelogText(b, "zh-Hant-CN")).toBe("修复。");
    expect(changelogText(b, "en-AU")).toBe("Fix.");
  });
});

describe("splitBilingual", () => {
  it("splits an English sentence followed by a Chinese one", () => {
    expect(splitBilingual("An invalid certificate is still refused. 内置浏览器的 HTTPS 网页可以正常打开了。")).toEqual({ en: "An invalid certificate is still refused.", zh: "内置浏览器的 HTTPS 网页可以正常打开了。" });
    expect(splitBilingual("Older cutex: nothing changes. Claude Profile 可读取 Claude Code 项目和账号设置，权限菜单显示实际使用的设置来源。")).toEqual({ en: "Older cutex: nothing changes.", zh: "Claude Profile 可读取 Claude Code 项目和账号设置，权限菜单显示实际使用的设置来源。" });
  });

  it("keeps English that quotes Chinese UI terms in the English part", () => {
    const r = splitBilingual("「暂停智能体」 is its own button; 「继续」 resumes with one click. 共享标签：暂停与撤销分开。");
    expect(r.zh).toBe("共享标签：暂停与撤销分开。");
    const s = splitBilingual("gets its own id: 「ABC中文一」 and 「ABC中文二」 no longer clash as `abc`. 中文项目名不再冲突。");
    expect(s.zh).toBe("中文项目名不再冲突。");
    const t = splitBilingual("The menu's 「在线空闲不收起」 moved under 侧栏显示 ›. 收起的不再自己展开。");
    expect(t.zh).toBe("收起的不再自己展开。");
  });

  it("leaves English-only and Chinese-only text whole", () => {
    expect(splitBilingual("Chinese and English UI, plus AI translations.")).toEqual({ en: "Chinese and English UI, plus AI translations." });
    expect(splitBilingual("只有中文。没有英文。")).toEqual({ en: "只有中文。没有英文。" });
  });
});

describe("changelog view helpers", () => {
  const releases = [{ version: "0.1.3", blocks: [] }, { version: "0.1.2", blocks: [] }, { version: "0.1.1", blocks: [] }];
  it("marks versions newer than the last seen one (none without a baseline)", () => {
    expect([...newSince(releases, "0.1.1")]).toEqual(["0.1.3", "0.1.2"]);
    expect([...newSince(releases, null)]).toEqual([]);
    expect([...newSince(releases, "garbage")]).toEqual([]);
  });
  it("opens the installed version first, else the newest", () => {
    expect(initialOpen(releases, "0.1.2")).toBe("0.1.2");
    expect(initialOpen(releases, "9.9.9")).toBe("0.1.3");
    expect(initialOpen([], null)).toBeNull();
  });
  it("tokenises inline code, bold and links (label only)", () => {
    expect(inlineTokens("Use `x` and **y** via [the doc](https://e.invalid).")).toEqual([
      { kind: "text", text: "Use " },
      { kind: "code", text: "x" },
      { kind: "text", text: " and " },
      { kind: "bold", text: "y" },
      { kind: "text", text: " via " },
      { kind: "text", text: "the doc" },
      { kind: "text", text: "." },
    ]);
  });
});
