import { describe, expect, it } from "vitest";
import { aliasFieldsOf, aliasResolutionOf, readReasoningResolution, sessionAliasFields, sessionReasoningResolution } from "../../../shared/modelResolution";
import { effortText, effortTip, launchEffortShown, resolutionShown, unsetChoice } from "./effortDisplay";

const t = ((key: string, vars?: Record<string, string | number>) => (vars ? `${key}${JSON.stringify(vars)}` : key)) as never;

describe("host fields (shared/modelResolution): one reader, older hosts give null", () => {
  it("reads a resolution and the skipped unsupported levels", () => {
    expect(readReasoningResolution({ configured: null, value: "medium", source: "claudeCodeDefault", requestedModel: "opus" })).toEqual({ configured: null, value: "medium", source: "claudeCodeDefault", skipped: [] });
    // cutex a7fc3da1: `skipped: [{source, value, reason: "unsupportedByModel"}]`; malformed entries are dropped
    expect(readReasoningResolution({ configured: null, value: "high", source: "catalog", skipped: [{ source: "profile", value: "max", reason: "unsupportedByModel" }, { source: "model", value: "ultra", reason: "unsupportedByModel" }, "x", { value: "y" }] })!.skipped)
      .toEqual([{ source: "profile", value: "max" }, { source: "model", value: "ultra" }]);
    expect(readReasoningResolution(null)).toBeNull();
    expect(readReasoningResolution({ value: "high" })).toBeNull(); // no source: not a resolution
    expect(sessionReasoningResolution({ claudeAllowWrite: false })).toBeNull(); // legacy session
  });

  it("alias: only sdkHandshake evidence names a target; the version only from resolvedDisplayVersion (contract)", () => {
    expect(aliasResolutionOf({ resolvedModel: "claude-opus-5-5", resolvedModelSource: "sdkHandshake", resolvedDisplayName: "Opus 5.5", resolvedDisplayVersion: "5.5" })).toEqual({ resolvedModel: "claude-opus-5-5", version: "5.5" });
    expect(aliasResolutionOf({ resolvedModel: "claude-opus-5-5", resolvedModelSource: "sdkHandshake" })).toEqual({ resolvedModel: "claude-opus-5-5", version: null });
    expect(aliasResolutionOf({ resolvedModel: "claude-opus-5-5", resolvedModelSource: "sdkHandshake", resolvedDisplayName: "Opus 5.5" })!.version).toBeNull();
    expect(aliasResolutionOf({ resolvedModel: "claude-opus-5-5", resolvedModelSource: "lastObserved", resolvedDisplayVersion: "5.5" })).toBeNull();
    expect(aliasResolutionOf({})).toBeNull();
    expect(aliasFieldsOf({ resolvedModel: "x", other: 1, resolvedModelSource: "" })).toEqual({ resolvedModel: "x" });
  });

  it("the session's alias evidence counts only for the model it was requested for", () => {
    const rd = { reasoningResolution: { value: "medium", source: "claudeCodeDefault", requestedModel: "opus", resolvedModel: "claude-opus-5-5", resolvedModelSource: "sdkHandshake" } };
    expect(sessionAliasFields(rd, "opus")).toEqual({ resolvedModel: "claude-opus-5-5", resolvedModelSource: "sdkHandshake" });
    expect(sessionAliasFields(rd, "sonnet")).toEqual({});
  });
});

describe("effort labels never say 默认 (owner 2026-11-20)", () => {
  it("a level, or 「—」 with 未上报 / 不支持 on hover", () => {
    expect(effortText(t, resolutionShown({ configured: null, value: "medium", source: "claudeCodeDefault", skipped: [] }))).toBe("medium");
    const unsupported = resolutionShown({ configured: null, value: null, source: "unsupported", skipped: [] });
    expect(effortText(t, unsupported)).toBe("—");
    expect(effortTip(t, unsupported)).toBe("effortLabel.unsupported");
    const legacy = resolutionShown(null);
    expect(effortText(t, legacy)).toBe("—");
    expect(effortTip(t, legacy)).toBe("effortLabel.unreported");
    expect(effortTip(t, resolutionShown({ configured: null, value: "high", source: "catalog", skipped: [{ source: "profile", value: "max" }, { source: "model", value: "ultra" }] })))
      .toBe('effortLabel.skippedProfile{"effort":"max"}\neffortLabel.skippedModel{"effort":"ultra"}');
  });

  it("selectors' 「不指定」 choice names what applies", () => {
    expect(unsetChoice(t, resolutionShown({ configured: null, value: "medium", source: "catalog", skipped: [] }))).toBe('effortLabel.unset{"effort":"medium"}');
    expect(unsetChoice(t, resolutionShown(null))).toBe('effortLabel.unset{"effort":"effortLabel.unreportedShort"}');
    expect(unsetChoice(t, null)).toBe("effortLabel.unsetBare");
  });

  it("new agent / chat: the pick, else the host's row resolution, else the old computation, else 「—」", () => {
    const row = { reasoningEffort: { configured: null, value: "medium", source: "claudeCodeDefault" }, supportedReasoningEfforts: ["low", "medium", "high"] };
    expect(launchEffortShown("high", row, "low", true).level).toBe("high");
    expect(launchEffortShown("", row, "low", true).level).toBe("medium");
    expect(launchEffortShown(null, { supportedReasoningEfforts: ["low", "high"] }, "high", false).level).toBe("high");
    expect(launchEffortShown(null, { supportedReasoningEfforts: ["low"] }, "none", true)).toEqual({ level: null, none: "unreported", skipped: [] });
    expect(launchEffortShown(null, { supportedReasoningEfforts: [], effortSupportKnown: true }, null, true).none).toBe("unsupported");
  });
});
