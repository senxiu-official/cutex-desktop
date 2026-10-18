import { describe, expect, it } from "vitest";
import { CODEX_FEATURES, type AgentFeatures } from "../src/renderer/src/lib/agentFeatures";
import { claudeModeOf, claudeModePatch, claudeModesOf, claudePermissionOf, claudeToolSwitches, planApprovalPatch, planKeepMode } from "../src/renderer/src/lib/claudePermissionModes";
import { CLAUDE_RULE_DECISION, approvalKeyAction, toInteraction, type InteractionModel } from "../src/renderer/src/lib/interactions";
import type { ThreadSettingsView } from "../src/renderer/src/lib/timeline";

type Approval = Extract<InteractionModel, { kind: "approval" }>;
const claude = (map: Record<string, unknown> | null): AgentFeatures => ({ runtime: "claude", map });
const ALL = ["default", "acceptEdits", "plan", "auto", "bypassPermissions"];
const base: ThreadSettingsView = { model: "sonnet", effort: "high" };

describe("Claude permission modes", () => {
  it("are offered only by a Claude adapter that lists them", () => {
    expect(claudeModesOf(CODEX_FEATURES)).toBeNull();
    expect(claudeModesOf(claude(null))).toBeNull();
    expect(claudeModesOf(claude({ permissionPresets: ["full", "auto", "readOnly"] }))).toBeNull();
    expect(claudeModesOf(claude({ claudePermissionModes: ALL }))).toEqual(ALL);
    // Display order is ours; unknown names are dropped.
    expect(claudeModesOf(claude({ claudePermissionModes: ["bypassPermissions", "dontAsk", "default"] }))).toEqual(["default", "bypassPermissions"]);
    expect(claudeModesOf(claude({ claudePermissionModes: ["dontAsk"] }))).toBeNull();
  });

  it("read the adapter's Codex-shaped settings back as Claude modes", () => {
    expect(claudeModeOf(null)).toBeNull();
    expect(claudeModeOf({ ...base, approvalPolicy: "never", sandboxPolicy: { type: "dangerFullAccess" } })).toBe("bypassPermissions");
    expect(claudeModeOf({ ...base, approvalPolicy: "on-request", approvalsReviewer: "auto_review", sandboxPolicy: { type: "dangerFullAccess" } })).toBe("auto");
    expect(claudeModeOf({ ...base, approvalPolicy: "on-request", approvalsReviewer: "user", sandboxPolicy: { type: "workspaceWrite" } })).toBe("acceptEdits");
    expect(claudeModeOf({ ...base, approvalPolicy: "on-request", approvalsReviewer: "user", sandboxPolicy: { type: "readOnly" } })).toBe("default");
    const planning = { ...base, approvalPolicy: "never", sandboxPolicy: { type: "dangerFullAccess" }, collaborationMode: { mode: "plan" } };
    expect(claudeModeOf(planning)).toBe("plan");
    expect(claudePermissionOf(planning)).toBe("bypassPermissions");
  });

  it("write each mode as one settings patch the adapter maps back", () => {
    const roundTrip = (mode: (typeof ALL)[number], from: ThreadSettingsView) => claudeModeOf({ ...from, ...claudeModePatch(mode as never, from) } as ThreadSettingsView);
    const full = { ...base, approvalPolicy: "never", sandboxPolicy: { type: "dangerFullAccess" } };
    for (const mode of ALL) expect(roundTrip(mode, full)).toBe(mode);
    // Plan keeps the permission mode underneath; leaving plan for a mode turns plan off in the same patch.
    const plan = claudeModePatch("plan", full);
    expect(plan).toEqual({ collaborationMode: { mode: "plan", settings: { model: "sonnet", reasoning_effort: "high", developer_instructions: null } } });
    const out = claudeModePatch("acceptEdits", { ...full, collaborationMode: { mode: "plan" } });
    expect(out.collaborationMode).toEqual({ mode: "default", settings: { model: "sonnet", reasoning_effort: "high", developer_instructions: null } });
    expect(out.approvalsReviewer).toBe("user");
    expect(claudeModePatch("default", full).collaborationMode).toBeUndefined();
  });

  it("plan approval leaves plan mode with the chosen mode, or keeps full access / auto", () => {
    const planning = { ...base, approvalPolicy: "never", sandboxPolicy: { type: "dangerFullAccess" }, collaborationMode: { mode: "plan" } };
    const after = (then: "acceptEdits" | "default" | "keep") => claudeModeOf({ ...planning, ...planApprovalPatch(then, planning) } as ThreadSettingsView);
    expect(after("acceptEdits")).toBe("acceptEdits");
    expect(after("default")).toBe("default");
    expect(after("keep")).toBe("bypassPermissions");
    expect(planKeepMode(planning)).toBe("bypassPermissions");
    expect(planKeepMode({ ...planning, approvalPolicy: "on-request", approvalsReviewer: "user", sandboxPolicy: { type: "readOnly" } })).toBeNull();
  });

  it("tool switches come from the session's runtime defaults", () => {
    expect(claudeToolSwitches({ claudeAllowWrite: false, claudeAllowExec: true })).toEqual({ write: false, exec: true });
    expect(claudeToolSwitches(null)).toEqual({ write: null, exec: null });
  });
});

describe("Claude 'always allow in this project' on approval cards", () => {
  const decision = { [CLAUDE_RULE_DECISION]: { rules: ["Bash(git diff:*)"] } };

  it("a command approval offers the rule choice with the rule shown", () => {
    const m = toInteraction({ id: 1, method: "item/commandExecution/requestApproval", params: { kind: "command", command: "git diff", claudePermissionRules: ["Bash(git diff:*)"], availableDecisions: ["accept", "acceptForSession", decision, "decline", "cancel"] } }) as Approval;
    expect(m.choices.map((c) => c.label)).toEqual(["accept", "acceptForSession", "acceptForProject", "decline", "cancel"]);
    const rule = m.choices[2]!;
    expect(rule.detail).toBe("Bash(git diff:*)");
    expect(rule.result).toEqual({ decision });
    // Esc still only declines.
    expect(approvalKeyAction("Escape", false, m, 0)).toEqual({ pick: 3 });
  });

  it("a Claude file change offers it after 'this session'; other natives are unchanged", () => {
    const claudeEdit = toInteraction({ id: 2, method: "item/fileChange/requestApproval", params: { claudePermissionRules: ["Edit(src/**)"] } }) as Approval;
    expect(claudeEdit.choices.map((c) => c.label)).toEqual(["accept", "acceptForSession", "acceptForProject", "decline"]);
    expect(claudeEdit.choices[2]!.result).toEqual({ decision: { [CLAUDE_RULE_DECISION]: { rules: ["Edit(src/**)"] } } });
    const codexEdit = toInteraction({ id: 3, method: "item/fileChange/requestApproval", params: {} }) as Approval;
    expect(codexEdit.choices.map((c) => c.label)).toEqual(["accept", "acceptForSession", "decline"]);
  });

  it("an empty or malformed rule decision is not offered", () => {
    const m = toInteraction({ id: 4, method: "item/commandExecution/requestApproval", params: { kind: "command", command: "x", availableDecisions: ["accept", { [CLAUDE_RULE_DECISION]: { rules: [] } }, { [CLAUDE_RULE_DECISION]: {} }, "decline"] } }) as Approval;
    expect(m.choices.map((c) => c.label)).toEqual(["accept", "decline"]);
  });
});
