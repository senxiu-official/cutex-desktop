// 项目目录 (project settings): what a `set_workspace_root` edit needs before it is sent — the path
// to send, which confirm (if any) explains its effects, and cutex's refusal codes as words.
import type { MessageKey } from "../i18n";

/** The value to send: trimmed, empty = clear (null). */
export function nextWorkspaceRoot(input: string): string | null {
  const v = input.trim();
  return v ? v : null;
}

/**
 * Which confirm a change needs: none for a first set (no current root) or an unchanged path,
 * "change" when an existing root is replaced, "clear" when it is removed. `same` = nothing to send.
 */
export type RootConfirm = "same" | "none" | "change" | "clear";

export function rootConfirmKind(current: string | null | undefined, next: string | null): RootConfirm {
  const cur = current?.trim() || null;
  if (cur === next) return "same";
  if (!cur) return "none";
  return next === null ? "clear" : "change";
}

/** cutex refusals of `set_workspace_root` with our own words. */
const ROOT_ERRORS: Record<string, MessageKey> = {
  invalid_workspace_root: "projects.rootError.invalid",
  workspace_root_not_found: "projects.rootError.notFound",
  workspace_root_not_directory: "projects.rootError.notDirectory",
  workspace_root_create_failed: "projects.rootError.createFailed",
};

/**
 * The words for a refused root change, or null for any other error. cutex answers these as
 * `invalid_request` with the reason token in the message (management/v2/server.rs
 * write_agent_management_control_error: "invalid_request: workspace_root_not_found"), and the
 * client prefixes its code again, so the token is looked for as any word of the message.
 */
export function workspaceRootErrorKey(error: unknown): MessageKey | null {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && ROOT_ERRORS[code]) return ROOT_ERRORS[code];
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  for (const m of message.matchAll(/[a-z][a-z0-9_]*/g)) {
    const key = ROOT_ERRORS[m[0]];
    if (key) return key;
  }
  return null;
}
