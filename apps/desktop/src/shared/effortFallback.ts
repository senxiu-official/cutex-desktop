// The effort a new agent runs with when the owner picked none (design 028 (b), mirrors cutex
// `selected_profile::fallback_effort`): the profile default when the model offers it (or offers no
// list), else for GLM the documented mapping, else the row's default, else its highest level.

const ORDER = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];

/** glm-5.3 / -flash accept low / high / max only. */
export function glmEffort(effort: string): string | null {
  if (["none", "minimal", "low"].includes(effort)) return "low";
  if (["medium", "high"].includes(effort)) return "high";
  if (["xhigh", "max", "ultra"].includes(effort)) return "max";
  return null;
}

export function effectiveDefaultEffort(model: string | null, profileDefault: string | null, offered: readonly string[], rowDefault: string | null): string | null {
  if (!profileDefault) return rowDefault && (!offered.length || offered.includes(rowDefault)) ? rowDefault : null;
  if (!offered.length || offered.includes(profileDefault)) return profileDefault;
  const mapped = model?.startsWith("glm-") ? glmEffort(profileDefault) : null;
  if (mapped && offered.includes(mapped)) return mapped;
  if (rowDefault && offered.includes(rowDefault)) return rowDefault;
  return [...offered].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)).at(-1) ?? null;
}
