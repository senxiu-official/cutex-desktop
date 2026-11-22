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

it.each([["dsh", "settings.modelContext.unsupportedDsh"], ["kimi", "settings.modelContext.unsupportedKimi"]] as const)("keeps both rows for %s, greyed with the reason", (kind, reason) => {
  act(() => root.render(h(ProfileContextRows, { kind, detail: codex(), models: null, cfg: {}, patch: {}, setOrDrop: vi.fn() })));
  for (const key of [W, C]) {
    expect(row(key).textContent).toContain(reason);
    expect(select(key).disabled).toBe(true);
  }
});

it("greys the rows on a host whose cutex cannot store them", () => {
  act(() => root.render(h(ProfileContextRows, { kind: "apiKey", detail: codex({}, false), models: null, cfg: {}, patch: {}, setOrDrop: vi.fn() })));
  expect(row(W).textContent).toContain("settings.modelContext.unsupportedHost");
  env.features.clear();
  act(() => root.render(h(ProfileContextRows, { kind: "claude", detail: claude(null), models: null, cfg: {}, patch: {}, setOrDrop: vi.fn() })));
  expect(row(C).textContent).toContain("settings.modelContext.unsupportedHost");
});

it("greys 推理摘要 on Claude with the reason instead of hiding it", () => {
  act(() => root.render(h(ProfileModelFields, { detail: claude(null), models: view([]), cfg: {}, set: vi.fn() })));
  const summary = row("agent-config.profile.reasoningSummary");
  expect(summary.textContent).toContain("settings.modelContext.summaryNoClaude");
  expect(summary.querySelector("select")!.disabled).toBe(true);
});

it("shows an earlier Claude 约 50 万 token value as 自定义 and never rewrites it untouched", () => {
  const setOrDrop = vi.fn();
  act(() => root.render(h(ProfileContextRows, { kind: "claude", detail: claude({ window: 533_000, percent: 100 }), models: view([]), cfg: {}, patch: {}, setOrDrop })));
  expect(select(C).value).toBe("custom");
  expect(row(C).querySelector("input")!.value).toBe("500k");
  // The window is decided by the token count: shown locked, with the reason.
  expect(select(W).disabled).toBe(true);
  expect(row(W).textContent).toContain("settings.modelContext.windowLocked");
  expect(setOrDrop).not.toHaveBeenCalled();
});

it("greys the percentages until a fixed window is chosen (Claude B1), then stores window × percent", () => {
  const setOrDrop = vi.fn();
  act(() => root.render(h(ProfileContextRows, { kind: "claude", detail: claude(null), models: view([]), cfg: {}, patch: {}, setOrDrop })));
  expect(options(C)).toEqual([["default", false], ["p75", true], ["p80", true], ["p90", true], ["custom", false]]);
  expect(row(C).textContent).toContain("settings.modelContext.percentNeedsWindowHint");
  act(() => root.render(h(ProfileContextRows, { kind: "claude", detail: claude(null), models: view([]), cfg: {}, patch: { claudeCompaction: { window: 400_000, percent: 100 } }, setOrDrop })));
  expect(options(C).filter(([, off]) => off)).toEqual([]);
  pick(C, "p80");
  expect(setOrDrop).toHaveBeenLastCalledWith("claudeCompaction", { window: 400_000, percent: 80 }, null);
});

it("stores a Codex percentage as tokens of the fixed window and keeps the draft clean when back at the saved value", () => {
  const setOrDrop = vi.fn();
  const detail = codex({ modelContextWindow: 400_000, modelAutoCompactTokenLimit: 300_000 });
  act(() => root.render(h(ProfileContextRows, { kind: "apiKey", detail, models: view([model("gpt")]), cfg: { model: "gpt", modelContextWindow: 400_000, modelAutoCompactTokenLimit: 300_000 }, patch: {}, setOrDrop })));
  expect(select(C).value).toBe("p75");
  pick(C, "p90");
  expect(setOrDrop).toHaveBeenCalledWith("modelAutoCompactTokenLimit", 360_000, 300_000);
  expect(setOrDrop).toHaveBeenCalledWith("modelContextWindow", 400_000, 400_000);
});

it("greys 按模型 while a percentage needs the fixed window (Codex B2)", () => {
  act(() => root.render(h(ProfileContextRows, { kind: "apiKey", detail: codex(), models: view([model("gpt")]), cfg: { model: "gpt", modelContextWindow: 400_000, modelAutoCompactTokenLimit: 300_000 }, patch: {}, setOrDrop: vi.fn() })));
  expect(options(W).find(([v]) => v === "unset")).toEqual(["unset", true]);
});

it("shows the first rows with 上下文 / 自动压缩 and their sources, and folds the rest into 「全部 N 个模型」", () => {
  const models = Array.from({ length: 7 }, (_, i) => model(`m${i}`));
  act(() => root.render(h(ModelList, { profile: "p", view: view(models), setView: vi.fn(), limit: MODELS_ON_PAGE })));
  expect(host.querySelectorAll("[data-model-effort]")).toHaveLength(MODELS_ON_PAGE);
  expect(host.querySelector('[data-model-compact="m0"]')!.textContent).toBe("245Ksettings.modelContext.source.default90");
  const all = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("settings.modelContext.allModels:7"))!;
  act(() => all.click());
  expect(env.shelf).toHaveBeenCalledWith({ tab: "profiles", profile: "p", sub: "models" });
  act(() => root.render(h(ModelList, { profile: "p", view: view(models.slice(0, 5)), setView: vi.fn(), limit: MODELS_ON_PAGE })));
  expect(host.textContent).not.toContain("settings.modelContext.allModels");
});

it("tells a Claude model's own compaction from the Profile's and the runtime default", () => {
  const claudeRow = (id: string) => model(id, { contextWindow: null, maxContextWindow: null, supportedReasoningEfforts: [], effective: { contextWindow: 200_000, contextWindowSource: "catalog", autoCompactTokenLimit: null, autoCompactTokenLimitSource: "unknown" } });
  const v = view([claudeRow("claude-opus-5-5"), claudeRow("claude-sonnet-5-5")], { modelsSource: { kind: "claudeReference", updatedAt: "2026-11-18" } });
  const props = (profile: unknown) => ({ profile: "c", view: v, setView: vi.fn(), claude: { table: { "claude-opus-5-5": { window: 400_000, percent: 80 } }, profile, onDetail: vi.fn() } });
  act(() => root.render(h(ModelList, props(null) as never)));
  expect(host.querySelector('[data-model-compact="claude-opus-5-5"]')!.textContent).toContain("settings.modelContext.source.thisModel");
  expect(host.querySelector('[data-model-compact="claude-sonnet-5-5"]')!.textContent).toContain("settings.modelContext.source.runtimeDefault");
  act(() => root.render(h(ModelList, props({ window: 300_000, percent: 90 }) as never)));
  expect(host.querySelector('[data-model-compact="claude-sonnet-5-5"]')!.textContent).toContain("settings.modelContext.source.profile");
});

// ---------- cutex profile-model-context-v1 (docs/model-context-contract.md) ----------
const V1 = "profile-model-context-v1";
const migrated = (config: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  id: "p", cliKind: "codex", modelContextSettingsV1: true, modelContextSettingsSupport: { supported: true, reason: null }, ...extra,
  detail: { config, editable: { model: true, modelReasoningEffort: true, modelContextWindow: true, modelAutoCompactTokenLimit: true, modelAutoCompactPercent: true } },
}) as unknown as ProfileDetail;

it("stores a GPT percentage in its own field without a fixed window on a migrated Profile", () => {
  env.features.add(V1);
  const setOrDrop = vi.fn();
  act(() => root.render(h(ProfileContextRows, { kind: "apiKey", detail: migrated({ modelAutoCompactTokenLimit: 300_000 }), models: view([model("gpt")]), cfg: { model: "gpt", modelContextWindow: null, modelAutoCompactTokenLimit: 300_000 }, patch: {}, setOrDrop })));
  expect(options(C).filter(([, off]) => off)).toEqual([]);
  expect(row(C).textContent).not.toContain("percentNeedsWindowHint");
  pick(C, "p80");
  expect(setOrDrop).toHaveBeenCalledWith("modelAutoCompactPercent", 80, null);
  expect(setOrDrop).toHaveBeenCalledWith("modelAutoCompactTokenLimit", null, 300_000);
});

it("shows a stored GPT percentage and the model's own value winning in the hint", () => {
  env.features.add(V1);
  const own = model("gpt", { contextWindow: 128_000, maxContextWindow: 256_000, autoCompactPercent: 50 });
  act(() => root.render(h(ProfileContextRows, { kind: "apiKey", detail: migrated({ modelAutoCompactPercent: 75 }, { modelAutoCompactPercent: 75 }), models: view([own]), cfg: { model: "gpt", modelContextWindow: 200_000, modelAutoCompactTokenLimit: null, modelAutoCompactPercent: 75 }, patch: {}, setOrDrop: vi.fn() })));
  expect(select(C).value).toBe("p75");
  expect(row(C).textContent).toContain("settings.modelContext.nowCompactModelOwn");
});

it.each([
  ["an old Native runtime", { modelContextSettingsSupport: { supported: false, reason: "nativeModelContextSettingsV1Required" } }, "settings.modelContext.reason.nativeV1Required"],
  ["a Profile not migrated yet", { modelContextSettingsV1: false }, "settings.modelContext.reason.notMigrated"],
])("keeps the fixed-window controls on %s and greys only the percentages, with the reason", (_label, extra, reason) => {
  env.features.add(V1);
  act(() => root.render(h(ProfileContextRows, { kind: "apiKey", detail: migrated({}, extra), models: view([model("gpt")]), cfg: { model: "gpt" }, patch: {}, setOrDrop: vi.fn() })));
  expect(select(W).disabled).toBe(false);
  expect(options(C).filter(([, off]) => off).map(([v]) => v)).toEqual(["p75", "p80", "p90"]);
  expect(row(C).textContent).toContain(reason);
});

it("greys the rows with the support reason cutex gives", () => {
  env.features.add(V1);
  act(() => root.render(h(ProfileContextRows, { kind: "apiKey", detail: migrated({}, { modelContextSettingsSupport: { supported: false, reason: "somethingNew" } }), models: null, cfg: {}, patch: {}, setOrDrop: vi.fn() })));
  expect(select(W).disabled).toBe(true);
  expect(row(W).textContent).toContain("settings.modelContext.reason.other");
});

it("stores a Claude percent alone on a host and adapter that support it, and greys it with the reason otherwise", () => {
  env.features.add(V1);
  const setOrDrop = vi.fn();
  const detail = (support: unknown) => ({ ...claude(null), modelContextSettingsSupport: support }) as unknown as ProfileDetail;
  act(() => root.render(h(ProfileContextRows, { kind: "claude", detail: detail({ supported: true, reason: null }), models: view([]), cfg: {}, patch: {}, setOrDrop })));
  expect(options(C).filter(([, off]) => off)).toEqual([]);
  pick(C, "p80");
  expect(setOrDrop).toHaveBeenLastCalledWith("claudeCompaction", { window: null, percent: 80 }, null);
  act(() => root.render(h(ProfileContextRows, { kind: "claude", detail: detail({ supported: false, reason: "claudeModelContextSettingsV1Required" }), models: view([]), cfg: {}, patch: {}, setOrDrop })));
  expect(select(W).disabled).toBe(false);
  expect(row(C).textContent).toContain("settings.modelContext.reason.claudeV1Required");
});

it("reads a stored Claude percent-only value back unchanged", () => {
  env.features.add(V1);
  const setOrDrop = vi.fn();
  act(() => root.render(h(ProfileContextRows, { kind: "claude", detail: claude({ window: null, percent: 80 }), models: view([]), cfg: {}, patch: {}, setOrDrop })));
  expect(select(C).value).toBe("p80");
  expect(select(W).value).toBe("unset");
  expect(setOrDrop).not.toHaveBeenCalled();
});

it("marks a model's own value in the catalog with its percentage", () => {
  const own = model("gpt", { autoCompactPercent: 50, effective: { contextWindow: 128_000, contextWindowSource: "model", autoCompactTokenLimit: 64_000, autoCompactTokenLimitSource: "model", autoCompactPercent: 50, autoCompactPercentSource: "model" } });
  act(() => root.render(h(ModelList, { profile: "p", view: view([own]), setView: vi.fn() })));
  expect(host.querySelector('[data-model-compact="gpt"]')!.textContent).toBe("64K50% · settings.modelContext.source.thisModel");
});

it("saves a migrated model's own percentage from its dialog, exclusive with the token limit", async () => {
  env.features.add(V1);
  HTMLDialogElement.prototype.showModal = vi.fn(); HTMLDialogElement.prototype.close = vi.fn();
  const { ProfileModelDialog } = await import("../src/renderer/src/components/settings/ProfileModelDialog");
  const v = view([model("gpt", { contextWindow: null, autoCompactTokenLimit: 200_000 })], { catalogSupported: true, modelContextSettingsV1: true, modelContextSettingsV1Supported: true, modelContextSettingsSupport: { supported: true, reason: null } });
  const patchModel = vi.fn().mockResolvedValue(v); Object.assign(env.api, { patchModel });
  act(() => root.render(h(ProfileModelDialog, { model: v.models[0]!, profile: "p", view: v, onSaved: vi.fn(), onClose: vi.fn() })));
  const dialog = document.querySelector("dialog")!;
  const compact = [...dialog.querySelectorAll("[data-setting-row]")].find((r) => r.textContent?.startsWith(C))!.querySelector("select")!;
  expect(compact.value).toBe("custom");
  expect([...dialog.querySelectorAll("[data-setting-row]")].find((r) => r.textContent?.startsWith(W))!.textContent).toContain("settings.modelContext.modelWins");
  act(() => { compact.value = "p75"; compact.dispatchEvent(new Event("change", { bubbles: true })); });
  await act(async () => [...dialog.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "settings.save")!.click());
  expect(patchModel).toHaveBeenCalledWith("p", "gpt", expect.objectContaining({ autoCompactPercent: 75, autoCompactTokenLimit: null, contextWindow: null }));
});

it("shows a raw legacy limit above the window as 自定义 500k with the capped point, without writing it", () => {
  const setOrDrop = vi.fn();
  const detail = codex({ modelContextWindow: 200_000, modelAutoCompactTokenLimit: 500_000 });
  act(() => root.render(h(ProfileContextRows, { kind: "apiKey", detail, models: view([model("gpt")]), cfg: { model: "gpt", modelContextWindow: 200_000, modelAutoCompactTokenLimit: 500_000 }, patch: {}, setOrDrop })));
  expect(select(W).value).toBe("200000");
  expect(select(C).value).toBe("custom");
  expect(row(C).querySelector("input")!.value).toBe("500k");
  expect(row(C).textContent).toContain("settings.modelContext.compactAboveWindow");
  expect(setOrDrop).not.toHaveBeenCalled();
});

it("reports a typed invalid value to the Profile page (its save is blocked) and recovers on a valid one or an outside change", () => {
  const onValidityChange = vi.fn();
  const props = { kind: "apiKey" as const, detail: codex({}), models: view([model("gpt")]), cfg: { model: "gpt", modelContextWindow: 200_000, modelAutoCompactTokenLimit: 123_000 }, patch: {}, setOrDrop: vi.fn(), onValidityChange };
  act(() => root.render(h(ProfileContextRows, props)));
  const type = (text: string) => act(() => {
    const input = row(C).querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  type("160kx");
  expect(onValidityChange).toHaveBeenLastCalledWith(false);
  type("160k");
  expect(onValidityChange).toHaveBeenLastCalledWith(true);
  type("abc");
  expect(onValidityChange).toHaveBeenLastCalledWith(false);
  // 撤销 / a saved refresh: the value changes from outside, the typed text and its error go.
  act(() => root.render(h(ProfileContextRows, { ...props, cfg: { ...props.cfg, modelAutoCompactTokenLimit: 120_000 } })));
  expect(onValidityChange).toHaveBeenLastCalledWith(true);
  expect(row(C).querySelector("input")!.value).toBe("120k");
});

it("disables a Codex model dialog's context rows for an unknown unsupported reason", async () => {
  env.features.add(V1);
  HTMLDialogElement.prototype.showModal = vi.fn(); HTMLDialogElement.prototype.close = vi.fn();
  const { ProfileModelDialog } = await import("../src/renderer/src/components/settings/ProfileModelDialog");
  const v = view([model("gpt")], { catalogSupported: true, modelContextSettingsSupport: { supported: false, reason: "futureRuntimeIncompatible" } });
  act(() => root.render(h(ProfileModelDialog, { model: v.models[0]!, profile: "p", view: v, onSaved: vi.fn(), onClose: vi.fn() })));
  const dialog = document.querySelector("dialog")!;
  const r = [...dialog.querySelectorAll("[data-setting-row]")].find((x) => x.textContent?.startsWith(C))!;
  expect(r.querySelector("select")!.disabled).toBe(true);
  expect(r.textContent).toContain("settings.modelContext.reason.other");
});

it("keeps each row's typed error: a valid window change neither clears an invalid compaction nor drops a valid one", async () => {
  const { useState } = await import("react");
  const onValidityChange = vi.fn();
  const writes: [string, unknown][] = [];
  const stored = { modelContextWindow: 200_000, modelAutoCompactTokenLimit: 123_000 };
  function Page() {
    const [cfg, setCfg] = useState<Record<string, unknown>>({ model: "gpt", ...stored });
    return h(ProfileContextRows, { kind: "apiKey", detail: codex(stored), models: view([model("gpt")]), cfg, patch: {}, onValidityChange,
      setOrDrop: (key: string, value: unknown) => { writes.push([key, value]); setCfg((c) => ({ ...c, [key]: value })); } } as never);
  }
  act(() => root.render(h(Page)));
  const type = (text: string) => act(() => {
    const input = row(C).querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  type("160kx");
  pick(W, "400000");
  expect(row(C).querySelector("input")!.value).toBe("160kx");
  expect(row(C).textContent).toContain("settings.modelContext.error.customText");
  expect(onValidityChange).toHaveBeenLastCalledWith(false);
  // The typed compaction becomes valid and is stored with the window shown.
  type("300k");
  expect(onValidityChange).toHaveBeenLastCalledWith(true);
  expect(writes.at(-1)).toEqual(["modelAutoCompactTokenLimit", 300_000]);
  // A typed window that is invalid, then a compaction change: the window error stays.
  pick(W, "custom");
  act(() => {
    const input = row(W).querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "zz");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  pick(C, "default");
  expect(row(W).querySelector("input")!.value).toBe("zz");
  expect(onValidityChange).toHaveBeenLastCalledWith(false);
});

// Director 2026-11-19: models missing from the bundled offline catalog are benign (the server catalog carries their
// metadata), so that case is a quiet info line with no update / re-patch call; a newer-client cache stays a warning.
it("shows models missing from the offline catalog as a quiet info line, a newer cache as a warning", () => {
  const cache = { kind: "nativeCache", fetchedAt: null, clientVersion: "0.161.0", native: { version: "0.160.0-r50" }, notInBundled: ["gpt-6.2-sol"] };
  const notice = (kind: string) => host.querySelector<HTMLElement>(`[data-upstream-notice="${kind}"]`);
  const render = (src: unknown) => act(() => root.render(h(ModelList, { profile: "p", view: view([model("gpt-6.2-sol")], { modelsSource: src } as Partial<ProfileModelsView>), setView: vi.fn() })));
  render({ ...cache, clientVersion: "0.160.0" });
  expect(notice("missing")!.textContent).toBe("agent-config.profile.upstreamMissing");
  expect(notice("missing")!.className).not.toMatch(/warn/);
  expect(notice("newer")).toBeNull();
  render(cache);
  expect(notice("missing")!.className).not.toMatch(/warn/);
  expect(notice("newer")!.className).toMatch(/text-warn/);
  render({ ...cache, notInBundled: [] });
  expect(notice("missing")).toBeNull();
  expect(notice("newer")!.textContent).toBe("agent-config.profile.upstreamNewer");
  render({ kind: "overlay", upstream: { ...cache, clientVersion: "0.160.0" } });
  expect(notice("missing")).not.toBeNull();
  render({ ...cache, clientVersion: "0.160.0", notInBundled: [] });
  expect(host.querySelector("[data-upstream-notice]")).toBeNull();
});
