// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fx = vi.hoisted(() => ({
  list: { defaultProfile: "one", profiles: [{ id: "one", name: "one", cliKind: "codex", source: "api-key" }] },
  api: { listProfiles: vi.fn(), patchProfile: vi.fn(), patchSettings: vi.fn(), deleteProfile: vi.fn() },
  loadQuota: vi.fn(), reveal: vi.fn(), flash: vi.fn(),
}));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => fx.api, bridge: { on: () => () => {} }, cleanIpcMessage: (s: string) => s }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key, locale: "en" }) }));
vi.mock("../src/renderer/src/lib/targetHost", async (importOriginal) => ({ ...(await importOriginal<object>()),
  useTargetApi: () => fx.api, useTargetHostId: () => "picked-host", useTargetFeatures: () => new Set(), useTargetLoadQuota: () => fx.loadQuota,
}));
vi.mock("../src/renderer/src/lib/profileSnapshot", () => ({
  cachedProfileList: () => fx.list, cachedProfile: () => null, prefetchProfiles: () => {}, rememberProfileList: () => {}, updateCachedProfile: () => {},
}));
vi.mock("../src/renderer/src/lib/settingsSearchView", () => ({ requestSettingsReveal: fx.reveal }));
vi.mock("../src/renderer/src/lib/focusRequest", () => ({ flashElement: fx.flash }));
vi.mock("../src/renderer/src/modules/Outlet", () => ({ SettingsSections: () => null }));
vi.mock("../src/renderer/src/lib/useTransferTargets", () => ({ useTransferTargets: () => [] }));
vi.mock("../src/renderer/src/lib/modelDisplay", () => ({ useModelName: () => (name: string) => name }));
vi.mock("../src/renderer/src/lib/newAgentReturn", () => ({ noteNewAgentProfile: () => {}, useKeptNewAgentDraft: () => null }));
vi.mock("../src/renderer/src/components/settings/ProfileCard", () => ({ ProfileCard: ({ onOpen }: { onOpen(): void }) => h("button", { onClick: onOpen, "data-pick-profile": true }, "one") }));
vi.mock("../src/renderer/src/components/settings/ProfileEditor", () => ({ ProfileEditor: ({ profile }: { profile: string }) => h("div", { "data-profile": profile }, h("section", { id: "profile-models" }, "context and compaction")) }));
vi.mock("../src/renderer/src/components/settings/NewProfileForm", () => ({ NewProfileForm: () => null }));
vi.mock("../src/renderer/src/components/settings/CopyProfileToHostDialog", () => ({ CopyProfileToHostDialog: () => null }));
const { useApp } = await import("../src/renderer/src/store");
const { useSettingsShelf } = await import("../src/renderer/src/lib/settingsShelf");
const { ProfilesPage } = await import("../src/renderer/src/components/settings/ProfilesSettings");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); fx.api.listProfiles.mockResolvedValue(fx.list);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  useSettingsShelf.setState({ open: true, params: { tab: "profiles" } });
  useApp.setState({ settingsFocus: null });
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });
it("keeps a search destination until a Profile is picked, then reveals it without writes", async () => {
  useApp.getState().openSettings("profiles", { anchor: "models" });
  await act(async () => root.render(h(ProfilesPage)));
  expect(host.textContent).toContain("settings.searchIa.pickProfile");
  expect(useApp.getState().settingsFocus?.anchor).toBe("models");
  act(() => vi.advanceTimersByTime(4000));
  expect(fx.flash).not.toHaveBeenCalled();
  act(() => host.querySelector<HTMLButtonElement>("[data-pick-profile]")!.click());
  expect(useSettingsShelf.getState().params.profile).toBe("one");
  expect(useApp.getState().settingsFocus).toEqual({ profile: "one", anchor: "models" });
  act(() => vi.advanceTimersByTime(100));
  expect(fx.flash).toHaveBeenCalledWith(host.querySelector("#profile-models"));
  expect(useApp.getState().settingsFocus).toBeNull();
  expect(fx.api.patchProfile).not.toHaveBeenCalled(); expect(fx.api.patchSettings).not.toHaveBeenCalled(); expect(fx.api.deleteProfile).not.toHaveBeenCalled();
});
it("reports a detail unavailable on the chosen Profile instead of silently losing the target", async () => {
  useApp.getState().openSettings("profiles", { profile: "one", anchor: "images" });
  await act(async () => root.render(h(ProfilesPage)));
  act(() => vi.advanceTimersByTime(3200));
  expect(host.textContent).toContain("settings.searchIa.profileUnavailable");
  expect(fx.flash).not.toHaveBeenCalled();
  expect(useApp.getState().settingsFocus).toBeNull();
});
