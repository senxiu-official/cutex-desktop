// @vitest-environment jsdom
// Exercise the complete editor inside its real error boundary: smaller field tests do not
// catch assumptions about Codex configuration on a Claude or legacy profile.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ProfileDetail, ProfileItem } from "../src/shared/ipc";

const env = vi.hoisted(() => ({ snapshot: null as unknown, features: new Set<string>(), api: {} as Record<string, unknown>, logError: vi.fn() }));
vi.mock("../src/renderer/src/bridge", () => ({
  api: env.api, apiFor: () => env.api, cleanIpcMessage: (s: string) => s,
  bridge: { on: () => () => {}, shell: { logError: env.logError } }, onEvent: () => () => {},
}));
vi.mock("../src/renderer/src/i18n", async original => ({
  ...await original<object>(), useI18n: () => ({ locale: "en", t: (key: string) => key }),
}));
vi.mock("../src/renderer/src/lib/targetHost", async original => ({
  ...await original<object>(), useTargetApi: () => env.api, useTargetFeatures: () => env.features,
  useTargetHostId: () => "local", useTargetLoadQuota: () => vi.fn(), useTargetQuotas: () => ({}),
  useTargetSidebar: () => ({ active: [], retired: [], projects: null }), useTargetSelect: () => vi.fn(),
}));
vi.mock("../src/renderer/src/lib/profileSnapshot", () => ({
  cachedProfile: () => env.snapshot, loadProfileSnapshot: async () => env.snapshot,
  updateCachedProfile: vi.fn(), loadProfileList: async () => null,
}));
vi.mock("../src/renderer/src/lib/useProfilePresets", async () => {
  const { FALLBACK_PRESETS } = await import("../src/renderer/src/lib/profilePresets");
  return { useProfilePresets: () => FALLBACK_PRESETS };
});
vi.mock("../src/renderer/src/lib/useClaudeAccountList", () => ({
  useClaudeAccountList: () => ({ list: [
    { id: "default", label: null, kind: "subscription", isDefault: true, status: null, api: null },
    { id: "api", label: "Claude API", kind: "api", isDefault: false, status: null, api: { apiKeyPresent: true } },
  ], loadError: null, load: async () => {} }),
}));
vi.mock("../src/renderer/src/modules/react", () => ({ useSlot: () => [] }));
import { ProfileEditor } from "../src/renderer/src/components/settings/ProfileEditor";
import { CardBoundary } from "../src/renderer/src/components/settings/Form";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  env.features = new Set(["claude-accounts", "claude-profile-default-model", "claude-compaction", "claude-compaction-models"]);
  env.logError.mockReset().mockResolvedValue(undefined);
  Object.assign(env.api, { getProfile: async () => (env.snapshot as { detail: ProfileDetail }).detail, profileAccount: async () => null, profileModels: async () => null,
    components: async () => ({ components: [] }), listComponents: async () => ({ components: [] }), listClaudeAccounts: async () => ({ accounts: [] }) });
  HTMLDialogElement.prototype.showModal = vi.fn(); HTMLDialogElement.prototype.close = vi.fn();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

function fixture(name: string, cliKind: "codex" | "claude", authKind: string, providerFamily: string, nested: unknown): ProfileDetail {
  return { id: name, name, cliKind, authKind, providerFamily, providerFamilyLabel: null, authPresent: true,
    baseUrl: cliKind === "codex" ? "https://relay.example/v1" : null, planLabel: null,
    model: cliKind === "claude" ? "sonnet" : "gpt-5", modelReasoningEffort: null,
    appearance: { color: null, effectiveColor: null, providerCategory: null },
    claudeAccount: cliKind === "claude" ? (name.includes("api") ? "api" : "default") : null,
    claudeCompaction: cliKind === "claude" ? null : undefined,
    allowSessionSwitch: false, quotaEnabled: false, detail: nested,
  } as unknown as ProfileDetail;
}
const config = { model: "gpt-5", modelProvider: "relay", providerBaseUrl: "https://relay.example/v1" };
const nested = () => ({ config: { ...config }, editable: { model: true, modelReasoningEffort: true, modelContextWindow: true, modelAutoCompactTokenLimit: true }, apiKeyPresent: true });


it("REVIEW DELTA: legacy above-window pair permits an unrelated Profile edit without rewriting context", async () => {
  const detail = fixture("legacy-high", "codex", "apiKey", "relay", {
    ...nested(), config: { ...config, modelContextWindow: 200_000, modelAutoCompactTokenLimit: 500_000 },
  });
  env.snapshot = { detail, models: null, quota: null, account: null };
  const patchProfile = vi.fn().mockResolvedValue(detail); env.api.patchProfile = patchProfile;
  await act(async () => root.render(h(ProfileEditor, {
    profile: detail.name, item: detail as ProfileItem, isDefault: false, refusal: null,
    onChanged: vi.fn(), onDuplicate: vi.fn(), onDelete: async () => {}, onCreateProvider: vi.fn(),
  })));
  expect(container.textContent).toContain("settings.modelContext.compactAboveWindow");
  expect([...container.querySelectorAll("input")].some(input => input.value === "500k")).toBe(true);
  const key = container.querySelector<HTMLInputElement>('#profile-account input[type="password"]')!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(key, "review-test-key");
    key.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const save = [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "settings.save")!;
  expect(save.disabled).toBe(false);
  await act(async () => save.click());
  expect(patchProfile).toHaveBeenCalledExactlyOnceWith(detail.name, { apiKey: "review-test-key" });
});
