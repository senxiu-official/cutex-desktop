// The model that actually answered a Claude agent (adapter `modelObservation`, claude-runtime R9):
// `claude/model/status` (read on open) and the `claude/model/observed` notification carry the same
// status. Only an observation made for the current selection counts: after a model switch the old
// evidence says nothing about the new one. Pure (no React) so it is unit-tested.

/** The fields of a Claude model status the desktop reads. */
export interface ClaudeModelStatus {
  requestedModel?: unknown;
  observedForRequestedModel?: unknown;
  lastObservedModel?: unknown;
}

/** The answering model of `status` for the selection `currentModel` (null = none observed for it yet). */
export function observedModelOf(status: ClaudeModelStatus | null | undefined, currentModel: string | null): string | null {
  if (!status || typeof status.lastObservedModel !== "string" || !status.lastObservedModel) return null;
  const requested = typeof status.requestedModel === "string" ? status.requestedModel : null;
  if (status.observedForRequestedModel !== requested) return null;
  if (currentModel && requested && requested !== currentModel) return null;
  return status.lastObservedModel;
}

/** A compact form for the model chip: `claude-opus-5-5` → `opus-5-5`, dated suffixes dropped. */
export function shortModelId(model: string): string {
  return model.replace(/^claude-/, "").replace(/-\d{8}$/, "");
}
