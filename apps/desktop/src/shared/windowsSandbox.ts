// Windows sandbox readiness (cutex capability windows-sandbox-readiness; docs/research/
// codex-auto-mode-approval-audit-20261016.md §6). On a Windows host whose native home has no sandbox
// backend (`[windows] sandbox` unset, legacy features off), cute-codex treats a managed filesystem
// policy (自动 = workspace-write, 只读) as unenforceable and asks before EVERY command
// (exec_policy: Windows sandbox level Disabled). Readiness says so; the unelevated setup (restricted
// token, no administrator rights) fixes it for the next runtime start. Elevated setup (UAC, local
// sandbox users, firewall rules) stays a manual step on that host — cutex refuses it.
import type { WindowsSandboxReadiness } from "./ipc";

export const WINDOWS_SANDBOX_FEATURE = "windows-sandbox-readiness";

/** A native readiness `status` value, or null when it is not one. */
export function windowsSandboxReadinessOf(value: unknown): WindowsSandboxReadiness | null {
  return value === "ready" || value === "notConfigured" || value === "updateRequired" ? value : null;
}

/** Native `windowsSandbox/setupCompleted` params (`{mode, success, error}`). */
export interface WindowsSandboxSetupOutcome {
  success: boolean;
  error: string | null;
}

export function windowsSandboxSetupOutcomeOf(value: unknown): WindowsSandboxSetupOutcome | null {
  if (!value || typeof value !== "object") return null;
  const v = value as { success?: unknown; error?: unknown };
  if (typeof v.success !== "boolean") return null;
  return { success: v.success, error: typeof v.error === "string" && v.error ? v.error : null };
}

/**
 * Whether to warn: a Windows host, a readiness answer that is not `ready`, and a permission mode
 * with a filesystem policy (完全访问 = no policy: nothing to enforce, no extra prompts).
 */
export function windowsSandboxWarns(platform: string | null | undefined, readiness: WindowsSandboxReadiness | null, mode: string | null): boolean {
  return platform === "windows" && readiness !== null && readiness !== "ready" && mode !== "full";
}

/** The unelevated setup button is offered only for `notConfigured` (an elevated setup that needs an update stays the owner's choice). */
export function windowsSandboxCanSetUp(readiness: WindowsSandboxReadiness | null): boolean {
  return readiness === "notConfigured";
}
