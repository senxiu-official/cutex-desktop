// Settings search lands where Settings renders (review UI-03): the index (lib/settingsSearchView
// settingsSearchDocs) and SettingsSections (modules/Outlet) share lib/settingsGate. Built from the real
// module declarations and catalogs, for zh-CN and en, owner / member / pending, modern and legacy hosts.
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));

const { MODULES } = await import("../src/renderer/src/modules/registry");
const { zhCN } = await import("../src/renderer/src/i18n/zh-CN");
const { en } = await import("../src/renderer/src/i18n/en");
const { cleanText, searchSettings } = await import("../src/renderer/src/lib/settingsSearch");
const { settingsSearchDocs } = await import("../src/renderer/src/lib/settingsSearchView");
const { isSettingsHostPage, settingsCardGate, settingsPageAccess, settingsSectionGate } = await import("../src/renderer/src/lib/settingsGate");
const { entryCapabilities } = await import("../src/renderer/src/lib/hostGating");
const { USERS_FEATURE } = await import("../src/shared/users");
const { PEERS_FEATURE } = await import("../src/shared/peers");

type Target = import("../src/renderer/src/lib/settingsGate").SettingsGateTarget;
type MessageKey = import("../src/renderer/src/i18n").MessageKey;

const show = <T,>(moduleId: string, item: T) => ({ item, moduleId, mode: "show" as const, missing: [] as string[], waiting: false });
const PAGES = MODULES.flatMap((m) => (m.contributes?.["settings.page"] ?? []).map((item) => show(m.id, item)));
const SECTIONS = MODULES.flatMap((m) => (m.contributes?.["settings.section"] ?? []).map((item) => show(m.id, item)));
const capabilitiesOf = (moduleId: string, item?: { requires?: { capabilities?: readonly string[] } }) =>
  entryCapabilities(MODULES.find((m) => m.id === moduleId), item);

/** Every capability any built-in page, card or module asks for: a current host. */
const MODERN = new Set<string>([
  ...MODULES.flatMap((m) => m.requires?.capabilities ?? []),
  ...PAGES.flatMap((e) => (e.item.sections ?? []).flatMap((s) => s.requires?.capabilities ?? [])),
  ...SECTIONS.flatMap((e) => [...(e.item.requires?.capabilities ?? []), ...(e.item.sections ?? []).flatMap((s) => s.requires?.capabilities ?? [])]),
]);
const host = (features: Iterable<string>) => ({ features: new Set(features), featuresKnown: true });
const OWNER = { isOwner: true, pending: false };
const MEMBER = { isOwner: false, pending: false };
const PENDING = { isOwner: false, pending: true };

function docs(locale: "zh-CN" | "en", hostTarget: Omit<Target, "hostId">, appFeatures: Iterable<string> = MODERN) {
  const [cur, other] = locale === "en" ? [en, zhCN] : [zhCN, en];
  const fill = (s: string, vars?: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? `{${k}}`));
  return settingsSearchDocs({
    pages: PAGES,
    sections: SECTIONS,
    text: (key: MessageKey) => ({ current: cleanText(cur[key]), other: cleanText(other[key]) }),
    t: (key: MessageKey, vars) => fill(cur[key], vars),
    hostTarget: { hostId: "host-a", ...hostTarget },
    appTarget: { hostId: null, host: host(appFeatures), access: null },
    hostLabel: "host-a",
    capabilitiesOf,
  });
}

/** First result group, and its first available section anchor. */
function top(all: ReturnType<typeof docs>, query: string) {
  const groups = searchSettings(all, query);
  const g = groups[0];
  return { page: g?.page, anchor: g?.sections.find((h) => !h.doc.disabled)?.doc.anchor ?? null, groups };
}

const anchors = (all: ReturnType<typeof docs>) => all.filter((d) => d.anchor && !d.disabled).map((d) => `${d.page}#${d.anchor}`);

describe("settings search: model accounts, devices and peers (owner, current host)", () => {
  const modern = { host: host(MODERN), access: OWNER };

  it.each(["zh-CN", "en"] as const)("%s: API key / 密钥 / 登录 / login find Profiles first", (locale) => {
    const all = docs(locale, modern);
    for (const q of ["API key", "密钥", "登录", "login"]) expect(top(all, q).page, q).toBe("profiles");
    // The identity key is still found (under 你), just after the model account.
    expect(searchSettings(all, "密钥").map((g) => g.page)).toContain("me");
  });

  it.each(["zh-CN", "en"] as const)("%s: 设备 / devices land on 用户 › 设备, 对端 / peers on 用户 › 对端主机", (locale) => {
    const all = docs(locale, modern);
    for (const q of ["设备", "devices"]) expect(top(all, q), q).toMatchObject({ page: "users", anchor: "users-devices" });
    for (const q of ["对端", "linked hosts"]) expect(top(all, q), q).toMatchObject({ page: "users", anchor: "users-peers" });
    const peers = searchSettings(all, "peers").find((g) => g.page === "users");
    expect(peers?.sections.map((h) => h.doc.anchor)).toContain("users-peers");
    // The users module's section is found by its cards, not as one more 「用户」 result.
    expect(anchors(all)).not.toContain("users#users.manage");
    expect(anchors(all)).not.toContain("users#users-own-devices");
  });
});

describe("settings search follows the connection's role on the settings host", () => {
  it.each(["zh-CN", "en"] as const)("%s member: own devices instead of the owner's lists; host pages greyed with the reason", (locale) => {
    const all = docs(locale, { host: host(MODERN), access: MEMBER });
    for (const q of ["设备", "devices"]) expect(top(all, q), q).toMatchObject({ page: "users", anchor: "users-own-devices" });
    for (const a of ["users#users-devices", "users#users-peers", "users#users-list"]) expect(anchors(all)).not.toContain(a);
    const profiles = all.find((d) => d.page === "profiles" && d.anchor === null)!;
    expect(profiles.disabled).toContain("host-a");
    // Nothing under a host page other than 用户 can be opened.
    expect(all.filter((d) => d.page !== "users" && d.disabled === null && ["profiles", "defaults", "runtime", "collab"].includes(d.page))).toEqual([]);
  });

  it("pending: neither own devices nor the owner's lists", () => {
    const all = docs("zh-CN", { host: host(MODERN), access: PENDING });
    expect(anchors(all).filter((a) => a.startsWith("users#"))).toEqual(["users#users-me"]);
    expect(all.find((d) => d.page === "profiles" && d.anchor === null)!.disabled).toBeTruthy();
  });
});

describe("settings search on a legacy settings host (a current focus host in the scope)", () => {
  it.each(["zh-CN", "en"] as const)("%s: no result leads to a card the page leaves out", (locale) => {
    const all = docs(locale, { host: host([]), access: OWNER });
    // The users module needs `users`: its cards are gone, not a dead link.
    for (const a of ["users#users-devices", "users#users-peers", "users#users-list", "users#users.manage"]) expect(all.some((d) => `${d.page}#${d.anchor}` === a)).toBe(false);
    // Every enabled host-page card passes the same gate SettingsSections / the page applies.
    for (const d of all.filter((x) => x.anchor && !x.disabled)) {
      const section = SECTIONS.find((e) => e.item.page === d.page && e.item.id === d.anchor);
      const page = PAGES.find((e) => e.item.page === d.page)!;
      const onHost = isSettingsHostPage(page.item) ? { hostId: "host-a", host: host([]), access: OWNER } : null;
      if (section) expect(settingsSectionGate(section, capabilitiesOf(section.moduleId, section.item), onHost).kind, d.anchor!).toBe("show");
    }
    // Profiles stays usable (its account keywords too).
    expect(top(all, "API key").page).toBe("profiles");
  });

  it("users without peers-v2: devices yes, linked hosts no", () => {
    const all = docs("en", { host: host([...MODERN].filter((c) => c !== PEERS_FEATURE)), access: OWNER });
    expect(anchors(all)).toContain("users#users-devices");
    expect(anchors(all)).not.toContain("users#users-peers");
  });

  it("capabilities still loading: the host's gated cards wait (left out)", () => {
    const all = docs("en", { host: { features: new Set(), featuresKnown: false }, access: OWNER });
    expect(anchors(all)).not.toContain("users#users-devices");
    expect(all.some((d) => d.page === "users" && d.anchor === null)).toBe(true);
  });
});

describe("mixed pages: the host part follows the Settings target, not the focus host", () => {
  it("notifications: the target's capabilities and owner decide the host cards; 本设备 stays", () => {
    const legacy = docs("en", { host: host([]), access: OWNER }, MODERN);
    const levels = legacy.find((d) => d.page === "notifications" && d.anchor === "levels");
    expect(levels?.disabled).toBeTruthy(); // the page shows 「需要升级 cutex」 there
    expect(anchors(legacy)).toContain("notifications#device");
    expect(anchors(legacy)).toContain("notifications#newAgentLevel");
    const member = docs("en", { host: host(MODERN), access: MEMBER }, MODERN);
    for (const a of ["notifications#levels", "notifications#newAgentLevel", "notifications#mute"]) expect(member.some((d) => `${d.page}#${d.anchor}` === a), a).toBe(false);
    expect(anchors(member)).toContain("notifications#device");
    // Its settings.section items (owner-notify) render in the host part: gone for a member.
    expect(member.some((d) => d.page === "notifications" && d.anchor === "owner-notify.settings")).toBe(false);
    const modern = docs("en", { host: host(MODERN), access: OWNER }, []);
    expect(anchors(modern)).toContain("notifications#levels");
    expect(anchors(modern)).toContain("notifications#owner-notify.settings");
  });

  it("an offline / unread target keeps its pages findable (they open showing the host's state)", () => {
    const all = docs("zh-CN", { host: null, access: OWNER });
    expect(all.find((d) => d.page === "profiles" && d.anchor === null)?.disabled).toBeNull();
    expect(top(all, "API key").page).toBe("profiles");
    expect(anchors(all)).not.toContain("users#users-devices");
  });
});

describe("lib/settingsGate", () => {
  const entry = (unavailable?: "hide" | "notice") => ({ mode: "show" as const, missing: [], waiting: false, item: { unavailable, titleKey: "users.list" as MessageKey } });
  const target = (features: string[] | null, access = OWNER): Target => ({ hostId: "h", host: features ? host(features) : null, access });

  it("settingsSectionGate: target capabilities, notice vs hide, loading, owner only, app pages", () => {
    expect(settingsSectionGate(entry(), [USERS_FEATURE], target([USERS_FEATURE]))).toEqual({ kind: "show" });
    expect(settingsSectionGate(entry(), [USERS_FEATURE], target([]))).toEqual({ kind: "hidden" });
    expect(settingsSectionGate(entry("notice"), [USERS_FEATURE], target([]))).toEqual({ kind: "notice", missing: [USERS_FEATURE] });
    expect(settingsSectionGate(entry("notice"), [USERS_FEATURE], target(null))).toEqual({ kind: "hidden" });
    expect(settingsSectionGate(entry(), [USERS_FEATURE], target([USERS_FEATURE], MEMBER))).toEqual({ kind: "hidden" });
    expect(settingsSectionGate(entry(), [USERS_FEATURE], null)).toEqual({ kind: "show" });
    expect(settingsSectionGate({ ...entry("notice"), mode: "notice", missing: ["x"] }, ["x"], null)).toEqual({ kind: "notice", missing: ["x"] });
    expect(settingsSectionGate({ ...entry("notice"), mode: "notice", missing: [], waiting: true }, ["x"], null)).toEqual({ kind: "hidden" });
  });

  it("settingsCardGate: access, hiddenWith, requires", () => {
    const t = { host: host(["a"]), access: OWNER };
    expect(settingsCardGate({ access: "member" }, t).kind).toBe("hidden");
    expect(settingsCardGate({ access: "member" }, { ...t, access: MEMBER }).kind).toBe("show");
    expect(settingsCardGate({ access: "member" }, { ...t, access: PENDING }).kind).toBe("hidden");
    expect(settingsCardGate({ access: "owner" }, { ...t, access: MEMBER }).kind).toBe("hidden");
    expect(settingsCardGate({ access: "owner" }, { ...t, access: null }).kind).toBe("show");
    expect(settingsCardGate({ hiddenWith: { capabilities: ["a"] } }, t).kind).toBe("hidden");
    expect(settingsCardGate({ requires: { capabilities: ["b"] } }, t)).toEqual({ kind: "notice", missing: ["b"] });
  });

  it("settingsPageAccess: host pages are the owner's, 用户 is everyone's, app pages always", () => {
    expect(settingsPageAccess({ page: "profiles", source: "host" }, MEMBER)).toBe("notOwner");
    expect(settingsPageAccess({ page: "profiles", source: "host" }, PENDING)).toBe("pending");
    expect(settingsPageAccess({ page: "users", source: "host" }, MEMBER)).toBe("ok");
    expect(settingsPageAccess({ page: "general", source: "local" }, MEMBER)).toBe("ok");
    expect(settingsPageAccess({ page: "profiles", source: "host" }, null)).toBe("ok");
  });
});
