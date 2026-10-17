// Settings → 关于 (about module): the page shows the desktop version, the license and project links, and
// the built-in known issues (docs/known-issues.json, mirrored by docs/KNOWN-ISSUES.md) with zh-CN and en
// strings. The fetched list (shared/knownIssues.ts, main/knownIssues.ts) is covered in knownIssues.test.ts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({ opened: [] as string[], state: { daemon: { kind: "disconnected" }, hosts: null } as Record<string, unknown> }));

vi.mock("../src/renderer/src/bridge", () => ({
  api: { openExternal: (url: string) => void fx.opened.push(url), capabilities: () => Promise.resolve(null) },
  bridge: {},
  onEvent: () => () => {},
  cleanIpcMessage: (m: string) => m,
}));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string, p?: Record<string, unknown>) => (p ? `${key}(${Object.values(p).join(",")})` : key), locale: "en" }),
}));
vi.mock("../src/renderer/src/store", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useApp: Object.assign((select: (s: unknown) => unknown) => select(fx.state), { getState: () => fx.state, setState: () => {}, subscribe: () => () => {} }),
}));
vi.mock("../src/renderer/src/lib/update", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useUpdateStatus: () => ({ state: "idle", current: { commit: "abcdef1234567", committedAt: "2026-10-16T09:30:00Z", version: "0.1.2" } }),
}));
vi.mock("../src/renderer/src/lib/runtimePackagesView", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useHostRuntimePackages: () => null,
  useOutdatedAgentCount: () => 0,
}));
vi.mock("../src/renderer/src/lib/runtimePackageStore", async (importOriginal) => ({ ...(await importOriginal<object>()), refreshRuntimePackages: () => Promise.resolve() }));
vi.mock("../src/renderer/src/components/settings/AboutDragon", () => ({ AboutDragon: () => null }));
// The page places the module's sections through the slot outlet; here they are rendered directly.
vi.mock("../src/renderer/src/modules/Outlet", async () => {
  const { AboutLinksSection, KnownIssuesSection } = await import("../src/renderer/src/modules/about/AboutSections");
  return { SettingsSections: ({ page }: { page: string }) => (page === "about" ? h("div", null, h(AboutLinksSection), h(KnownIssuesSection)) : null) };
});

const { AboutPage } = await import("../src/renderer/src/components/settings/AppSettings");
const { BUNDLED_KNOWN_ISSUES, ABOUT_LINKS } = await import("../src/renderer/src/modules/about/knownIssues");
const { parseKnownIssues } = await import("../src/shared/knownIssues");
const { applyTerms, DEFAULT_TERMS } = await import("../src/renderer/src/lib/terms");
const about = (await import("../src/renderer/src/modules/about")).default;

const root = join(__dirname, "../../..");
const json = JSON.parse(readFileSync(join(root, "docs/known-issues.json"), "utf8")) as { issues: unknown[] };
const en = (s: string) => applyTerms(s, DEFAULT_TERMS.en, "en");
const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

describe("about module", () => {
  const html = renderToStaticMarkup(h(AboutPage));

  it("shows the desktop version, the license and every project link", () => {
    expect(html).toContain("0.1.2 · abcdef1");
    expect(html).toContain("Apache-2.0");
    for (const link of ABOUT_LINKS) {
      expect(html).toContain(`title="${link.url}"`);
      expect(link.url.startsWith("https://github.com/senxiu-official/cutex-desktop")).toBe(true);
    }
    expect(ABOUT_LINKS.find((l) => l.id === "knownIssues")?.url).toBe("https://github.com/senxiu-official/cutex-desktop/blob/release/docs/KNOWN-ISSUES.md");
  });

  it("lists every built-in known issue (no fetched list yet) with its fix-version badge", () => {
    expect(html).toContain('data-known-issues-source="builtin"');
    expect(html).toContain("about.sourceBuiltin");
    for (const issue of BUNDLED_KNOWN_ISSUES.issues) {
      expect(html).toContain(`data-issue="${issue.id}"`);
      expect(html).toContain(escape(en(issue.title.en)));
      expect(html).toContain(escape(en(issue.body.en)));
      if (issue.fixedIn) expect(html).toContain(`about.fixedIn(${issue.fixedIn})`);
    }
    // Term tokens are filled in, never shown raw.
    expect(html).not.toContain("{{");
  });

  it("bundles docs/known-issues.json whole: every entry valid, zh-CN, zh-Hant-CN and en strings", () => {
    // The app imports a byte-identical copy (app code may not import outside apps/desktop).
    expect(readFileSync(join(root, "apps/desktop/src/renderer/src/modules/about/known-issues.bundled.json"), "utf8"), "copy docs/known-issues.json to modules/about/known-issues.bundled.json").toBe(readFileSync(join(root, "docs/known-issues.json"), "utf8"));
    expect(BUNDLED_KNOWN_ISSUES.issues.length).toBeGreaterThan(0);
    expect(BUNDLED_KNOWN_ISSUES.issues.length).toBe(json.issues.length);
    expect(parseKnownIssues(json)).toEqual(BUNDLED_KNOWN_ISSUES);
    for (const issue of BUNDLED_KNOWN_ISSUES.issues) {
      for (const text of [issue.title, issue.body, issue.workaround].filter((v) => !!v)) {
        expect(text!["zh-Hant-CN"], `${issue.id} zh-Hant-CN`).toBeTruthy();
        expect(text!["zh-CN"], issue.id).not.toBe(text!.en);
      }
    }
  });

  it("mirrors docs/KNOWN-ISSUES.md: same entries in the same order, same planned fix", () => {
    const doc = readFileSync(join(root, "docs/KNOWN-ISSUES.md"), "utf8");
    const sections = doc.split(/^## /m).slice(1);
    expect(sections.map((s) => s.split("\n")[0]!.trim())).toEqual(BUNDLED_KNOWN_ISSUES.issues.map((i) => en(i.title.en)));
    sections.forEach((section, n) => {
      const issue = BUNDLED_KNOWN_ISSUES.issues[n]!;
      const planned = /^- Planned fix: (.+)$/m.exec(section)?.[1] ?? "";
      if (issue.fixedIn) expect(planned, issue.id).toContain(issue.fixedIn);
      else expect(planned, issue.id).toMatch(/^not scheduled/);
      expect(/^- Workaround: none/m.test(section), issue.id).toBe(!issue.workaround);
    });
  });

  it("is a required module placing its sections on the shell's 关于 page", () => {
    expect(about.required).toBe(true);
    expect(about.contributes?.["settings.section"]?.map((s) => s.page)).toEqual(["about", "about"]);
  });
});
