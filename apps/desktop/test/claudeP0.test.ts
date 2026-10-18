// Claude P0 (2026-10-17): skill picker source, revert with files, fast mode gate, answering-model badge.
import { describe, expect, it } from "vitest";
import { agentFeaturesOf, canRewindFiles, CLAUDE_REWIND_FILES_CAPABILITY, CLAUDE_SESSION_SKILLS_CAPABILITY, claudeFastMode, CODEX_FEATURES, observesModel, skillSource } from "../src/renderer/src/lib/agentFeatures";
import { observedModelOf, shortModelId } from "../src/renderer/src/lib/observedModel";
import { applyEvent, emptyTimeline } from "../src/renderer/src/lib/timeline";
import { fastTierOf } from "../src/shared/fastMode";

const claude = (features: Record<string, unknown> | null) => agentFeaturesOf({ native: { schema: { protocol: "claude-app-server-subset", capabilities: { experimentalApi: true, features } } } });
const host = (...features: string[]) => new Set(features);

describe("skillSource", () => {
  it("keeps the Codex catalog for Codex agents unless skill input is off", () => {
    expect(skillSource(CODEX_FEATURES, host())).toBe("codex");
  });
  it("uses a Claude agent's own catalog only with managedSkills and cutex claude-session-skills", () => {
    // cutex hides skillInput for Claude (older desktops would list the Codex catalog).
    expect(skillSource(claude({ skillInput: false, managedSkills: true }), host(CLAUDE_SESSION_SKILLS_CAPABILITY))).toBe("claude");
    expect(skillSource(claude({ skillInput: false, managedSkills: true }), host())).toBeNull();
    expect(skillSource(claude({ skillInput: false }), host(CLAUDE_SESSION_SKILLS_CAPABILITY))).toBeNull();
    expect(skillSource(claude(null), host(CLAUDE_SESSION_SKILLS_CAPABILITY))).toBeNull();
    // Never the Codex catalog for a Claude agent, even if an adapter claimed skillInput.
    expect(skillSource(claude({ skillInput: true }), host())).toBeNull();
  });
});

describe("Claude revert with files / fast mode / model observation gates", () => {
  it("offers file rewind only with adapter fileRewind and cutex claude-rewind-files", () => {
    expect(canRewindFiles(claude({ fileRewind: true }), host(CLAUDE_REWIND_FILES_CAPABILITY))).toBe(true);
    expect(canRewindFiles(claude({ fileRewind: true }), host())).toBe(false);
    expect(canRewindFiles(claude({ fileRewind: null }), host(CLAUDE_REWIND_FILES_CAPABILITY))).toBe(false);
    expect(canRewindFiles(CODEX_FEATURES, host(CLAUDE_REWIND_FILES_CAPABILITY))).toBe(false);
  });
  it("shows Fast for Claude only when the adapter declares fastMode; the tier comes from model/list", () => {
    expect(claudeFastMode(claude({ fastMode: true }))).toBe(true);
    expect(claudeFastMode(claude({}))).toBe(false);
    expect(claudeFastMode(CODEX_FEATURES)).toBe(false);
    expect(fastTierOf({ serviceTiers: [{ id: "priority", name: "Fast" }] })).toBe("priority");
    expect(fastTierOf({ serviceTiers: [] })).toBeNull();
    expect(observesModel(claude({ modelObservation: true }))).toBe(true);
    expect(observesModel(CODEX_FEATURES)).toBe(false);
  });
});

describe("observedModelOf", () => {
  const status = { requestedModel: "opus", observedForRequestedModel: "opus", lastObservedModel: "claude-opus-5-5" };
  it("returns the answering model observed for the current selection", () => {
    expect(observedModelOf(status, "opus")).toBe("claude-opus-5-5");
    expect(observedModelOf(status, null)).toBe("claude-opus-5-5");
  });
  it("ignores evidence for another selection or none", () => {
    expect(observedModelOf(status, "sonnet")).toBeNull();
    expect(observedModelOf({ ...status, observedForRequestedModel: "sonnet" }, "opus")).toBeNull();
    expect(observedModelOf({ requestedModel: "opus", observedForRequestedModel: null, lastObservedModel: null }, "opus")).toBeNull();
    expect(observedModelOf(null, "opus")).toBeNull();
  });
  it("shortens ids for the chip", () => {
    expect(shortModelId("claude-opus-5-5")).toBe("opus-5-5");
    expect(shortModelId("claude-haiku-4-5-20251001")).toBe("haiku-4-5");
    expect(shortModelId("gpt-5.5")).toBe("gpt-5.5");
  });
  it("keeps the live claude/model/observed status on the timeline", () => {
    const state = emptyTimeline();
    applyEvent(state, {
      cursor: "1", receivedAt: new Date().toISOString(), cutexSessionId: "s",
      native: { kind: "notification", message: { method: "claude/model/observed", params: { threadId: "t", ...status } } },
    } as never);
    expect(observedModelOf(state.modelObservation, "opus")).toBe("claude-opus-5-5");
  });
});
