import { SESSION_DEFAULTS_KEYS } from "./ipc";
/** The renderer may only flip the Claude tool switches through `cutex/session/defaults/update`. */
export function checkDefaultsPatch(params: Record<string, unknown>): void {
  const patch = params.patch;
  const keys = Object.keys(params);
  const ok =
    keys.every((k) => k === "patch" || k === "expectedRevision") &&
    !!patch && typeof patch === "object" && !Array.isArray(patch) &&
    Object.keys(patch).length > 0 &&
    Object.entries(patch).every(([k, v]) => (SESSION_DEFAULTS_KEYS as readonly string[]).includes(k) && typeof v === "boolean");
  if (!ok) throw new Error("cutex/session/defaults/update: only claudeAllowWrite / claudeAllowExec");
}
