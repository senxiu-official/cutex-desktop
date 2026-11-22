// Cross-review of 0ef2e1044 (roster-bottom-review, five P2s): the boundary cases that failed there.
import { afterEach, describe, expect, it } from "vitest";
import { aliasResolutionOf, withSessionAlias } from "../../../shared/modelResolution";
import { claudeAliasName, claudeCatalogChoices, claudeShortName } from "./claudeModels";
import { answeringModelShown, resetComposerShown, shownEffort } from "./composerShown";
import { launchEffortShown, profileUnsetShown } from "./effortDisplay";
import { modelLabel, setAliasNamer } from "./modelDisplay";

const t = ((key: string, vars?: Record<string, string | number>) => (vars ? `${key}${JSON.stringify(vars)}` : key)) as never;
const OPUS = "Opus"; // owner 2026-11-23: family + version, no 「最新」

describe("#1 the session's handshake evidence replaces the catalog's alias fields as a whole", () => {
  const catalogRow = { id: "opus", displayName: "Opus (alias)", resolvedModel: "claude-opus-5-5", resolvedModelSource: "sdkHandshake", resolvedDisplayName: "Opus 5.5", resolvedDisplayVersion: "5.5" };
  it("a newer session target without a display version clears the catalog's older version", () => {
    const merged = withSessionAlias(catalogRow, { resolvedModel: "claude-opus-6", resolvedModelSource: "sdkHandshake" });
    expect(aliasResolutionOf(merged)).toEqual({ resolvedModel: "claude-opus-6", version: null });
    expect(claudeShortName([merged, { id: "claude-opus-5-5", displayName: "Opus 5.5" }], "opus", t)).toBe(OPUS);
  });
  it("no session evidence: the catalog row is unchanged", () => {
    expect(withSessionAlias(catalogRow, {})).toBe(catalogRow);
  });
});

describe("#2 (owner 2026-11-23) the answering model is named only when it is not what the chip shows", () => {
  it("a handshake target without a display version: the label takes this answer's version — nothing to add", () => {
    expect(answeringModelShown("claude-opus-5-5", "opus", { resolvedModel: "claude-opus-5-5", version: null })).toBe(false);
    expect(answeringModelShown("claude-opus-4-6", "opus", { resolvedModel: "claude-opus-5-5", version: null })).toBe(false);
  });
  it("the label names the handshake version: another version or family is named", () => {
    expect(answeringModelShown("claude-opus-5-5", "opus", { resolvedModel: "claude-opus-5-5", version: "5.5" })).toBe(false);
    expect(answeringModelShown("claude-opus-4-6", "opus", { resolvedModel: "claude-opus-5-5", version: "5.5" })).toBe(true);
    expect(answeringModelShown("claude-sonnet-5-5", "opus", null)).toBe(true);
  });
});

describe("#3 a trusted empty level list is 不支持 before any cached or computed level", () => {
  afterEach(() => resetComposerShown());
  it("composer: an earlier level for this agent and model is not reused", () => {
    shownEffort("h", "s", "m", "high", { model: "m", efforts: ["low", "high"] });
    expect(shownEffort("h", "s", "m", null, { model: "m", efforts: [], defaultEffort: "high" })).toEqual({ level: null, none: "unsupported", skipped: [] });
  });
  it("new agent / chat: the locally computed level is not used", () => {
    expect(launchEffortShown(null, { supportedReasoningEfforts: [], effortSupportKnown: true }, "high", false)).toEqual({ level: null, none: "unsupported", skipped: [] });
  });
});

describe("#4 the Profile selector's 「不指定」 follows the host's resolution, not the raw per-model value", () => {
  it("a skipped 超高 resolving to 高 shows 高", () => {
    const row = { modelReasoningEffort: "xhigh", reasoningEffort: { configured: null, value: "high", source: "catalog", skipped: [{ source: "model", value: "xhigh", reason: "unsupportedByModel" }] } };
    expect(profileUnsetShown(row, null, ["low", "medium", "high"], true).level).toBe("high");
  });
  it("an older host: the per-model level only if the model offers it", () => {
    expect(profileUnsetShown({ modelReasoningEffort: "xhigh", defaultReasoningEffort: "medium" }, null, ["low", "medium", "high"], false).level).toBe("medium");
    expect(profileUnsetShown({ modelReasoningEffort: "high", defaultReasoningEffort: "medium" }, null, ["low", "medium", "high"], false).level).toBe("high");
  });
});

describe("#5 no entry shows the catalog's 「Opus (alias)」", () => {
  afterEach(() => setAliasNamer(null));
  it("names by id fall back to 「Opus」 (quick chat chip, batch rows, any id-only caller)", () => {
    setAliasNamer((id) => claudeAliasName(id, t));
    expect(modelLabel("opus", "Opus (alias)")).toBe(OPUS);
    expect(modelLabel("opus", null)).toBe(OPUS);
    expect(modelLabel("opus[1m]", "Opus 1M (alias)")).toBe(`claudeModels.oneMName${JSON.stringify({ model: OPUS })}`);
    // a folded name passed by the caller (with the handshake's version) and the owner's entry name win
    expect(modelLabel("opus", "Opus 5.5")).toBe("Opus 5.5");
    expect(modelLabel("opus", "Opus (alias)", "My Opus")).toBe("My Opus");
    expect(modelLabel("gpt-5.5", null)).toBe("gpt-5.5");
  });
  it("batch targets / quick-chat menu: folded catalog choices carry the handshake version", () => {
    const rows = [{ id: "opus", displayName: "Opus (alias)", resolvedModel: "claude-opus-5-5", resolvedModelSource: "sdkHandshake", resolvedDisplayVersion: "5.5" }, { id: "claude-opus-5-5", displayName: "Opus 5.5" }];
    expect(claudeCatalogChoices(rows, null, t)[0]).toMatchObject({ id: "opus", name: "Opus 5.5" });
  });
});
