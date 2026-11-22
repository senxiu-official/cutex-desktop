import type { ProfileItem, ProfileModelsView } from "../../../shared/ipc";
import type { useI18n } from "../i18n";
import { defaultVariantOf, variantsOf, variantsOn } from "./profileVariants";
import { runtimeModelChoices, variantCatalogView } from "./runtimeChoices";
import { claudeCatalogChoices, isClaudeCatalog } from "./claudeModels";
import { rowResolution } from "./effortDisplay";

export interface ProfileMentionModel { id: string | null; name: string; isDefault: boolean; efforts: string[]; defaultEffort: string | null; /** Claude alias rows: 「跟随最新」. */ tag?: string }

/** Same catalog/default/variant/discovery sources and Claude folding as new-agent LaunchModelPanel. */
export function profileMentionModelChoices(
  profile: ProfileItem, catalog: ProfileModelsView | null, features: ReadonlySet<string>,
  t: ReturnType<typeof useI18n>["t"], runtime?: string | null,
): ProfileMentionModel[] {
  const variant = variantsOn(features)
    ? ((runtime ? variantsOf(profile)?.find(v => v.runtime === runtime) : null) ?? defaultVariantOf(profile))
    : null;
  const secondary = !!variant && (!variant.primary || variant.runtime === "kimi");
  const view = secondary ? variantCatalogView({ id: profile.id, name: profile.name }, variant) : catalog;
  const selected = view?.selectedModel ?? (secondary ? variant?.defaults.model : profile.model) ?? null;
  const models = view?.models ?? [];
  const kind = variant?.runtime ?? profile.cliKind;
  const extra = [
    ...(models.length ? [] : runtimeModelChoices(kind, null, selected) ?? []),
    ...(view?.discovery?.models ?? []), ...(selected ? [selected] : []),
  ].filter((id, i, all) => all.indexOf(id) === i && !models.some(m => m.id === id));
  const rows = [...models, ...extra.map(id => ({ id, displayName: null }))];
  const folded = isClaudeCatalog(view)
    // `option`: 「Opus 5.5 · 跟随最新」 where the alias reads like a fixed row of the same version.
    ? claudeCatalogChoices(rows, selected, t).map(m => ({ id: m.id, name: m.option, ...(m.tag ? { tag: m.tag } : {}) }))
    : rows.map(m => ({ id: m.id, name: m.displayName ?? m.id }));
  return [
    ...(selected ? [] : [{ id: null, name: t("mention.profileDefault"), isDefault: true, efforts: [], defaultEffort: null }]),
    ...folded.map(m => {
      const metadata = models.find(row => row.id === m.id);
      return { ...m, isDefault: m.id === selected,
        efforts: [...new Set(metadata?.supportedReasoningEfforts ?? [])],
        // What 「不指定」 runs with: the host's resolution for the row (an explicit level), else the catalog's.
        defaultEffort: (rowResolution(metadata) ? rowResolution(metadata)!.value : metadata?.defaultReasoningEffort) ?? null };
    }),
  ].sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
}
