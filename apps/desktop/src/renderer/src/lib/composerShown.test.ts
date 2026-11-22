import { beforeEach, describe, expect, it } from "vitest";
import { claudeShortName } from "./claudeModels";
import { observedModelOf } from "./observedModel";
import { observedDiffers, resetComposerShown, shownContext, shownEffort, shownModelName } from "./composerShown";

const opus = { model: "claude-opus-5-5", efforts: ["none", "low", "medium", "high", "xhigh", "max"], defaultEffort: "none" };

type Skip = { source: string; value: string };
const lvl = (level: string, skipped: Skip[] = []) => ({ level, none: null, skipped });
const dash = (none: "unreported" | "unsupported", skipped: Skip[] = []) => ({ level: null, none, skipped });
const res = (value: string | null, source: string, skipped: Skip[] = []) => ({ configured: null, value, source, skipped });

describe("composer chips never show a 「…」 placeholder (owner 2026-11-18) nor 「默认」 (owner 2026-11-20)", () => {
  beforeEach(() => resetComposerShown());

  it("effort: the live value wins", () => {
    expect(shownEffort("h", "s", "claude-opus-5-5", "high", opus)).toEqual(lvl("high"));
    expect(shownEffort("h", "s", "claude-opus-5-5", "high", opus, { resolution: res("medium", "claudeCodeDefault"), claude: true })).toEqual(lvl("high"));
  });

  it("effort: Claude's \"none\" (Claude Code's own default) is no level: the host's resolution names it", () => {
    expect(shownEffort("h", "s", "opus", "none", opus, { resolution: res("medium", "claudeCodeDefault"), claude: true })).toEqual(lvl("medium"));
    expect(shownEffort("h", "s", "opus", null, opus, { resolution: res("max", "profile", [{ source: "model", value: "ultra" }]), claude: true })).toEqual(lvl("max", [{ source: "model", value: "ultra" }]));
  });

  it("effort: an older host (no resolution) with Claude's \"none\": 「—」 未上报, never 默认", () => {
    expect(shownEffort("h", "s", "claude-opus-5-5", "none", opus, { claude: true })).toEqual(dash("unreported"));
    expect(shownEffort("h", "s", "claude-opus-5-5", null, opus, { claude: true })).toEqual(dash("unreported"));
    // a configured row default or an earlier level is not what "none" runs with
    shownEffort("h", "s", "opus", "high", opus, { claude: true });
    expect(shownEffort("h", "s", "opus", "none", { model: "opus", efforts: ["low", "high"], defaultEffort: "high" }, { claude: true })).toEqual(dash("unreported"));
  });

  it("effort: the host says unsupported / unreported", () => {
    expect(shownEffort("h", "s", "m", null, opus, { resolution: res(null, "unsupported") })).toEqual(dash("unsupported"));
    expect(shownEffort("h", "s", "m", null, opus, { resolution: res(null, "unreported") })).toEqual(dash("unreported"));
  });

  it("effort: Codex with none set — the model row's default (Codex applies it to a null effort)", () => {
    expect(shownEffort("h", "s", "gpt-5.5", null, { model: "gpt-5.5", efforts: ["low", "medium", "high"], defaultEffort: "medium" })).toEqual(lvl("medium"));
  });

  it("effort: a default the model does not offer is not shown; a model without levels is 不支持", () => {
    expect(shownEffort("h", "s", "m", null, { model: "m", efforts: ["low"], defaultEffort: "high" })).toEqual(dash("unreported"));
    expect(shownEffort("h", "s", "m", null, { model: "m", efforts: [], defaultEffort: null })).toEqual(dash("unsupported"));
  });

  it("effort: before model/list answers, the last value seen for this agent and model", () => {
    shownEffort("h", "s", "claude-opus-5-5", "xhigh", opus);
    expect(shownEffort("h", "s", "claude-opus-5-5", null, null)).toEqual(lvl("xhigh"));
    expect(shownEffort("h", "other", "claude-opus-5-5", null, null)).toEqual(dash("unreported"));
    expect(shownEffort("h", "s", "claude-sonnet-5-5", null, null)).toEqual(dash("unreported"));
  });

  it("model: live name, else last seen, else the catalog default row", () => {
    expect(shownModelName("h", "s", "", { model: "gpt-5.5", displayName: "GPT-5.5" })).toBe("GPT-5.5");
    expect(shownModelName("h", "s", "Opus 5.5", null)).toBe("Opus 5.5");
    expect(shownModelName("h", "s", "", { model: "gpt-5.5", displayName: "GPT-5.5" })).toBe("Opus 5.5");
  });

  it("context: the last report survives a reopen without one", () => {
    const usage = { used: 1, window: 10 };
    expect(shownContext("h", "s", usage)).toBe(usage);
    expect(shownContext("h", "s", null)).toBe(usage);
    expect(shownContext("h", "t", null)).toBeNull();
  });
});

describe("answering model line only when a different model answered", () => {
  it("hides the alias resolving to its reported target and the same fixed model", () => {
    expect(observedDiffers("claude-opus-5-5", "opus", false, "claude-opus-5-5")).toBe(false);
    expect(observedDiffers("claude-opus-5-5", "opus[1m]", false, "claude-opus-5-5")).toBe(false);
    expect(observedDiffers("claude-opus-5-5-20261101", "claude-opus-5-5", false)).toBe(false);
    expect(observedDiffers("claude-opus-5-5", "claude-opus-5-5", false)).toBe(false);
    expect(observedDiffers("claude-opus-5-5", "x", true)).toBe(false);
  });

  it("shows another family or version", () => {
    expect(observedDiffers("claude-sonnet-5-5", "opus", false)).toBe(true);
    expect(observedDiffers("claude-opus-5", "claude-opus-5-5", false)).toBe(true);
  });
});

// Cross-review of d74e26826 (peer-review, M1/M2): both failed there.
describe("answering model compares family + version, suffixes in any order", () => {
  const t = ((key: string, v?: Record<string, string | number>) => (key === "claudeModels.oneMName" ? `${v?.model} (1M)` : v ? `${key}${JSON.stringify(v)}` : key)) as Parameters<typeof claudeShortName>[2];
  const ids = [{ id: "opus", displayName: "Opus" }, { id: "claude-opus-5-5", displayName: "Opus 5.5" }, { id: "claude-opus-4-6", displayName: "Opus 4.6" }, { id: "claude-opus-5-5-20261101[1m]", displayName: "Opus 5.5 (1M)" }];
  const target = "claude-opus-5-5";

  it("M1: the alias resolved to Opus 5.5 but Opus 4.6 answered — the note shows", () => {
    const current = "opus";
    const observed = observedModelOf({ requestedModel: current, observedForRequestedModel: current, lastObservedModel: "claude-opus-4-6" }, current)!;
    const chosenName = claudeShortName(ids, current, t), seenName = claudeShortName(ids, observed, t);
    expect(chosenName).toBe("Opus");
    expect(seenName).toBe("Opus 4.6");
    expect(observedDiffers(observed, current, chosenName === seenName, target)).toBe(true);
    expect(observedDiffers("claude-opus-4-6", "opus[1m]", false, target)).toBe(true);
  });

  it("M2: a date suffix with [1m] is the same version — no note", () => {
    const current = "claude-opus-5-5-20261101[1m]", observed = "claude-opus-5-5";
    const isShown = claudeShortName(ids, current, t) === claudeShortName(ids, observed, t);
    expect(isShown).toBe(false);
    expect(observedDiffers(observed, current, isShown)).toBe(false);
    expect(observedDiffers("claude-opus-5-5-20261101", "claude-opus-5-5[1m]", false)).toBe(false);
  });

  // Re-review of 35896ff1b (N1): the fallback for non-family ids lost its regex escapes there.
  it("N1: other ids drop only a literal [1m] and an 8-digit date; other suffixes stay significant", () => {
    expect(observedDiffers("claude-3-5-sonnet-20241022", "claude-3-5-sonnet", false)).toBe(false);
    expect(observedDiffers("claude-3-5-sonnet[1m]", "claude-3-5-sonnet", false)).toBe(false);
    expect(observedDiffers("route", "route1", false)).toBe(true);
    expect(observedDiffers("route", "routem", false)).toBe(true);
    expect(observedDiffers("route-dddddddd", "route", false)).toBe(true);
  });

  it("still hides the alias resolving to its reported target, and shows another family", () => {
    expect(observedDiffers("claude-opus-5-5", "opus", false, target)).toBe(false);
    expect(observedDiffers("claude-opus-5-5-20261101", "opus[1m]", false, target)).toBe(false);
    expect(observedDiffers("claude-sonnet-5-5", "opus", false, target)).toBe(true);
  });

  it("owner 2026-11-23: without the SDK handshake's target the label's version comes from this answer — only another family differs", () => {
    expect(observedDiffers("claude-opus-5-5", "opus", false)).toBe(false);
    expect(observedDiffers("claude-opus-4-8", "opus", false, null)).toBe(false);
    expect(observedDiffers("claude-sonnet-5-5", "opus", false)).toBe(true);
  });
});
