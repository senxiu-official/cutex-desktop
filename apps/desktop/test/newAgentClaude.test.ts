import { describe, expect, it } from "vitest";
import type { ProfileItem } from "../src/shared/ipc";
import { BUILTIN_THREAD_DEFAULTS, type LaunchForm } from "../src/shared/launch";
import { claudeLaunchFromForm, effectiveProfile, isClaudeCreatorRefusal, isClaudeProfile } from "../src/renderer/src/lib/newAgentClaude";

const item = (id: string, name: string, cliKind: string) => ({ id, name, cliKind }) as ProfileItem;
const profiles = { defaultProfile: "Claude main", profiles: [item("codex-id", "codex", "codex"), item("claude-id", "Claude main", "claude")] };
const form = (patch: Partial<LaunchForm> = {}): LaunchForm => ({ ...BUILTIN_THREAD_DEFAULTS.agent, writableRoots: ["/w"], model: "", reasoningEffort: "", ...patch });

describe("new agent with a Claude profile", () => {
  it("resolves the picked profile, else the default by name or id", () => {
    expect(effectiveProfile(profiles, "codex-id")?.name).toBe("codex");
    expect(isClaudeProfile(effectiveProfile(profiles, ""))).toBe(true);
    expect(effectiveProfile({ ...profiles, defaultProfile: "codex-id" }, "")?.name).toBe("codex");
    expect(effectiveProfile({ ...profiles, defaultProfile: null }, "")).toBeNull();
    expect(effectiveProfile(null, "x")).toBeNull();
  });

  it("sends only model / effort for Claude (no Codex-only launch fields)", () => {
    expect(claudeLaunchFromForm(form({ sandbox: "read-only" }), false)).toBeUndefined();
    expect(claudeLaunchFromForm(form({ sandbox: "read-only" }), true)).toBeUndefined();
    expect(claudeLaunchFromForm(form({ model: "opus", reasoningEffort: "high", networkAccess: true }), true)).toEqual({ model: "opus", reasoningEffort: "high" });
  });

  it("recognises the refusal of a cutex without human-agent-claude", () => {
    expect(isClaudeCreatorRefusal("unsupported_profile: Claude subscription profiles are not supported by this creator")).toBe(true);
    expect(isClaudeCreatorRefusal("unsupported_profile: No local runtime installed")).toBe(false);
  });
});
