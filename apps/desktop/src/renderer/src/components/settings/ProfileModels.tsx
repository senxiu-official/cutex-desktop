// Settings → Profiles → 模型: context-window / auto-compact pickers and the profile's model list —
// an editable catalog (including official models on a capable runtime), or native/Claude choices.
import { foldClaudeModels, presentClaudeRow } from "../../lib/claudeModels";
import { useState } from "react";
import { CopyPlus, Info, RotateCw } from "lucide-react";
import type { CatalogModel, ProfileModelsView } from "../../../../shared/ipc";
import { useI18n, type MessageKey } from "../../i18n";
import { formatWindow } from "../../lib/contextPresets";
import { localDateTime, upstreamModelsNotice } from "../../lib/profileKind";
import { modelLabel, useModelName } from "../../lib/modelDisplay";
import { canCreateModelVariant, MODEL_NAMES_FEATURE, modelListColumns, modelsSourceText, upstreamSource } from "../../lib/profileModels";
import { AddButton, SettingRow, SettingsGroup, ArmedRemove, Button, IconButton } from "./Form";
import { ProfileModelDialog } from "./ProfileModelDialog";
import { useTargetApi, useTargetFeatures } from "../../lib/targetHost";
import { CLAUDE_COMPACTION_FEATURE, MAX_COMPACTION_MODELS, compactAt, withModelCompaction, type ClaudeCompaction, type CompactionModels } from "../../../../shared/claudeCompaction";
import { CompactionPicker } from "./CompactionPicker";
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

/** "Upstream has models the installed cute-codex doesn't know" — hidden when cutex omits the fields. */
function UpstreamNotice({ view }: { view: ProfileModelsView }) {
  const { t } = useI18n();
  const modelName = useModelName();
  const notice = upstreamModelsNotice(upstreamSource(view.modelsSource));
  if (!notice) return null;
  return (
    <p className="my-2 rounded-md bg-warn/10 px-2.5 py-1.5 text-xs text-warn">
      {notice.missing.length
        ? t("agent-config.profile.upstreamMissing", { models: notice.missing.map((id) => modelName(id, view.models.find((m) => m.id === id)?.displayName, view.profile.id)).join(t("agent-config.listSep")) })
        : t("agent-config.profile.upstreamNewer", { cache: notice.newer!.cache, native: notice.newer!.native })}
    </p>
  );
}

/** Model column, then the limit columns this list shows (lib/profileModels modelListColumns), then actions. */
const GRIDS: Record<number, string> = {
  0: "grid grid-cols-[minmax(0,1fr)_7.5rem] items-center gap-2",
  1: "grid grid-cols-[minmax(0,1fr)_5.5rem_7.5rem] items-center gap-2",
  2: "grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_7.5rem] items-center gap-2",
  3: "grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_5.5rem_7.5rem] items-center gap-2",
};

/**
 * cutex `claude-compaction-models` (docs/design/037), part of the page draft like the profile-wide row:
 * `table` = the stored table, `draft` undefined = unchanged, `profile` = the profile-wide value other
 * models follow. `change(undefined)` drops the draft.
 */
export interface ModelCompaction {
  table: CompactionModels | null;
  draft: CompactionModels | null | undefined;
  profile: ClaudeCompaction | null;
  error?: string | null;
  disabled?: boolean;
  change(v: CompactionModels | null | undefined): void;
}

/** Per-model edits save immediately; existing runtimes keep their launch snapshot. */
export function ModelList({ profile, view, setView, compaction }: { profile: string; view: ProfileModelsView; setView(v: ProfileModelsView): void; compaction?: ModelCompaction }) {
  const api = useTargetApi();
  const { t, locale } = useI18n();
  const modelName = useModelName();
  const features = useTargetFeatures();
  const [editing, setEditing] = useState<{ model: CatalogModel | null; variant?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editable = view.catalogSupported;
  const variants = canCreateModelVariant(features, view);
  // profile-model-display-names: every entry (also read-only catalogs) can carry this profile's name.
  const names = features.has(MODEL_NAMES_FEATURE);
  // The view is fresher than the profile list right after an edit, so rows use its entry name.
  const rowName = (m: CatalogModel) => modelLabel(m.id, m.displayName, m.entryDisplayName);
  const discovery = view.discoverySupported ?? editable;
  const cols = modelListColumns(view);
  // Claude (docs/design/024-model-list.md): one row per real model; an alias row stands for its newest
  // model (and that model's `[1m]` alias), shown under its name with the ids it covers.
  const folded = cols.claude ? foldClaudeModels(view.models, (m) => m.id, (m) => m.displayName, view.selectedModel ?? null) : null;
  const rows = folded ? folded.map((r) => r.item) : view.models;
  const foldOf = (m: CatalogModel) => folded?.find((r) => r.item === m);
  const shownName = (m: CatalogModel) => {
    const row = foldOf(m);
    return row && !m.entryDisplayName ? presentClaudeRow(row, t).name : rowName(m);
  };
  const windowOf = (m: CatalogModel) => m.effective.contextWindow ?? foldOf(m)?.folded.map((id) => view.models.find((x) => x.id === id)?.effective.contextWindow).find((w) => w != null) ?? null;
  const perModel = !!compaction && cols.claude;
  const effortName = (id: string) => { const key = `composer.effort.${id}` as MessageKey; return t(key) === key ? id : t(key); };
  const sourceName = (source: string) => t(`agent-config.profile.source.${source}` as MessageKey);
  const GRID = GRIDS[Number(cols.context) + Number(cols.compact) + Number(perModel)]!;
  const [open, setOpen] = useState<string | null>(null);
  const [resets, setResets] = useState(0);
  const [limitError, setLimitError] = useState(false);
  const table = compaction ? (compaction.draft !== undefined ? compaction.draft : compaction.table) : null;
  const idsOf = (m: CatalogModel) => [m.id, ...(foldOf(m)?.folded ?? [])];
  const zh = locale.startsWith("zh");
  const amount = (n: number) => (zh ? `${+(n / 10_000).toFixed(1)} 万` : `${Math.round(n / 1000)}K`);
  const setModel = (m: CatalogModel, v: ClaudeCompaction | null | undefined) => {
    if (!compaction) return;
    if (v === undefined) return; // an incomplete custom entry keeps the last valid value
    const next = withModelCompaction(table, idsOf(m), v);
    // cutex refuses more than 32 entries: say so here and keep the draft as it was.
    const tooMany = !!next && Object.keys(next).length > MAX_COMPACTION_MODELS;
    setLimitError(tooMany);
    if (tooMany) return;
    compaction.change(JSON.stringify(next) === JSON.stringify(compaction.table) ? undefined : next);
  };
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
  // One hint line; the other notes go in its tooltip (settings audit 2026-10-15 #49).
  const notes = [
    editable ? t("agent-config.profile.entryHint") : names && t("agent-config.profile.entryNamesListHint"),
    cols.claude && cols.context && t("agent-config.profile.claudeContextHint"),
    cols.claude && t(features.has(CLAUDE_COMPACTION_FEATURE) ? "agent-config.profile.claudeCompactSetHint" : "agent-config.profile.claudeCompactHint"),
    variants && t("agent-config.profile.variantsHint"),
    variants && t("agent-config.profile.variantSwitchHint"),
    view.followsUpstream && editable && t("agent-config.profile.followsUpstreamHint"),
  ].filter((n): n is string => !!n);
  return (
    <>
    <SettingRow agents={editable || perModel ? "next" : "none"} source="host" readOnly={!editable} label={t("settings.profileIa.catalogOverrides" as MessageKey)} hint={<span title={sourceTitle}>
          {source}
          {/* Read-only list, but per-entry display names stay editable (profile-model-display-names). */}
          {!editable && ` · ${t(names ? "agent-config.profile.modelsNamesOnly" : "agent-config.profile.modelsReadOnly")}`}
        </span>}>
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
      <p className="mb-2 text-xs text-subtle">{t((perModel ? "settings.profileIa.catalogModelCompactionHint" : "settings.profileIa.catalogImmediateHint") as MessageKey)}</p>
      {notes.length > 0 && (
        <p className="mb-2 flex items-center gap-1 text-xs text-subtle" title={notes.join("\n")}>
          <span className="min-w-0 truncate">{notes[0]}</span>
          {notes.length > 1 && <Info size={12} className="shrink-0" aria-hidden />}
        </p>
      )}
      {!cols.claude && <p className="mb-2 text-xs text-subtle">{t("settings.profileParity.catalogLimitsHint" as MessageKey)}</p>}
      <UpstreamNotice view={view} />
      {error && <p className="py-1 text-xs text-danger">{error}</p>}
      {view.models.length === 0 ? (
        <p className="py-1 text-xs text-subtle">{editable ? t("agent-config.profile.noModels") : (view.modelsUnavailableReason ?? t("agent-config.profile.noModelsNative"))}</p>
      ) : (
        <div className="border-t border-border">
          <div className={`${GRID} border-b border-border py-1.5 text-caption/[inherit] text-subtle`}>
            <span>{t("agent-config.defaults.profileModel")}</span>
            {cols.context && <span className="text-right">{t("agent-config.profile.colContext")}</span>}
            {cols.compact && <span className="text-right">{t("agent-config.profile.colCompact")}</span>}
            {perModel && <span className="text-right">{t("agent-config.profile.colModelCompaction")}</span>}
            <span />
          </div>
          {rows.map((m) => {
            const own = idsOf(m).map((id) => table?.[id]).find((c) => !!c) ?? null;
            const shown = own ?? compaction?.profile ?? null;
            const ctx = windowOf(m);
            return (
            <SettingsGroup key={m.id} agents={editable || perModel ? "next" : "none"} source="host" readOnly={!editable && !perModel && !names && !variants}>{decoration => <div {...decoration.attributes} className="border-b border-border last:border-b-0">
            <div className={`group ${GRID} py-1.5`}>
              <span className="flex min-w-0 flex-col items-start gap-1">
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="min-w-0 truncate font-mono text-sm" title={[m.id, ...(foldOf(m)?.folded ?? [])].join(" · ")}>
                  {shownName(m)}
                  {foldOf(m)?.tag === "latest" && <span className="ml-1.5 font-sans text-caption/[inherit] text-accent" title={presentClaudeRow(foldOf(m)!, t).description}>{t("claudeModels.latestTag")}</span>}
                  {m.entryDisplayName && <span className="ml-1.5 text-caption/[inherit] text-subtle">{m.id}</span>}
                </span>
                {decoration.marker}
                {/* Every Claude model takes images: the tag says nothing there. */}
                {!cols.claude && m.inputModalities.includes("image") && <Tag>{t("agent-config.profile.vision")}</Tag>}
                {m.id === view.selectedModel && <span className="shrink-0 text-caption/[inherit] text-accent">{t("agent-config.profile.selected")}</span>}
                </span>
                {!cols.claude && <span className="text-caption/[inherit] text-subtle" data-model-effort={m.id}>
                  {m.supportedReasoningEfforts.length
                    ? t("settings.profileParity.modelEfforts" as MessageKey, { levels: m.supportedReasoningEfforts.map(effortName).join(" / ") })
                    : t((m.effortSupportKnown === true ? "agent-config.profile.effortNone" : "settings.profileParity.modelEffortsUnknown") as MessageKey)}
                  <span className="block">{t("settings.profileParity.modelEffortDefault" as MessageKey, { effort: m.defaultReasoningEffort ? effortName(m.defaultReasoningEffort) : t("settings.profileParity.runtimeEffortDefault" as MessageKey) })}</span>
                </span>}
              </span>
              {cols.context && (cols.claude && windowOf(m) == null ? (
                // A Claude alias / default resolves per account: no fixed window to show.
                <span className="text-right text-xs text-subtle" title={t("agent-config.profile.claudeWindowVariesTitle")}>{t("agent-config.profile.claudeWindowVaries")}</span>
              ) : (
                <span className="text-right text-xs text-muted tabular-nums" title={t(`agent-config.profile.source.${m.effective.contextWindowSource}` as MessageKey)}>{formatWindow(cols.claude ? windowOf(m) : m.effective.contextWindow)}{!cols.claude && <span className="block text-caption/[inherit] text-subtle">{sourceName(m.effective.contextWindowSource)}</span>}</span>
              ))}
              {cols.compact && <span className="text-right text-xs text-muted tabular-nums" title={t(`agent-config.profile.source.${m.effective.autoCompactTokenLimitSource}` as MessageKey)}>{formatWindow(m.effective.autoCompactTokenLimit)}{!cols.claude && <span className="block text-caption/[inherit] text-subtle">{sourceName(m.effective.autoCompactTokenLimitSource)}</span>}</span>}
              {perModel && (
                <button
                  className={`rounded px-1.5 text-right text-xs tabular-nums hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none ${own ? "text-accent" : "text-subtle"}`}
                  aria-expanded={open === m.id}
                  title={own ? t("agent-config.profile.modelCompaction.own") : shown ? t("agent-config.profile.modelCompaction.followsProfile") : t("agent-config.profile.modelCompaction.claudeDecides")}
                  onClick={() => setOpen(open === m.id ? null : m.id)}
                >
                  <span className="block">{shown ? `≈${amount(compactAt(shown, ctx))}` : t("agent-config.profile.modelCompaction.defaultShort")}</span>
                  <span className="block text-caption text-subtle">{t((own ? "settings.profileIa.modelOverride" : "settings.profileIa.inheritsProfile") as MessageKey)}</span>
                </button>
              )}
              <span className="flex items-center justify-end gap-1 opacity-60 group-focus-within:opacity-100 group-hover:opacity-100">
                {variants && <IconButton label={t("agent-config.profile.addVariantFor", { model: rowName(m) })} disabled={busy} onClick={() => setEditing({ model: m, variant: true })}><CopyPlus size={14} /></IconButton>}
                {(editable || names) && <button disabled={busy} onClick={() => setEditing({ model: m })} className="rounded px-1.5 text-xs hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none">{t("agent-config.profile.edit")}</button>}
                {editable && m.id !== view.selectedModel && (
                  <ArmedRemove title={t("agent-config.profile.removeModel", { model: rowName(m) })} disabled={busy} onRemove={() => void run(() => api.deleteModel(profile, m.id))} />
                )}
              </span>
            </div>
            {perModel && open === m.id && (
              <div className="mb-2 rounded-md bg-surface-2/50 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted">{t("agent-config.profile.modelCompaction.for", { model: shownName(m) })}</span>
                  <CompactionPicker
                    key={`${m.id}:${resets}`}
                    value={own}
                    disabled={compaction.disabled}
                    unsetLabel={t("agent-config.profile.modelCompaction.followProfile")}
                    onChange={(v) => setModel(m, v)}
                  />
                  {own && (
                    <Button
                      disabled={compaction.disabled}
                      onClick={() => {
                        setModel(m, null);
                        setResets(resets + 1);
                      }}
                    >
                      {t("agent-config.profile.modelCompaction.reset")}
                    </Button>
                  )}
                </div>
                <p className="mt-1 text-xs text-subtle">
                  {shown
                    ? t("settings.profileTiming.modelCompaction", { at: amount(compactAt(shown, ctx)), source: own ? t("agent-config.profile.modelCompaction.own") : t("agent-config.profile.modelCompaction.followsProfile") })
                    : t("agent-config.profile.modelCompaction.hintDefault")}
                </p>
              </div>
            )}
            </div>}</SettingsGroup>
            );
          })}
        </div>
      )}
      {limitError && perModel && <p className="py-1 text-xs text-danger">{t("agent-config.profile.modelCompaction.limit", { n: MAX_COMPACTION_MODELS })}</p>}
      {compaction?.error && perModel && <p className="py-1 text-xs text-danger">{t("agent-config.profile.claudeCompaction.error", { error: compaction.error })}</p>}
      <UnavailableModels view={view} busy={busy} onRemove={(id) => void run(() => api.deleteModel(profile, id))} />
      {editing && (
        <ProfileModelDialog
          profile={profile}
          view={view}
          model={editing.model}
          variant={editing.variant}
          catalog={editable}
          names={names}
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

