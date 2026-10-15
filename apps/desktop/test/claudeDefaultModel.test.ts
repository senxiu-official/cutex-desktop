// cutex claude-profile-default-model: a Claude profile's default model / effort are set with the
// same PATCH fields as a Codex profile's (Profile → 模型, and the Settings → Profiles card's 模型
// value via lib/profileDefaultModel); older cutex keeps them read-only.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PreloadBridge, ProfileModelsView, ProfilePatch } from "../src/shared/ipc";
import type { MenuAction, MenuEntry } from "../src/renderer/src/lib/contextMenu";
import { defaultModelMenu } from "../src/renderer/src/lib/profileDefaultModel";
import { defaultModelEditable, PROFILE_FEATURES } from "../src/renderer/src/lib/profileKind";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";
import { en } from "../src/renderer/src/i18n/en";
import { enAU } from "../src/renderer/src/i18n/en-AU";
import { zhHantCN } from "../src/renderer/src/i18n/zh-Hant-CN";

async function install(search = ""): Promise<PreloadBridge> {
  vi.resetModules();
  vi.useFakeTimers();
  const win: { cutex?: PreloadBridge } = {};
  vi.stubGlobal("window", win);
  vi.stubGlobal("location", { search });
  vi.stubGlobal("document", { title: "" });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  const { installMockBridge } = await import("../src/renderer/src/dev/mockBridge");
  installMockBridge();
  return win.cutex!;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const actions = (entries: MenuEntry[]) => entries.filter((e): e is MenuAction => typeof e === "object" && !!e);
const labels = { current: "✓", effort: "Effort", effortDefault: "Model default", effortName: (e: string) => e };
const named = (id: string | null | undefined, displayName?: string | null) => displayName ?? id ?? "";

function view(models: { id: string; displayName?: string | null; efforts?: string[]; defaultEffort?: string | null }[], selected: string | null): ProfileModelsView {
  return {
    selectedModel: selected,
    models: models.map((m) => ({ id: m.id, displayName: m.displayName ?? null, supportedReasoningEfforts: m.efforts ?? [], defaultReasoningEffort: m.defaultEffort ?? null, isDefault: m.id === selected })),
  } as unknown as ProfileModelsView;
}

describe("Claude profile default model (mock cutex)", () => {
  it("is editable, round-trips through PATCH and moves the models list's default", async () => {
    const api = (await install()).api;
    const before = await api.getProfile("claude");
    expect(before.model).toBe("sonnet");
    expect(before.detail.editable.claudeDefaultModel).toBe(true);
    expect(before.detail.claudeBuiltinDefaultModel).toBe("sonnet");
    expect((await api.profileModels("claude")).models.find((m) => m.isDefault)?.id).toBe("sonnet");

    const opus = await api.patchProfile("claude", { model: "claude-opus-5-5", modelReasoningEffort: "high" });
    expect(opus.model).toBe("claude-opus-5-5");
    expect(opus.modelReasoningEffort).toBe("high");
    expect(opus.detail.claudeProfileModel).toBe("claude-opus-5-5");
    const list = await api.profileModels("claude");
    expect(list.selectedModel).toBe("claude-opus-5-5");
    expect(list.models.filter((m) => m.isDefault).map((m) => m.id)).toEqual(["claude-opus-5-5"]);
    expect((await api.listProfiles())!.profiles.find((p) => p.name === "claude")?.model).toBe("claude-opus-5-5");

    await expect(api.patchProfile("claude", { model: "claude opus" })).rejects.toThrow("no spaces");
    await expect(api.patchProfile("claude", { modelContextWindow: 100_000 })).rejects.toThrow("unavailable for a Claude profile");
    const reset = await api.patchProfile("claude", { model: null, modelReasoningEffort: null });
    expect([reset.model, reset.modelReasoningEffort]).toEqual(["sonnet", null]);
  });

  it("stays read-only on an older cutex", async () => {
    const api = (await install("?legacy")).api;
    const claude = await api.getProfile("claude");
    expect(claude.detail.editable.claudeDefaultModel).toBeUndefined();
    await expect(api.patchProfile("claude", { model: "opus" })).rejects.toThrow("unavailable for a Claude profile");
  });
});

describe("defaultModelEditable", () => {
  it("needs claude-profile-default-model for Claude profiles only", () => {
    const none = new Set<string>();
    const has = new Set([PROFILE_FEATURES.claudeDefaultModel]);
    expect(defaultModelEditable({ cliKind: "codex" }, none)).toBe(true);
    expect(defaultModelEditable({ cliKind: "claude" }, none)).toBe(false);
    expect(defaultModelEditable({ cliKind: "claude" }, has)).toBe(true);
  });
});

describe("defaultModelMenu", () => {
  const claudeView = view([{ id: "sonnet" }, { id: "opus" }, { id: "claude-opus-5-5", displayName: "Claude Opus 5.5", efforts: ["low", "high", "max"] }], "sonnet");

  it("lists the models by display name with the current one ticked and disabled", () => {
    const entries = actions(defaultModelMenu({ view: claudeView, profileId: "c", claude: true, model: "sonnet", effort: null, modelName: named, labels, onPick: () => {} }));
    expect(entries.slice(0, 3).map((e) => [e.label, e.hint ?? null, !!e.disabled])).toEqual([
      ["sonnet", "✓", true],
      ["opus", null, false],
      ["Claude Opus 5.5", null, false],
    ]);
    expect(entries[2]!.title).toBe("claude-opus-5-5");
  });

  it("writes the picked model, dropping an effort the new model does not offer", () => {
    const picks: ProfilePatch[] = [];
    const onPick = (p: ProfilePatch) => picks.push(p);
    const pick = (effort: string | null, label: string) => {
      const entries = actions(defaultModelMenu({ view: claudeView, profileId: "c", claude: true, model: "sonnet", effort, modelName: named, labels, onPick }));
      void entries.find((e) => e.label === label)!.onSelect();
    };
    pick(null, "Claude Opus 5.5");
    pick("high", "Claude Opus 5.5");
    pick("xhigh", "Claude Opus 5.5");
    expect(picks).toEqual([{ model: "claude-opus-5-5" }, { model: "claude-opus-5-5" }, { model: "claude-opus-5-5", modelReasoningEffort: null }]);
  });

  it("offers the current model's effort levels (Claude: every level when the row lists none)", () => {
    const opus = actions(defaultModelMenu({ view: claudeView, profileId: "c", claude: true, model: "claude-opus-5-5", effort: "high", modelName: named, labels, onPick: () => {} }));
    const effort = opus.find((e) => e.label === "Effort")!;
    expect(effort.hint).toBe("high");
    expect(actions(effort.submenu!).map((e) => e.label)).toEqual(["Model default", "low", "high", "max"]);
    const sonnet = actions(defaultModelMenu({ view: claudeView, profileId: "c", claude: true, model: "sonnet", effort: null, modelName: named, labels, onPick: () => {} }));
    expect(actions(sonnet.find((e) => e.label === "Effort")!.submenu!).map((e) => e.label)).toEqual(["Model default", "low", "medium", "high", "xhigh", "max"]);
    // A Codex model without levels: no effort row.
    const codex = actions(defaultModelMenu({ view: view([{ id: "relay-model" }], "relay-model"), profileId: "r", claude: false, model: "relay-model", effort: null, modelName: named, labels, onPick: () => {} }));
    expect(codex.map((e) => e.label)).toEqual(["relay-model"]);
  });

  it("keeps an unlisted current default visible", () => {
    const entries = actions(defaultModelMenu({ view: claudeView, profileId: "c", claude: true, model: "claude-opus-5-5[1m]", effort: null, modelName: named, labels, onPick: () => {} }));
    expect([entries[0]!.label, entries[0]!.hint]).toEqual(["claude-opus-5-5[1m]", "✓"]);
  });
});

describe("locales", () => {
  it("has the new strings in every maintained catalog", () => {
    const keys = ["agent-config.profile.claudeModelHint", "agent-config.profile.claudeModelOverrideHint", "settings.profile.card.modelPick", "settings.profile.card.effortDefault", "settings.profile.card.modelSaved"] as const;
    for (const catalog of [zhCN, en, enAU, zhHantCN]) for (const key of keys) expect(catalog[key]).toBeTruthy();
    for (const catalog of [zhCN, en, enAU, zhHantCN]) {
      expect(catalog["agent-config.profile.claudeModelOverrideHint"]).toContain("{model}");
      expect(catalog["settings.profile.card.modelSaved"]).toContain("{name}");
    }
  });
});
