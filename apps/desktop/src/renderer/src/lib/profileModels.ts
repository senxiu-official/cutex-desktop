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
    case "claudeReference":
      return src.updatedAt ? t("agent-config.profile.modelsSource.claudeReferenceAt", { at: src.updatedAt }) : t("agent-config.profile.modelsSource.claudeReference");
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

/** A Claude profile's list (the adapter's reference catalog, or its alias fallback). */
export function isClaudeModelsView(view: ProfileModelsView): boolean {
  const kind = upstreamSource(view.modelsSource)?.kind;
  return kind === "claudeReference" || kind === "claudeAliases";
}

/**
 * Which limit columns the model list shows. Claude Code decides compaction itself (cutex
 * `autoCompactApplies: false`), so a Claude list has no 自动压缩 column; its 上下文 column only
 * when cutex reports reference windows (older cutex: none, so no column of bare "—").
 */
export function modelListColumns(view: ProfileModelsView): { claude: boolean; context: boolean; compact: boolean } {
  const claude = isClaudeModelsView(view);
  return {
    claude,
    context: !claude || view.models.some((m) => m.effective.contextWindow != null),
    compact: view.autoCompactApplies ?? !claude,
  };
}

/** Claude effort levels cutex takes (`options.claude.effort`). */
export const CLAUDE_EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;

/**
 * Effort levels a Claude profile can store for a model: the row's own levels; none for a model
 * known to have none (e.g. Haiku 4.5); the full Claude set only where support is unknown (aliases,
 * custom ids, older cutex without `effortSupportKnown`).
 */
export function claudeEffortLevels(row: CatalogModel | undefined): string[] {
  if (row?.supportedReasoningEfforts.length) return row.supportedReasoningEfforts;
  return row?.effortSupportKnown === true ? [] : [...CLAUDE_EFFORT_LEVELS];
}
