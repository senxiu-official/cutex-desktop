// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CatalogModel, ProfileDetail, ProfileModelsView, QuotaConfigView } from "../src/shared/ipc";
import { en, zhCN } from "../src/renderer/src/lib/settingsProfileParityMessages";

const env = vi.hoisted(() => ({ features: new Set<string>(), loadQuota: vi.fn(), api: {}, quotas: {} }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ locale: "en", t: (key: string, vars?: Record<string, string | number>) => {
  let text = (en as Record<string, string>)[key] ?? key;
  for (const [name, value] of Object.entries(vars ?? {})) text = text.replaceAll(`{${name}}`, String(value));
  return text;
} }) }));
vi.mock("../src/renderer/src/lib/targetHost", async (importOriginal) => ({ ...(await importOriginal<object>()),
  useTargetFeatures: () => env.features, useTargetHostId: () => "test-host", useTargetApi: () => env.api,
  useTargetLoadQuota: () => env.loadQuota, useTargetQuotas: () => env.quotas,
}));
vi.mock("../src/renderer/src/lib/modelDisplay", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useModelName: () => (id: string) => id, modelLabel: (id: string, display?: string, entry?: string) => entry || display || id,
  updateProfileModelNames: () => {},
}));
import { ProfileModelFields } from "../src/renderer/src/components/settings/ProfileModelFields";
import { ProfileModelDialog } from "../src/renderer/src/components/settings/ProfileModelDialog";
import { ModelList } from "../src/renderer/src/components/settings/ProfileModels";
import { OfficialQuotaSection, QuotaConfigSection } from "../src/renderer/src/components/settings/ProfileQuota";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement; let root: Root;
beforeEach(() => { env.features.clear(); env.loadQuota.mockReset(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const model: CatalogModel = {
  id: "api-model", displayName: "API Model", contextWindow: 200_000, maxContextWindow: 400_000,
  autoCompactTokenLimit: null, effectiveContextWindowPercent: null, inputModalities: ["text"],
  supportedReasoningEfforts: ["low", "high"], defaultReasoningEffort: "high", isDefault: true, discovered: true,
  effective: { contextWindow: 300_000, contextWindowSource: "profile", autoCompactTokenLimit: 270_000, autoCompactTokenLimitSource: "default90Percent" },
};
const view: ProfileModelsView = {
  profile: { id: "p", name: "API account" }, catalogSupported: false, catalogPresent: true,
  selectedModel: model.id, profileOverrides: { modelContextWindow: 300_000, modelAutoCompactTokenLimit: null },
  discovery: null, models: [model], unsupportedModelFields: [], precedence: null,
};
const detail = { id: "p", cliKind: "codex", detail: { editable: { model: true, modelReasoningEffort: true, modelContextWindow: false, modelAutoCompactTokenLimit: false } } } as unknown as ProfileDetail;

it("clears Profile effort to inherit while retaining a stored unlisted value for removal", () => {
  const set = vi.fn();
  act(() => root.render(h(ProfileModelFields, { detail, models: view, cfg: { model: model.id, modelReasoningEffort: "custom-level" }, set })));
  const selects = host.querySelectorAll("select");
  expect([...selects[1]!.options].map((o) => o.value)).toEqual(["", "low", "high", "custom-level"]);
  act(() => { selects[1]!.value = ""; selects[1]!.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(set).toHaveBeenCalledWith({ modelReasoningEffort: null });
  expect(host.textContent).toContain("An explicit Profile value takes precedence");
});

it("does not invent supported effort levels when model metadata omits them", () => {
  const set = vi.fn();
  act(() => root.render(h(ProfileModelFields, { detail, models: { ...view, models: [{ ...model, supportedReasoningEfforts: [], defaultReasoningEffort: null }] }, cfg: { model: model.id }, set })));
  expect([...host.querySelectorAll("select")[1]!.options].map((o) => o.value)).toEqual([""]);
  expect(host.textContent).toContain("catalog provides no reasoning levels");
  expect(set).not.toHaveBeenCalled();
});

it("shows reported reasoning and effective limit sources on a read-only Codex model list", () => {
  act(() => root.render(h(ModelList, { profile: "p", view, setView: vi.fn() })));
  expect(host.querySelector('[data-model-effort="api-model"]')!.textContent).toContain("Reasoning: low / high");
  expect(host.textContent).toContain("Model default: high");
  expect(host.textContent).toContain("agent-config.profile.source.profile");
  expect(host.textContent).toContain("agent-config.profile.source.default90Percent");
  expect(host.textContent).not.toContain("agent-config.profile.vision");
  expect(host.textContent).not.toContain("agent-config.profile.edit");
});

it("saves an unset catalog effort without assigning a fixed Profile effort", async () => {
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
  const patchModel = vi.fn().mockResolvedValue(view); Object.assign(env.api, { patchModel });
  const onSaved = vi.fn();
  act(() => root.render(h(ProfileModelDialog, { model, profile: "p", view, onSaved, onClose: vi.fn() })));
  const dialog = document.querySelector("dialog")!;
  expect(dialog.textContent).toContain("do not change provider capabilities");
  const selects = dialog.querySelectorAll("select"); const effort = selects[selects.length - 1]!;
  act(() => { effort.value = ""; effort.dispatchEvent(new Event("change", { bubbles: true })); });
  await act(async () => [...dialog.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "settings.save")!.click());
  expect(patchModel).toHaveBeenCalledWith("p", "api-model", expect.objectContaining({ defaultReasoningEffort: null, supportedReasoningEfforts: ["low", "high"] }));
  expect(onSaved).toHaveBeenCalledWith(view);
});

it("starts a manual model entry without guessed reasoning capabilities", () => {
  HTMLDialogElement.prototype.showModal = vi.fn(); HTMLDialogElement.prototype.close = vi.fn();
  act(() => root.render(h(ProfileModelDialog, { model: null, profile: "p", view, onSaved: vi.fn(), onClose: vi.fn() })));
  const dialog = document.querySelector("dialog")!;
  expect(dialog.querySelector('[aria-pressed="true"]')).toBeNull();
  const selects = dialog.querySelectorAll("select");
  expect([...selects[selects.length - 1]!.options].map((o) => o.value)).toEqual([""]);
});

it("separates API quota readings from draft setup and refreshes without saving drafts", () => {
  env.features.add("profile-generic-switches");
  const setDraft = vi.fn();
  const draft: QuotaConfigView = { profile: { id: "p", name: "API account" }, resolvedPrimary: null, presetError: null, preset: "custom", primary: { enabled: false, url: "https://provider.test/quota", auth: "none", label: "quota", refresh_seconds: 60, mode: "balance", value_pointer: "/balance", limit_pointer: "", reset_pointer: "", reset_format: "rfc3339", window_label: null }, extras: [] };
  act(() => root.render(h(QuotaConfigSection, { profile: "p", name: "API account", draft, setDraft })));
  expect(host.textContent).toContain("Profile “API account” on the selected host");
  expect([...host.querySelectorAll("h4")].map((x) => x.textContent)).toEqual(["Readings", "Sources and refresh rules"]);
  expect(host.textContent).toContain("do not set spending limits");
  const refresh = host.querySelector<HTMLButtonElement>('button[aria-label="composer.quota.refresh"]')!;
  act(() => refresh.click());
  expect(env.loadQuota).toHaveBeenCalledWith("p", true);
  expect(setDraft).not.toHaveBeenCalled();
  const enable = [...host.querySelectorAll("button")].find((x) => x.textContent === "agent-config.quota.enableNow")!;
  act(() => enable.click());
  expect(setDraft).toHaveBeenCalledWith(expect.objectContaining({ primary: expect.objectContaining({ enabled: true }) }));
});

it("explains ChatGPT quota without offering an API reader", () => {
  act(() => root.render(h(OfficialQuotaSection, { profile: "p", name: "Subscription", claude: false })));
  expect(host.textContent).toContain("ChatGPT account quota for Profile “Subscription”");
  expect(host.querySelector("select")).toBeNull();
});

it("keeps both parity catalogs complete with matching substitutions", () => {
  expect(Object.keys(en)).toEqual(Object.keys(zhCN));
  for (const key of Object.keys(zhCN) as (keyof typeof zhCN)[]) expect(en[key].match(/\{\w+\}/g) ?? []).toEqual(zhCN[key].match(/\{\w+\}/g) ?? []);
});
