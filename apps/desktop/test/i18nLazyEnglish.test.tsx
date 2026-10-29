// @vitest-environment jsdom
// en loads on demand (0.2.0 beta perf audit follow-up, 2026-10-24): only zh-CN is in the entry chunk. The zh UI's
// English search aliases (Settings search, slash commands) arrive with the en catalog; a search typed before then
// finds the English names once it has arrived, and nothing in the entry chunk imports an en / other-locale table.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
localStorage.setItem("cutex-desktop.locale", "zh-CN");

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
const { MODULES } = await import("../src/renderer/src/modules/registry");
const { entryCapabilities } = await import("../src/renderer/src/lib/hostGating");
const show = <T,>(moduleId: string, item: T) => ({ item, moduleId, mode: "show" as const, missing: [] as string[], waiting: false });
const PAGES = MODULES.flatMap((m) => (m.contributes?.["settings.page"] ?? []).map((item) => show(m.id, item)));
const SECTIONS = MODULES.flatMap((m) => (m.contributes?.["settings.section"] ?? []).map((item) => show(m.id, item)));
const ALL = new Set<string>([...MODULES.flatMap((m) => m.requires?.capabilities ?? []), ...SECTIONS.flatMap((e) => e.item.requires?.capabilities ?? [])]);
const TARGET = { hostId: "host-a", host: { features: ALL, featuresKnown: true }, access: { isOwner: true, pending: false } };
const STATUSES = new Map();
vi.mock("../src/renderer/src/modules/app", () => ({ appModules: () => ({ modules: MODULES, isEnabled: () => true }) }));
vi.mock("../src/renderer/src/modules/react", async (orig) => ({
  ...(await orig<object>()),
  useSlot: (id: string) => (id === "settings.page" ? PAGES : SECTIONS),
  useModuleStatuses: () => STATUSES,
}));
vi.mock("../src/renderer/src/lib/settingsHost", async (orig) => ({ ...(await orig<object>()), useSettingsHost: () => "host-a" }));
vi.mock("../src/renderer/src/lib/settingsGateView", async (orig) => ({ ...(await orig<object>()), useSettingsGateTarget: () => TARGET }));
vi.mock("../src/renderer/src/lib/useHostScope", async (orig) => ({ ...(await orig<object>()), useHostScope: () => ({ host: () => undefined }) }));
vi.mock("../src/renderer/src/lib/hostGatingView", async (orig) => ({
  ...(await orig<object>()),
  capabilitiesOf: (moduleId: string, item?: { requires?: { capabilities?: readonly string[] } }) => entryCapabilities(MODULES.find((m) => m.id === moduleId), item),
}));

const i18n = await import("../src/renderer/src/i18n");
const { useSettingsSearchIndex } = await import("../src/renderer/src/lib/settingsSearchView");
const { searchSettings } = await import("../src/renderer/src/lib/settingsSearch");

let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("en on demand (i18n)", () => {
  it("is not loaded at start for a zh-CN UI; useEnglishCatalog(false) does not load it", async () => {
    expect(i18n.englishCatalog()).toBeUndefined();
    function Idle() {
      return h("i", null, i18n.useEnglishCatalog(false) ? "en" : "none");
    }
    await act(async () => root.render(h(i18n.I18nProvider, null, h(Idle))));
    await act(async () => void (await new Promise((r) => setTimeout(r, 50))));
    expect(host.textContent).toBe("none");
    expect(i18n.englishCatalog()).toBeUndefined();
  });

  it("Settings search: an English query typed before en arrived finds its page once it has", async () => {
    const seen: string[][] = [];
    function Search({ q }: { q: string }) {
      const docs = useSettingsSearchIndex();
      const pages = searchSettings(docs, q).map((g) => g.page);
      seen.push(pages);
      return h("i", null, pages.join(","));
    }
    await act(async () => root.render(h(i18n.I18nProvider, null, h(Search, { q: "login" }))));
    // The first render had only the zh-CN texts: 登录, not "login".
    expect(seen[0]).not.toContain("profiles");
    await act(async () => i18n.loadEnglish());
    await act(async () => void (await new Promise((r) => setTimeout(r, 0))));
    expect(i18n.englishCatalog()).toBeDefined();
    expect(seen.at(-1)![0]).toBe("profiles");
    // zh still matches as before.
    await act(async () => root.render(h(i18n.I18nProvider, null, h(Search, { q: "登录" }))));
    expect(seen.at(-1)![0]).toBe("profiles");
  });

  it("an en UI loads en before its first render (no zh-CN text first)", async () => {
    // A fresh module graph with en saved: the provider renders nothing until en has arrived.
    vi.resetModules();
    localStorage.setItem("cutex-desktop.locale", "en");
    const fresh = await import("../src/renderer/src/i18n");
    const texts: string[] = [];
    function Title() {
      const { t } = fresh.useI18n();
      texts.push(t("app.name") + "|" + t("modules.retry"));
      return null;
    }
    await act(async () => root.render(h(fresh.I18nProvider, null, h(Title))));
    await act(async () => fresh.startLocaleReady);
    await act(async () => void (await new Promise((r) => setTimeout(r, 0))));
    expect(texts.length).toBeGreaterThan(0);
    for (const s of texts) expect(s).toBe("Cutex|Retry");
    localStorage.setItem("cutex-desktop.locale", "zh-CN");
  });
});

describe("the entry chunk has no en / other-locale tables (source)", () => {
  const SRC = join(__dirname, "../src/renderer/src");
  // Files the lazy catalogs reach (modules/*/locales.<loc>.ts only through their i18n.locales.ts); everything else is
  // (or may be) in the entry chunk.
  const LAZY = /(^|\/)(i18n\/(?!index\.tsx|zh-CN\.ts|trayCatalog\.ts|gestureCatalog\.ts)[^/]+|modules\/i18nCatalog(En|Locales)\.ts|modules\/.+\.(en|locales)\.ts|modules\/[^/]+\/locales\.[^/]+\.ts)$/;
  const files: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) && !/[\\/]dev[\\/]/.test(p)) files.push(p);
    }
  };
  walk(SRC);
  it.each(files.map((f) => [relative(SRC, f).replace(/\\/g, "/"), f]).filter(([rel]) => !LAZY.test(rel!)))("%s imports no en / locale table statically", (_rel, file) => {
    const text = readFileSync(file!, "utf8");
    for (const m of text.matchAll(/^\s*import\s+(?!type\b)[^;]*?from\s+"([^"]+)"/gm)) {
      const spec = m[1]!;
      expect(spec, spec).not.toMatch(/(^|\/)(en|en-AU|de-DE|es-ES|fr-FR|it-IT|ja-JP|ko-KR|pt-BR|ru-RU|zh-Hant-CN)$|\.(en|locales)$|i18nCatalog(En|Locales)$/);
    }
  });
});
