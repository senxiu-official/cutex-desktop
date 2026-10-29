// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProfileDetail, ProfilePreset } from "../src/shared/ipc";
import { useApp } from "../src/renderer/src/store";
import { providerPresetDraft } from "../src/renderer/src/lib/profileProviderDraft";
import { presetsOf } from "../src/renderer/src/lib/profilePresets";
import { zhCN, en } from "../src/renderer/src/lib/settingsProviderMessages";

const fx = vi.hoisted(() => ({ api: { createProfile: vi.fn() }, openSettings: vi.fn(), presets: [] as ProfilePreset[] }));
vi.mock("../src/renderer/src/bridge", () => ({ bridge: { on: () => () => {} }, api: {} }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key, locale: "zh-CN" }) }));
vi.mock("../src/renderer/src/lib/targetHost", async (importOriginal) => ({ ...(await importOriginal<object>()), useTargetApi: () => fx.api, useTargetHostId: () => "picked-host", useTargetFeatures: () => new Set(["profile-create"]) }));
vi.mock("../src/renderer/src/lib/useProfilePresets", () => ({ useProfilePresets: () => fx.presets }));
vi.mock("../src/renderer/src/components/ComponentCard", () => ({ ComponentNotice: () => null }));
vi.mock("../src/renderer/src/components/settings/ProfileClaudeAccount", () => ({ NewClaudeAccountRow: () => null }));
const { ProfileProviderPicker } = await import("../src/renderer/src/components/settings/ProfileProviderPicker");
const { NewProfileForm } = await import("../src/renderer/src/components/settings/NewProfileForm");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const openai: ProfilePreset = { id: "openai", label: "OpenAI", providerId: "openai-api", baseUrl: "https://api.openai.com/v1", baseUrlRequired: false, aliases: [], providerFamily: "openai-api", providerFamilyLabel: "OpenAI", defaultModel: null };
const glm: ProfilePreset = { ...openai, id: "zhipu", label: "GLM", providerId: "zhipu", providerFamily: "zhipu", providerFamilyLabel: "GLM", baseUrl: "https://open.bigmodel.cn/api/v1", defaultModel: "glm-host-model", modelCatalog: true, webSearch: "disabled", toolSchemaCompat: "strict" };
let host: HTMLDivElement; let root: Root;
beforeEach(() => { vi.clearAllMocks(); useApp.setState({ openSettings: fx.openSettings }); fx.presets = [glm, openai]; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const input = (el: HTMLInputElement, value: string) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); };

describe("host provider presets", () => {
  it("exposes host-supported choices and an enabled Anthropic account route", () => {
    const choose = vi.fn();
    act(() => root.render(h(ProfileProviderPicker, { presets: fx.presets, value: "zhipu", onChange: choose })));
    const select = host.querySelector("select")!;
    expect(select.options[0]!.value).toBe("openai");
    expect(select.querySelector<HTMLOptionElement>('option[value="__anthropic"]')!.disabled).toBe(false);
    act(() => { select.value = ""; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(choose).toHaveBeenCalledWith("");
    expect(host.querySelector('[role="tooltip"]')).not.toBeNull();
  });
  it("places provider before name and sends the host preset with editable URL on create", async () => {
    const created = vi.fn(); fx.api.createProfile.mockResolvedValue({ name: "my-provider" });
    act(() => root.render(h(NewProfileForm, { existing: [], onCreated: created, onCancel: vi.fn() })));
    act(() => host.querySelector<HTMLButtonElement>('[data-provider-card="openai"]')!.click());
    act(() => host.querySelector<HTMLInputElement>('[data-auth-option="apiKey"] input')!.click());
    const provider = host.querySelector("[data-provider-chosen]")!;
    const name = host.querySelector<HTMLInputElement>('input[aria-label="newProfile.name.label"]')!;
    expect(provider.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    act(() => input(name, "my-provider"));
    const url = host.querySelector<HTMLInputElement>('input[aria-label="newProfile.address.label"]')!;
    expect(url.value).toBe(openai.baseUrl);
    act(() => input(url, "https://relay.example/v1"));
    await act(async () => Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "newProfile.create")!.click());
    expect(fx.api.createProfile).toHaveBeenCalledExactlyOnceWith({ name: "my-provider", kind: "apiKey", preset: "openai", baseUrl: "https://relay.example/v1" });
    expect(created).toHaveBeenCalledOnce();
  });
  it("fills declared defaults without replacing provider IDs, credentials or the existing catalog", () => {
    const detail = { detail: { config: { modelProvider: "zhipu" }, editable: { webSearch: true, toolSchemaCompat: true, providerEnvKey: false } } } as unknown as ProfileDetail;
    expect(providerPresetDraft(glm, detail)).toEqual({ providerBaseUrl: glm.baseUrl, providerName: "GLM", providerWireApi: "responses", requiresOpenaiAuth: false, model: "glm-host-model", modelReasoningEffort: null, webSearch: "disabled", toolSchemaCompat: "strict" });
    expect(providerPresetDraft(openai, detail)).not.toHaveProperty("webSearch");
    expect(providerPresetDraft({ ...glm, webSearch: "live" }, { ...detail, searchTool: true, detail: { ...detail.detail, editable: { webSearch: true, searchTool: true } } })).toMatchObject({ webSearch: "live", searchTool: false });
    expect(providerPresetDraft(openai, detail)).toEqual({});
    expect(providerPresetDraft(glm, { detail: { editable: { providerOptions: false, model: false, modelReasoningEffort: false } } } as unknown as ProfileDetail)).toEqual({});
  });
  it("accepts only known strict-compat metadata and preserves absent old-host defaults", () => {
    expect(presetsOf([{ ...glm, toolSchemaCompat: "strict" }])![0]!.toolSchemaCompat).toBe("strict");
    expect(presetsOf([{ ...glm, toolSchemaCompat: "guess" }])![0]).not.toHaveProperty("toolSchemaCompat");
    expect(presetsOf([openai])![0]).not.toHaveProperty("toolSchemaCompat");
    expect(Object.keys(en)).toEqual(Object.keys(zhCN));
  });
  it("offers a new preselected Profile for another provider without modifying or creating on selection", () => {
    const openNew = vi.fn();
    act(() => root.render(h(ProfileProviderPicker, { presets: fx.presets, value: "openai", providerId: "zhipu", edit: true, onChange: vi.fn(), onCreateProvider: openNew })));
    expect(openNew).not.toHaveBeenCalled(); expect(fx.api.createProfile).not.toHaveBeenCalled();
    act(() => host.querySelector<HTMLButtonElement>('[data-provider-create] button')!.click());
    expect(openNew).toHaveBeenCalledExactlyOnceWith("openai");
    act(() => root.render(h(NewProfileForm, { existing: [], initialPreset: "openai", onCreated: vi.fn(), onCancel: vi.fn() })));
    expect(host.querySelector("[data-provider-chosen]")!.getAttribute("data-provider-chosen")).toBe("openai");
    expect(host.querySelector<HTMLInputElement>('[data-auth-option="apiKey"] input')!.checked).toBe(true);
    expect(host.querySelector<HTMLInputElement>('input[aria-label="newProfile.address.label"]')!.value).toBe(openai.baseUrl);
    expect(host.querySelector<HTMLInputElement>('input[aria-label="newProfile.name.label"]')!.value).toBe("");
    expect(fx.api.createProfile).not.toHaveBeenCalled();
  });
});

it("Anthropic is its own card: no detour to the Claude 账户 page, no Codex Profile", () => {
  act(() => root.render(h(NewProfileForm, { existing: [], onCreated: vi.fn(), onCancel: vi.fn() })));
  act(() => host.querySelector<HTMLButtonElement>('[data-provider-card="anthropic"]')!.click());
  // Without claude-accounts only the subscription login is offered (the inline key needs a Claude API account).
  expect([...host.querySelectorAll("[data-auth-option]")].map((e) => e.getAttribute("data-auth-option"))).toEqual(["claudeSubscription"]);
  expect(fx.openSettings).not.toHaveBeenCalled();
  expect(fx.api.createProfile).not.toHaveBeenCalled();
});
it("preserves ChatGPT and Claude login creation alongside provider-first API creation", async () => {
  act(() => root.render(h(NewProfileForm, { existing: [], onCreated: vi.fn(), onCancel: vi.fn() })));
  act(() => host.querySelector<HTMLButtonElement>('[data-provider-card="openai"]')!.click());
  expect(host.querySelector('input[aria-label="newProfile.address.label"]')).toBeNull();
  act(() => input(host.querySelector<HTMLInputElement>('input[aria-label="newProfile.name.label"]')!, "chatgpt-work"));
  await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "newProfile.create")!.click());
  expect(fx.api.createProfile).toHaveBeenLastCalledWith({ name: "chatgpt-work", kind: "chatgpt" });
  act(() => [...host.querySelectorAll("button")].find(button => button.textContent === "newProfile.changeProvider")!.click());
  act(() => host.querySelector<HTMLButtonElement>('[data-provider-card="anthropic"]')!.click());
  await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "newProfile.create")!.click());
  expect(fx.api.createProfile).toHaveBeenLastCalledWith({ name: "chatgpt-work", kind: "claude" });
});
