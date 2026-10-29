// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ProfileDetail } from "../src/shared/ipc";
import { FALLBACK_PRESETS } from "../src/renderer/src/lib/profilePresets";
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ locale: "en", t: (key: string) => key }) }));
import { ProfileProviderSummary } from "../src/renderer/src/components/settings/ProfileProviderSummary";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement; let root: Root;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const detail = (url: string, provider = "deepseek") => ({ id: "p", providerFamily: provider, providerFamilyLabel: null, detail: { config: { modelProvider: provider, providerBaseUrl: url } } } as unknown as ProfileDetail);
it("shows the saved provider and URL read-only and opens creation without editing the profile", () => {
  const onCreateProvider = vi.fn();
  act(() => root.render(h(ProfileProviderSummary, { detail: detail("https://api.deepseek.com/"), presets: FALLBACK_PRESETS, onCreateProvider })));
  expect(host.textContent).toContain("DeepSeek");
  expect(host.textContent).toContain("https://api.deepseek.com/");
  expect(host.querySelector("select,input")).toBeNull();
  expect(host.querySelector('[data-timing-presentation="row"]')).toBeNull();
  act(() => [...host.querySelectorAll("button")].find(button => button.textContent === "settings.provider.changeCreate")!.click());
  expect(onCreateProvider).toHaveBeenCalledExactlyOnceWith("deepseek");
});
it("retains a custom relay identity and omits the creation link without that action", () => {
  const saved = detail("https://relay.example/v1", "my-relay");
  act(() => root.render(h(ProfileProviderSummary, { detail: saved, presets: FALLBACK_PRESETS })));
  expect(host.textContent).toContain("my-relay");
  expect(host.textContent).toContain("https://relay.example/v1");
  expect(host.textContent).not.toContain("settings.provider.changeCreate");
  expect(host.querySelector("select,input")).toBeNull();
});
