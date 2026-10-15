// The three permission modes offered in the composer row, mapped onto cute-codex thread settings
// (approvalPolicy + sandboxPolicy). Anything else is shown as "custom".
import type { ThreadSettingsView } from "./timeline";

export type PermissionMode = "full" | "auto" | "readOnly" | "custom";

export const PERMISSION_MODES: Exclude<PermissionMode, "custom">[] = ["full", "auto", "readOnly"];

export function permissionModeOf(settings: ThreadSettingsView | null): PermissionMode | null {
  if (!settings) return null;
  const sandbox = settings.sandboxPolicy?.type;
  const approval = settings.approvalPolicy;
  if (sandbox === "dangerFullAccess" && approval === "never") return "full";
  if (sandbox === "workspaceWrite" && approval === "on-request") return "auto";
  if (sandbox === "readOnly" && approval === "on-request") return "readOnly";
  return "custom";
}

/** Mode for launch values (cutex new-thread defaults: kebab-case sandbox, approval). */
export function permissionModeOfLaunch(sandbox: string, approval: string): PermissionMode {
  if (sandbox === "danger-full-access" && approval === "never") return "full";
  if (sandbox === "workspace-write" && approval === "on-request") return "auto";
  if (sandbox === "read-only" && approval === "on-request") return "readOnly";
  return "custom";
}

/** `thread/settings/update` patch for a mode. */
export function permissionPatch(mode: Exclude<PermissionMode, "custom">): Record<string, unknown> {
  switch (mode) {
    case "full":
      return { approvalPolicy: "never", sandboxPolicy: { type: "dangerFullAccess" } };
    case "auto":
      return {
        approvalPolicy: "on-request",
        sandboxPolicy: { type: "workspaceWrite", writableRoots: [], networkAccess: true, excludeTmpdirEnvVar: false, excludeSlashTmp: false },
      };
    case "readOnly":
      return { approvalPolicy: "on-request", sandboxPolicy: { type: "readOnly", networkAccess: false } };
  }
}

/** Launch values (cutex create `launch`) for a composer mode. */
export const LAUNCH_FOR_MODE: Record<Exclude<PermissionMode, "custom">, { sandbox: "danger-full-access" | "workspace-write" | "read-only"; approvalPolicy: "never" | "on-request" }> = {
  full: { sandbox: "danger-full-access", approvalPolicy: "never" },
  auto: { sandbox: "workspace-write", approvalPolicy: "on-request" },
  readOnly: { sandbox: "read-only", approvalPolicy: "on-request" },
};
