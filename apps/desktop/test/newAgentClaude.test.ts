import { describe, expect, it } from "vitest";
import type { ProfileItem } from "../src/shared/ipc";
import { BUILTIN_THREAD_DEFAULTS, type LaunchForm } from "../src/shared/launch";
import { claudeLaunchFromForm, claudeLaunchModes, claudeOnlyLaunch, codexOnlyLaunch, effectiveProfile, isClaudeCreatorRefusal, isClaudeProfile, shownClaudeMode } from "../src/renderer/src/lib/newAgentClaude";
import { sanitizeLaunch } from "../src/shared/launch";

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

  it("offers Claude starting modes only when cutex lists them for a Claude profile", () => {
    const claude = (modes?: string[] | null) => ({ cliKind: "claude", claudeLaunchPermissionModes: modes }) as ProfileItem;
    expect(claudeLaunchModes(claude(["bypassPermissions", "plan", "default", "bogus"]))).toEqual(["default", "plan", "bypassPermissions"]);
    expect(claudeLaunchModes(claude(undefined))).toBeNull(); // older cutex
    expect(claudeLaunchModes(claude([]))).toBeNull(); // runtime offers none
    expect(claudeLaunchModes({ cliKind: "codex", claudeLaunchPermissionModes: ["default"] } as ProfileItem)).toBeNull();
    expect(claudeLaunchModes(null)).toBeNull();
  });

  it("shows the pick when offered, else the adapter default, else the first offered", () => {
    expect(shownClaudeMode("plan", ["default", "plan", "bypassPermissions"])).toBe("plan");
    expect(shownClaudeMode(null, ["default", "plan", "bypassPermissions"])).toBe("bypassPermissions");
    expect(shownClaudeMode("auto", ["default", "acceptEdits"])).toBe("default");
    expect(shownClaudeMode("plan", null)).toBeNull();
  });

  it("sends the picked starting mode with model / effort and nothing Codex-only", () => {
    const modes = ["default", "acceptEdits", "plan", "auto", "bypassPermissions"] as const;
    expect(claudeLaunchFromForm(form({ sandbox: "read-only" }), false, "plan", [...modes])).toEqual({ claudePermissionMode: "plan" });
    expect(claudeLaunchFromForm(form({ model: "opus" }), true, "acceptEdits", [...modes])).toEqual({ model: "opus", claudePermissionMode: "acceptEdits" });
    // A mode the profile does not offer (older runtime) is not sent.
    expect(claudeLaunchFromForm(form(), false, "auto", ["default"])).toBeUndefined();
    expect(claudeOnlyLaunch({ sandbox: "workspace-write", approvalPolicy: "on-request", approvalsReviewer: "auto_review", claudePermissionMode: "default", reasoningEffort: "high" }, [...modes])).toEqual({ reasoningEffort: "high", claudePermissionMode: "default" });
    expect(claudeOnlyLaunch({ sandbox: "read-only" }, null)).toBeUndefined();
    expect(codexOnlyLaunch({ sandbox: "read-only", claudePermissionMode: "plan" })).toEqual({ sandbox: "read-only" });
  });

  it("main keeps a valid Claude starting mode and drops anything else", () => {
    expect(sanitizeLaunch({ claudePermissionMode: "acceptEdits" })).toEqual({ claudePermissionMode: "acceptEdits" });
    expect(sanitizeLaunch({ claudePermissionMode: "dontAsk" })).toBeNull();
  });

  it("recognises the refusal of a cutex without human-agent-claude", () => {
    expect(isClaudeCreatorRefusal("unsupported_profile: Claude subscription profiles are not supported by this creator")).toBe(true);
    expect(isClaudeCreatorRefusal("unsupported_profile: No local runtime installed")).toBe(false);
  });
});
