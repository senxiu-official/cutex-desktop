// Settings → Profiles → 模型: context-window / auto-compact pickers and the profile's model list —
// an editable catalog (including official models on a capable runtime), or native/Claude choices.
import { useState } from "react";
import { CopyPlus, Info, RotateCw } from "lucide-react";
import type { CatalogModel, ProfileModelsView } from "../../../../shared/ipc";
import { useI18n, type MessageKey } from "../../i18n";
import { formatWindow } from "../../lib/contextPresets";
import { localDateTime, upstreamModelsNotice } from "../../lib/profileKind";
import { modelLabel, useModelName } from "../../lib/modelDisplay";
import { canCreateModelVariant, MODEL_NAMES_FEATURE, modelsSourceText, upstreamSource } from "../../lib/profileModels";
import { AddButton, ArmedRemove, Button, IconButton } from "./Form";
import { ProfileModelDialog } from "./ProfileModelDialog";
import { useTargetApi, useTargetFeatures } from "../../lib/targetHost";

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
              <span className="min-w-0 truncate text-[11px] text-warn-text">
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

const GRID = "grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_7.5rem] items-center gap-2";

/** Per-model edits save immediately; existing runtimes keep their launch snapshot. */
export function ModelList({ profile, view, setView }: { profile: string; view: ProfileModelsView; setView(v: ProfileModelsView): void }) {
  const api = useTargetApi();
  const { t } = useI18n();
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
    (names || editable) && t("agent-config.profile.entryHint"),
    variants && t("agent-config.profile.variantsHint"),
    variants && t("agent-config.profile.variantSwitchHint"),
    view.followsUpstream && editable && t("agent-config.profile.followsUpstreamHint"),
  ].filter((n): n is string => !!n);
  return (
    <div className="border-b border-border py-2.5 last:border-b-0">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="shrink-0 text-sm">{t("agent-config.profile.models")}</span>
        <span className="min-w-0 truncate text-xs text-subtle" title={sourceTitle}>
          {source}
          {!editable && ` · ${t("agent-config.profile.modelsReadOnly")}`}
        </span>
        {editable && (
          <span className="ml-auto flex shrink-0 gap-2">
            {discovery && <Button disabled={busy} onClick={() => void run(() => api.discoverModels(profile))}>
              <RotateCw size={12} className="mr-1 -ml-0.5 inline align-[-2px]" />
              {t("agent-config.profile.discover")}
            </Button>}
            {discovery && <AddButton onClick={() => setEditing({ model: null })}>{t("agent-config.profile.addModel")}</AddButton>}
          </span>
        )}
      </div>
      {notes.length > 0 && (
        <p className="mb-2 flex items-center gap-1 text-xs text-subtle" title={notes.join("\n")}>
          <span className="min-w-0 truncate">{notes[0]}</span>
          {notes.length > 1 && <Info size={12} className="shrink-0" aria-hidden />}
        </p>
      )}
      <UpstreamNotice view={view} />
      {error && <p className="py-1 text-xs text-danger">{error}</p>}
      {view.models.length === 0 ? (
        <p className="py-1 text-xs text-subtle">{editable ? t("agent-config.profile.noModels") : (view.modelsUnavailableReason ?? t("agent-config.profile.noModelsNative"))}</p>
      ) : (
        <div className="rounded-lg border border-border px-3">
          <div className={`${GRID} border-b border-border py-1.5 text-[11px] text-subtle`}>
            <span>{t("agent-config.defaults.profileModel")}</span>
            <span className="text-right">{t("agent-config.profile.colContext")}</span>
            <span className="text-right">{t("agent-config.profile.colCompact")}</span>
            <span />
          </div>
          {view.models.map((m) => (
            <div key={m.id} className={`group ${GRID} border-b border-border py-1.5 last:border-b-0`}>
              <span className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 truncate font-mono text-sm" title={m.id}>
                  {rowName(m)}
                  {m.entryDisplayName && <span className="ml-1.5 text-[11px] text-subtle">{m.id}</span>}
                </span>
                {m.inputModalities.includes("image") && <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted">{t("agent-config.profile.vision")}</span>}
                {m.id === view.selectedModel && <span className="shrink-0 text-[11px] text-accent">{t("agent-config.profile.selected")}</span>}
              </span>
              <span className="text-right text-xs text-muted tabular-nums" title={t(`agent-config.profile.source.${m.effective.contextWindowSource}` as MessageKey)}>{formatWindow(m.effective.contextWindow)}</span>
              <span className="text-right text-xs text-muted tabular-nums" title={t(`agent-config.profile.source.${m.effective.autoCompactTokenLimitSource}` as MessageKey)}>{formatWindow(m.effective.autoCompactTokenLimit)}</span>
              <span className="flex items-center justify-end gap-1 opacity-60 group-focus-within:opacity-100 group-hover:opacity-100">
                {variants && <IconButton label={t("agent-config.profile.addVariantFor", { model: rowName(m) })} disabled={busy} onClick={() => setEditing({ model: m, variant: true })}><CopyPlus size={14} /></IconButton>}
                {(editable || names) && <button disabled={busy} onClick={() => setEditing({ model: m })} className="rounded px-1.5 text-xs hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none">{t("agent-config.profile.edit")}</button>}
                {editable && m.id !== view.selectedModel && (
                  <ArmedRemove title={t("agent-config.profile.removeModel", { model: rowName(m) })} disabled={busy} onRemove={() => void run(() => api.deleteModel(profile, m.id))} />
                )}
              </span>
            </div>
          ))}
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
          onClose={() => setEditing(null)}
          onSaved={(v) => {
            setView(v);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

