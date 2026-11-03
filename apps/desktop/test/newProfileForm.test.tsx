// @vitest-environment jsdom
// 新建 Profile (provider-first, P1) as rendered: cards per capability set, the address row (relay tag,
// restore), the inline Anthropic key (account → Profile, key cleared after submit, failed step named),
// the payloads that reach cutex, 「用这个服务商新建」 preselection and the legacy DSH host variable.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({ features: new Set<string>(), createProfile: vi.fn(), createClaudeAccount: vi.fn(), patchProfile: vi.fn(), presets: [] as unknown[] }));
vi.mock("../src/renderer/src/bridge", () => ({ bridge: { on: () => () => {} }, api: {} }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string, vars?: Record<string, unknown>) => key + (vars ? JSON.stringify(vars) : ""), locale: "zh-CN" }) }));
vi.mock("../src/renderer/src/lib/targetHost", async (original) => ({ ...(await original<object>()), useTargetApi: () => ({ createProfile: fx.createProfile, createClaudeAccount: fx.createClaudeAccount, patchProfile: fx.patchProfile }), useTargetHostId: () => "host-a", useTargetFeatures: () => fx.features }));
vi.mock("../src/renderer/src/lib/useProfilePresets", () => ({ useProfilePresets: () => fx.presets }));
vi.mock("../src/renderer/src/components/ComponentCard", () => ({ ComponentNotice: ({ name }: { name: string }) => h("div", { "data-component": name }) }));
vi.mock("../src/renderer/src/components/settings/ProfileClaudeAccount", () => ({ NewClaudeAccountRow: () => h("div", { "data-claude-account-row": "" }) }));
vi.mock("../src/renderer/src/components/InlineGuide", () => ({ InlineGuide: () => null }));
vi.mock("../src/renderer/src/lib/guides", () => ({ markGuideSeen: vi.fn() }));

const { NewProfileForm } = await import("../src/renderer/src/components/settings/NewProfileForm");
const { presetsOf } = await import("../src/renderer/src/lib/profilePresets");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mp = (id: string, providerId: string, baseUrl: string | null, family: string | null) => ({ id, aliases: [], label: id, providerId, baseUrl, baseUrlRequired: baseUrl === null, defaultModel: null, providerFamily: family, providerFamilyLabel: null });
const PRESETS = presetsOf([
  mp("deepseek", "deepseek", "https://api.deepseek.com/", "deepseek"),
  mp("zai", "zai", "https://api.z.ai/api/v1", "zhipu"),
  mp("zhipu", "zhipu", "https://open.bigmodel.cn/api/v1", "zhipu"),
  mp("moonshot", "moonshot", "https://api.moonshot.ai/v1", "moonshot"),
  mp("kimi-code-cn", "kimi-code", "https://api.kimi.com/coding/v1", "kimi-code"),
  mp("openai", "openai-api", "https://api.openai.com/v1", "openai-api"),
  mp("gemini", "gemini", null, null),
  mp("custom", "custom", null, null),
])!;

let host: HTMLDivElement, root: Root;
const props = { existing: ["taken"], onCreated: vi.fn(), onCancel: vi.fn() };
beforeEach(() => {
  fx.features = new Set(["profile-create"]);
  fx.presets = PRESETS;
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = (extra: Record<string, unknown> = {}) => act(() => root.render(h(NewProfileForm, { ...props, ...extra })));
const q = <E extends Element = HTMLElement>(sel: string) => host.querySelector<E>(sel);
const button = (label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === label)!;
const pickCard = (id: string) => act(() => q<HTMLButtonElement>(`[data-provider-card="${id}"]`)!.click());
const pickOption = (id: string) => act(() => q<HTMLInputElement>(`[data-auth-option="${id}"] input`)!.click());
const input = (label: string) => q<HTMLInputElement>(`input[aria-label^="${label}"]`)!;
const type = (el: HTMLInputElement, value: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
const create = () => act(async () => button("newProfile.create").click());

it("keeps all provider/key/model/name steps free of settings badges", () => {
  render();
  pickCard("deepseek");
  expect(host.querySelectorAll("[data-form-field]").length).toBeGreaterThan(3);
  expect(q("[data-effect-markers]")).toBeNull();
  expect(q("[data-settings-agents]")).toBeNull();
  expect(input("newProfile.key.label")).not.toBeNull();
  expect(input("newProfile.name.label")).not.toBeNull();
});

it("cards and login options follow the host's capabilities", () => {
  render();
  expect([...host.querySelectorAll("[data-provider-card]")].map((e) => e.getAttribute("data-provider-card"))).toEqual(["openai", "anthropic", "deepseek", "kimi", "glm", "gemini", "custom"]);
  pickCard("deepseek");
  expect([...host.querySelectorAll("[data-auth-option]")].map((e) => e.getAttribute("data-auth-option"))).toEqual(["apiKey"]);
  act(() => button("newProfile.changeProvider").click());
  fx.features = new Set(["profile-create", "claude-accounts", "dsh-runtime"]);
  render();
  pickCard("deepseek");
  // The host variable sits under 高级 until opened.
  expect([...host.querySelectorAll("[data-auth-option]")].map((e) => e.getAttribute("data-auth-option"))).toEqual(["apiKey", "anthropicCompatible"]);
  act(() => button("newProfile.advanced").click());
  expect(q('[data-auth-option="dshEnv"]')).not.toBeNull();
});

it("DeepSeek API key through a relay: relay tag, restore, payload; the key field is cleared after submit", async () => {
  render();
  pickCard("deepseek");
  expect(q("[data-auth-consequence]")?.textContent).toBe('newProfile.auth.consequence.only{"runtime":"cute-codex"}');
  const address = input("newProfile.address.label");
  expect(address.value).toBe("https://api.deepseek.com/");
  expect(q("[data-address-relay]")).toBeNull();
  type(address, "https://relay.corp/deepseek/v1");
  expect(q("[data-address-relay]")?.textContent).toBe("newProfile.address.tag.relay");
  expect(q("[data-relay-note]")?.textContent).toBe("newProfile.relayNote.codex");
  act(() => button("newProfile.address.restore").click());
  expect(input("newProfile.address.label").value).toBe("https://api.deepseek.com/");
  type(input("newProfile.address.label"), "https://relay.corp/deepseek/v1");
  type(input("newProfile.key.label"), "sk-secret");
  type(input("newProfile.name.label"), "ds-relay");
  expect(q("[data-new-profile-summary]")?.textContent).toContain('newProfile.summary.via{"host":"relay.corp"}');
  fx.createProfile.mockResolvedValue({ name: "ds-relay" });
  await create();
  expect(fx.createProfile).toHaveBeenCalledWith({ name: "ds-relay", kind: "apiKey", preset: "deepseek", baseUrl: "https://relay.corp/deepseek/v1", apiKey: "sk-secret" });
  expect(fx.createClaudeAccount).not.toHaveBeenCalled();
  expect(props.onCreated).toHaveBeenCalledWith({ name: "ds-relay" });
  expect(input("newProfile.key.label").value).toBe("");
});

it("Gemini needs an address before anything is sent", async () => {
  render();
  pickCard("gemini");
  type(input("newProfile.name.label"), "gem");
  await create();
  expect(fx.createProfile).not.toHaveBeenCalled();
  expect(q("[data-new-profile-error]")?.textContent).toBe("newProfile.error.baseUrlMissing");
});

it("Anthropic API key inline: Claude API account first (with the key), then the Claude Profile on it; colour last", async () => {
  fx.features = new Set(["profile-create", "claude-accounts"]);
  render();
  pickCard("anthropic");
  pickOption("anthropicKey");
  expect(q('[data-component="claude-runtime"]')).not.toBeNull();
  type(input("newProfile.key.label"), "sk-ant-1");
  type(input("newProfile.name.label"), "claude-api");
  act(() => q<HTMLButtonElement>('[data-new-profile-colors] button[title="#ef4444"], [data-new-profile-colors] button:nth-of-type(3)')!.click());
  fx.createClaudeAccount.mockResolvedValue({ ok: true, account: { id: "ca-new0000001" } });
  fx.createProfile.mockResolvedValue({ name: "claude-api" });
  fx.patchProfile.mockResolvedValue({ name: "claude-api", color: "x" });
  await create();
  expect(fx.createClaudeAccount).toHaveBeenCalledWith({ label: "claude-api", kind: "api", keyEnv: "ANTHROPIC_API_KEY", apiKey: "sk-ant-1" });
  expect(fx.createProfile).toHaveBeenCalledWith({ name: "claude-api", kind: "claude", claudeAccount: "ca-new0000001" });
  expect(fx.patchProfile).toHaveBeenCalledWith("claude-api", { color: expect.any(String) });
  expect(fx.createClaudeAccount.mock.invocationCallOrder[0]).toBeLessThan(fx.createProfile.mock.invocationCallOrder[0]!);
  expect(props.onCreated).toHaveBeenCalledWith({ name: "claude-api", color: "x" });
  expect(input("newProfile.key.label").value).toBe("");
});

it("a refused account step is named; no Profile is created and the key is not kept", async () => {
  fx.features = new Set(["profile-create", "claude-accounts"]);
  render();
  pickCard("glm");
  pickOption("anthropicCompatible");
  expect(input("newProfile.address.label").value).toBe("https://api.z.ai/api/anthropic");
  type(input("newProfile.key.label"), "glm-key");
  type(input("newProfile.name.label"), "glm-claude");
  fx.createClaudeAccount.mockResolvedValue({ ok: false, error: { code: "claude_account_label_taken", message: "taken" } });
  await create();
  expect(fx.createClaudeAccount).toHaveBeenCalledWith({ label: "glm-claude", kind: "api", keyEnv: "ANTHROPIC_AUTH_TOKEN", baseUrl: "https://api.z.ai/api/anthropic", apiKey: "glm-key" });
  expect(fx.createProfile).not.toHaveBeenCalled();
  expect(q("[data-new-profile-error]")?.textContent).toBe('newProfile.error.step{"step":"newProfile.error.step.account","message":"taken (claude_account_label_taken)"}');
  expect(input("newProfile.key.label").value).toBe("");
});

it("the account exists but the Profile fails: says the account was kept", async () => {
  fx.features = new Set(["profile-create", "claude-accounts"]);
  render();
  pickCard("anthropic");
  pickOption("anthropicKey");
  type(input("newProfile.name.label"), "c2");
  fx.createClaudeAccount.mockResolvedValue({ ok: true, account: { id: "ca-new0000002" } });
  fx.createProfile.mockRejectedValue(new Error("boom"));
  await create();
  expect(q("[data-new-profile-error]")?.textContent).toBe('newProfile.error.accountKept{"label":"c2","message":"boom"}');
  expect(props.onCreated).not.toHaveBeenCalled();
});

it("「用这个服务商新建」 preselects the preset's card, option and region", () => {
  render({ initialPreset: "kimi-code-cn" });
  expect(q("[data-provider-chosen]")?.getAttribute("data-provider-chosen")).toBe("kimi");
  expect(q<HTMLInputElement>('[data-auth-option="apiKey:kimi-code"] input')?.checked).toBe(true);
  expect(input("newProfile.address.label").value).toBe("https://api.kimi.com/coding/v1");
});

it("legacy host: no DSH; with dsh-runtime the host variable makes a DSH-kind Profile without a key field", async () => {
  render();
  pickCard("deepseek");
  expect(button("newProfile.advanced")).toBeUndefined();
  act(() => root.unmount());
  root = createRoot(host);
  fx.features = new Set(["profile-create", "dsh-runtime"]);
  render();
  pickCard("deepseek");
  act(() => button("newProfile.advanced").click());
  pickOption("dshEnv");
  expect(q('input[type="password"]')).toBeNull();
  expect(q("[data-dsh-not-recommended]")?.textContent).toBe("dsh.notRecommended");
  expect(q('[data-component="dsh-runtime"]')).not.toBeNull();
  type(input("newProfile.name.label"), "dsh-team");
  fx.createProfile.mockResolvedValue({ name: "dsh-team" });
  await create();
  expect(fx.createProfile).toHaveBeenCalledWith({ name: "dsh-team", kind: "dsh", options: { dsh: { model: "deepseek-v4-flash", apiKeyEnv: "DEEPSEEK_API_KEY" } } });
});


it("API-only Kimi and other provider cards carry no experimental runtime badge", () => {
  render();
  expect(q('[data-provider-card="kimi"]')).toBeTruthy();
  expect(q('[data-experimental-runtime]')).toBeNull();
});

it("legacy DSH auth and runtime choices are labelled experimental", () => {
  fx.features.add("dsh-runtime");
  render({ initialPreset: "deepseek" });
  act(() => button("newProfile.advanced").click());
  const option = q<HTMLElement>('[data-auth-option="dshEnv"]')!;
  expect(option.querySelector('[data-experimental-runtime="dsh"]')).toBeTruthy();
  act(() => option.querySelector<HTMLInputElement>("input")!.click());
  expect(q('[data-runtime-step="dsh"] [data-experimental-runtime="dsh"]')).toBeTruthy();
});
