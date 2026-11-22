// Profile → 模型与上下文 (owner 2026-11-18: one skeleton for every runtime). Two groups on the profile page, saved
// by its save bar: 默认模型与推理 (model, effort, reasoning summary) and 上下文与压缩 (上下文窗口 + 自动压缩, the
// same two controls on every runtime — components/settings/ContextCompactionRows, lib/contextCompaction). A row the
// runtime or host does not offer stays in place, greyed, with one line saying why.
import { claudeCatalogChoices, foldClaudeModels, presentClaudeRow, type FoldedModel } from "../../lib/claudeModels";
import { profileUnsetShown, rowResolution, skippedLines, unsetChoice } from "../../lib/effortDisplay";
import type { CatalogModel, ProfileConfig, ProfileDetail, ProfileModelsView, ProfilePatch, ReasoningSummaryMode } from "../../../../shared/ipc";
import { useI18n, type MessageKey } from "../../i18n";
import { formatWindow } from "../../lib/contextPresets";
import { FIELD_W } from "../../lib/fieldWidths";
import { fieldEditable, fieldOffered, type ProfileKind } from "../../lib/profileKind";
import { SettingRow, Select, TextInput } from "./Form";
import { useModelName } from "../../lib/modelDisplay";
import { ModelName } from "../ModelName";
import { claudeEffortLevels } from "../../lib/profileModels";
import { CLAUDE_COMPACTION_FEATURE, sameCompaction, type ClaudeCompaction } from "../../../../shared/claudeCompaction";
import { catalogFirst, claudeCompactsAt, claudePercentBlock, codexEffective, codexPercentBlock, contextBlocked, contextReasonMessage, formatTokens, MODEL_CONTEXT_V1_FEATURE, fromClaude, fromCodex, toClaude, toCodex } from "../../lib/contextCompaction";
import { defaultNumbers, layeredView } from "../../lib/contextLayers";
import { useTargetFeatures } from "../../lib/targetHost";
import { ContextCompactionRows, UnsupportedContextRows } from "./ContextCompactionRows";

const SUMMARIES: ReasoningSummaryMode[] = ["auto", "detailed", "concise", "none"];

/** The 推理摘要 row where the runtime does not offer it: greyed, with the reason. */
export function SummaryUnsupportedRow({ reason }: { reason: string }) {
  const { t } = useI18n();
  return (
    <SettingRow source="host" agents="next" readOnly label={t("agent-config.profile.reasoningSummary")} hint={reason}>
      <Select width={FIELD_W.model} disabled value="" options={[{ value: "", label: "—" }]} onChange={() => {}} />
    </SettingRow>
  );
}

export function ProfileModelFields({ detail, models, cfg, set }: { detail: ProfileDetail; models: ProfileModelsView | null; cfg: Partial<ProfileConfig>; set(p: ProfilePatch): void; }) {
  const { t } = useI18n();
  const m = (k: string) => t(`settings.modelContext.${k}` as MessageKey);
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
  const selected = list.find((x) => x.id === (model ?? models?.selectedModel));
  // The default model left upstream (cutex unavailableModels): new agents on it would fail to start.
  const gone = [model, models?.selectedModel].find((id) => id && models?.unavailableModels?.some((u) => u.id === id)) ?? null;
  // Effort ids in the app language (the composer's 低 / 中 / 高 …); unknown ids stay raw.
  const effortName = (e: string) => {
    const key = `composer.effort.${e}` as MessageKey;
    return t(key) === key ? e : t(key);
  };
  // Empty/absent Codex metadata is not evidence that every reasoning level is supported.
  const levels = claude ? claudeEffortLevels(selected) : selected?.supportedReasoningEfforts ?? [];
  const storedEffort = cfg.modelReasoningEffort ?? null;
  // "" = no stored effort: 「不指定（中）」 with the level that then applies — the host's resolution for the selected
  // model when the Profile sets none (cutex resolved-reasoning-effort), else the catalog's level; 「不指定（未上报）」
  // / 「不指定（不支持）」 without one — never 「默认」 (owner 2026-11-20, lib/effortDisplay).
  // The host's resolution already applies the owner's per-model level and skips what the model cannot use (a skipped
  // 超高 resolving to 高 shows 高); a raw saved value is only used when the host gives no resolution.
  const resolution = rowResolution(selected);
  const defaultLabel = unsetChoice(t, profileUnsetShown(selected, storedEffort, levels, claude));
  return (
    <>
      <SettingRow source="host" agents="next" readOnly={!modelEditable} label={t("agent-config.profile.model")} hint={gone ? <span className="text-warn">{t("models.defaultGoneHint", { model: modelName(gone, null, detail.id) })}</span> : override ? t("agent-config.profile.claudeModelOverrideHint", { model: modelName(override, null, detail.id) }) : m("modelHint")}>
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
                ? claudeCatalogChoices(list, model, t).map((c) => ({ value: c.id, label: modelName(c.id, c.option, detail.id) }))
                : list.map((x) => ({ value: x.id, label: modelName(x.id, x.displayName, detail.id) }))),
              // A configured model the list doesn't know (e.g. newer than the native cache) stays selectable.
              ...(model && !list.some((x) => x.id === model) ? [{ value: model, label: modelName(model, null, detail.id) }] : []),
            ]}
            onChange={(v) => set({ model: v || null })}
          />
        ) : (
          <TextInput mono width={FIELD_W.model} value={model ?? ""} onChange={(v) => set({ model: v || null })} />
        )}
      </SettingRow>
      {effortEditable && (
        <SettingRow source="host" agents="next" label={t("agent-config.profile.effort")}
          hint={<>{levels.length ? m("effortHint") : claude || selected?.effortSupportKnown === true ? t("agent-config.profile.effortNone") : m("effortUnknownHint")}
            {/* Saved choices the selected model cannot use (cutex resolution `skipped`). */}
            {skippedLines(t, resolution?.skipped ?? []).map((line) => <span key={line} className="block text-warn" data-effort-skipped="">{line}</span>)}</>}
          info={claude ? undefined : t("settings.profileParity.effortInheritance" as MessageKey)}>
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
      {fieldOffered(detail, "modelReasoningSummary") ? (
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
      ) : (
        <SummaryUnsupportedRow reason={m(claude ? "summaryNoClaude" : "summaryNoProvider")} />
      )}
    </>
  );
}

/** The catalog row a Claude profile's hints describe: the default model's (folded as in the catalog, so an alias is
 *  its newest model), with the ids it covers; the window falls back to the first known one. */
function claudeContextOf(list: readonly CatalogModel[], id: string | null | undefined): { row: CatalogModel | null; fold: FoldedModel<CatalogModel> | null; ids: string[]; window: number | null } {
  const folded = foldClaudeModels(list, (r) => r.id, (r) => r.displayName, id ?? null);
  const fold = folded.find((f) => f.item.id === id || f.folded.includes(id ?? "")) ?? null;
  const row = fold?.item ?? list.find((x) => x.id === id) ?? null;
  const ids = row ? [row.id, ...(fold?.folded ?? [])] : [];
  const windowOf = (r: CatalogModel) => r.effective.contextWindow ?? r.maxContextWindow ?? null;
  const window = (row && (windowOf(row) ?? ids.map((x) => list.find((r) => r.id === x)).map((r) => r && windowOf(r)).find((w) => w != null))) ?? list.find((x) => x.effective.contextWindow)?.effective.contextWindow ?? null;
  return { row, fold, ids, window };
}

/** 上下文与压缩 at Profile level, for any runtime. `setOrDrop` keeps the draft clean when a value is back at the saved one. */
export function ProfileContextRows({ kind, detail, models, cfg, patch, setOrDrop, onValidityChange }: {
  kind: ProfileKind;
  detail: ProfileDetail;
  models: ProfileModelsView | null;
  cfg: Partial<ProfileConfig>;
  patch: ProfilePatch;
  setOrDrop<K extends keyof ProfilePatch>(key: K, value: ProfilePatch[K], stored: ProfilePatch[K] | undefined): void;
  /** See ContextCompactionRows: false blocks the page's save while a typed value is invalid. */
  onValidityChange?(valid: boolean): void;
}) {
  const { t, locale } = useI18n();
  const m = (k: string, v?: Record<string, string | number>) => t(`settings.modelContext.${k}` as MessageKey, v);
  const features = useTargetFeatures();
  const modelName = useModelName();
  const list = models?.models ?? [];
  const amount = (n: number) => formatTokens(n, locale);
  const reason = (code: string) => { const r = contextReasonMessage(code); return t(r.key as MessageKey, r.vars); };
  const v1Host = features.has(MODEL_CONTEXT_V1_FEATURE);
  if (kind === "dsh" || kind === "kimi") return <UnsupportedContextRows reason={m(kind === "dsh" ? "unsupportedDsh" : "unsupportedKimi")} />;
  const blocked = contextBlocked(detail);
  if (blocked) return <UnsupportedContextRows reason={reason(blocked)} />;
  // P13 B: 默认 labels with the number the backend resolved for the (draft) default model, never a computed or
  // universal one — defaults differ by model (profileDefaultValues.byModel / selected).
  const layered = layeredView(models);
  // The draft's default model: an explicit null in the draft = the owner cleared it (cutex then reports no selected
  // defaults), not "fall back to the saved one".
  const defaultId = patch.model !== undefined ? (patch.model ?? null) : (cfg.model ?? models?.selectedModel ?? null);
  const pdv = models?.profileDefaultValues;
  // Director 2026-11-18 (re-review of 21f7d0c97): the default model is an input too — numbers only while the draft's
  // default model is the saved one the backend resolved them for; another or no model reads plain 默认 until saved.
  const defaultsOf = pdv && defaultId !== null && pdv.selectedModel === defaultId ? (pdv.byModel?.[defaultId] ?? pdv.selected) : null;
  const dn = layered ? defaultNumbers(defaultsOf) : null;
  // The compaction default was resolved with the saved Profile window (the resolved window): while the draft changes
  // that window it reads plain 默认 until saved (Director 2026-11-18; never a number computed here). The window default
  // is resolved without the Profile window, so it holds.
  const profileWindowChanged = detail.cliKind === "claude"
    ? patch.claudeCompaction !== undefined && (patch.claudeCompaction?.window ?? null) !== (detail.claudeCompaction?.window ?? null)
    : patch.modelContextWindow !== undefined && (patch.modelContextWindow ?? null) !== (detail.detail?.config?.modelContextWindow ?? null);
  const defaultLabels = dn ? {
    window: dn.window !== null ? m("defaultWith", { value: formatWindow(dn.window) }) : m("default"),
    compact: dn.compactAt !== null && !profileWindowChanged ? m("defaultAbout", { value: amount(dn.compactAt) }) : m("default"),
  } : undefined;

  if (detail.cliKind === "claude") {
    if (!features.has(CLAUDE_COMPACTION_FEATURE) || detail.claudeCompaction === undefined) return <UnsupportedContextRows reason={m("unsupportedHost")} />;
    const stored = detail.claudeCompaction ?? null;
    const current: ClaudeCompaction | null = patch.claudeCompaction !== undefined ? patch.claudeCompaction ?? null : stored;
    const { row, fold, ids, window } = claudeContextOf(list, cfg.model ?? models?.selectedModel);
    const name = row ? (fold && !row.entryDisplayName ? presentClaudeRow(fold, t).name : modelName(row.id, row.displayName, detail.id)) : null;
    // A model's own entry wins over the Profile value (cutex claude-compaction-models): say so instead of a point it will not use.
    const own = ids.map((x) => detail.claudeCompactionModels?.[x]).find((c) => !!c) ?? null;
    const at = claudeCompactsAt(own ?? current, window);
    const value = fromClaude(current);
    const error = detail.detail?.claudeCompactionError;
    const claudeBlock = claudePercentBlock(v1Host, detail);
    return (
      <ContextCompactionRows
        runtime="claude"
        defaultLabels={defaultLabels}
        onValidityChange={onValidityChange}
        value={value}
        disabled={!fieldEditable(detail, "claudeCompaction")}
        // profile-model-context-v1: a percent alone (of each model's window); older hosts need a fixed window.
        percentBlock={claudeBlock === null ? null : reason(claudeBlock)}
        check={(v) => { const c = toClaude(v, claudeBlock === null); return c && "unsupported" in c ? c.unsupported : null; }}
        onChange={(v) => {
          const c = toClaude(v, claudeBlock === null);
          if (c && "unsupported" in c) return;
          setOrDrop("claudeCompaction", sameCompaction(c, stored) ? stored : c, stored);
        }}
        windowHint={<>{value.window === null && !value.compact && window && name ? m("nowWindow", { value: formatWindow(window), model: name }) + " · " : ""}{m("claudeWindowOnly")}</>}
        compactHint={<>
          {at && name ? m(own ? "nowCompactModelOwn" : current ? "nowCompact" : "nowCompactClaudeDefault", { at: amount(at), model: name }) : current ? null : m("claudeDecides")}
          {error && patch.claudeCompaction === undefined && <span className="block text-danger">{t("agent-config.profile.claudeCompaction.error", { error })}</span>}
        </>}
        compactInfo={t("settings.profileTiming.compaction" as MessageKey)}
      />
    );
  }

  if (!fieldEditable(detail, "modelContextWindow") || !fieldEditable(detail, "modelAutoCompactTokenLimit")) return <UnsupportedContextRows reason={m("unsupportedHost")} />;
  // P13: an API-key Profile without a catalog yet — cutex refuses Profile context edits until the first model creates it.
  if (catalogFirst(models)) return <UnsupportedContextRows reason={reason("needsCatalog")} />;
  const storedWindow = detail.detail?.config?.modelContextWindow ?? null;
  const storedLimit = detail.detail?.config?.modelAutoCompactTokenLimit ?? null;
  const storedPercent = detail.detail?.config?.modelAutoCompactPercent ?? detail.modelAutoCompactPercent ?? null;
  // profile-model-context-v1 on a migrated Profile: the percent is its own field and the models' own values win.
  const block = codexPercentBlock(v1Host, detail, fieldEditable(detail, "modelAutoCompactPercent"), { migratesOnEdit: layered });
  const percentField = block === null;
  // B hosts migrate on the first context edit: the hints already follow the migrated rules.
  const migrated = v1Host && (detail.modelContextSettingsV1 === true || (layered && percentField));
  const value = fromCodex(cfg.modelContextWindow, cfg.modelAutoCompactTokenLimit, percentField ? (cfg.modelAutoCompactPercent !== undefined ? cfg.modelAutoCompactPercent : storedPercent) : null, !percentField);
  const row = list.find((x) => x.id === (cfg.model ?? models?.selectedModel)) ?? null;
  const eff = row ? codexEffective(row, value, migrated) : null;
  const name = row ? modelName(row.id, row.displayName, detail.id) : null;
  return (
    <ContextCompactionRows
      runtime="codex"
      defaultLabels={defaultLabels}
      onValidityChange={onValidityChange}
      value={value}
      percentBlock={block === null ? null : reason(block)}
      check={(v) => { const w = toCodex(v, percentField); return "unsupported" in w ? w.unsupported : null; }}
      onChange={(v) => {
        const w = toCodex(v, percentField);
        if ("unsupported" in w) return;
        setOrDrop("modelContextWindow", w.modelContextWindow, storedWindow);
        setOrDrop("modelAutoCompactTokenLimit", w.modelAutoCompactTokenLimit, storedLimit);
        if (percentField) setOrDrop("modelAutoCompactPercent", w.modelAutoCompactPercent ?? null, storedPercent);
      }}
      windowHint={<>{eff?.window && name ? m(eff.ownWindow ? "nowWindowModelOwn" : "nowWindow", { value: formatWindow(eff.window), model: name }) + " · " : ""}{row?.maxContextWindow ? m("cappedAt", { max: formatWindow(row.maxContextWindow) }) : m("capped")}</>}
      compactHint={<>
        {eff?.compactAt && name ? m(eff.own ? "nowCompactModelOwn" : "nowCompact", { at: amount(eff.compactAt), model: name }) : null}
        {/* A legacy value at or above the window (kept raw by cutex migration): Native caps it at 90 % of the window. */}
        {value.compact && "tokens" in value.compact && value.window !== null && value.compact.tokens >= value.window && (
          <span className="block text-warn">{m("compactAboveWindow", { at: amount(Math.floor((value.window * 9) / 10)) })}</span>
        )}
      </>}
      compactInfo={t("settings.profileParity.catalogLimitsHint" as MessageKey)}
    />
  );
}
