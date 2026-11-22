// @vitest-environment jsdom
// P13 owner decision B (cutex feat/r290-model-context-unification b1c55892, docs/model-context-contract.md): per field,
// preserved > owner > Profile > catalog built-in. The desktop reads contextSettings.owner / preserved (the flat row
// numbers are catalog recommendations), shows each field's own source, offers 使用此模型原设置 for a preserved value
// as its own request, labels 默认 only with a number the backend resolved, and lets the first model edit of an
// API-key Profile without a catalog create it.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogModel, ContextEffective, ProfileDetail, ProfileModelsView } from "../src/shared/ipc";

const env = vi.hoisted(() => ({ features: new Set<string>(), api: {} as Record<string, unknown>, shelf: vi.fn() }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ locale: "en", t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key}${JSON.stringify(vars)}` : key) }) }));
vi.mock("../src/renderer/src/lib/targetHost", async (original) => ({
  ...(await original<object>()),
  useTargetFeatures: () => env.features, useTargetHostId: () => "host", useTargetApi: () => env.api,
}));
vi.mock("../src/renderer/src/lib/modelDisplay", async (importOriginal) => ({
  ...(await importOriginal<object>()), useModelName: () => (id: string) => id, modelLabel: (id: string) => id, updateProfileModelNames: () => {},
}));
vi.mock("../src/renderer/src/lib/settingsShelf", async (importOriginal) => ({ ...(await importOriginal<object>()), openSettingsShelf: env.shelf }));
import { ProfileContextRows } from "../src/renderer/src/components/settings/ProfileModelFields";
import { ModelList } from "../src/renderer/src/components/settings/ProfileModels";
import { catalogFirst, codexEffective, codexPercentBlock, contextReasonMessage } from "../src/renderer/src/lib/contextCompaction";
import { changedContext, compactField, defaultNumbers, layeredView, pinnedSource, sourceKey, windowField } from "../src/renderer/src/lib/contextLayers";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement; let root: Root;
beforeEach(() => {
  env.features = new Set(["profile-model-context-v1"]); env.api = {};
  HTMLDialogElement.prototype.showModal = vi.fn(); HTMLDialogElement.prototype.close = vi.fn();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const W = "settings.modelContext.window", C = "settings.modelContext.compact";
const rowIn = (scope: ParentNode, key: string) => [...scope.querySelectorAll("[data-setting-row]")].find((r) => r.textContent?.startsWith(key))!;
const optionLabels = (scope: ParentNode, key: string) => [...rowIn(scope, key).querySelector("select")!.options].map((o) => [o.value, o.textContent, o.disabled] as const);
const pick = (scope: ParentNode, key: string, value: string) => act(() => { const s = rowIn(scope, key).querySelector("select")!; s.value = value; s.dispatchEvent(new Event("change", { bubbles: true })); });

const eff = (over: Partial<ContextEffective> = {}): ContextEffective => ({ contextWindow: 272_000, contextWindowSource: "catalog", autoCompactTokenLimit: 244_800, autoCompactTokenLimitSource: "default90Percent", autoCompactPercent: null, autoCompactPercentSource: "unknown", ...over });
const model = (id: string, extra: Partial<CatalogModel> = {}): CatalogModel => ({
  id, displayName: null, contextWindow: 272_000, maxContextWindow: 400_000, autoCompactTokenLimit: null, effectiveContextWindowPercent: null,
  inputModalities: ["text"], supportedReasoningEfforts: ["low", "high"], defaultReasoningEffort: "high", isDefault: false, discovered: true,
  effective: eff(), contextSettings: { catalog: { contextWindow: 272_000 }, owner: {}, preserved: {} },
  defaultValues: { model: eff(), profile: eff() }, ...extra,
});
const view = (models: CatalogModel[], extra: Partial<ProfileModelsView> = {}): ProfileModelsView => ({
  profile: { id: "p", name: "P" }, catalogSupported: true, catalogPresent: true, selectedModel: models[0]?.id ?? null,
  modelContextSettingsV1: true, modelContextSettingsV1Supported: true, modelContextSettingsSupport: { supported: true, reason: null },
  profileOverrides: { modelContextWindow: null, modelAutoCompactTokenLimit: null }, discovery: null, models, unsupportedModelFields: [], precedence: null,
  profileDefaultValues: { selectedModel: models[0]?.id ?? null, selected: models[0] ? eff() : null }, ...extra,
});
const codex = (config: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({ id: "p", cliKind: "codex", modelContextSettingsV1: true, modelContextSettingsSupport: { supported: true, reason: null }, ...extra, detail: { config, editable: { model: true, modelContextWindow: true, modelAutoCompactTokenLimit: true, modelAutoCompactPercent: true } } }) as unknown as ProfileDetail;
// gpt-5.5 as cutex B reports it after upgrade: owner 128K / 90K, the old effective 200K / 150K preserved.
const preservedRow = () => model("gpt-5.5", {
  contextWindow: 128_000, autoCompactTokenLimit: 90_000,
  contextSettings: { catalog: { contextWindow: 272_000 }, owner: { contextWindow: 128_000, autoCompactTokenLimit: 90_000 }, preserved: { contextWindow: 200_000, autoCompactTokenLimit: 150_000 } },
  effective: eff({ contextWindow: 200_000, contextWindowSource: "preserved", autoCompactTokenLimit: 150_000, autoCompactTokenLimitSource: "preserved" }),
});

describe("pure", () => {
  it("reads the row's own setting from the layers: preserved over owner, never the flat catalog numbers", () => {
    expect(windowField(preservedRow())).toEqual({ value: 200_000, owner: 128_000, preserved: true });
    expect(compactField(preservedRow())).toEqual({ value: { tokens: 150_000 }, owner: { tokens: 90_000 }, preserved: true });
    // Flat 272K / 90K with an empty owner layer: nothing set on this model.
    const plain = model("m", { autoCompactTokenLimit: 90_000 });
    expect(windowField(plain)).toEqual({ value: null, owner: null, preserved: false });
    expect(compactField(plain).value).toBeNull();
  });

  it("sends only the fields the owner changed (an unchanged one would pin a recommendation or drop a preserved value)", () => {
    const initial = { contextWindow: 200_000, autoCompactPercent: null, autoCompactTokenLimit: 150_000 };
    expect(changedContext(initial, { ...initial })).toEqual({});
    expect(changedContext(initial, { ...initial, contextWindow: 300_000 })).toEqual({ contextWindow: 300_000 });
    expect(changedContext(initial, { ...initial, autoCompactPercent: 80, autoCompactTokenLimit: null })).toEqual({ autoCompactPercent: 80, autoCompactTokenLimit: null });
  });

  it("source tags are generic, per field, with preserved; unknown future tags read 未知", () => {
    expect(["model", "profile", "catalog", "reference", "preserved", "default90Percent", "runtimeDefault", "unsupported", "somethingNew"].map(sourceKey))
      .toEqual(["source.thisModel", "source.profile", "source.model", "source.model", "source.preserved", "source.default90", "source.runtimeDefault", "source.unsupported", "source.unknown"]);
    expect([pinnedSource("model"), pinnedSource("preserved"), pinnedSource("profile"), pinnedSource("catalog")]).toEqual([true, true, false, false]);
  });

  it("default numbers only as the backend reports them; an uncatalogued model's capacity stays unknown (never 272K)", () => {
    expect(defaultNumbers(eff())).toEqual({ window: 272_000, compactAt: 244_800 });
    expect(defaultNumbers(eff({ contextWindow: null, contextWindowSource: "unknown" }))).toEqual({ window: null, compactAt: 244_800 });
    expect(defaultNumbers(eff({ contextWindow: 272_000, contextWindowSource: "unknown" })).window).toBeNull();
    expect(defaultNumbers(null)).toEqual({ window: null, compactAt: null });
  });

  it("B Profile hints: window and compaction resolve independently (window from the model, compaction from the Profile)", () => {
    const row = model("astra", { contextWindow: 272_000, maxContextWindow: 872_000, autoCompactTokenLimit: 90_000, contextSettings: { catalog: { contextWindow: 272_000, autoCompactTokenLimit: 90_000 }, owner: { contextWindow: 400_000 }, preserved: {} } });
    expect(codexEffective(row, { window: 200_000, compact: { tokens: 150_000 } }, true)).toEqual({ window: 400_000, compactAt: 150_000, own: false, ownWindow: true });
    // No owner values: the Profile wins over the catalog built-ins (90K is a recommendation, not an override).
    const plain = model("p", { autoCompactTokenLimit: 90_000, contextSettings: { catalog: { contextWindow: 272_000, autoCompactTokenLimit: 90_000 }, owner: {}, preserved: {} } });
    expect(codexEffective(plain, { window: 200_000, compact: { tokens: 150_000 } }, true)).toMatchObject({ window: 200_000, compactAt: 150_000, own: false });
    expect(codexEffective(plain, { window: 200_000, compact: null }, true).ownWindow).toBeFalsy();
    expect(codexEffective(plain, { window: null, compact: null }, true)).toMatchObject({ window: 272_000, compactAt: 90_000 });
  });

  it("first model: an API-key Profile without a catalog on a supporting runtime; migration on demand unblocks percent", () => {
    const first = view([], { discoverySupported: true, catalogPresent: false, modelContextSettingsV1: false });
    expect(catalogFirst(first)).toBe(true);
    expect(catalogFirst({ ...first, catalogPresent: true })).toBe(false);
    expect(catalogFirst({ ...first, modelContextSettingsSupport: { supported: false, reason: "nativeModelContextSettingsV2Required" } })).toBe(false);
    expect(codexPercentBlock(true, first, true, { migratesOnEdit: layeredView(first) })).toBeNull();
    expect(codexPercentBlock(true, first, true)).toBe("notMigrated");
  });

  it("the renamed runtime reason reads like the earlier one", () => {
    expect(contextReasonMessage("nativeModelContextSettingsV2Required")).toEqual(contextReasonMessage("nativeModelContextSettingsV1Required"));
  });
});

describe("catalog table", () => {
  it("shows each field's own source; a preserved field offers 使用此模型原设置 as its own request", async () => {
    const mixed = model("astra", { effective: eff({ contextWindow: 400_000, contextWindowSource: "model", autoCompactTokenLimit: 150_000, autoCompactTokenLimitSource: "profile" }) });
    const v = view([preservedRow(), mixed]);
    const patchModel = vi.fn().mockResolvedValue(v); env.api.patchModel = patchModel;
    act(() => root.render(h(ModelList, { profile: "p", view: v, setView: vi.fn() })));
    const cell = (kind: "window" | "compact", id: string) => host.querySelector(`[data-model-${kind}="${id}"]`)!;
    expect(cell("window", "astra").textContent).toContain("settings.modelContext.source.thisModel");
    expect(cell("compact", "astra").textContent).toContain("settings.modelContext.source.profile");
    expect(cell("window", "gpt-5.5").textContent).toContain("settings.modelContext.source.preserved");
    expect(host.querySelector("[data-profile-applies]")?.textContent).toBe("settings.modelContext.profileAppliesHint");
    await act(async () => cell("window", "gpt-5.5").querySelector<HTMLButtonElement>("[data-restore-preserved]")!.click());
    expect(patchModel).toHaveBeenCalledWith("p", "gpt-5.5", { restorePreservedContextWindow: true });
    await act(async () => cell("compact", "gpt-5.5").querySelector<HTMLButtonElement>("[data-restore-preserved]")!.click());
    expect(patchModel).toHaveBeenLastCalledWith("p", "gpt-5.5", { restorePreservedAutoCompaction: true });
    expect(cell("window", "astra").querySelector("[data-restore-preserved]")).toBeNull();
  });
});

describe("model dialog", () => {
  const open = async (m: CatalogModel | null, v: ProfileModelsView) => {
    const { ProfileModelDialog } = await import("../src/renderer/src/components/settings/ProfileModelDialog");
    const onSaved = vi.fn();
    act(() => root.render(h(ProfileModelDialog, { model: m, profile: "p", view: v, onSaved, onClose: vi.fn() })));
    return { dialog: document.querySelector("dialog")!, onSaved };
  };
  const save = (dialog: Element) => act(async () => [...dialog.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "settings.save")!.click());

  it("a row without its own setting shows 默认（X） from defaultValues.model and saves no context fields untouched", async () => {
    const m = model("gpt-6", { autoCompactTokenLimit: 90_000, defaultValues: { model: eff({ contextWindow: 200_000, contextWindowSource: "profile", autoCompactTokenLimit: 150_000, autoCompactTokenLimitSource: "profile" }), profile: eff() } });
    const v = view([m]);
    const patchModel = vi.fn().mockResolvedValue(v); env.api.patchModel = patchModel;
    const { dialog } = await open(m, v);
    expect(rowIn(dialog, W).querySelector("select")!.value).toBe("unset");
    expect(optionLabels(dialog, W)[0]![1]).toBe('settings.modelContext.defaultWith{"value":"200K"}');
    expect(rowIn(dialog, C).querySelector("select")!.value).toBe("default");
    expect(optionLabels(dialog, C)[0]![1]).toBe('settings.modelContext.defaultAbout{"value":"150K"}');
    await save(dialog);
    const patch = patchModel.mock.calls[0]![2];
    expect(patch).not.toHaveProperty("contextWindow");
    expect(patch).not.toHaveProperty("autoCompactTokenLimit");
    expect(patch).not.toHaveProperty("autoCompactPercent");
  });

  // Review of 552e908b7 (disposal-invariant-review, P2): the backend resolved the compaction default for the saved
  // window; a draft window / cap change must not keep showing that number (B resolves 360K for 400K, not 180K).
  it("REVIEW: a draft window or cap change drops the stale default number until saved (plain 默认)", async () => {
    const e = eff({ contextWindow: 200_000, autoCompactTokenLimit: 180_000 });
    const m = model("m", { contextWindow: 200_000, contextSettings: { catalog: { contextWindow: 200_000 }, owner: {}, preserved: {} }, defaultValues: { model: e, profile: e } });
    const { dialog } = await open(m, view([m]));
    expect(optionLabels(dialog, C)[0]![1]).toBe('settings.modelContext.defaultAbout{"value":"180K"}');
    pick(dialog, W, "400000");
    expect(optionLabels(dialog, C)[0]![1]).toBe("settings.modelContext.default");
    // Back to the saved window: the backend number holds again.
    pick(dialog, W, "unset");
    expect(optionLabels(dialog, C)[0]![1]).toBe('settings.modelContext.defaultAbout{"value":"180K"}');
    expect(optionLabels(dialog, W)[0]![1]).toBe('settings.modelContext.defaultWith{"value":"200K"}');
    // A compaction-only edit leaves the window default alone.
    pick(dialog, C, "p80");
    expect(optionLabels(dialog, W)[0]![1]).toBe('settings.modelContext.defaultWith{"value":"200K"}');
  });

  it("REVIEW: a cap (上下文上限) change drops both default numbers", async () => {
    const e = eff({ contextWindow: 200_000, autoCompactTokenLimit: 180_000 });
    const m = model("m", { contextWindow: 200_000, maxContextWindow: 400_000, contextSettings: { catalog: { contextWindow: 200_000 }, owner: {}, preserved: {} }, defaultValues: { model: e, profile: e } });
    const { dialog } = await open(m, view([m]));
    const max = rowIn(dialog, "agent-config.profile.maxContextWindow").querySelector("select")!;
    act(() => { max.value = "unset"; max.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(optionLabels(dialog, W)[0]![1]).toBe("settings.modelContext.default");
    expect(optionLabels(dialog, C)[0]![1]).toBe("settings.modelContext.default");
  });

  // Revision v2 of delegation-d1dddd (backend review of c3b015c7, P3): a Claude model record must carry a percent, so
  // clearing the model's own compaction removes the record, its own window included — said in place, and saved so.
  it("Claude: clearing a model's own compaction says its own window is cleared too, and removes the record", async () => {
    const { ProfileModelDialog } = await import("../src/renderer/src/components/settings/ProfileModelDialog");
    const v = view([model("claude-sonnet")], { modelsSource: { kind: "claudeReference" }, catalogSupported: false });
    const detail = { id: "c", cliKind: "claude" } as unknown as ProfileDetail;
    const patchProfile = vi.fn().mockResolvedValue(detail); env.api.patchProfile = patchProfile; env.api.profileModels = vi.fn().mockResolvedValue(v);
    act(() => root.render(h(ProfileModelDialog, { model: v.models[0]!, profile: "c", view: v, catalog: false,
      claude: { table: { "claude-sonnet": { window: 500_000, percent: 80 } }, profile: { window: null, percent: 75 }, ids: ["claude-sonnet"], window: 200_000, onDetail: vi.fn() }, onSaved: vi.fn(), onClose: vi.fn() })));
    const dialog = document.querySelector("dialog")!;
    expect(dialog.querySelector("[data-claude-window-cleared]")).toBeNull();
    pick(dialog, C, "default");
    expect(dialog.querySelector("[data-claude-window-cleared]")?.textContent).toBe("settings.modelContext.claudeWindowCleared");
    expect(rowIn(dialog, W).querySelector("select")!.value).toBe("unset");
    await act(async () => [...dialog.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "settings.save")!.click());
    expect(patchProfile).toHaveBeenCalledWith("c", { claudeCompactionModels: null });
  });

  // Re-review of 070c5dd09 (disposal-invariant-review, P2): a fixed-window 100 % record ({500K, 100}, what window-only
  // edits stored) read as 跟随 Profile, so choosing 跟随 Profile sent nothing and the record kept overriding the Profile.
  it("REVIEW: Claude 跟随 Profile clears a fixed-window 100 % record (shown as its 100 %), keeping other models", async () => {
    const { ProfileModelDialog } = await import("../src/renderer/src/components/settings/ProfileModelDialog");
    const v = view([model("claude-sonnet")], { modelsSource: { kind: "claudeReference" }, catalogSupported: false });
    const detail = { id: "c", cliKind: "claude" } as unknown as ProfileDetail;
    const patchProfile = vi.fn().mockResolvedValue(detail); env.api.patchProfile = patchProfile; env.api.profileModels = vi.fn().mockResolvedValue(v);
    const other = { window: 200_000, percent: 75 };
    act(() => root.render(h(ProfileModelDialog, { model: v.models[0]!, profile: "c", view: v, catalog: false,
      claude: { table: { "claude-sonnet": { window: 500_000, percent: 100 }, "claude-opus": other }, profile: { window: null, percent: 75 }, ids: ["claude-sonnet"], window: 200_000, onDetail: vi.fn() }, onSaved: vi.fn(), onClose: vi.fn() })));
    const dialog = document.querySelector("dialog")!;
    expect(rowIn(dialog, C).querySelector("select")!.value).not.toBe("default");
    expect(dialog.querySelector("[data-claude-window-cleared]")).toBeNull();
    pick(dialog, C, "default");
    expect(dialog.querySelector("[data-claude-window-cleared]")?.textContent).toBe("settings.modelContext.claudeWindowCleared");
    await act(async () => [...dialog.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "settings.save")!.click());
    expect(patchProfile).toHaveBeenCalledWith("c", { claudeCompactionModels: { "claude-opus": other } });
  });

  it("Claude: without a record, a window pick stores it at 100 % (shown so) and 跟随 Profile drops it again", async () => {
    const { ProfileModelDialog } = await import("../src/renderer/src/components/settings/ProfileModelDialog");
    const v = view([model("claude-sonnet")], { modelsSource: { kind: "claudeReference" }, catalogSupported: false });
    const detail = { id: "c", cliKind: "claude" } as unknown as ProfileDetail;
    const patchProfile = vi.fn().mockResolvedValue(detail); env.api.patchProfile = patchProfile; env.api.profileModels = vi.fn().mockResolvedValue(v);
    act(() => root.render(h(ProfileModelDialog, { model: v.models[0]!, profile: "c", view: v, catalog: false,
      claude: { table: null, profile: { window: null, percent: 75 }, ids: ["claude-sonnet"], window: 200_000, onDetail: vi.fn() }, onSaved: vi.fn(), onClose: vi.fn() })));
    const dialog = document.querySelector("dialog")!;
    expect(rowIn(dialog, C).querySelector("select")!.value).toBe("default");
    const win = optionLabels(dialog, W).find(([value]) => /^\d+$/.test(value))![0];
    pick(dialog, W, win);
    expect(rowIn(dialog, C).querySelector("select")!.value).not.toBe("default");
    pick(dialog, C, "default");
    expect(rowIn(dialog, C).querySelector("select")!.value).toBe("default");
    expect(rowIn(dialog, W).querySelector("select")!.value).toBe("unset");
    pick(dialog, W, win);
    await act(async () => [...dialog.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "settings.save")!.click());
    expect(patchProfile).toHaveBeenCalledWith("c", { claudeCompactionModels: { "claude-sonnet": { window: Number(win), percent: 100 } } });
  });

  it("Claude: a model without its own window shows no such line", async () => {
    const { ProfileModelDialog } = await import("../src/renderer/src/components/settings/ProfileModelDialog");
    const v = view([model("claude-sonnet")], { modelsSource: { kind: "claudeReference" }, catalogSupported: false });
    act(() => root.render(h(ProfileModelDialog, { model: v.models[0]!, profile: "c", view: v, catalog: false,
      claude: { table: { "claude-sonnet": { window: null, percent: 80 } }, profile: null, ids: ["claude-sonnet"], window: 200_000, onDetail: vi.fn() }, onSaved: vi.fn(), onClose: vi.fn() })));
    const dialog = document.querySelector("dialog")!;
    pick(dialog, C, "default");
    expect(dialog.querySelector("[data-claude-window-cleared]")).toBeNull();
  });

  it("an unknown default reads plain 默认", async () => {
    const m = model("x", { defaultValues: { model: eff({ contextWindow: null, contextWindowSource: "unknown", autoCompactTokenLimit: null, autoCompactTokenLimitSource: "unknown" }), profile: eff() } });
    const { dialog } = await open(m, view([m]));
    expect(optionLabels(dialog, W)[0]![1]).toBe("settings.modelContext.default");
    expect(optionLabels(dialog, C)[0]![1]).toBe("settings.modelContext.default");
  });

  it("a preserved value: says so, restores alone, and an edit sends only that field", async () => {
    const v = view([preservedRow()]);
    const patchModel = vi.fn().mockResolvedValue(v); env.api.patchModel = patchModel;
    const { dialog, onSaved } = await open(preservedRow(), v);
    expect(dialog.querySelector('[data-preserved="window"]')?.textContent).toContain('settings.modelContext.preservedNote{"value":"200K","own":"128K"}');
    await act(async () => dialog.querySelector<HTMLButtonElement>('[data-restore-preserved="window"]')!.click());
    expect(patchModel).toHaveBeenCalledWith("p", "gpt-5.5", { restorePreservedContextWindow: true });
    expect(onSaved).toHaveBeenCalled();
    patchModel.mockClear();
    // Editing compaction: the restore buttons wait (they would drop the unsaved edit), and the save sends compaction only.
    pick(dialog, C, "p80");
    expect(dialog.querySelector<HTMLButtonElement>('[data-restore-preserved="window"]')!.disabled).toBe(true);
    expect(dialog.querySelector('[data-preserved="compact"]')).toBeNull();
    await save(dialog);
    const patch = patchModel.mock.calls[0]![2];
    expect(patch).toMatchObject({ autoCompactPercent: 80, autoCompactTokenLimit: null });
    expect(patch).not.toHaveProperty("contextWindow");
    expect(patch).not.toHaveProperty("restorePreservedContextWindow");
  });

  it("first model of an API-key Profile without a catalog: percent is offered and the edit creates the row", async () => {
    const v = view([], { discoverySupported: true, catalogPresent: false, modelContextSettingsV1: false });
    const patchModel = vi.fn().mockResolvedValue(v); env.api.patchModel = patchModel;
    const { dialog } = await open(null, v);
    expect(optionLabels(dialog, C).filter(([value]) => value.startsWith("p")).every(([, , disabled]) => !disabled)).toBe(true);
    const id = rowIn(dialog, "agent-config.profile.modelId").querySelector("input")!;
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(id, "glm-5"); id.dispatchEvent(new Event("input", { bubbles: true })); });
    pick(dialog, C, "p80");
    await save(dialog);
    expect(patchModel).toHaveBeenCalledTimes(1);
    const [, entry, patch] = patchModel.mock.calls[0]!;
    expect(entry).toBe("glm-5");
    expect(patch).toMatchObject({ autoCompactPercent: 80, autoCompactTokenLimit: null });
    expect(patch).not.toHaveProperty("contextWindow");
  });
});

describe("Profile level", () => {
  it("an API-key Profile without a catalog: the rows point to adding a model first", () => {
    const v = view([], { discoverySupported: true, catalogPresent: false, modelContextSettingsV1: false });
    act(() => root.render(h(ProfileContextRows, { kind: "apiKey", detail: codex({}, { modelContextSettingsV1: false }), models: v, cfg: {}, patch: {}, setOrDrop: vi.fn() })));
    for (const key of [W, C]) {
      expect(rowIn(host, key).textContent).toContain("settings.modelContext.reason.needsCatalog");
      expect(rowIn(host, key).querySelector("select")!.disabled).toBe(true);
    }
  });

  it("默认 labels follow the default model's resolved values; an unknown capacity is plain 默认", () => {
    const a = model("a"), b = model("b");
    const v = view([a, b], { profileDefaultValues: { selectedModel: "a", selected: eff(), byModel: { a: eff(), b: eff({ contextWindow: 1_000_000, autoCompactTokenLimit: 900_000 }) } } });
    act(() => root.render(h(ProfileContextRows, { kind: "chatgpt", detail: codex(), models: v, cfg: {}, patch: {}, setOrDrop: vi.fn() })));
    expect(optionLabels(host, W).find(([value]) => value === "unset")![1]).toBe('settings.modelContext.defaultWith{"value":"272K"}');
    expect(optionLabels(host, C).find(([value]) => value === "default")![1]).toBe('settings.modelContext.defaultAbout{"value":"245K"}');
    // The draft picks model b: a changed input — plain 默认 until saved (never a number for another model).
    act(() => root.render(h(ProfileContextRows, { kind: "chatgpt", detail: codex(), models: v, cfg: { model: "b" }, patch: { model: "b" }, setOrDrop: vi.fn() })));
    expect(optionLabels(host, W).find(([value]) => value === "unset")![1]).toBe("settings.modelContext.default");
    expect(optionLabels(host, C).find(([value]) => value === "default")![1]).toBe("settings.modelContext.default");
    // Saved with b (the backend now resolves for b): b's numbers.
    const vb = { ...v, selectedModel: "b", profileDefaultValues: { ...v.profileDefaultValues!, selectedModel: "b", selected: v.profileDefaultValues!.byModel!.b! } };
    act(() => root.render(h(ProfileContextRows, { kind: "chatgpt", detail: codex(), models: vb, cfg: { model: "b" }, patch: {}, setOrDrop: vi.fn() })));
    expect(optionLabels(host, W).find(([value]) => value === "unset")![1]).toBe('settings.modelContext.defaultWith{"value":"1M"}');
    // An uncatalogued default model: capacity unknown, compaction from the runtime budget.
    const u = view([a], { selectedModel: "mystery", profileDefaultValues: { selectedModel: "mystery", selected: eff({ contextWindow: null, contextWindowSource: "unknown", autoCompactTokenLimitSource: "runtimeDefault" }) } });
    act(() => root.render(h(ProfileContextRows, { kind: "chatgpt", detail: codex(), models: u, cfg: { model: "mystery" }, patch: {}, setOrDrop: vi.fn() })));
    expect(optionLabels(host, W).find(([value]) => value === "unset")![1]).toBe("settings.modelContext.default");
    expect(rowIn(host, W).textContent).not.toContain("272");
  });

  it("REVIEW: an unsaved Profile window change drops the stale compaction default (the window default holds)", () => {
    const e = eff({ contextWindow: 200_000, autoCompactTokenLimit: 180_000 });
    const m = model("m", { contextWindow: 200_000, contextSettings: { catalog: { contextWindow: 200_000 }, owner: {}, preserved: {} }, effective: e, defaultValues: { model: e, profile: e } });
    const v = view([m], { profileDefaultValues: { selectedModel: "m", selected: e, byModel: { m: e } } });
    act(() => root.render(h(ProfileContextRows, { kind: "chatgpt", detail: codex({ modelContextWindow: 200_000 }), models: v, cfg: { model: "m", modelContextWindow: 200_000 }, patch: {}, setOrDrop: vi.fn() })));
    expect(optionLabels(host, C).find(([value]) => value === "default")![1]).toBe('settings.modelContext.defaultAbout{"value":"180K"}');
    act(() => root.render(h(ProfileContextRows, { kind: "chatgpt", detail: codex({ modelContextWindow: 200_000 }), models: v, cfg: { model: "m", modelContextWindow: 400_000 }, patch: { modelContextWindow: 400_000 }, setOrDrop: vi.fn() })));
    expect(optionLabels(host, C).find(([value]) => value === "default")![1]).toBe("settings.modelContext.default");
    expect(optionLabels(host, W).find(([value]) => value === "unset")![1]).toBe('settings.modelContext.defaultWith{"value":"200K"}');
  });

  // Re-review of 21f7d0c97 (disposal-invariant-review, P2): clearing the Profile model in the draft (explicit null) must
  // not reuse the saved model's numbers — cutex reports no selected defaults then.
  it("REVIEW: clearing the Profile default model drops the saved model's default numbers", () => {
    const e = eff({ contextWindow: 200_000, autoCompactTokenLimit: 180_000 });
    const m = model("m", { defaultValues: { model: e, profile: e } });
    const v = view([m], { selectedModel: "m", profileDefaultValues: { selectedModel: "m", selected: e, byModel: { m: e } } });
    act(() => root.render(h(ProfileContextRows, { kind: "chatgpt", detail: codex({ model: "m" }), models: v, cfg: { model: "m" }, patch: {}, setOrDrop: vi.fn() })));
    expect(optionLabels(host, W).find(([value]) => value === "unset")![1]).toBe('settings.modelContext.defaultWith{"value":"200K"}');
    act(() => root.render(h(ProfileContextRows, { kind: "chatgpt", detail: codex({ model: "m" }), models: v, cfg: { model: null }, patch: { model: null }, setOrDrop: vi.fn() })));
    expect(optionLabels(host, W).find(([value]) => value === "unset")![1]).toBe("settings.modelContext.default");
    expect(optionLabels(host, C).find(([value]) => value === "default")![1]).toBe("settings.modelContext.default");
  });

  it("older hosts (no B fields) keep the earlier labels", () => {
    const old = view([model("a", { contextSettings: undefined, defaultValues: undefined })], { profileDefaultValues: undefined });
    act(() => root.render(h(ProfileContextRows, { kind: "chatgpt", detail: codex(), models: old, cfg: {}, patch: {}, setOrDrop: vi.fn() })));
    expect(optionLabels(host, W).find(([value]) => value === "unset")![1]).toBe("settings.modelContext.byModel");
    expect(optionLabels(host, C).find(([value]) => value === "default")![1]).toBe("settings.modelContext.defaultCodex");
  });
});
