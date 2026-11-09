import { describe, expect, it, vi } from "vitest";
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
const { MODULES } = await import("../src/renderer/src/modules/registry");
const { zhCN } = await import("../src/renderer/src/i18n/zh-CN");
const { en } = await import("../src/renderer/src/i18n/en");
const { settingsSearchDocs, settingsTermSearchTexts } = await import("../src/renderer/src/lib/settingsSearchView");
const { searchSettings, cleanText } = await import("../src/renderer/src/lib/settingsSearch");
const { settingsNavGroups } = await import("../src/renderer/src/lib/settingsNav");
const { profileSearchAnchor } = await import("../src/renderer/src/lib/settingsProfileSearch");
type Key = import("../src/renderer/src/i18n").MessageKey;
const show = <T,>(moduleId: string, item: T) => ({ item, moduleId, mode: "show" as const, missing: [], waiting: false });
const pages = MODULES.flatMap((m) => (m.contributes?.["settings.page"] ?? []).map((p) => show(m.id, p)));
const sections = MODULES.flatMap((m) => (m.contributes?.["settings.section"] ?? []).map((p) => show(m.id, p)));
const features = new Set(MODULES.flatMap((m) => [...m.requires?.capabilities ?? [], ...(m.contributes?.["settings.page"] ?? []).flatMap((p) => (p.sections ?? []).flatMap((s) => s.requires?.capabilities ?? []))]));
function index(locale: "en" | "zh-CN", owner = true, capabilities = features) {
  const [cur, other] = locale === "en" ? [en, zhCN] : [zhCN, en];
  const host = { features: capabilities, featuresKnown: true };
  return settingsSearchDocs({ pages, sections,
    text: (key: Key) => ({ current: cleanText(cur[key]), other: cleanText(other[key]) }),
    t: (key: Key) => cur[key], hostTarget: { hostId: "picked-host", host, access: { isOwner: owner, pending: false } },
    appTarget: { hostId: null, host, access: null }, hostLabel: "picked-host", capabilitiesOf: () => [],
    termKeywords: settingsTermSearchTexts({ "zh-CN": { director: { one: "领班" } }, en: { director: { one: "foreman" } } }, locale, locale === "en" ? "zh-CN" : "en"),
    moduleEntries: [{ id: "sample", title: { current: "Sample module", other: "示例模块" }, keywords: [{ current: "Original name", other: "原名" }] }],
  });
}
const anchors = (docs: ReturnType<typeof index>, query: string, page: string) => searchSettings(docs, query, 500).find((g) => g.page === page)?.sections.map((s) => s.doc.anchor) ?? [];

describe.each(["zh-CN", "en"] as const)("settings IA search %s", (locale) => {
  it.each([
    ["压缩", "profiles", "profile-models"], ["context", "profiles", "profile-models"],
    ["图片裁剪", "profiles", "profile-images"], ["autoPick", "profiles", "profile-tools"],
    ["代理", "profiles", "profile-proxy"], ["头像底色", "appearance", "avatars"],
    ["侧栏布局", "sidebar", "agentRows"],
    ["网站权限", "browser", "site-permissions"], ["origin", "browser", "site-origins"],
  ])("%s finds the visible destination %s#%s", (query, page, anchor) => {
    expect(anchors(index(locale), query, page)).toContain(anchor);
  });
  it("finds current and default terms independently", () => {
    for (const q of ["领班", "foreman", "主管", "director", "主人", "owner", "Shelf"]) expect(anchors(index(locale), q, "general"), q).toContain("terms");
  });
  it("finds module labels and their default name at the same module row", () => {
    for (const q of ["Sample module", "示例模块", "Original name"]) expect(anchors(index(locale), q, "modules"), q).toContain("module-sample");
  });
  it("uses precisely the visible navigation's page order", () => {
    expect(index(locale).filter((d) => d.anchor === null).map((d) => d.page)).toEqual(settingsNavGroups(pages, true).flatMap((g) => g.entries.map((e) => e.item.page)));
  });
  it("never enables Profile detail navigation for a member connection", () => {
    const profiles = index(locale, false).filter((d) => d.page === "profiles");
    expect(profiles.length).toBeGreaterThan(1);
    expect(profiles.every((d) => d.disabled !== null)).toBe(true);
  });
  it("disables image trimming and proxy results on hosts without the corresponding feature", () => {
    const legacy = index(locale, true, new Set());
    for (const anchor of ["profile-images", "profile-proxy"]) expect(legacy.find((d) => d.page === "profiles" && d.anchor === anchor)?.disabled).toBeTruthy();
  });
});
it("keeps legacy Profile deep links and does not treat overview sections as detail", () => {
  for (const anchor of ["account", "models", "tools", "images", "quota", "proxy", "appearance"]) {
    expect(profileSearchAnchor(anchor)).toBe(anchor);
    expect(profileSearchAnchor(`profile-${anchor}`)).toBe(anchor);
  }
  expect(profileSearchAnchor("claude-accounts")).toBeNull();
  expect(profileSearchAnchor(undefined)).toBeNull();
});
