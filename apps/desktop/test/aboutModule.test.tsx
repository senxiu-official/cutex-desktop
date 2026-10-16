// Settings → 关于 (about module): the page shows the desktop version, the license and project links, and
// every known issue (mirrored from docs/KNOWN-ISSUES.md) has zh-CN and en strings.
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
const { KNOWN_ISSUES, ABOUT_LINKS } = await import("../src/renderer/src/modules/about/knownIssues");
const { zhCN } = await import("../src/renderer/src/i18n/zh-CN");
const { en } = await import("../src/renderer/src/i18n/en");
const about = (await import("../src/renderer/src/modules/about")).default;

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

  it("lists every known issue with its fix-version badge", () => {
    for (const issue of KNOWN_ISSUES) {
      expect(html).toContain(`data-issue="${issue.id}"`);
      expect(html).toContain(issue.titleKey);
      expect(html).toContain(issue.bodyKey);
      if (issue.fixedIn) expect(html).toContain(`about.fixedIn(${issue.fixedIn})`);
    }
    expect(new Set(KNOWN_ISSUES.map((i) => i.id)).size).toBe(KNOWN_ISSUES.length);
  });

  it("every known issue has zh-CN and en strings", () => {
    const zh = zhCN as Record<string, string>;
    const enMap = en as Record<string, string>;
    for (const issue of KNOWN_ISSUES) {
      for (const key of [issue.titleKey, issue.bodyKey, issue.workaroundKey].filter(Boolean) as string[]) {
        expect(zh[key]?.trim(), `zh-CN ${key}`).toBeTruthy();
        expect(enMap[key]?.trim(), `en ${key}`).toBeTruthy();
        expect(zh[key], key).not.toBe(enMap[key]);
      }
    }
  });

  it("mirrors docs/KNOWN-ISSUES.md: one heading per entry, same count", () => {
    const doc = readFileSync(join(__dirname, "../../../docs/KNOWN-ISSUES.md"), "utf8");
    expect(doc.match(/^## /gm)?.length).toBe(KNOWN_ISSUES.length);
  });

  it("is a required module placing its sections on the shell's 关于 page", () => {
    expect(about.required).toBe(true);
    expect(about.contributes?.["settings.section"]?.map((s) => s.page)).toEqual(["about", "about"]);
  });
});
