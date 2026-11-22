// @vitest-environment jsdom
// Profile → 模型与上下文 (owner 2026-11-18): one skeleton for every runtime; choices a host cannot store yet are
// greyed with the reason; a saved value — including the earlier Claude 约 N 万 token values — shows as 自定义 and
// is not rewritten unless the owner changes it; the catalog shows 5 rows and folds the rest into 「全部 N 个模型」.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CatalogModel, ProfileDetail, ProfileModelsView } from "../src/shared/ipc";

const env = vi.hoisted(() => ({ features: new Set<string>(), api: {}, shelf: vi.fn() }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ locale: "en", t: (key: string, vars?: Record<string, unknown>) => (vars && "n" in vars ? `${key}:${vars.n}` : vars && "reason" in vars ? `${key}(${vars.reason})` : key) }) }));
vi.mock("../src/renderer/src/lib/targetHost", async (original) => ({
  ...(await original<object>()),
  useTargetFeatures: () => env.features, useTargetHostId: () => "host", useTargetApi: () => env.api,
}));
vi.mock("../src/renderer/src/lib/modelDisplay", async (importOriginal) => ({
  ...(await importOriginal<object>()), useModelName: () => (id: string) => id, modelLabel: (id: string) => id, updateProfileModelNames: () => {},
}));
vi.mock("../src/renderer/src/lib/settingsShelf", async (importOriginal) => ({ ...(await importOriginal<object>()), openSettingsShelf: env.shelf }));
import { ProfileContextRows, ProfileModelFields } from "../src/renderer/src/components/settings/ProfileModelFields";
import { ModelList } from "../src/renderer/src/components/settings/ProfileModels";
import { MODELS_ON_PAGE } from "../src/renderer/src/lib/profileModels";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement; let root: Root;
beforeEach(() => {
  env.features = new Set(["claude-compaction", "claude-compaction-models"]); env.shelf.mockReset();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const row = (key: string) => [...host.querySelectorAll("[data-setting-row]")].find((r) => r.textContent?.startsWith(key))!;
const select = (key: string) => row(key).querySelector("select")!;
const options = (key: string) => [...select(key).options].map((o) => [o.value, o.disabled] as const);
const pick = (key: string, value: string) => act(() => { const s = select(key); s.value = value; s.dispatchEvent(new Event("change", { bubbles: true })); });
const W = "settings.modelContext.window", C = "settings.modelContext.compact";

const model = (id: string, extra: Partial<CatalogModel> = {}): CatalogModel => ({
  id, displayName: null, contextWindow: 272_000, maxContextWindow: 400_000, autoCompactTokenLimit: null, effectiveContextWindowPercent: null,
  inputModalities: ["text"], supportedReasoningEfforts: ["low", "high"], defaultReasoningEffort: "high", isDefault: false, discovered: true,
  effective: { contextWindow: 272_000, contextWindowSource: "catalog", autoCompactTokenLimit: 244_800, autoCompactTokenLimitSource: "default90Percent" }, ...extra,
});
const view = (models: CatalogModel[], extra: Partial<ProfileModelsView> = {}): ProfileModelsView => ({
  profile: { id: "p", name: "P" }, catalogSupported: false, catalogPresent: true, selectedModel: models[0]?.id ?? null,
  profileOverrides: { modelContextWindow: null, modelAutoCompactTokenLimit: null }, discovery: null, models, unsupportedModelFields: [], precedence: null, ...extra,
});
const codex = (config: Record<string, unknown> = {}, editable = true) => ({ id: "p", cliKind: "codex", detail: { config, editable: { model: true, modelReasoningEffort: true, modelReasoningSummary: true, modelContextWindow: editable, modelAutoCompactTokenLimit: editable } } }) as unknown as ProfileDetail;
const claude = (claudeCompaction: unknown) => ({ id: "c", cliKind: "claude", claudeCompaction, detail: { editable: { model: true, modelReasoningEffort: true, claudeCompaction: true } } }) as unknown as ProfileDetail;


const fireInput = (input: HTMLInputElement, value: string) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
const drow = (dialog: Element, key: string) => [...dialog.querySelectorAll("[data-setting-row]")].find(r => r.textContent?.startsWith(key))!;

it("REVIEW: invalid custom compaction must not save the previous intermediate value", async () => {
  env.features.add("profile-model-context-v1");
  HTMLDialogElement.prototype.showModal = vi.fn(); HTMLDialogElement.prototype.close = vi.fn();
  const { ProfileModelDialog } = await import("../src/renderer/src/components/settings/ProfileModelDialog");
  const v = view([model("gpt", { contextWindow: 200_000, maxContextWindow: 400_000, autoCompactTokenLimit: 150_000 })], {
    catalogSupported: true, modelContextSettingsV1: true, modelContextSettingsV1Supported: true,
    modelContextSettingsSupport: { supported: true, reason: null },
  });
  const patchModel = vi.fn().mockResolvedValue(v); Object.assign(env.api, { patchModel });
  act(() => root.render(h(ProfileModelDialog, { model: v.models[0]!, profile: "p", view: v, onSaved: vi.fn(), onClose: vi.fn() })));
  const dialog = document.querySelector("dialog")!;
  fireInput(drow(dialog, C).querySelector("input")!, "160k");
  fireInput(drow(dialog, C).querySelector("input")!, "160kx");
  expect(drow(dialog, C).textContent).toContain("settings.modelContext.error.customText");
  const save = [...dialog.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === "settings.save")!;
  await act(async () => save.click());
  console.log("REVIEW_INVALID_SAVE", JSON.stringify({ disabled: save.disabled, calls: patchModel.mock.calls }));
  expect(patchModel, "A visible invalid input must block persistence, not save its last valid prefix").not.toHaveBeenCalled();
});

it("REVIEW: unknown unsupported Claude model reason must disable editing as at Profile level", async () => {
  env.features.add("profile-model-context-v1");
  HTMLDialogElement.prototype.showModal = vi.fn(); HTMLDialogElement.prototype.close = vi.fn();
  const { ProfileModelDialog } = await import("../src/renderer/src/components/settings/ProfileModelDialog");
  const unsupported = { supported: false, reason: "futureRuntimeIncompatible" };
  const cdetail = { ...claude(null), modelContextSettingsSupport: unsupported } as unknown as ProfileDetail;
  act(() => root.render(h(ProfileContextRows, { kind: "claude", detail: cdetail, models: null, cfg: {}, patch: {}, setOrDrop: vi.fn() })));
  expect(select(W).disabled).toBe(true);
  const v = view([model("claude-sonnet")], { modelsSource: { kind: "claudeReference" }, modelContextSettingsSupport: unsupported });
  const patchProfile = vi.fn().mockResolvedValue(cdetail); Object.assign(env.api, { patchProfile, profileModels: vi.fn().mockResolvedValue(v) });
  act(() => root.render(h(ProfileModelDialog, { model: v.models[0]!, profile: "c", view: v, catalog: false,
    claude: { table: null, profile: null, ids: ["claude-sonnet"], window: 200_000, onDetail: vi.fn() }, onSaved: vi.fn(), onClose: vi.fn() })));
  const dialog = document.querySelector("dialog")!;
  const windowSelect = drow(dialog, W).querySelector<HTMLSelectElement>("select")!;
  console.log("REVIEW_UNKNOWN_SUPPORT", JSON.stringify({ windowDisabled: windowSelect.disabled, text: drow(dialog, W).textContent }));
  act(() => { windowSelect.value = "200000"; windowSelect.dispatchEvent(new Event("change", { bubbles: true })); });
  await act(async () => [...dialog.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === "settings.save")!.click());
  console.log("REVIEW_UNSUPPORTED_WRITE", JSON.stringify(patchProfile.mock.calls));
  expect(patchProfile, "Unknown supported:false must not regain writable controls in the model dialog").not.toHaveBeenCalled();
});

it("REVIEW DELTA: another valid row must not clear invalid custom compaction text", async () => {
  env.features.add("profile-model-context-v1");
  HTMLDialogElement.prototype.showModal = vi.fn(); HTMLDialogElement.prototype.close = vi.fn();
  const { ProfileModelDialog } = await import("../src/renderer/src/components/settings/ProfileModelDialog");
  const v = view([model("gpt", { contextWindow: 200_000, maxContextWindow: 400_000, autoCompactTokenLimit: 150_000 })], {
    catalogSupported: true, modelContextSettingsV1: true, modelContextSettingsV1Supported: true,
    modelContextSettingsSupport: { supported: true, reason: null },
  });
  const patchModel = vi.fn().mockResolvedValue(v); Object.assign(env.api, { patchModel });
  act(() => root.render(h(ProfileModelDialog, { model: v.models[0]!, profile: "p", view: v, onSaved: vi.fn(), onClose: vi.fn() })));
  const dialog = document.querySelector("dialog")!;
  fireInput(drow(dialog, C).querySelector("input")!, "160kx");
  const save = [...dialog.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === "settings.save")!;
  expect(save.disabled).toBe(true);
  const windowSelect = drow(dialog, W).querySelector<HTMLSelectElement>("select")!;
  act(() => { windowSelect.value = "400000"; windowSelect.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(drow(dialog, C).querySelector<HTMLInputElement>("input")!.value).toBe("160kx");
  await act(async () => save.click());
  console.log("REVIEW_CROSS_ROW_SAVE", JSON.stringify({ disabled: save.disabled, calls: patchModel.mock.calls }));
  expect(patchModel, "Invalid compaction text remains displayed after a valid window change").not.toHaveBeenCalled();
});
