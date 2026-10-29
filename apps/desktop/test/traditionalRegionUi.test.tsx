// @vitest-environment jsdom
import { act, createElement as h, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MenuAction, MenuEntry } from "../src/renderer/src/lib/contextMenu";

function staticSubmenu(entries: MenuAction["submenu"]): MenuEntry[] {
  expect(Array.isArray(entries)).toBe(true);
  if (!Array.isArray(entries)) throw new Error("Expected a static submenu fixture");
  return entries;
}
const env = vi.hoisted(() => ({ locale: "en", calls: [] as string[], listeners: new Set<() => void>(), entries: [] as MenuEntry[] }));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({
    locale: useSyncExternalStore((l) => { env.listeners.add(l); return () => env.listeners.delete(l); }, () => env.locale),
    t: (key: string) => key === "onboarding.language.jiahaoCaption" ? "我很嘉豪。我將使用繁體中文-中國大陸。" : `${env.locale}:${key}`,
    setLocale: (value: string) => { env.locale = value; env.calls.push(value); if (value.startsWith("zh-Hant-")) localStorage.setItem("cutex-desktop.traditional-region", value.slice(-2)); for (const listener of env.listeners) listener(); },
  }),
}));
vi.mock("../src/renderer/src/bridge", () => ({ api: new Proxy({}, { get: () => async () => null }), bridge: {}, onEvent: () => () => {} }));
vi.mock("../src/renderer/src/lib/contextMenu", async (importOriginal) => ({ ...(await importOriginal<object>()), useMenuOwner: () => null, openMenuAbove: (_el: unknown, entries: MenuEntry[]) => { env.entries = entries; } }));
vi.mock("../src/renderer/src/lib/identityView", () => ({ useIdentity: () => ({ name: "Owner", role: "owner", color: "#778899", picture: null, words: { line: "identity.owner", suffix: null } }), useShellInfo: () => null }));
vi.mock("../src/renderer/src/lib/update", async (importOriginal) => ({ ...(await importOriginal<object>()), useUpdateStatus: () => null }));
vi.mock("../src/renderer/src/components/settings/TermsSettings", () => ({ TermsSection: () => null }));
vi.mock("../src/renderer/src/modules/Outlet", () => ({ SettingsSections: () => null }));
import { LanguageStep } from "../src/renderer/src/components/OnboardingSteps";
import { GeneralPage } from "../src/renderer/src/components/settings/AppSettings";
import { IdentityButton } from "../src/renderer/src/components/IdentityMenu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement; let root: Root;
beforeEach(() => { env.locale = "en"; localStorage.clear(); vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-US"]); vi.spyOn(navigator, "language", "get").mockReturnValue("en-US"); env.calls = []; env.entries = []; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });
const mount = (Component: typeof LanguageStep) => act(() => root.render(h(Component)));
const traditional = () => host.querySelector<HTMLButtonElement>('[role="radio"][lang="zh-Hant-CN"]')!;
const toggle = () => host.querySelector<HTMLButtonElement>('[role="switch"]')!;
const pickRegion = (region: string) => [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((button) => button.textContent?.endsWith(`shell.language.traditional.${region}`))!;

it("manual Traditional selection defaults on and preserves non-CN choice across on/off", () => {
  mount(LanguageStep); act(() => traditional().click());
  expect(env.locale).toBe("zh-Hant-CN"); expect(toggle().getAttribute("aria-checked")).toBe("true");
  expect(host.textContent).toContain("我很嘉豪。我將使用繁體中文-中國大陸。");
  act(() => toggle().click()); expect(env.locale).toBe("zh-Hant-TW");
  act(() => pickRegion("MO").click()); expect(env.locale).toBe("zh-Hant-MO");
  act(() => toggle().click()); expect(env.locale).toBe("zh-Hant-CN");
  act(() => toggle().click()); expect(env.locale).toBe("zh-Hant-MO");
  expect(pickRegion("CN")).toBeUndefined();
});

it.each(["HK", "MO", "TW"])("keeps first-run OS-selected %s Traditional off and preserves it", (region) => {
  env.locale = `zh-Hant-${region}`; mount(LanguageStep);
  expect(traditional().getAttribute("aria-checked")).toBe("true");
  expect(toggle().getAttribute("aria-checked")).toBe("false");
  expect(pickRegion(region).getAttribute("aria-checked")).toBe("true");
  act(() => traditional().click()); expect(env.calls).toEqual([]);
  act(() => toggle().click()); act(() => toggle().click()); expect(env.locale).toBe(`zh-Hant-${region}`);
});

it("uses the OS helper's non-CN fallback when switching off a default CN choice", () => {
  env.locale = "zh-Hant-CN"; vi.spyOn(navigator, "languages", "get").mockReturnValue(["zh-HK"]); mount(LanguageStep);
  act(() => toggle().click()); expect(env.locale).toBe("zh-Hant-HK");
});

it("keeps one Settings family option and one localized region row, with no onboarding joke", () => {
  env.locale = "zh-Hant-HK"; mount(GeneralPage);
  const selects = host.querySelectorAll<HTMLSelectElement>("select");
  expect([...selects[0]!.options].filter((option) => option.textContent === "繁體中文")).toHaveLength(1);
  expect(selects[0]!.value).toBe("zh-Hant-CN");
  expect(selects[1]!.value).toBe("HK");
  expect([...selects[1]!.options].map((option) => option.textContent)).toEqual(["CN", "HK", "MO", "TW"].map((region) => `zh-Hant-HK:shell.language.traditional.${region}`));
  expect(host.textContent).not.toContain("嘉豪");
  act(() => { selects[1]!.value = "TW"; selects[1]!.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(env.locale).toBe("zh-Hant-TW");
});

it("selects the remembered Traditional region from the Settings family entry", () => {
  localStorage.setItem("cutex-desktop.traditional-region", "MO"); mount(GeneralPage);
  const select = host.querySelector("select")!;
  act(() => { select.value = "zh-Hant-CN"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(env.locale).toBe("zh-Hant-MO");
});

it("nests four region choices in the identity language menu and checks the current region", () => {
  env.locale = "zh-Hant-TW"; mount(IdentityButton);
  act(() => host.querySelector("button")!.click());
  const language = env.entries.find((item) => item && typeof item === "object" && item.label.endsWith("identity.language"));
  if (!language || typeof language !== "object") throw Error("missing language menu");
  const family = staticSubmenu(language.submenu).find((item) => item && typeof item === "object" && item.label === "繁體中文");
  if (!family || typeof family !== "object") throw Error("missing Traditional family");
  expect(family.icon).toBeTruthy();
  const regions = staticSubmenu(family.submenu).filter((entry): entry is MenuAction => !!entry && typeof entry === "object");
  expect(regions).toHaveLength(4);
  expect(regions.map((entry) => !!entry.icon)).toEqual([false, false, false, true]);
  act(() => regions[1]!.onSelect()); expect(env.locale).toBe("zh-Hant-HK");
});
