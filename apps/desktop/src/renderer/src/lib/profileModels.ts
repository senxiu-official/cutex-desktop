import type { CatalogModel, CatalogModelPatch, ModelsSource, ProfileModelsView } from "../../../shared/ipc";
import type { MessageKey } from "../i18n";
import { localDateTime } from "./profileKind";

export const MODEL_VARIANTS_FEATURE = "profile-model-variants";
export const MODEL_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra", "persistent"];

/** Both the daemon API and the selected native must understand named configurations. */
export function canCreateModelVariant(features: ReadonlySet<string>, view: ProfileModelsView): boolean {
  return features.has(MODEL_VARIANTS_FEATURE) && view.catalogSupported && view.modelVariantsSupported === true;
}

/** Form values only; native metadata inheritance and effective limits belong to cutex. */
export function modelDraft(model: CatalogModel | null): CatalogModelPatch {
  return model ? {
    displayName: model.displayName,
    contextWindow: model.contextWindow,
    maxContextWindow: model.maxContextWindow,
    autoCompactTokenLimit: model.autoCompactTokenLimit,
    inputModalities: [...model.inputModalities],
    supportedReasoningEfforts: [...model.supportedReasoningEfforts],
    defaultReasoningEffort: model.defaultReasoningEffort,
  } : { inputModalities: ["text"], supportedReasoningEfforts: ["low", "medium", "high"], defaultReasoningEffort: "medium" };
}

export function modelVariantPatch(model: CatalogModel, draft: CatalogModelPatch): CatalogModelPatch {
  return { ...draft, requestModel: model.requestModel || model.id };
}

export function modelNameTaken(name: string, models: readonly CatalogModel[]): boolean {
  return models.some((model) => model.id === name.trim());
}

/** The native list a view is based on: an overlay's upstream, else the source itself. */
export function upstreamSource(src: ModelsSource | null | undefined): ModelsSource | null {
  return src?.kind === "overlay" ? (src.upstream ?? null) : (src ?? null);
}

export function modelsSourceText(t: (key: MessageKey, args?: Record<string, string | number>) => string, view: ProfileModelsView): string | null {
  if (view.modelsSource?.kind === "overlay") {
    const base = modelsSourceText(t, { ...view, modelsSource: view.modelsSource.upstream ?? null });
    return base ? t("agent-config.profile.modelsSource.overlay", { source: base }) : t("agent-config.profile.modelsSource.overlayOnly");
  }
  const src = view.modelsSource;
  switch (src?.kind) {
    case "nativeCache":
      return src.fetchedAt ? t("agent-config.profile.modelsSource.nativeCacheAt", { at: localDateTime(src.fetchedAt) }) : t("agent-config.profile.modelsSource.nativeCache");
    case "nativeBundled":
      return t("agent-config.profile.modelsSource.nativeBundled");
    case "claudeAliases":
      return t("agent-config.profile.modelsSource.claudeAliases");
    default:
      return null;
  }
}

export const MODEL_NAMES_FEATURE = "profile-model-display-names";

/** `modelDisplayNames` patch for one entry, or null when the name did not change ("" removes it). */
export function entryNamePatch(id: string, name: string, before: string | null): Record<string, string | null> | null {
  const next = name.trim().replace(/\s+/g, " ");
  if (next === (before ?? "")) return null;
  return { [id]: next || null };
}
