// @vitest-environment jsdom
// Profile variants UI (docs/design/042): the new-profile flow creates the profile then adds the DSH variant, the key
// field empties after the send and is never echoed; 服务与凭证 replaces a key write-only; 运行时变体 refuses removing a
// variant in use before and after asking cutex.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ProfileDetail } from "../src/shared/ipc";

const fx = vi.hoisted(() => ({ api: {} as Record<string, ReturnType<typeof vi.fn>>, notify: vi.fn(), features: new Set<string>(["profile-runtime-variants", "dsh-runtime", "profile-create"]) }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string, vars?: Record<string, unknown>) => key + (vars ? JSON.stringify(vars) : ""), locale: "en" }) }));
vi.mock("../src/renderer/src/lib/targetHost", async (original) => ({ ...(await original<object>()), useTargetApi: () => fx.api, useTargetHostId: () => "local", useTargetFeatures: () => fx.features }));
vi.mock("../src/renderer/src/lib/useProfilePresets", () => ({ useProfilePresets: () => [{ id: "deepseek", aliases: [], label: "DeepSeek", providerId: "deepseek", baseUrl: "https://api.deepseek.com/", baseUrlRequired: false, defaultModel: "deepseek-flash", providerFamily: "deepseek", providerFamilyLabel: "DeepSeek" }] }));
vi.mock("../src/renderer/src/lib/componentView", () => ({ useComponentState: () => ({ state: { kind: "body" }, entry: { list: null, refusal: null } }) }));
vi.mock("../src/renderer/src/components/ComponentCard", () => ({ ComponentNotice: () => null }));
vi.mock("../src/renderer/src/components/settings/ProfileClaudeAccount", () => ({ NewClaudeAccountRow: () => null }));
vi.mock("../src/renderer/src/lib/useClaudeAccountList", () => ({ useClaudeAccountList: () => ({ list: null, loadError: null, load: vi.fn() }) }));
const { useApp } = await import("../src/renderer/src/store");
const { NewProfileVariantsForm } = await import("../src/renderer/src/components/settings/NewProfileVariantsForm");
const { ProfileCredentialSection } = await import("../src/renderer/src/components/settings/ProfileCredentialSection");
const { ProfileVariantsSection } = await import("../src/renderer/src/components/settings/ProfileVariantsSection");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const KEY = "sk-test-only-variants";
let host: HTMLDivElement; let root: Root;
beforeEach(() => { vi.clearAllMocks(); fx.api = {}; useApp.setState({ notify: fx.notify } as never); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const button = (label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === label)!;
const type = (input: HTMLInputElement, value: string) => act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });

function detail(over: Partial<ProfileDetail> = {}): ProfileDetail {
  return {
    id: "omega", name: "omega", cliKind: "codex", providerFamilyLabel: "DeepSeek",
    providerInterfaces: [{ kind: "openaiCompatible", baseUrl: "https://api.deepseek.com/v1" }, { kind: "deepseekNative", baseUrl: "https://api.deepseek.com/" }],
    credential: { source: "stored", present: true, envName: null, claudeAccountId: null, version: 2, writable: true },
    runtimeVariants: [
      { id: "codex", runtime: "codex", primary: true, defaults: { model: "deepseek-flash", reasoningEffort: "high" }, inUse: 3 },
      { id: "dsh", runtime: "dsh", primary: false, defaults: { model: "deepseek-flash", reasoningEffort: null }, inUse: 1 },
    ],
    defaultVariant: "codex",
    runtimeCompatibility: [{ runtime: "codex", status: "supported", reason: null, variantPresent: true }, { runtime: "dsh", status: "supported", reason: null, variantPresent: true }, { runtime: "claude", status: "unsupported", reason: "anthropicRouteNotYetSupported", variantPresent: false }],
    ...over,
  } as unknown as ProfileDetail;
}

it("new profile: DeepSeek key + cute-codex + DSH → create with the key, then the DSH variant; the field empties", async () => {
  const created = detail({ runtimeVariants: [detail().runtimeVariants![0]!] });
  fx.api.createProfile = vi.fn().mockResolvedValue(created);
  fx.api.addProfileVariant = vi.fn().mockResolvedValue({ ok: true, profile: detail(), variant: null });
  fx.api.patchProfile = vi.fn();
  const onCreated = vi.fn();
  act(() => root.render(h(NewProfileVariantsForm, { existing: [], onCreated, onCancel: vi.fn(), initialPreset: "deepseek" })));
  const rows = [...host.querySelectorAll("[data-variant-choice]")].map((r) => [r.getAttribute("data-variant-choice"), r.getAttribute("data-variant-status")]);
  expect(rows).toEqual([["codex", "supported"], ["dsh", "supported"], ["claude", "unsupported"]]);
  expect(host.querySelector('[data-variant-choice="dsh"] [data-experimental-runtime="dsh"]')).toBeTruthy();
  expect(host.querySelector('[data-variant-choice="codex"] [data-experimental-runtime]')).toBeNull();
  expect(host.querySelector('[data-variant-choice="claude"] [data-experimental-runtime]')).toBeNull();
  expect(host.querySelector('[data-variant-choice="claude"] [role=checkbox]')!.hasAttribute("disabled")).toBe(true);
  act(() => (host.querySelector('[data-variant-choice="dsh"] [role=checkbox]') as HTMLButtonElement).click());
  const key = host.querySelector<HTMLInputElement>('input[type="password"]')!;
  type(key, KEY);
  type(host.querySelector<HTMLInputElement>('input[placeholder="deepseek"]')!, "ds");
  await act(async () => button("newProfile.create").click());
  expect(fx.api.createProfile).toHaveBeenCalledWith({ name: "ds", kind: "apiKey", preset: "deepseek", apiKey: KEY });
  expect(fx.api.addProfileVariant).toHaveBeenCalledWith("omega", { runtime: "dsh", defaults: { model: "deepseek-flash" } });
  expect(fx.api.patchProfile).not.toHaveBeenCalled();
  expect(onCreated).toHaveBeenCalledWith(detail());
  expect(key.value).toBe("");
  expect(host.innerHTML).not.toContain(KEY);
  expect(fx.notify).not.toHaveBeenCalled();
});

it("new profile: a refused variant is reported with cutex's reason and the profile still opens", async () => {
  fx.api.createProfile = vi.fn().mockResolvedValue(detail({ runtimeVariants: [detail().runtimeVariants![0]!] }));
  fx.api.addProfileVariant = vi.fn().mockResolvedValue({ ok: false, error: { code: "variant_runtime_unsupported", message: "runtime dsh is not available" } });
  const onCreated = vi.fn();
  act(() => root.render(h(NewProfileVariantsForm, { existing: [], onCreated, onCancel: vi.fn(), initialPreset: "deepseek" })));
  act(() => (host.querySelector('[data-variant-choice="dsh"] [role=checkbox]') as HTMLButtonElement).click());
  type(host.querySelector<HTMLInputElement>('input[placeholder="deepseek"]')!, "ds");
  await act(async () => button("newProfile.create").click());
  expect(onCreated).toHaveBeenCalled();
  expect(fx.notify.mock.calls[0]![0]).toContain("runtime dsh is not available");
});

it("服务与凭证: shows presence and version, never a value; replacing sends the key once and empties the field", async () => {
  fx.api.patchProfile = vi.fn().mockResolvedValue(detail());
  const onChanged = vi.fn();
  act(() => root.render(h(ProfileCredentialSection, { detail: detail(), onChanged })));
  expect(host.querySelector("[data-experimental-runtime]")).toBeNull();
  expect(host.textContent).toContain("variants.credential.set");
  expect(host.textContent).toContain('variants.credential.version{"n":2}');
  expect(host.textContent).toContain('variants.credential.affects{"n":4}');
  // A Codex profile's key cannot be removed (cutex has no clear for it).
  expect(button("variants.credential.remove")).toBeUndefined();
  const key = host.querySelector<HTMLInputElement>('input[type="password"]')!;
  type(key, KEY);
  await act(async () => button("variants.credential.replace").click());
  expect(fx.api.patchProfile).toHaveBeenCalledWith("omega", { apiKey: KEY });
  expect(key.value).toBe("");
  expect(host.innerHTML).not.toContain(KEY);
  expect(onChanged).toHaveBeenCalled();
});

it("服务与凭证: a DSH profile's stored key can be removed (click twice) and switched to a named variable", async () => {
  fx.api.patchProfile = vi.fn().mockResolvedValue(detail());
  act(() => root.render(h(ProfileCredentialSection, { detail: detail({ cliKind: "dsh" }), onChanged: vi.fn() })));
  act(() => button("variants.credential.remove").click());
  await act(async () => button("variants.credential.removeAgain").click());
  expect(fx.api.patchProfile).toHaveBeenCalledWith("omega", { apiKey: null });
});

it("运行时变体: removing is blocked for the primary and a bound variant; cutex's variant_in_use is explained", async () => {
  fx.api.deleteProfileVariant = vi.fn().mockResolvedValue({ ok: false, error: { code: "variant_in_use", message: "in use", count: 7 } });
  const free = detail({ runtimeVariants: [detail().runtimeVariants![0]!, { ...detail().runtimeVariants![1]!, inUse: 0 }] });
  act(() => root.render(h(ProfileVariantsSection, { detail: detail(), onChanged: vi.fn() })));
  const removes = [...host.querySelectorAll("[data-variant-row] button")].filter((b) => (b.getAttribute("title") ?? b.getAttribute("aria-label") ?? "").startsWith("variants.delete"));
  expect(removes.length).toBe(2);
  expect(removes.every((b) => b.hasAttribute("disabled"))).toBe(true);
  expect(host.querySelector('[data-variant-row="codex"]')!.hasAttribute("data-variant-default")).toBe(true);
  // Free variant: cutex still refuses (an agent was bound meanwhile).
  act(() => root.render(h(ProfileVariantsSection, { detail: free, onChanged: vi.fn() })));
  const remove = [...host.querySelectorAll('[data-variant-row="dsh"] button')].find((b) => !b.hasAttribute("disabled") && (b.getAttribute("title") ?? b.getAttribute("aria-label") ?? "").startsWith("variants.delete")) as HTMLButtonElement;
  act(() => remove.click());
  const again = [...host.querySelectorAll('[data-variant-row="dsh"] button')].find((b) => b.textContent === "variants.deleteAgain") as HTMLButtonElement;
  await act(async () => again.click());
  expect(fx.api.deleteProfileVariant).toHaveBeenCalledWith("omega", "dsh");
  expect(host.textContent).toContain('variants.deleteBlockedInUse{"n":7}');
});

it("运行时变体: a DSH variant's model list is cutex's catalog for it (QA 2026-10-27), not the hardcoded fallback", async () => {
  const models = [
    { id: "deepseek-v9-lab", displayName: "DeepSeek V9 Lab", inputModalities: ["text"], isDefault: true },
    { id: "deepseek-v9-vision", displayName: null, inputModalities: ["text", "image"] },
  ];
  const withCatalog = detail({ runtimeVariants: [detail().runtimeVariants![0]!, { ...detail().runtimeVariants![1]!, defaults: { model: null, reasoningEffort: null }, models }] });
  fx.api.patchProfileVariant = vi.fn().mockResolvedValue({ ok: true, profile: withCatalog, variant: null });
  act(() => root.render(h(ProfileVariantsSection, { detail: withCatalog, onChanged: vi.fn() })));
  const select = host.querySelector('[data-variant-row="dsh"] select[aria-label="agent-config.profile.model"], [data-variant-row="dsh"] select') as HTMLSelectElement;
  expect([...select.options].map((o) => [o.value, o.textContent])).toEqual([["deepseek-v9-lab", "DeepSeek V9 Lab"], ["deepseek-v9-vision", "deepseek-v9-vision"]]);
  // No pick stored: the catalog's default shows (not DSH's fallback name).
  expect(select.value).toBe("deepseek-v9-lab");
  act(() => { select.value = "deepseek-v9-vision"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  await act(async () => button("variants.save").click());
  expect(fx.api.patchProfileVariant).toHaveBeenCalledWith("omega", "dsh", { model: "deepseek-v9-vision" });
  // A stored model the catalog no longer lists is kept as a choice.
  const legacy = detail({ runtimeVariants: [detail().runtimeVariants![0]!, { ...detail().runtimeVariants![1]!, defaults: { model: "deepseek-v4-flash", reasoningEffort: null }, models }] });
  act(() => root.render(h(ProfileVariantsSection, { detail: legacy, onChanged: vi.fn() })));
  const kept = host.querySelector('[data-variant-row="dsh"] select') as HTMLSelectElement;
  expect([...kept.options].map((o) => o.value)).toEqual(["deepseek-v9-lab", "deepseek-v9-vision", "deepseek-v4-flash"]);
  expect(kept.value).toBe("deepseek-v4-flash");
});

it("运行时变体: a Kimi account variant lists the account catalog with display names; no pick = Kimi's default (r266)", async () => {
  const models = [
    { id: "kimi-code/kimi-for-coding", displayName: "Kimi for Coding", inputModalities: ["text", "image"], isDefault: true },
    { id: "kimi-code/k3", displayName: null, inputModalities: ["text"] },
  ];
  const kimi = detail({
    cliKind: "kimi", providerFamilyLabel: "Kimi Code",
    runtimeVariants: [{ id: "kimi", runtime: "kimi", primary: true, defaults: { model: null, reasoningEffort: null }, inUse: 0, models }],
    defaultVariant: "kimi",
    runtimeCompatibility: [{ runtime: "kimi", status: "supported", reason: null, variantPresent: true }],
  } as never);
  fx.api.patchProfileVariant = vi.fn().mockResolvedValue({ ok: true, profile: kimi, variant: null });
  act(() => root.render(h(ProfileVariantsSection, { detail: kimi, onChanged: vi.fn() })));
  const select = host.querySelector('[data-variant-row="kimi"] select') as HTMLSelectElement;
  expect([...select.options].map((o) => [o.value, o.textContent])).toEqual([["", "variants.defaults.modelRuntimeDefault"], ["kimi-code/kimi-for-coding", "Kimi for Coding"], ["kimi-code/k3", "kimi-code/k3"]]);
  expect(select.value).toBe("");
  act(() => { select.value = "kimi-code/k3"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  await act(async () => button("variants.save").click());
  expect(fx.api.patchProfileVariant).toHaveBeenCalledWith("omega", "kimi", { model: "kimi-code/k3" });
});


it("provider-first DeepSeek relay preflights its DSH address and sends it only on the variant", async () => {
  fx.features.add("profile-relay-runtimes");
  try {
    fx.api.createProfile = vi.fn().mockResolvedValue(detail({ runtimeVariants: [detail().runtimeVariants![0]!] }));
    fx.api.addProfileVariant = vi.fn().mockResolvedValue({ ok: true, profile: detail(), variant: null });
    act(() => root.render(h(NewProfileVariantsForm, { existing: [], onCreated: vi.fn(), onCancel: vi.fn() })));
    expect(host.querySelector("[data-provider-cards]")).not.toBeNull();
    act(() => host.querySelector<HTMLButtonElement>('[data-provider-card="deepseek"]')!.click());
    const address = host.querySelector<HTMLInputElement>('input[value^="https://api.deepseek.com"]')!;
    type(address, "https://relay.example/v1");
    act(() => host.querySelector<HTMLButtonElement>('[data-variant-choice="dsh"] [role=checkbox]')!.click());
    type(host.querySelector<HTMLInputElement>('input[placeholder="deepseek"]')!, "relay");
    await act(async () => button("newProfile.create").click());
    expect(fx.api.createProfile).not.toHaveBeenCalled();
    expect(host.textContent).toContain("variants.error.variantBaseUrlMissing");
    type(host.querySelector<HTMLInputElement>('input[aria-label^="DSH ·"]')!, "https://relay.example/native");
    await act(async () => button("newProfile.create").click());
    expect(fx.api.createProfile).toHaveBeenCalledWith({ name: "relay", kind: "apiKey", preset: "deepseek", baseUrl: "https://relay.example/v1" });
    expect(fx.api.addProfileVariant).toHaveBeenCalledWith("omega", { runtime: "dsh", defaults: { model: "deepseek-flash" }, baseUrl: "https://relay.example/native" });
  } finally { fx.features.delete("profile-relay-runtimes"); }
});

it("provider-first Anthropic-compatible key creates its account before its Claude profile", async () => {
  fx.features.add("claude-accounts");
  try {
    fx.api.createClaudeAccount = vi.fn().mockResolvedValue({ ok: true, account: { id: "ca-relay" } });
    fx.api.createProfile = vi.fn().mockResolvedValue(detail());
    act(() => root.render(h(NewProfileVariantsForm, { existing: [], onCreated: vi.fn(), onCancel: vi.fn(), initialPreset: "deepseek" })));
    act(() => host.querySelector<HTMLInputElement>('[data-auth-option="anthropicCompatible"] input')!.click());
    type(host.querySelector<HTMLInputElement>('input[type="password"]')!, KEY);
    type(host.querySelector<HTMLInputElement>('input[placeholder="deepseek"]')!, "claude-relay");
    await act(async () => button("newProfile.create").click());
    expect(fx.api.createClaudeAccount).toHaveBeenCalledWith({ label: "claude-relay", kind: "api", keyEnv: "ANTHROPIC_AUTH_TOKEN", baseUrl: "https://api.deepseek.com/anthropic", apiKey: KEY });
    expect(fx.api.createProfile).toHaveBeenCalledWith({ name: "claude-relay", kind: "claude", claudeAccount: "ca-relay" });
    expect(fx.api.createClaudeAccount.mock.invocationCallOrder[0]).toBeLessThan(fx.api.createProfile.mock.invocationCallOrder[0]!);
    expect(host.querySelector<HTMLInputElement>('input[type="password"]')!.value).toBe("");
  } finally { fx.features.delete("claude-accounts"); }
});


it("provider-first host variable auth retains the DeepSeek preset and creates a DSH-only profile", async () => {
  fx.api.createProfile = vi.fn().mockResolvedValue(detail());
  act(() => root.render(h(NewProfileVariantsForm, { existing: [], onCreated: vi.fn(), onCancel: vi.fn(), initialPreset: "deepseek" })));
  act(() => button("newProfile.advanced").click());
  act(() => host.querySelector<HTMLInputElement>('[data-auth-option="dshEnv"] input')!.click());
  type(host.querySelector<HTMLInputElement>('input[placeholder="deepseek"]')!, "dsh-env");
  await act(async () => button("newProfile.create").click());
  expect(fx.api.createProfile).toHaveBeenCalledWith({ name: "dsh-env", kind: "dsh", options: { dsh: { model: "deepseek-flash" } }, credential: { source: "env", envName: "DEEPSEEK_API_KEY" } });
});

it("normalizes DeepSeek official /v1 spelling before create so DSH keeps its official default", async () => {
  fx.features.add("profile-relay-runtimes");
  try {
    fx.api.createProfile = vi.fn().mockResolvedValue(detail({ runtimeVariants: [detail().runtimeVariants![0]!] }));
    fx.api.addProfileVariant = vi.fn().mockResolvedValue({ ok: true, profile: detail(), variant: null });
    act(() => root.render(h(NewProfileVariantsForm, { existing: [], onCreated: vi.fn(), onCancel: vi.fn(), initialPreset: "deepseek" })));
    type(host.querySelector<HTMLInputElement>('input[value^="https://api.deepseek.com"]')!, "https://api.deepseek.com/v1");
    act(() => host.querySelector<HTMLButtonElement>('[data-variant-choice="dsh"] [role=checkbox]')!.click());
    type(host.querySelector<HTMLInputElement>('input[placeholder="deepseek"]')!, "official");
    await act(async () => button("newProfile.create").click());
    expect(fx.api.createProfile).toHaveBeenCalledWith({ name: "official", kind: "apiKey", preset: "deepseek" });
    expect(fx.api.addProfileVariant).toHaveBeenCalledWith("omega", { runtime: "dsh", defaults: { model: "deepseek-flash" } });
  } finally { fx.features.delete("profile-relay-runtimes"); }
});
