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
const cases = [
  ["Codex API key", () => fixture("omega", "codex", "apiKey", "deepseek", nested()), true, false],
  ["ChatGPT login", () => fixture("gamma", "codex", "chatgpt", "openai-chatgpt", nested()), false, false],
  ["Claude subscription with null detail", () => fixture("claude", "claude", "none", "anthropic", null), false, true],
  ["Claude API with null config", () => fixture("claude-api", "claude", "none", "anthropic", { config: null, editable: {}, claudeAccount: "api" }), false, true],
  ["GLM custom provider", () => fixture("GLM", "codex", "apiKey", "zai", nested()), true, false],
  ["Legacy Codex without detail", () => fixture("legacy", "codex", "apiKey", "relay", null), true, false],
  ["Codex with null config", () => fixture("null-config", "codex", "apiKey", "relay", { config: null, editable: {} }), true, false],
  ["Legacy response with omitted detail", () => fixture("omitted", "codex", "apiKey", "relay", undefined), true, false],
  ["Claude with a complete detail", () => fixture("claude-full", "claude", "none", "anthropic", nested()), false, true],
] as const;

it.each(cases)("renders %s without a boundary fallback and with the correct account/provider controls", async (_label, make, provider, claude) => {
  const detail = make();
  env.snapshot = { detail, models: null, quota: null, account: null };
  await act(async () => root.render(h(CardBoundary, { children: h(ProfileEditor, {
    profile: detail.name, item: detail as ProfileItem, isDefault: false, refusal: null,
    onChanged: vi.fn(), onDuplicate: vi.fn(), onDelete: async () => {}, onCreateProvider: vi.fn(),
  }) })));
  expect(container.querySelector("[data-card-error]")).toBeNull();
  expect(env.logError).not.toHaveBeenCalled();
  expect(container.querySelector("#profile-account")).not.toBeNull();
  expect(container.querySelector("#profile-models")).not.toBeNull();
  expect(container.textContent?.includes("settings.provider.picker")).toBe(provider);
  expect(container.textContent?.includes("agent-config.profile.claudeAccount")).toBe(claude);
  if (provider) expect(container.textContent).toContain("https://relay.example/v1");
  if (claude) expect(container.textContent).not.toContain("settings.provider.changeCreate");
  if (claude) {
    expect(container.textContent).toContain("settings.profileIa.defaultCompaction");
    const account = [...container.querySelectorAll("select")].find(select => [...select.options].some(option => option.value === "api"));
    expect(account?.value).toBe(detail.claudeAccount);
  }
  const sections = [...container.querySelectorAll("section")];
  const appearance = sections.find(section => section.querySelector("h3")?.textContent?.startsWith("settings.profile.look"));
  expect(appearance).toBeDefined();
  expect(appearance!.querySelectorAll('[data-timing-presentation="header"][aria-label="settings.scope.agents.none"]')).toHaveLength(1);
  expect(appearance!.querySelectorAll('[data-timing-presentation="row"]')).toHaveLength(0);
  const quota = sections.find(section => section.querySelector("h3")?.textContent?.startsWith("agent-config.quota.title"));
  if (quota) {
    const observation = quota.querySelector("[data-setting-row]");
    expect(observation).not.toBeNull();
    expect(observation!.querySelector("[data-effect-markers], [data-timing-presentation], [data-effect-scope-marker]")).toBeNull();
  }
});

it.each([false, undefined])("keeps the API-key credential separate from providerEnvKey (editable=%s)", async editable => {
  const detail = fixture("api-key-account", "codex", "apiKey", "relay", {
    config: { ...config, providerEnvKey: "R270_VIRTUAL_ENV" },
    editable: editable === undefined ? {} : { providerEnvKey: editable },
    apiKeyPresent: true,
  });
  env.snapshot = { detail, models: null, quota: null, account: null };
  const patchProfile = vi.fn().mockResolvedValue(detail);
  env.api.patchProfile = patchProfile;
  await act(async () => root.render(h(ProfileEditor, {
    profile: detail.name, item: detail as ProfileItem, isDefault: false, refusal: null,
    onChanged: vi.fn(), onDuplicate: vi.fn(), onDelete: async () => {}, onCreateProvider: vi.fn(),
  })));
  const account = container.querySelector("#profile-account")!;
  expect(account.textContent).not.toContain("providerEnvKey");
  expect(account.textContent).not.toContain("R270_VIRTUAL_ENV");
  expect([...container.querySelectorAll("input")].some(input => input.value === "R270_VIRTUAL_ENV")).toBe(false);
  const key = account.querySelector<HTMLInputElement>('input[type="password"]')!;
  expect(key).not.toBeNull();
  expect(key.value).toBe("");
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(key, "virtual-r270-key");
    key.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const save = [...container.querySelectorAll("button")].find(button => button.textContent === "settings.save");
  expect(save).toBeDefined();
  await act(async () => save!.click());
  expect(patchProfile).toHaveBeenCalledExactlyOnceWith(detail.name, { apiKey: "virtual-r270-key" });
  expect(key.value).toBe("");
});

it.each([
  [{ providerOptions: false }, true],
  [{ providerBaseUrl: false }, true],
  [{ providerOptions: true, providerBaseUrl: true }, false],
  [{}, false],
] as const)("honors the daemon endpoint editability map %j, including older hosts", async (editable, disabled) => {
  const detail = fixture("endpoint-account", "codex", "apiKey", "relay", {
    config: { ...config, providerEnvKey: "R270_VIRTUAL_ENV" }, editable, apiKeyPresent: true,
  });
  env.snapshot = { detail, models: null, quota: null, account: null };
  await act(async () => root.render(h(ProfileEditor, {
    profile: detail.name, item: detail as ProfileItem, isDefault: false, refusal: null,
    onChanged: vi.fn(), onDuplicate: vi.fn(), onDelete: async () => {}, onCreateProvider: vi.fn(),
  })));
  const endpoint = [...container.querySelectorAll("#profile-account input")]
    .find(input => (input as HTMLInputElement).value === config.providerBaseUrl) as HTMLInputElement | undefined;
  expect(endpoint).toBeDefined();
  expect(endpoint!.disabled).toBe(disabled);
});
