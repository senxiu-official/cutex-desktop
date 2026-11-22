import { SESSION_DEFAULTS_KEYS, SESSION_DEFAULTS_MODEL_KEYS } from "./ipc";

/** A model id / effort name as cutex stores it: short printable text, no control characters. */
const modelText = (v: unknown) => typeof v === "string" && v.trim() === v && v.length > 0 && v.length <= 200 && !/[\x00-\x1f\x7f]/.test(v);

/**
 * The renderer may only send these through `cutex/session/defaults/update`: the Claude tool switches and
 * memoryInjection (booleans), and an offline agent's model / reasoning effort (批量换模型: text, used at its next start).
 */
export function checkDefaultsPatch(params: Record<string, unknown>): void {
  const patch = params.patch;
  const keys = Object.keys(params);
  const ok =
    keys.every((k) => k === "patch" || k === "expectedRevision") &&
    !!patch && typeof patch === "object" && !Array.isArray(patch) &&
    Object.keys(patch).length > 0 &&
    Object.entries(patch).every(([k, v]) =>
      ((SESSION_DEFAULTS_KEYS as readonly string[]).includes(k) && typeof v === "boolean") ||
      ((SESSION_DEFAULTS_MODEL_KEYS as readonly string[]).includes(k) && modelText(v)));
  if (!ok) throw new Error("cutex/session/defaults/update: only claudeAllowWrite / claudeAllowExec / memoryInjection / model / reasoningEffort");
}
