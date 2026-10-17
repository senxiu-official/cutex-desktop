// Settings → 外观 → 启动页立绘 with the preview's mock bridge (dev/mockLaunchArt.ts): per-provider source
// labels, the import / clear buttons, and the store update after an import or a clear.
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({ state: { daemon: { kind: "disconnected" }, hosts: null } as Record<string, unknown> }));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string, p?: Record<string, unknown>) => (p ? `${key}(${Object.values(p).join(",")})` : key), locale: "en" }),
}));
vi.mock("../src/renderer/src/store", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useApp: Object.assign((select: (s: unknown) => unknown) => select(fx.state), { getState: () => fx.state, setState: () => {}, subscribe: () => () => {} }),
}));

const g = globalThis as { cutex?: unknown; location?: unknown };
let section: typeof import("../src/renderer/src/components/settings/LaunchArtSettings");
let art: typeof import("../src/renderer/src/lib/launchArt");
beforeAll(async () => {
  g.location ??= { search: "?launchart=imported" };
  const { mockLaunchArt } = await import("../src/renderer/src/dev/mockLaunchArt");
  g.cutex = { launchArt: mockLaunchArt() };
  section = await import("../src/renderer/src/components/settings/LaunchArtSettings");
  art = await import("../src/renderer/src/lib/launchArt");
});

const sources = (html: string) => Object.fromEntries([...html.matchAll(/data-launch-art-source="(\w+)"/g)].map((m, i) => [i, m[1]]));

describe("LaunchArtSection", () => {
  it("lists every provider with its source and the two buttons", async () => {
    await art.importLaunchArt();
    const html = renderToStaticMarkup(h(section.LaunchArtSection));
    expect(html).toContain("appearance.launchArt.import");
    expect(html).toContain("appearance.launchArt.clear");
    expect(html).toContain(art.LAUNCH_ART_FILES.kimi.portrait);
    // Provider order of LAUNCH_ART_FILES: codex, claude, deepseek, kimi, glm, gemini. A checkout may bundle art.
    const fallback = (p: keyof typeof art.LAUNCH_ART_FILES) => (art.BUNDLED_LAUNCH_ART[p] ? "bundled" : "none");
    expect(sources(html)).toEqual({ 0: fallback("codex"), 1: "imported", 2: fallback("deepseek"), 3: "imported", 4: fallback("glm"), 5: fallback("gemini") });
  });

  it("falls back after 清除", async () => {
    await art.clearLaunchArt();
    const html = renderToStaticMarkup(h(section.LaunchArtSection));
    const providers = Object.keys(art.LAUNCH_ART_FILES) as (keyof typeof art.LAUNCH_ART_FILES)[];
    expect(Object.values(sources(html))).toEqual(providers.map((p) => (art.BUNDLED_LAUNCH_ART[p] ? "bundled" : "none")));
    // 清除 is disabled with nothing imported.
    expect(html).toMatch(/<button disabled=""[^>]*>appearance\.launchArt\.clear<\/button>/);
  });
});
