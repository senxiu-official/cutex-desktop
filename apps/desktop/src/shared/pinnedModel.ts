/**
 * An old agent whose saved model or reasoning effort is no longer offered (Z5, cutex r295): starting it
 * (`cutex/runtime/online`, or the start a send attempts) is refused with HTTP 409 and a typed error, while its
 * history stays readable offline.
 * - `pinned_model_selection_unavailable`: details `model`, `reasoningEffort`, `reason` (`modelUnavailable` |
 *   `effortUnavailable`) and, for a rejected effort, `offeredReasoningEfforts`.
 * - `pinned_model_selection_upgrade_required`: details `requiredCapability: "offlineLaunchSelection"`: an older Claude
 *   adapter cannot take an offline model / effort change; the agent's Claude runtime needs 升级运行时 first.
 * The owner picks a new model / effort (saved with `cutex/session/defaults/update`, nothing starts), then starts the
 * agent or sends again. Older hosts never send these codes and keep their start-error line.
 *
 * Main turns the refusal into a fixed-shape wire message (IPC keeps only the message; no daemon text crosses it),
 * the renderer reads it back with `pinnedModelBlock` (same as shared/creatorPaths).
 */
export const PINNED_MODEL_UNAVAILABLE_CODE = "pinned_model_selection_unavailable";
export const PINNED_MODEL_UPGRADE_CODE = "pinned_model_selection_upgrade_required";
const WIRE = "pinned_model_blocked:";

export type PinnedModelBlock =
  | {
      kind: "unavailable";
      /** The saved model (null when cutex did not name it). */
      model: string | null;
      /** The saved effort (null: none saved). */
      effort: string | null;
      reason: "modelUnavailable" | "effortUnavailable";
      /** The efforts the saved model offers (a rejected effort only; may be empty). */
      offeredEfforts: string[];
    }
  | { kind: "upgradeRequired" };

/** A model id / effort name as cutex stores it: short printable text. */
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() === v && v.length > 0 && v.length <= 200 && !/[\x00-\x1f\x7f]/.test(v) ? v : null);

function blockOf(code: unknown, details: unknown): PinnedModelBlock | null {
  if (code === PINNED_MODEL_UPGRADE_CODE) return { kind: "upgradeRequired" };
  if (code !== PINNED_MODEL_UNAVAILABLE_CODE) return null;
  const d = (details && typeof details === "object" && !Array.isArray(details) ? details : {}) as Record<string, unknown>;
  const offered = Array.isArray(d.offeredReasoningEfforts) ? d.offeredReasoningEfforts.map(text).filter((x): x is string => !!x).slice(0, 32) : [];
  return { kind: "unavailable", model: text(d.model), effort: text(d.reasoningEffort), reason: d.reason === "effortUnavailable" ? "effortUnavailable" : "modelUnavailable", offeredEfforts: offered };
}

/** Main / store: the refusal (a CutexApiError, or a `startFailed` event's `{code, details}`) as a wire message, else null. */
export function pinnedModelWire(error: unknown): string | null {
  const e = error as { code?: unknown; details?: unknown } | null;
  const block = e ? blockOf(e.code, e.details) : null;
  return block ? wireOf(block) : null;
}

export function wireOf(block: PinnedModelBlock): string {
  return WIRE + JSON.stringify(block);
}

/** Renderer: the refusal read back from an IPC error or a saved start-error message, else null. */
export function pinnedModelBlock(error: unknown): PinnedModelBlock | null {
  const direct = pinnedModelWire(error);
  const message = (direct ?? (error instanceof Error ? error.message : String(error ?? "")))
    .replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
  if (!message.startsWith(WIRE)) return null;
  try {
    const data = JSON.parse(message.slice(WIRE.length)) as Record<string, unknown> | null;
    if (!data || typeof data !== "object") return null;
    if (data.kind === "upgradeRequired") return { kind: "upgradeRequired" };
    return blockOf(PINNED_MODEL_UNAVAILABLE_CODE, { model: data.model, reasoningEffort: data.effort, reason: data.reason, offeredReasoningEfforts: data.offeredEfforts });
  } catch {
    return null;
  }
}

/**
 * The `cutex/session/defaults/update` patch for a new choice. `effort` undefined: keep the saved explicit effort;
 * null: remove it (the model's own default); a string: that effort.
 */
export function launchSelectionPatch(choice: { model?: string | null; effort?: string | null }): Record<string, string | null> {
  return {
    ...(choice.model ? { model: choice.model } : {}),
    ...(choice.effort !== undefined ? { reasoningEffort: choice.effort } : {}),
  };
}
