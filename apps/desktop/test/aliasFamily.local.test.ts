import { afterEach, describe, expect, it } from "vitest";
import { catalogRowFor, observedVersionFor, claudeAliasName, claudeShortName } from "../src/renderer/src/lib/claudeModels";
import { defaultModelMenu } from "../src/renderer/src/lib/profileDefaultModel";
import { forgetCatalogNames, modelName, modelLabel, setAliasNamer } from "../src/renderer/src/lib/modelDisplay";
import { profileMentionModelChoices } from "../src/renderer/src/lib/profileMentionModels";
import { withSessionAlias } from "../src/shared/modelResolution";
import type { ProfileItem, ProfileModelsView } from "../src/shared/ipc";
const t = ((key: string, vars?: Record<string, string | number>) => key === "claudeModels.latestTag" ? "Follow latest" : key === "claudeModels.oneMName" ? `${vars?.model} · 1M` : key) as Parameters<typeof claudeAliasName>[1];
const alias = { id: "opus", displayName: "Opus (alias)", resolvedModel: "claude-opus-5-5", resolvedModelSource: "sdkHandshake", resolvedDisplayVersion: "5.5", supportedReasoningEfforts: ["medium"] };
afterEach(() => { setAliasNamer(null); forgetCatalogNames(); });

describe("11-23 alias family-version independent review", () => {
  it("a dated answer also matches an available 1M-only catalog row of the same version", () => {
    const rows = [{ id: "claude-opus-5-5[1m]", displayName: "Opus 5.5" }];
    expect(catalogRowFor(rows, "claude-opus-5-5-20261101")?.id).toBe(rows[0]!.id);
    expect(observedVersionFor("claude-opus-5-5-20261101", "opus", rows)).toBe("5.5");
  });
  it("the Profile card model menu uses the alias row's handshake version", () => {
    setAliasNamer(id => claudeAliasName(id, t));
    const view = { models: [alias], selectedModel: "opus", modelsSource: { kind: "claudeReference" } } as unknown as ProfileModelsView;
    const entries = defaultModelMenu({ view, profileId: "claude-review", claude: true, model: "opus", effort: null, modelName, labels: { current: "checked", effort: "Effort", effortDefault: "Unset", effortName: x => x }, onPick: () => {} });
    expect((entries[0] as { label: string }).label).toBe("Opus 5.5");
  });
  it("the Profile card menu also retains the handshake version of the current 1M alias", () => {
    setAliasNamer(id => claudeAliasName(id, t));
    const view = { models: [alias, { ...alias, id: "opus[1m]", displayName: "Opus 1M (alias)" }], selectedModel: "opus[1m]", modelsSource: { kind: "claudeReference" } } as unknown as ProfileModelsView;
    const entries = defaultModelMenu({ view, profileId: "claude-review", claude: true, model: "opus[1m]", effort: null, modelName, labels: { current: "checked", effort: "Effort", effortDefault: "Unset", effortName: x => x }, onPick: () => {} });
    expect((entries[1] as { label: string }).label).toBe("Opus 5.5 · 1M");
  });
  it("@Profile distinguishes the alias from a retained fixed row of the same version", () => {
    const profile = { id: "claude-review", name: "Claude Review", cliKind: "claude", model: "claude-opus-5-5" } as ProfileItem;
    const view = { models: [alias, { id: "claude-opus-5-5", displayName: "Opus 5.5", supportedReasoningEfforts: ["medium"] }], selectedModel: "claude-opus-5-5", modelsSource: { kind: "claudeReference" } } as unknown as ProfileModelsView;
    const choices = profileMentionModelChoices(profile, view, new Set(), t);
    const a = choices.find(x => x.id === "opus")!;
    expect(`${a.name} ${(a as { tag?: string }).tag ?? ""}`).toContain("Follow latest");
  });
  it("prior session evidence replacement and cache isolation still hold under the new wording", () => {
    setAliasNamer(id => claudeAliasName(id, t));
    const row = withSessionAlias(alias, { resolvedModel: "claude-opus-6", resolvedModelSource: "sdkHandshake" });
    expect(claudeShortName([row], "opus", t)).toBe("Opus");
    expect(modelLabel("opus", "Opus 5.5")).toBe("Opus 5.5");
    expect(modelLabel("opus", null)).toBe("Opus");
  });
});
