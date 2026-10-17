// The three permission modes offered in the composer row, mapped onto cute-codex thread settings
// (approvalPolicy + approvalsReviewer + sandboxPolicy). Anything else is shown as "custom".
//
// 「自动」 (owner decision 2026-10-16) = workspace-write + on-request + the native automatic reviewer
// (`approvalsReviewer: "auto_review"`): escalations go to Codex's reviewer subagent, not the owner.
// A workspace-write + on-request thread whose reviewer is the owner (`user`) shows as "custom", so one
// click on 自动 fixes it. There is no separate "ask me" mode for now.
import type { ApprovalsReviewer } from "@cutex-desktop/protocol/codex/v2";
import type { LaunchOverrides } from "../../../shared/launch";
import type { MessageKey } from "../i18n";
import type { ThreadSettingsView } from "./timeline";

export type PermissionMode = "full" | "auto" | "readOnly" | "custom";

export const PERMISSION_MODES: Exclude<PermissionMode, "custom">[] = ["full", "auto", "readOnly"];

/** cutex feature: create `launch.approvalsReviewer` + newThreadDefaults reviewer (cutex launch-approvals-reviewer). */
export const LAUNCH_REVIEWER_FEATURE = "launch-approvals-reviewer";

/** The native's automatic reviewer (`guardian_subagent` is its legacy alias, still accepted). */
export function isAutoReviewer(reviewer: unknown): boolean {
  return reviewer === "auto_review" || reviewer === "guardian_subagent";
}

export function permissionModeOf(settings: ThreadSettingsView | null): PermissionMode | null {
  if (!settings) return null;
  const sandbox = settings.sandboxPolicy?.type;
  const approval = settings.approvalPolicy;
  // An absent reviewer is the native default (`user`).
  const auto = isAutoReviewer(settings.approvalsReviewer);
  if (sandbox === "dangerFullAccess" && approval === "never") return "full";
  if (sandbox === "workspaceWrite" && approval === "on-request") return auto ? "auto" : "custom";
  if (sandbox === "readOnly" && approval === "on-request") return auto ? "custom" : "readOnly";
  return "custom";
}

/**
 * Mode for launch values (cutex new-thread defaults: kebab-case sandbox, approval). `reviewer`
 * undefined / null = not reported (a cutex without launch-approvals-reviewer): the form follows the
 * mode, and creation applies the mode's reviewer afterwards (reviewerForCreate).
 */
export function permissionModeOfLaunch(sandbox: string, approval: string, reviewer?: string | null): PermissionMode {
  const known = reviewer !== undefined && reviewer !== null;
  if (sandbox === "danger-full-access" && approval === "never") return "full";
  if (sandbox === "workspace-write" && approval === "on-request") return !known || isAutoReviewer(reviewer) ? "auto" : "custom";
  if (sandbox === "read-only" && approval === "on-request") return !known || !isAutoReviewer(reviewer) ? "readOnly" : "custom";
  return "custom";
}

/**
 * `thread/settings/update` patch for a mode. `current`: the thread's live settings — switching to
 * "auto" keeps the extra writable directories it already has (the patch sends the whole sandbox
 * policy, so an empty list would revoke them and bring their approvals back).
 *
 * Reviewer: auto → `auto_review`. Read only → `user`: read only is the owner's explicit "change
 * nothing" choice, so a write it would need stays the owner's call instead of the reviewer's (which
 * approves low-risk escalations on its own). Full access never asks, so its reviewer is left alone.
 */
export function permissionPatch(mode: Exclude<PermissionMode, "custom">, current?: ThreadSettingsView | null): Record<string, unknown> {
  switch (mode) {
    case "full":
      return { approvalPolicy: "never", sandboxPolicy: { type: "dangerFullAccess" } };
    case "auto":
      return {
        approvalPolicy: "on-request",
        approvalsReviewer: "auto_review" satisfies ApprovalsReviewer,
        sandboxPolicy: { type: "workspaceWrite", writableRoots: writableRootsOf(current), networkAccess: true, excludeTmpdirEnvVar: false, excludeSlashTmp: false },
      };
    case "readOnly":
      return { approvalPolicy: "on-request", approvalsReviewer: "user" satisfies ApprovalsReviewer, sandboxPolicy: { type: "readOnly", networkAccess: false } };
  }
}

interface LaunchModeValues {
  sandbox: "danger-full-access" | "workspace-write" | "read-only";
  approvalPolicy: "never" | "on-request";
  approvalsReviewer?: "user" | "auto_review";
  networkAccess?: boolean;
}

/**
 * Launch values (cutex create `launch`) for a composer mode (reviewer as in permissionPatch).
 *
 * Network (lead decision 2026-10-16, one rule for every entry point): 自动 = network on — the same as
 * switching a running thread to 自动 (permissionPatch) and as fresh-install agent / quick-chat defaults
 * (cutex fresh_agent_permissions). Picking 自动 on the new-agent page or a pending quick chat therefore
 * turns network on even when the host default (an old home: full access, network off) had it off; the
 * network toggle can still turn it off afterwards. Extra writable directories are kept, as in
 * permissionPatch. Full access and read only leave the network field alone (it only applies to
 * workspace-write).
 */
export const LAUNCH_FOR_MODE: Record<Exclude<PermissionMode, "custom">, LaunchModeValues> = {
  full: { sandbox: "danger-full-access", approvalPolicy: "never" },
  auto: { sandbox: "workspace-write", approvalPolicy: "on-request", approvalsReviewer: "auto_review", networkAccess: true },
  readOnly: { sandbox: "read-only", approvalPolicy: "on-request", approvalsReviewer: "user" },
};

/**
 * The create request's `launch` for a host, and the reviewer to set once the new thread is live.
 * A host with launch-approvals-reviewer takes the reviewer in `launch` (no fallback). An older cutex
 * refuses the unknown field, so it is left out there and a new thread in 自动 gets `auto_review`
 * through `thread/settings/update` once it runs (`fallback`; store `expectApprovalsReviewer`).
 */
export function reviewerForCreate(launch: LaunchOverrides | undefined, mode: PermissionMode, supported: boolean): { launch: LaunchOverrides | undefined; fallback: ApprovalsReviewer | null } {
  if (supported) return { launch, fallback: null };
  let stripped = launch;
  if (launch && "approvalsReviewer" in launch) {
    const { approvalsReviewer: _dropped, ...rest } = launch;
    stripped = rest;
  }
  return { launch: stripped, fallback: mode === "auto" ? "auto_review" : null };
}

/** What a thread's permissions actually are, beyond the mode name (composer chip / menu). */
export interface EffectivePermissions {
  /** Who decides escalations: the automatic reviewer, the owner, or nobody (never asks). */
  approvals: "autoReview" | "owner" | "never" | null;
  /** Sandboxed commands may use the network (full access: always). null = not reported. */
  network: boolean | null;
  /** Extra writable directories besides the workspace (workspace-write only). */
  writableRoots: string[];
  /** A named permission profile other than the built-in presets (`:workspace`, …), else null. */
  profile: string | null;
}

export function effectivePermissions(settings: ThreadSettingsView | null | undefined): EffectivePermissions | null {
  if (!settings) return null;
  const policy = settings.sandboxPolicy as { type?: string; networkAccess?: unknown } | null | undefined;
  const approval = settings.approvalPolicy;
  const approvals = approval === "never" ? "never" : approval === undefined || approval === null ? null : isAutoReviewer(settings.approvalsReviewer) ? "autoReview" : "owner";
  const network = policy?.type === "dangerFullAccess" ? true : typeof policy?.networkAccess === "boolean" ? policy.networkAccess : null;
  const id = settings.activePermissionProfile?.id;
  const profile = typeof id === "string" && id && !id.startsWith(":") && id !== CUTEX_WORKSPACE_PROFILE ? id : null;
  return { approvals, network, writableRoots: writableRootsOf(settings), profile };
}

/** The detail lines (message key + params) of {@link effectivePermissions}, in display order. */
export function effectivePermissionLines(effective: EffectivePermissions): { key: MessageKey; params?: Record<string, string | number> }[] {
  const lines: { key: MessageKey; params?: Record<string, string | number> }[] = [];
  if (effective.approvals) lines.push({ key: `composer.effective.approvals.${effective.approvals}` });
  if (effective.network !== null) lines.push({ key: effective.network ? "composer.effective.network.on" : "composer.effective.network.off" });
  lines.push(effective.writableRoots.length ? { key: "composer.effective.roots", params: { n: effective.writableRoots.length } } : { key: "composer.effective.rootsNone" });
  if (effective.profile) lines.push({ key: "composer.effective.profile", params: { id: effective.profile } });
  return lines;
}

/** cutex's own permission profile for workspace extras (cutex launch/stock.rs): not a user profile. */
const CUTEX_WORKSPACE_PROFILE = "cutex-workspace";

/** Extra writable directories of a workspace-write sandbox policy (none for any other policy). */
function writableRootsOf(settings: ThreadSettingsView | null | undefined): string[] {
  const policy = settings?.sandboxPolicy as { type?: string; writableRoots?: unknown } | null | undefined;
  if (policy?.type !== "workspaceWrite" || !Array.isArray(policy.writableRoots)) return [];
  return policy.writableRoots.filter((root): root is string => typeof root === "string" && root.length > 0);
}
