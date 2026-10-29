// Model / reasoning choices of a runtime variant in the Profile forms and the new-agent page (docs/design/048, 049).
// DSH: cutex's catalog or DSH's own fallback list (lib/dshModels), four efforts. Kimi Code: the catalog cutex sends
// (a Kimi account's provisioned models), else free text (API-key variants: the preset's model); five efforts.
// Pure, unit-tested.
import { KIMI_EFFORTS } from "../../../shared/kimiAccounts";
import type { ProfileRuntimeVariant, VariantRuntime } from "../../../shared/profileVariants";
import type { CatalogModel, ProfileModelsView } from "../../../shared/ipc";
import { DSH_DEFAULT_MODEL, DSH_EFFORTS, dshModelIds } from "./dshModels";

type CatalogLike = { models?: readonly { id: string }[] | null } | null | undefined;

/** The reasoning levels a variant of this runtime takes; null = not one of the ACP runtimes (the caller's list). */
export function runtimeEfforts(runtime: VariantRuntime | string | null | undefined): readonly string[] | null {
  if (runtime === "dsh") return DSH_EFFORTS;
  if (runtime === "kimi") return KIMI_EFFORTS;
  return null;
}

/**
 * The model ids a select offers, or null when the runtime takes free text here. DSH always has a list (fallback);
 * Kimi only when cutex sent a catalog (`models` of the variant / account). `keep` is never dropped.
 */
export function runtimeModelChoices(runtime: VariantRuntime | string | null | undefined, catalog: CatalogLike, keep?: string | null): string[] | null {
  if (runtime === "dsh") return dshModelIds(catalog, keep);
  if (runtime !== "kimi") return null;
  const ids = (catalog?.models ?? []).map((m) => m.id).filter((id) => typeof id === "string" && id.trim() !== "");
  if (!ids.length) return null;
  const current = keep?.trim();
  return current && !ids.includes(current) ? [...ids, current] : ids;
}

/** The model a select shows when nothing is chosen (DSH: its default; others: none — cutex / Kimi decide). */
export function runtimeDefaultModel(runtime: VariantRuntime | string | null | undefined): string | null {
  return runtime === "dsh" ? DSH_DEFAULT_MODEL : null;
}

/** A variant's own catalog (`runtimeVariants[].models`: DSH, a Kimi account's models) as catalog rows. */
export function variantCatalogModels(v: Pick<ProfileRuntimeVariant, "models"> | null | undefined): CatalogModel[] {
  return (v?.models ?? []).filter((m) => typeof m.id === "string" && m.id.trim()).map((m) => ({
    id: m.id, displayName: m.displayName ?? null, contextWindow: null, maxContextWindow: null, autoCompactTokenLimit: null, effectiveContextWindowPercent: null,
    inputModalities: m.inputModalities ?? ["text"], supportedReasoningEfforts: m.supportedReasoningEfforts ?? [], defaultReasoningEffort: m.defaultReasoningEffort ?? null, isDefault: !!m.isDefault, discovered: false,
    effective: { contextWindow: null, contextWindowSource: "unknown", autoCompactTokenLimit: null, autoCompactTokenLimitSource: "unknown" },
  }));
}

/** The same as a read-only models view for the new-agent model panel (null without rows). */
export function variantCatalogView(profile: { id: string; name: string }, v: Pick<ProfileRuntimeVariant, "models" | "defaults"> | null | undefined): ProfileModelsView | null {
  const models = variantCatalogModels(v);
  if (!models.length) return null;
  return { profile, catalogSupported: false, catalogPresent: true, selectedModel: v?.defaults.model ?? models.find((m) => m.isDefault)?.id ?? null, profileOverrides: { modelContextWindow: null, modelAutoCompactTokenLimit: null }, discovery: null, models, unsupportedModelFields: [], precedence: null };
}
