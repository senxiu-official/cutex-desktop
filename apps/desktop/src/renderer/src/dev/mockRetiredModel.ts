// Preview mock of an old agent whose saved model or effort is no longer offered (shared/pinnedModel, Z5).
// `?retiredmodel`: starting an agent that is not online is refused with pinned_model_selection_unavailable
// (modelUnavailable, saved model `gpt-5.1-codex-max`) until a new model is saved; `?retiredmodel=effort`: the saved
// effort `minimal` is refused (offered: low, medium, high) until a new effort (or none) is saved;
// `?retiredmodel=upgrade`: an older Claude adapter: the start is refused with pinned_model_selection_upgrade_required, and
// so is saving an effort; a model alone is accepted. Saving the retired model / effort again is refused as an
// invalid pair. A save never starts anything.
import { PINNED_MODEL_UNAVAILABLE_CODE, PINNED_MODEL_UPGRADE_CODE, pinnedModelWire } from "../../../shared/pinnedModel";

const MODE = typeof location !== "undefined" ? new URLSearchParams(location.search).get("retiredmodel") : null;
export const RETIRED_MODEL = "gpt-5.1-codex-max";
export const RETIRED_EFFORT = "minimal";
const OFFERED = ["low", "medium", "high"];
const recovered = new Set<string>();

const unavailable = (reason: "modelUnavailable" | "effortUnavailable") =>
  pinnedModelWire({ code: PINNED_MODEL_UNAVAILABLE_CODE, details: { model: reason === "effortUnavailable" ? "gpt-6.2" : RETIRED_MODEL, reasoningEffort: reason === "effortUnavailable" ? RETIRED_EFFORT : "high", reason, offeredReasoningEfforts: reason === "effortUnavailable" ? OFFERED : [] } })!;

/** The wire refusal for starting `id`, or null. */
export function mockRetiredModelRefusal(id: string): string | null {
  if (MODE === null || recovered.has(id)) return null;
  if (MODE === "upgrade") return pinnedModelWire({ code: PINNED_MODEL_UPGRADE_CODE, details: { requiredCapability: "offlineLaunchSelection" } });
  return unavailable(MODE === "effort" ? "effortUnavailable" : "modelUnavailable");
}

/** A `cutex/session/defaults/update` patch: throws cutex's refusal (an invalid pair, an old adapter), else marks it recovered. */
export function mockRetiredModelSave(id: string, patch: Record<string, unknown>): void {
  if (MODE === null) return;
  if (patch.model === RETIRED_MODEL) throw new Error(unavailable("modelUnavailable"));
  if (patch.reasoningEffort === RETIRED_EFFORT) throw new Error(unavailable("effortUnavailable"));
  if (MODE === "upgrade" && "reasoningEffort" in patch) throw new Error(pinnedModelWire({ code: PINNED_MODEL_UPGRADE_CODE, details: { requiredCapability: "offlineLaunchSelection" } })!);
  if (MODE === "effort" ? "reasoningEffort" in patch : typeof patch.model === "string") recovered.add(id);
}
