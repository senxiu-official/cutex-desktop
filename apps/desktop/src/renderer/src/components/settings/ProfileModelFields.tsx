// A profile's default model, reasoning effort, context window and auto-compact — the per-profile
// config in cutex `/v2/profiles/{p}`, on the profile page's 模型 section (saved by its save bar;
// Settings → 新建 only shows a read-only summary with a link here).
import { claudeCatalogChoices } from "../../lib/claudeModels";
import type { ProfileConfig, ProfileDetail, ProfileModelsView, ProfilePatch, ReasoningSummaryMode } from "../../../../shared/ipc";
import { useI18n, type MessageKey } from "../../i18n";
import { formatWindow } from "../../lib/contextPresets";
import { FIELD_W } from "../../lib/fieldWidths";
import { fieldEditable, fieldOffered } from "../../lib/profileKind";
import { SettingRow, Select, TextInput } from "./Form";
import { CompactInput, WindowInput } from "./ProfileContextInputs";
import { useModelName } from "../../lib/modelDisplay";
import { ModelName } from "../ModelName";
import { claudeEffortLevels } from "../../lib/profileModels";

const SUMMARIES: ReasoningSummaryMode[] = ["auto", "detailed", "concise", "none"];

export function ProfileModelFields({ detail, models, cfg, set }: { detail: ProfileDetail; models: ProfileModelsView | null; cfg: Partial<ProfileConfig>; set(p: ProfilePatch): void; }) {
  const { t } = useI18n();
  // Labels by this profile's entry names (lib/modelDisplay); values and the text input stay raw ids.
  const modelName = useModelName();
  const list = models?.models ?? [];
  const model = cfg.model ?? null;
  // claude-profile-default-model: a Claude profile's own default model / effort (same PATCH fields;
  // `cfg` carries the profile item's values, see ProfileEditor). Older cutex: read-only as before.
  const claude = detail.cliKind === "claude";
  const claudeDefaults = claude && fieldOffered(detail, "claudeDefaultModel");
  const modelEditable = claude ? claudeDefaults : fieldEditable(detail, "model");
  const effortEditable = claude ? claudeDefaults : fieldEditable(detail, "modelReasoningEffort");
  const override = claudeDefaults ? (detail.detail?.claudeNewSessionModel ?? null) : null;
  const selected = list.find((m) => m.id === (model ?? models?.selectedModel));
  // The default model left upstream (cutex unavailableModels): new agents on it would fail to start.
  const gone = [model, models?.selectedModel].find((id) => id && models?.unavailableModels?.some((u) => u.id === id)) ?? null;
  const src = (s: string) => t(`agent-config.profile.source.${s}` as MessageKey);
  // Effort ids in the app language (the composer's 低 / 中 / 高 …); unknown ids stay raw.
  const effortName = (e: string) => {
    const key = `composer.effort.${e}` as MessageKey;
    return t(key) === key ? e : t(key);
  };
  // Empty/absent Codex metadata is not evidence that every reasoning level is supported.
  const levels = claude ? claudeEffortLevels(selected) : selected?.supportedReasoningEfforts ?? [];
  const storedEffort = cfg.modelReasoningEffort ?? null;
  // "" = no stored effort: the model's own default (Claude: Claude Code picks it per model).
  const defaultLabel = selected?.defaultReasoningEffort
    ? t("agent-config.profile.effortDefaultIs", { effort: effortName(selected.defaultReasoningEffort) })
    : t("agent-config.profile.effortDefault");
  const effective = (value: number | null, source: string) => (value ? <span className="text-xs text-subtle tabular-nums">{!claude && <span className="block">{t("settings.profileParity.savedEffective" as MessageKey)}</span>}{t("agent-config.profile.effectiveInline", { value: formatWindow(value), source: src(source) })}</span> : null);
  return (
    <>
      <SettingRow source="host" agents="next" readOnly={!modelEditable} label={t("agent-config.profile.model")} hint={gone ? <span className="text-warn">{t("models.defaultGoneHint", { model: modelName(gone, null, detail.id) })}</span> : claudeDefaults ? t(override ? "agent-config.profile.claudeModelOverrideHint" : "agent-config.profile.claudeModelHint", { model: override ? modelName(override, null, detail.id) : "" }) : t("settings.profileParity.modelDefaultHint" as MessageKey)}>
        {!modelEditable ? (
          <ModelName id={model ?? detail.model} profile={detail.id} fallback="—" className="font-mono text-xs text-muted" />
        ) : list.length > 0 ? (
          <Select
            width={FIELD_W.model}
            value={model ?? ""}
            options={[
              { value: "", label: claude ? "—" : t("settings.profileParity.runtimeModelDefault" as MessageKey) },
              // Claude (docs/design/024-model-list.md): one choice per real model, aliases folded in.
              ...(claude
                ? claudeCatalogChoices(list, model, t).map((c) => ({ value: c.id, label: modelName(c.id, c.name, detail.id) }))
                : list.map((m) => ({ value: m.id, label: modelName(m.id, m.displayName, detail.id) }))),
              // A configured model the list doesn't know (e.g. newer than the native cache) stays selectable.
              ...(model && !list.some((m) => m.id === model) ? [{ value: model, label: modelName(model, null, detail.id) }] : []),
            ]}
            onChange={(v) => set({ model: v || null })}
          />
        ) : (
          <TextInput mono width={FIELD_W.model} value={model ?? ""} onChange={(v) => set({ model: v || null })} />
        )}
      </SettingRow>
      {effortEditable && (
        <SettingRow source="host" agents="next" label={t("agent-config.profile.effort")} hint={claude ? levels.length === 0 ? t("agent-config.profile.effortNone") : undefined : t((levels.length ? "settings.profileParity.effortInheritance" : selected?.effortSupportKnown === true ? "agent-config.profile.effortNone" : "settings.profileParity.effortUnknown") as MessageKey)}>
          <Select
            width={FIELD_W.model}
            value={storedEffort ?? ""}
            options={[
              { value: "", label: defaultLabel },
              ...levels.map((e) => ({ value: e, label: effortName(e) })),
              // A stored level the model does not list stays visible so it can be cleared.
              ...(storedEffort && !levels.includes(storedEffort) ? [{ value: storedEffort, label: effortName(storedEffort) }] : []),
            ]}
            onChange={(v) => set({ modelReasoningEffort: v || null })}
          />
        </SettingRow>
      )}
      {/* GPT models default to no reasoning summaries; turning them on fills the timeline's 推理
          rows (DESIGN §4.14). Takes effect when the agent's native process next starts. */}
      {fieldOffered(detail, "modelReasoningSummary") && (
        <SettingRow source="host" agents="next" label={t("agent-config.profile.reasoningSummary")} hint={t("agent-config.profile.reasoningSummaryHint")}>
          <Select
            width={FIELD_W.model}
            value={cfg.modelReasoningSummary ?? ""}
            options={[
              { value: "", label: t("agent-config.profile.reasoningSummary.default") },
              ...SUMMARIES.map((v) => ({ value: v, label: t(`agent-config.profile.reasoningSummary.${v}` as MessageKey) })),
            ]}
            onChange={(v) => set({ modelReasoningSummary: (v || null) as ReasoningSummaryMode | null })}
          />
        </SettingRow>
      )}
      {!claude && <p className="mt-2 text-xs text-subtle">{t("settings.profileParity.limitsInheritance" as MessageKey)}</p>}
      {fieldEditable(detail, "modelContextWindow") && (
        <SettingRow source="host" agents="next" label={t("agent-config.profile.contextWindow")} hint={selected?.maxContextWindow ? t("agent-config.profile.maxHint", { max: formatWindow(selected.maxContextWindow) }) : t("agent-config.profile.contextProfileHint")}>
          {selected && effective(selected.effective.contextWindow, selected.effective.contextWindowSource)}
          <WindowInput width={FIELD_W.model} value={cfg.modelContextWindow ?? null} onChange={(v) => set({ modelContextWindow: v })} allowInherit inheritLabel={t("agent-config.profile.fromModel")} />
        </SettingRow>
      )}
      {fieldEditable(detail, "modelAutoCompactTokenLimit") && (
        <SettingRow source="host" agents="next" label={t("agent-config.profile.autoCompact")}>
          {selected && effective(selected.effective.autoCompactTokenLimit, selected.effective.autoCompactTokenLimitSource)}
          <CompactInput width={FIELD_W.model} value={cfg.modelAutoCompactTokenLimit ?? null} window={cfg.modelContextWindow ?? selected?.effective.contextWindow ?? null} onChange={(v) => set({ modelAutoCompactTokenLimit: v })} allowInherit />
        </SettingRow>
      )}
    </>
  );
}
