// Claude Code's own permission modes for Claude agents (adapter feature `claudePermissionModes`,
// claude-r15+), shown in the composer instead of the three Codex presets. The adapter keeps serving
// the Codex v2 thread settings, so each mode is written as the same `thread/settings/update` patch
// the adapter already maps (components/claude-runtime protocol.py `requested_mode`):
//
//   default           ← on-request + reviewer `user` + readOnly sandbox name  (asks before edits and commands)
//   acceptEdits       ← on-request + reviewer `user` + workspaceWrite         (edits run, commands ask)
//   auto              ← on-request + reviewer `auto_review`                   (Claude's classifier decides)
//   bypassPermissions ← approvalPolicy `never` + dangerFullAccess             (never asks; safety checks still stop)
//   plan              ← collaborationMode `plan` (the permission mode underneath is kept)
//
// Claude has no OS sandbox: the sandbox names only select the mode. Write / command tools still need
// the agent's cutex switches (Profile / agent menu `claudeAllowWrite` / `claudeAllowExec`): a mode
// never turns a disabled tool on, it only decides whether an enabled one asks first.
// An adapter without the feature keeps the Codex presets (lib/permissionModes). Pure.
import type { AgentFeatures } from "./agentFeatures";
import { isAutoReviewer } from "./permissionModes";
import type { ThreadSettingsView } from "./timeline";

export type ClaudeMode = "default" | "acceptEdits" | "plan" | "auto" | "bypassPermissions";

export const CLAUDE_MODES: readonly ClaudeMode[] = ["default", "acceptEdits", "plan", "auto", "bypassPermissions"];

/** The Claude modes this agent's adapter offers (in display order), or null: show the Codex presets. */
export function claudeModesOf(features: AgentFeatures): ClaudeMode[] | null {
  if (features.runtime !== "claude") return null;
  const listed = features.map?.claudePermissionModes;
  if (!Array.isArray(listed)) return null;
  const modes = CLAUDE_MODES.filter((m) => listed.includes(m));
  return modes.length ? modes : null;
}

/** The thread's Claude mode from its live settings (plan wins), or null when unknown. */
export function claudeModeOf(settings: ThreadSettingsView | null | undefined): ClaudeMode | null {
  if (!settings) return null;
  if (settings.collaborationMode?.mode === "plan") return "plan";
  return claudePermissionOf(settings);
}

/** The permission mode under plan mode (what the thread returns to when plan ends). */
export function claudePermissionOf(settings: ThreadSettingsView | null | undefined): Exclude<ClaudeMode, "plan"> | null {
  if (!settings) return null;
  if (settings.approvalPolicy === "never") return "bypassPermissions";
  if (isAutoReviewer(settings.approvalsReviewer)) return "auto";
  const sandbox = settings.sandboxPolicy?.type;
  if (sandbox === "workspaceWrite") return "acceptEdits";
  if (sandbox === "readOnly") return "default";
  return settings.approvalPolicy === "on-request" ? "default" : null;
}

/** Permission fields of a (non-plan) Claude mode. */
export function claudePermissionPatch(mode: Exclude<ClaudeMode, "plan">): Record<string, unknown> {
  switch (mode) {
    case "bypassPermissions":
      return { approvalPolicy: "never", sandboxPolicy: { type: "dangerFullAccess" } };
    case "auto":
      return { approvalPolicy: "on-request", approvalsReviewer: "auto_review", sandboxPolicy: { type: "workspaceWrite", writableRoots: [], networkAccess: true, excludeTmpdirEnvVar: false, excludeSlashTmp: false } };
    case "acceptEdits":
      return { approvalPolicy: "on-request", approvalsReviewer: "user", sandboxPolicy: { type: "workspaceWrite", writableRoots: [], networkAccess: true, excludeTmpdirEnvVar: false, excludeSlashTmp: false } };
    case "default":
      return { approvalPolicy: "on-request", approvalsReviewer: "user", sandboxPolicy: { type: "readOnly", networkAccess: false } };
  }
}

/** Collaboration mode field keeping the thread's model / effort (as the TUI's mode masks do). */
function collaboration(mode: "plan" | "default", settings: ThreadSettingsView | null | undefined): Record<string, unknown> {
  return { collaborationMode: { mode, settings: { model: settings?.model ?? "", reasoning_effort: settings?.effort ?? null, developer_instructions: null } } };
}

/**
 * One `thread/settings/update` patch that puts the thread in `mode`: plan turns plan mode on (the
 * permission mode underneath stays); any other mode sets it and leaves plan mode when it was on.
 * The adapter applies it to a running turn too (adapter feature `livePermissionMode`).
 */
export function claudeModePatch(mode: ClaudeMode, settings: ThreadSettingsView | null | undefined): Record<string, unknown> {
  if (mode === "plan") return collaboration("plan", settings);
  const planning = settings?.collaborationMode?.mode === "plan";
  return { ...claudePermissionPatch(mode), ...(planning ? collaboration("default", settings) : {}) };
}

/**
 * Plan approval (Claude Code's ExitPlanMode choices): leave plan mode with `then` as the permission
 * mode for the implementation — `acceptEdits` ("yes, auto-accept edits"), `default` ("yes, approve
 * edits manually") or `keep` (the mode under plan mode, offered when that is full access / auto).
 */
export function planApprovalPatch(then: "acceptEdits" | "default" | "keep", settings: ThreadSettingsView | null | undefined): Record<string, unknown> {
  return { ...(then === "keep" ? {} : claudePermissionPatch(then)), ...collaboration("default", settings) };
}

/** The "keep" plan approval choice: the mode under plan mode when it asks less than acceptEdits. */
export function planKeepMode(settings: ThreadSettingsView | null | undefined): "bypassPermissions" | "auto" | null {
  const current = claudePermissionOf(settings);
  return current === "bypassPermissions" || current === "auto" ? current : null;
}

/** A Claude session's write / command switch from its runtime defaults (null = not reported). */
export function claudeToolSwitches(runtimeDefaults: Record<string, unknown> | null | undefined): { write: boolean | null; exec: boolean | null } {
  const pick = (v: unknown) => (typeof v === "boolean" ? v : null);
  return { write: pick(runtimeDefaults?.claudeAllowWrite), exec: pick(runtimeDefaults?.claudeAllowExec) };
}

/** The tools a Claude agent has turned off (cutex write / command switches), in display order. */
export function claudeToolsOff(switches: { write: boolean | null; exec: boolean | null }): ("write" | "exec")[] {
  return [switches.write === false ? "write" : null, switches.exec === false ? "exec" : null].filter((t): t is "write" | "exec" => t !== null);
}

/**
 * The composer's Claude rules chip (components/ClaudeRulesChip): only when its popover has
 * something beyond the generic no-sandbox sentence — the always-allow rules (cutex
 * `claude-permission-rules` + an adapter that applies them), a turned-off tool, or the Claude Code
 * sources note (cutex `claude-code-sources`). Codex agents and older hosts keep the toolbar as before.
 */
export function claudeRulesChipShown(opts: { claude: boolean; rulesFeature: boolean; toolsOff: readonly string[]; sourcesFeature: boolean }): boolean {
  return opts.claude && (opts.rulesFeature || opts.toolsOff.length > 0 || opts.sourcesFeature);
}
