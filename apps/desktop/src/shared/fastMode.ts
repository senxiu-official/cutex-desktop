// Fast mode (cute-codex service tiers, cutex `session-fast-mode`).
//
// The native `/fast` toggles the thread's service tier between the model's Fast tier (catalog id
// `priority`, name "Fast") and the explicit standard sentinel `default`. cutex mirrors the tier from
// `thread/settings/updated` into the session record and sends it again on every resume, so the
// choice survives runtime restarts. Older cutex lacks the capability: the desktop then hides the
// toggle (a native-only change would silently reset on the next restart).

export const SESSION_FAST_MODE_FEATURE = "session-fast-mode";

/** The explicit standard tier ("Fast off"); null would fall back to the profile's `service_tier`. */
export const STANDARD_SERVICE_TIER = "default";

/** Legacy request alias the native normalizes to `priority`. */
const LEGACY_FAST_TIER = "fast";

interface ModelTiers {
  serviceTiers?: ReadonlyArray<{ id: string; name: string }> | null;
  /** Deprecated native field: `["fast"]` on catalogs that predate `serviceTiers`. */
  additionalSpeedTiers?: ReadonlyArray<string> | null;
}

/** The model's Fast tier id from native `model/list`, null when the model has none (like the TUI). */
export function fastTierOf(model: ModelTiers): string | null {
  const tiers = model.serviceTiers ?? [];
  const named = tiers.find((tier) => tier.name.toLowerCase() === LEGACY_FAST_TIER);
  if (named) return named.id;
  if (tiers.some((tier) => tier.id === "priority")) return "priority";
  if (model.additionalSpeedTiers?.includes(LEGACY_FAST_TIER)) return "priority";
  return null;
}

/** Whether the thread's selected tier is the model's Fast tier. */
export function isFastTier(serviceTier: unknown, fastTier: string | null | undefined): boolean {
  if (!fastTier || typeof serviceTier !== "string") return false;
  return serviceTier === fastTier || (serviceTier === LEGACY_FAST_TIER && fastTier === "priority");
}

/** `thread/settings/update` patch that flips Fast mode. */
export function fastModePatch(on: boolean, fastTier: string): { serviceTier: string } {
  return { serviceTier: on ? fastTier : STANDARD_SERVICE_TIER };
}
