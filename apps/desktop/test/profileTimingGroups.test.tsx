// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ProfileDetail } from "../src/shared/ipc";
const env = vi.hoisted(() => ({ features: new Set(["profile-avatar-style"]), browserEnabled: true }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ locale: "en", t: (key: string) => key }) }));
vi.mock("../src/renderer/src/lib/targetHost", async original => ({ ...(await original<object>()), useTargetFeatures: () => env.features, useTargetHostId: () => "host" }));
vi.mock("../src/renderer/src/lib/profileAvatar", () => ({ useProfileAvatar: () => null }));
vi.mock("../src/renderer/src/lib/introAppearance", async (original) => ({ ...(await original<object>()), useIntroAppearanceOf: () => ({ portrait: null, greeting: null }) }));
vi.mock("../src/renderer/src/lib/launchArt", () => ({ useLaunchArt: () => ({}) }));
vi.mock("../src/renderer/src/lib/profileLooks", async (original) => ({ ...(await original<object>()), useProfileLooksSynced: () => true }));
vi.mock("../src/renderer/src/lib/avatarStyle", async (original) => ({ ...(await original<object>()), useAvatarStyleVersion: () => 0, getProfileAvatarStyle: () => null, pendingLocalProfileAvatarStyle: () => null }));
vi.mock("../src/renderer/src/components/ProfileAvatar", () => ({ ProfileAvatar: () => null }));
vi.mock("../src/renderer/src/components/settings/AvatarStylePicker", () => ({ AvatarStylePicker: () => null, AvatarStyleLabel: () => null }));
vi.mock("../src/shared/browser", async (original) => ({ ...(await original<object>()), browserActivation: { subscribe: () => () => {}, get: () => env.browserEnabled } }));
import { Section, SettingRow, SettingsPage } from "../src/renderer/src/components/settings/Form";
import { ProfileAppearance } from "../src/renderer/src/components/settings/ProfileAppearance";
import { BrowserProfileTools } from "../src/renderer/src/components/settings/ProfileBrowserTools";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement; let root: Root;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); env.browserEnabled = true; });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const timingButtons = (element: Element) => [...element.querySelectorAll("button[aria-label]")].map(button => button.getAttribute("aria-label")).filter(label => label?.startsWith("settings.scope.agents."));
const appearance = () => h(ProfileAppearance, {
    detail: { id: "p", name: "P", appearance: { color: null, effectiveColor: "#112233", providerCategory: null }, detail: { editable: {} } } as unknown as ProfileDetail,
    patch: {}, set: vi.fn(), host: "host", picture: undefined, setPicture: vi.fn(), onPicture: vi.fn(),
    intro: { portrait: undefined, greeting: undefined }, setIntro: vi.fn(), onIntroPortrait: vi.fn(), introError: null, theme: undefined, setTheme: vi.fn(),
  });
it("keeps avatar style, pictures and opening display-only in a mixed Profile page", () => {
  act(() => root.render(h(SettingsPage, { page: "profiles", children: [
    h("div", { key: "appearance" }, appearance()),
    h(Section, { key: "runtime", title: "Runtime", children: h(SettingRow, { label: "Model", agents: "next", source: "host", children: "m" }) }),
  ] })));
  const rows = [...host.querySelectorAll("[data-setting-row]")].filter(row => !row.textContent?.startsWith("Model"));
  expect(rows.length).toBeGreaterThanOrEqual(7);
  for (const row of rows) expect(timingButtons(row)).toEqual([]);
  expect(rows.some(row => row.textContent?.includes("avatarStyle.title"))).toBe(true);
  expect(host.querySelector('[data-settings-header] button[data-settings-agents="mixed"]')).not.toBeNull();
  expect(host.querySelector('section button[data-settings-agents="none"][data-timing-presentation="header"]')).toBeNull();
});
it("shows asymmetric timing for browser tools and none on its module navigation link", () => {
  act(() => root.render(h(BrowserProfileTools, { profile: "p" })));
  expect(timingButtons(host.querySelector("[data-setting-row]")!)).toEqual(["settings.scope.agents.offNowOnNext"]);
  env.browserEnabled = false;
  act(() => root.render(h(BrowserProfileTools, { profile: "p" })));
  expect(timingButtons(host.querySelector("[data-setting-row]")!)).toEqual([]);
});

it("summarizes uniform Profile appearance at page level without repeated row icons", () => {
  act(() => root.render(h(SettingsPage, { page: "profiles", children: appearance() })));
  expect(host.querySelector('[data-settings-header] button[data-settings-agents="none"]')).toBeNull();
  for (const row of host.querySelectorAll("[data-setting-row]")) expect(timingButtons(row)).toEqual([]);
  expect(host.querySelector('section button[data-timing-presentation="header"]')).toBeNull();
});
