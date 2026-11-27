// Settings → Profiles → 模型与上下文 → 模型目录 (owner 2026-11-18): one table for every runtime — 模型 · 上下文 ·
// 自动压缩 · 操作, each value with where it comes from — the first rows on the profile page, all of them on the
// 全部 N 个模型 sub-page (ProfileModelsSubPage). Single models are edited in their dialog and saved at once.
import { foldClaudeModels, presentClaudeRow } from "../../lib/claudeModels";
import { resolutionShown, rowResolution } from "../../lib/effortDisplay";
import { useState } from "react";
import { CopyPlus, RotateCw } from "lucide-react";
import type { CatalogModel, CatalogModelPatch, ProfileDetail, ProfileModelsView, ContextSource } from "../../../../shared/ipc";
import { hasLayers, pinnedSource, sourceKey } from "../../lib/contextLayers";
import { useI18n, type MessageKey } from "../../i18n";
import { formatWindow } from "../../lib/contextPresets";
import { localDateTime, upstreamModelsNotice } from "../../lib/profileKind";
import { modelLabel, useModelName } from "../../lib/modelDisplay";
import { canCreateModelVariant, claudeEffortLevels, MODEL_NAMES_FEATURE, modelListColumns, modelsSourceText, upstreamSource } from "../../lib/profileModels";
import { AddButton, SettingRow, SettingsGroup, ArmedRemove, Button, IconButton, SubPageRow } from "./Form";
import { ProfileModelDialog } from "./ProfileModelDialog";
import { useTargetApi, useTargetFeatures } from "../../lib/targetHost";
import type { ClaudeCompaction, CompactionModels } from "../../../../shared/claudeCompaction";
import { claudeCompactsAt, formatTokens } from "../../lib/contextCompaction";
import { openSettingsShelf } from "../../lib/settingsShelf";
import { Tag } from "../../components/Tag";

/** cutex `profile-catalog-overlay`: edited entries whose (base) model left upstream — kept, not launchable, removable. */
function UnavailableModels({ view, busy, onRemove }: { view: ProfileModelsView; busy: boolean; onRemove(id: string): void }) {
  const { t } = useI18n();
  const items = view.unavailableModels ?? [];
  if (!items.length) return null;
  return (
    <div className="mt-2">
      <p className="mb-1 text-xs text-subtle">{t("agent-config.profile.unavailableHint")}</p>
      <div className="rounded-lg border border-dashed border-border px-3">
        {items.map((m) => {
          const name = modelLabel(m.id, m.displayName, m.entryDisplayName);
          return (
            <div key={m.id} className="group flex items-center gap-2 border-b border-border py-1.5 last:border-b-0">
              <span className="min-w-0 truncate font-mono text-sm text-muted line-through decoration-subtle" title={m.id}>{name}</span>
              <span className="min-w-0 truncate text-caption/[inherit] text-warn-text">
                {m.reason === "baseModelMissing" && m.requestModel
                  ? t("agent-config.profile.unavailable.baseModelMissing", { model: m.requestModel })
                  : t("agent-config.profile.unavailable.modelMissing")}
              </span>
              <span className="ml-auto shrink-0 opacity-60 group-focus-within:opacity-100 group-hover:opacity-100">
                <ArmedRemove title={t("agent-config.profile.removeModel", { model: name })} disabled={busy} onRemove={() => onRemove(m.id)} />
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Upstream catalog vs the installed cute-codex — hidden when cutex omits the fields. Models missing from the
 * bundled offline catalog are benign (the server catalog carries their metadata): a quiet info line
 * (Director 2026-11-19). A cache written by a newer client stays a warning.
 */
function UpstreamNotice({ view }: { view: ProfileModelsView }) {
  const { t } = useI18n();
  const modelName = useModelName();
  const notice = upstreamModelsNotice(upstreamSource(view.modelsSource));
  if (!notice) return null;
  return (
    <>
      {notice.missing.length > 0 && (
        <p data-upstream-notice="missing" className="my-2 px-0.5 text-xs text-muted">
          {t("agent-config.profile.upstreamMissing", { models: notice.missing.map((id) => modelName(id, view.models.find((m) => m.id === id)?.displayName, view.profile.id)).join(t("agent-config.listSep")) })}
        </p>
      )}
      {notice.newer && (
        <p data-upstream-notice="newer" className="my-2 rounded-md bg-warn/10 px-2.5 py-1.5 text-xs text-warn">
          {t("agent-config.profile.upstreamNewer", { cache: notice.newer.cache, native: notice.newer.native })}
        </p>
      )}
    </>
  );
}

/** Every runtime: model, context, auto-compact, actions (owner 2026-11-18). */
const GRID = "grid grid-cols-[minmax(0,1fr)_5.5rem_6.5rem_7.5rem] items-center gap-2";

/**
 * Claude per-model compaction (cutex `claude-compaction-models`, docs/design/037): `table` = the stored table,
 * `profile` = the Profile default the other models follow (with its unsaved draft). A model's dialog saves its own
 * entry at once (like every other per-model edit); `onDetail` receives cutex's answer.
 */
export interface ClaudeModelCompaction {
  table: CompactionModels | null;
  profile: ClaudeCompaction | null;
  error?: string | null;
  disabled?: boolean;
  onDetail(detail: ProfileDetail): void;
}

/** Per-model edits save immediately; existing runtimes keep their launch snapshot. `limit`: rows shown before
 *  「全部 N 个模型」; `filter`: the sub-page's filter text. */
/** 使用此模型原设置: one click drops the upgrade-preserved value of that field. */
function RestoreLink({ disabled, onClick }: { disabled: boolean; onClick(): void }) {
  const { t } = useI18n();
  return (
    <button type="button" disabled={disabled} onClick={onClick} data-restore-preserved="" className="block w-full text-right text-caption/[inherit] text-accent hover:underline disabled:opacity-50">
      {t("settings.modelContext.restorePreserved" as MessageKey)}
    </button>
  );
}

export function ModelList({ profile, view, setView, claude, limit, filter }: { profile: string; view: ProfileModelsView; setView(v: ProfileModelsView): void; claude?: ClaudeModelCompaction; limit?: number; filter?: string }) {
  const api = useTargetApi();
  const { t, locale } = useI18n();
  const m = (k: string, v?: Record<string, string | number>) => t(`settings.modelContext.${k}` as MessageKey, v);
  const features = useTargetFeatures();
  const [editing, setEditing] = useState<{ model: CatalogModel | null; variant?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editable = view.catalogSupported;
  const variants = canCreateModelVariant(features, view);
  // profile-model-display-names: every entry (also read-only catalogs) can carry this profile's name.
  const names = features.has(MODEL_NAMES_FEATURE);
  // The view is fresher than the profile list right after an edit, so rows use its entry name.
  const rowName = (r: CatalogModel) => modelLabel(r.id, r.displayName, r.entryDisplayName);
  const discovery = view.discoverySupported ?? editable;
  const isClaude = modelListColumns(view).claude;
  // Claude (docs/design/024-model-list.md): one row per real model; an alias row stands for its newest
  // model (and that model's `[1m]` alias), shown under its name with the ids it covers.
  const folded = isClaude ? foldClaudeModels(view.models, (r) => r.id, (r) => r.displayName, view.selectedModel ?? null) : null;
  const all = folded ? folded.map((r) => r.item) : view.models;
  const foldOf = (r: CatalogModel) => folded?.find((x) => x.item === r);
  const shownName = (r: CatalogModel) => {
    const row = foldOf(r);
    return row && !r.entryDisplayName ? presentClaudeRow(row, t).name : rowName(r);
  };
  const needle = filter?.trim().toLowerCase() ?? "";
  const matching = needle ? all.filter((r) => [shownName(r), r.id, ...(foldOf(r)?.folded ?? [])].some((s) => s.toLowerCase().includes(needle))) : all;
  const rows = limit ? matching.slice(0, limit) : matching;
  const windowOf = (r: CatalogModel) => r.effective.contextWindow ?? [...(foldOf(r)?.folded ?? []), ...(foldOf(r)?.follows ? [foldOf(r)!.follows!] : [])].map((id) => view.models.find((x) => x.id === id)?.effective.contextWindow).find((w) => w != null) ?? null;
  const effortName = (id: string) => { const key = `composer.effort.${id}` as MessageKey; return t(key) === key ? id : t(key); };
  // An alias row also covers the fixed model it follows (same model; that fixed id has its own row too).
  const idsOf = (r: CatalogModel) => [r.id, ...(foldOf(r)?.folded ?? []), ...(foldOf(r)?.follows ? [foldOf(r)!.follows!] : [])];
  const amount = (n: number) => formatTokens(n, locale);
  const run = async (fn: () => Promise<ProfileModelsView>) => {
    setBusy(true);
    setError(null);
    try {
      setView(await fn());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const source = editable
    ? view.discovery
      ? t("agent-config.profile.discoveredAt", { at: localDateTime(view.discovery.fetchedAt) })
      : modelsSourceText(t, view)
    : (modelsSourceText(t, view) ?? t("agent-config.profile.catalogUnsupported"));
  const src = upstreamSource(view.modelsSource);
  const sourceTitle = src?.kind === "nativeCache" && src.clientVersion ? `cute-codex ${src.clientVersion}` : src?.kind === "nativeBundled" && src.cliSha256 ? `sha256 ${src.cliSha256.slice(0, 12)}` : undefined;
  // The details live in the ⓘ (R7); the page shows the source and one line about saving.
  const notes = [
    editable ? t("agent-config.profile.entryHint") : names && t("agent-config.profile.entryNamesListHint"),
    isClaude && t("agent-config.profile.claudeContextHint"),
    !isClaude && t("settings.profileParity.catalogLimitsHint" as MessageKey),
    variants && t("agent-config.profile.variantsHint"),
    variants && t("agent-config.profile.variantSwitchHint"),
    view.followsUpstream && editable && t("agent-config.profile.followsUpstreamHint"),
  ].filter((n): n is string => !!n);
  const canEdit = editable || names || !!claude;
  /** cutex source tags, per field (window and compaction resolve independently; P13 B adds `preserved`). */
  const sourceText = (s: ContextSource | undefined) => m(sourceKey(s));
  const layered = view.models.some(hasLayers);
  /** P13 B: drop an upgrade-preserved value (one field, its own request: never together with an edit of it). */
  const restore = (r: CatalogModel, field: "window" | "compact") => {
    const patch: CatalogModelPatch = field === "window" ? { restorePreservedContextWindow: true } : { restorePreservedAutoCompaction: true };
    void run(() => api.patchModel(profile, r.id, patch));
  };
  /** The context cell: value + where it comes from. */
  const contextCell = (r: CatalogModel) => {
    if (isClaude) {
      const w = windowOf(r);
      return w == null
        ? { value: t("agent-config.profile.claudeWindowVaries"), from: m("source.model"), title: t("agent-config.profile.claudeWindowVariesTitle") }
        : { value: formatWindow(w), from: m("source.model") };
    }
    const s = r.effective.contextWindowSource;
    return { value: formatWindow(r.effective.contextWindow), from: sourceText(s), own: pinnedSource(s), preserved: s === "preserved" };
  };
  /** The auto-compact cell: where it compacts + where that comes from. */
  const compactCell = (r: CatalogModel) => {
    if (isClaude) {
      const own = idsOf(r).map((id) => claude?.table?.[id]).find((c) => !!c) ?? null;
      const shown = own ?? claude?.profile ?? null;
      const at = claudeCompactsAt(shown, windowOf(r));
      return { value: at ? `≈${amount(at)}` : "—", from: m(own ? "source.thisModel" : shown ? "source.profile" : "source.runtimeDefault"), own: !!own };
    }
    const e = r.effective;
    // A percentage (profile-model-context-v1) shows with its source; the value is the resolved token point.
    if (e.autoCompactPercent != null) return { value: formatWindow(e.autoCompactTokenLimit), from: `${e.autoCompactPercent}% · ${sourceText(e.autoCompactPercentSource)}`, own: pinnedSource(e.autoCompactPercentSource), preserved: e.autoCompactPercentSource === "preserved" };
    return { value: formatWindow(e.autoCompactTokenLimit), from: sourceText(e.autoCompactTokenLimitSource), own: pinnedSource(e.autoCompactTokenLimitSource), preserved: e.autoCompactTokenLimitSource === "preserved" };
  };
  const effortLine = (r: CatalogModel) => {
    const levels = isClaude ? claudeEffortLevels(r) : r.supportedReasoningEfforts;
    const head = levels.length
      ? t("settings.profileParity.modelEfforts" as MessageKey, { levels: levels.map(effortName).join(" / ") })
      : t((r.effortSupportKnown === true ? "agent-config.profile.effortNone" : "settings.profileParity.modelEffortsUnknown") as MessageKey);
    // The level a new agent on this row gets (cutex resolved-reasoning-effort: owner per-model → Profile → runtime
    // default), else (older host, Codex) the catalog's level for an unset effort — explicit levels only, never
    // 「默认」 (owner 2026-11-20, lib/effortDisplay).
    const resolution = rowResolution(r);
    const shown = resolution ? resolutionShown(resolution) : null;
    const dflt = shown?.level ? ` · ${t("effortLabel.inUse", { effort: effortName(shown.level) })}`
      : shown && levels.length ? ` · ${t("effortLabel.inUse", { effort: t(shown.none === "unsupported" ? "effortLabel.unsupportedShort" : "effortLabel.unreportedShort") })}`
      : !resolution && !isClaude && levels.length && r.defaultReasoningEffort ? ` · ${t("effortLabel.whenUnset", { effort: effortName(r.defaultReasoningEffort) })}` : "";
    return head + dflt;
  };
  return (
    <>
      <SettingRow agents={canEdit ? "next" : "none"} source="host" readOnly={!editable && !claude} label={m("catalog")}
        info={notes.length ? notes.join("\n") : undefined}
        hint={<>
          <span className="block" title={sourceTitle}>{source}{!editable && ` · ${t(names || claude ? "agent-config.profile.modelsNamesOnly" : "agent-config.profile.modelsReadOnly")}`}</span>
          <span className="block">{m("catalogSaveHint")}</span>
          {layered && <span className="block" data-profile-applies="">{m("profileAppliesHint")}</span>}
        </>}>
        {editable && (
          <span className="ml-auto flex shrink-0 gap-2">
            {discovery && <Button disabled={busy} onClick={() => void run(() => api.discoverModels(profile))}>
              <RotateCw size={12} className="mr-1 -ml-0.5 inline align-[-2px]" />
              {t("agent-config.profile.discover")}
            </Button>}
            {discovery && <AddButton onClick={() => setEditing({ model: null })}>{t("agent-config.profile.addModel")}</AddButton>}
          </span>
        )}
      </SettingRow>
      <UpstreamNotice view={view} />
      {error && <p className="py-1 text-xs text-danger">{error}</p>}
      {claude?.error && <p className="py-1 text-xs text-danger">{t("agent-config.profile.claudeCompaction.error", { error: claude.error })}</p>}
      {view.models.length === 0 ? (
        <p className="py-1 text-xs text-subtle">{editable ? t("agent-config.profile.noModels") : (view.modelsUnavailableReason ?? t("agent-config.profile.noModelsNative"))}</p>
      ) : (
        <div className="border-t border-border" data-model-catalog="">
          <div className={`${GRID} border-b border-border py-1.5 text-caption/[inherit] text-subtle`}>
            <span>{t("agent-config.defaults.profileModel")}</span>
            <span className="text-right">{t("agent-config.profile.colContext")}</span>
            <span className="text-right">{t("agent-config.profile.colCompact")}</span>
            <span />
          </div>
          {rows.map((r) => {
            const ctx = contextCell(r);
            const cmp = compactCell(r);
            return (
            <SettingsGroup key={r.id} agents={canEdit ? "next" : "none"} source="host" readOnly={!canEdit && !variants}>{decoration => <div {...decoration.attributes} className="border-b border-border last:border-b-0">
            <div className={`group ${GRID} py-1.5`} data-model-row={r.id}>
              <span className="flex min-w-0 flex-col items-start gap-0.5">
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="min-w-0 truncate font-mono text-sm" title={[r.id, ...(foldOf(r)?.folded ?? [])].join(" · ")}>
                  {shownName(r)}
                  {r.entryDisplayName && <span className="ml-1.5 text-caption/[inherit] text-subtle">{r.id}</span>}
                </span>
                {foldOf(r)?.alias && <span title={presentClaudeRow(foldOf(r)!, t).description}><Tag>{t("claudeModels.latestTag")}</Tag></span>}
                {decoration.marker}
                {/* Every Claude model takes images: the tag says nothing there. */}
                {!isClaude && r.inputModalities.includes("image") && <Tag>{t("agent-config.profile.vision")}</Tag>}
                {r.id === view.selectedModel && <span className="shrink-0 text-caption/[inherit] text-accent">{t("agent-config.profile.selected")}</span>}
                </span>
                <span className="text-caption/[inherit] text-subtle" data-model-effort={r.id}>{effortLine(r)}</span>
              </span>
              <span className={`text-right text-xs tabular-nums ${"own" in ctx && ctx.own ? "text-foreground" : "text-muted"}`} title={ctx.title} data-model-window={r.id}>{ctx.value}<span className={`block text-caption/[inherit] ${"own" in ctx && ctx.own ? "text-accent" : "text-subtle"}`}>{ctx.from}</span>
                {"preserved" in ctx && ctx.preserved && <RestoreLink disabled={busy} onClick={() => restore(r, "window")} />}
              </span>
              <span className={`text-right text-xs tabular-nums ${cmp.own ? "text-foreground" : "text-muted"}`} data-model-compact={r.id}>{cmp.value}<span className={`block text-caption/[inherit] ${cmp.own ? "text-accent" : "text-subtle"}`}>{cmp.from}</span>
                {"preserved" in cmp && cmp.preserved && <RestoreLink disabled={busy} onClick={() => restore(r, "compact")} />}
              </span>
              <span className="flex items-center justify-end gap-1 opacity-60 group-focus-within:opacity-100 group-hover:opacity-100">
                {variants && <IconButton label={t("agent-config.profile.addVariantFor", { model: rowName(r) })} disabled={busy} onClick={() => setEditing({ model: r, variant: true })}><CopyPlus size={14} /></IconButton>}
                {canEdit && <button disabled={busy} onClick={() => setEditing({ model: r })} className="rounded px-1.5 text-xs hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none">{t("agent-config.profile.edit")}</button>}
                {editable && r.id !== view.selectedModel && (
                  <ArmedRemove title={t("agent-config.profile.removeModel", { model: rowName(r) })} disabled={busy} onRemove={() => void run(() => api.deleteModel(profile, r.id))} />
                )}
              </span>
            </div>
            </div>}</SettingsGroup>
            );
          })}
          {needle && matching.length === 0 && <p className="py-2 text-xs text-subtle">{m("noMatch")}</p>}
          {limit !== undefined && all.length > limit && (
            <SubPageRow title={m("allModels", { n: all.length })} summary={m("allModelsSummary")} effect={{ agents: canEdit ? "next" : "none", source: "host" }} onOpen={() => openSettingsShelf({ tab: "profiles", profile, sub: "models" })} />
          )}
        </div>
      )}
      <UnavailableModels view={view} busy={busy} onRemove={(id) => void run(() => api.deleteModel(profile, id))} />
      {editing && (
        <ProfileModelDialog
          profile={profile}
          view={view}
          model={editing.model}
          variant={editing.variant}
          catalog={editable}
          names={names}
          claude={claude && editing.model && !editing.variant ? { ...claude, ids: idsOf(editing.model), window: windowOf(editing.model) } : undefined}
          onClose={() => setEditing(null)}
          onSaved={(v) => {
            setView(v);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}
