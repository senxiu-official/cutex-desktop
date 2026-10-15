// A profile's default model, reasoning effort, context window and auto-compact — the per-profile
// config in cutex `/v2/profiles/{p}`, on the profile page's 模型 section (saved by its save bar;
// Settings → 新建 only shows a read-only summary with a link here).
import type { ProfileConfig, ProfileDetail, ProfileModelsView, ProfilePatch, ReasoningSummaryMode, WebSearchMode } from "../../../../shared/ipc";
import { useI18n, type MessageKey } from "../../i18n";
import { formatWindow } from "../../lib/contextPresets";
import { FIELD_W } from "../../lib/fieldWidths";
import { fieldEditable, fieldOffered } from "../../lib/profileKind";
import { SettingRow, Select, TextInput, Toggle } from "./Form";
import { CompactInput, WindowInput } from "./ProfileContextInputs";
import { useModelName } from "../../lib/modelDisplay";
import { ModelName } from "../ModelName";

const EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
/** Claude effort levels cutex takes (`options.claude.effort`) when the model row lists none. */
const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const SUMMARIES: ReasoningSummaryMode[] = ["auto", "detailed", "concise", "none"];
const WEB_SEARCH: WebSearchMode[] = ["disabled", "cached", "live"];

export function ProfileModelFields({ detail, models, cfg, set, searchTool }: { detail: ProfileDetail; models: ProfileModelsView | null; cfg: Partial<ProfileConfig>; set(p: ProfilePatch): void; /** The draft `searchTool` (profile-search-tool), else the stored one. */ searchTool?: boolean }) {
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
  const override = claudeDefaults ? (detail.detail.claudeNewSessionModel ?? null) : null;
  const selected = list.find((m) => m.id === (model ?? models?.selectedModel));
  const src = (s: string) => t(`agent-config.profile.source.${s}` as MessageKey);
  // Effort ids in the app language (the composer's 低 / 中 / 高 …); unknown ids stay raw.
  const effortName = (e: string) => {
    const key = `composer.effort.${e}` as MessageKey;
    return t(key) === key ? e : t(key);
  };
  const effective = (value: number | null, source: string) => (value ? <span className="text-xs text-subtle tabular-nums">{t("agent-config.profile.effectiveInline", { value: formatWindow(value), source: src(source) })}</span> : null);
  return (
    <>
      <SettingRow label={t("agent-config.profile.model")} hint={claudeDefaults ? t(override ? "agent-config.profile.claudeModelOverrideHint" : "agent-config.profile.claudeModelHint", { model: override ? modelName(override, null, detail.id) : "" }) : undefined}>
        {!modelEditable ? (
          <ModelName id={model ?? detail.model} profile={detail.id} fallback="—" className="font-mono text-xs text-muted" />
        ) : list.length > 0 ? (
          <Select
            width={FIELD_W.model}
            value={model ?? ""}
            options={[
              ...(model ? [] : [{ value: "", label: "—" }]),
              ...list.map((m) => ({ value: m.id, label: modelName(m.id, m.displayName, detail.id) })),
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
        <SettingRow label={t("agent-config.profile.effort")}>
          <Select
            width={FIELD_W.model}
            value={cfg.modelReasoningEffort ?? ""}
            options={[
              { value: "", label: selected?.defaultReasoningEffort ? `— (${effortName(selected.defaultReasoningEffort)})` : "—" },
              ...(selected?.supportedReasoningEfforts.length ? selected.supportedReasoningEfforts : claude ? CLAUDE_EFFORTS : EFFORTS).map((e) => ({ value: e, label: effortName(e) })),
            ]}
            onChange={(v) => set({ modelReasoningEffort: v || null })}
          />
        </SettingRow>
      )}
      {/* GPT models default to no reasoning summaries; turning them on fills the timeline's 推理
          rows (DESIGN §4.14). Takes effect when the agent's native process next starts. */}
      {fieldOffered(detail, "modelReasoningSummary") && (
        <SettingRow label={t("agent-config.profile.reasoningSummary")} hint={t("agent-config.profile.reasoningSummaryHint")}>
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
      {/* Codex registers update_plan only with tools.update_plan.enabled; it feeds the capsule's 进程. */}
      {fieldOffered(detail, "updatePlanEnabled") && (
        <SettingRow label={<span title="update_plan">{t("agent-config.profile.updatePlan")}</span>} hint={t("agent-config.profile.updatePlanHint")}>
          <Toggle checked={cfg.updatePlanEnabled === true} onChange={(v) => set({ updatePlanEnabled: v })} />
        </SettingRow>
      )}
      {/* Codex's built-in web_search; some providers refuse it next to function calls (cutex preset gemini = off). */}
      {fieldOffered(detail, "webSearch") && (
        <SettingRow label={<span title="web_search">{t("agent-config.profile.webSearch")}</span>} hint={t("agent-config.profile.webSearchHint")}>
          <Select
            width={FIELD_W.model}
            value={cfg.webSearch ?? ""}
            options={[
              { value: "", label: t("agent-config.profile.webSearch.default") },
              // "indexed" only when already set (not offered otherwise).
              ...[...WEB_SEARCH, ...(cfg.webSearch === "indexed" ? (["indexed"] as const) : [])].map((v) => ({ value: v, label: t(`agent-config.profile.webSearch.${v}` as MessageKey) })),
            ]}
            onChange={(v) => set({ webSearch: (v || null) as WebSearchMode | null })}
          />
        </SettingRow>
      )}
      {/* cutex profile-search-tool: the separate search-only `web_search` cutex tool, for providers
          that refuse the built-in search next to function calls. Owner switch, default off. */}
      {/* Turning it on also turns 内置网页搜索 off in the same draft (the tool exists for providers that
          refuse the two together; owner 2026-10-15 switched only one and kept the 400). Generic, no
          provider check; while both stay on, a line under the row offers to turn the built-in off. */}
      {fieldOffered(detail, "searchTool") && (
        <SettingRow label={<span title="web_search (cutex)">{t("agent-config.profile.searchTool")}</span>} hint={t("agent-config.profile.searchToolHint")}>
          <Toggle
            checked={searchTool ?? detail.searchTool ?? false}
            onChange={(v) => set(v && fieldOffered(detail, "webSearch") && cfg.webSearch !== "disabled" ? { searchTool: true, webSearch: "disabled" } : { searchTool: v })}
          />
        </SettingRow>
      )}
      {fieldOffered(detail, "searchTool") && fieldOffered(detail, "webSearch") && (searchTool ?? detail.searchTool ?? false) && cfg.webSearch !== "disabled" && (
        <p data-search-tool-conflict className="-mt-1 mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-warn">
          {t("agent-config.profile.searchToolBuiltinOn")}
          <button type="button" onClick={() => set({ webSearch: "disabled" })} className="rounded-md border border-border px-2 py-0.5 text-foreground hover:bg-hover">
            {t("agent-config.profile.searchToolBuiltinOff")}
          </button>
        </p>
      )}
      {fieldEditable(detail, "modelContextWindow") && (
        <SettingRow label={t("agent-config.profile.contextWindow")} hint={selected?.maxContextWindow ? t("agent-config.profile.maxHint", { max: formatWindow(selected.maxContextWindow) }) : t("agent-config.profile.contextProfileHint")}>
          {selected && effective(selected.effective.contextWindow, selected.effective.contextWindowSource)}
          <WindowInput width={FIELD_W.model} value={cfg.modelContextWindow ?? null} onChange={(v) => set({ modelContextWindow: v })} allowInherit inheritLabel={t("agent-config.profile.fromModel")} />
        </SettingRow>
      )}
      {fieldEditable(detail, "modelAutoCompactTokenLimit") && (
        <SettingRow label={t("agent-config.profile.autoCompact")}>
          {selected && effective(selected.effective.autoCompactTokenLimit, selected.effective.autoCompactTokenLimitSource)}
          <CompactInput width={FIELD_W.model} value={cfg.modelAutoCompactTokenLimit ?? null} window={cfg.modelContextWindow ?? selected?.effective.contextWindow ?? null} onChange={(v) => set({ modelAutoCompactTokenLimit: v })} allowInherit />
        </SettingRow>
      )}
    </>
  );
}
