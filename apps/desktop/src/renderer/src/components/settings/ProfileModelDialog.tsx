import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { CatalogModel, CatalogModelPatch, ProfileDetail, ProfileModelsView, ProfilePatch } from "../../../../shared/ipc";
import { useI18n, type MessageKey } from "../../i18n";
import { entryNamePatch, modelDraft, modelNameTaken, modelVariantPatch, isClaudeModelsView, MODEL_EFFORTS } from "../../lib/profileModels";
import { updateProfileModelNames, useModelName } from "../../lib/modelDisplay";
import { updateCachedProfile } from "../../lib/profileSnapshot";
import { Button, FormFields, IconButton, SettingRow, Select, TextInput, Toggle } from "./Form";
import { WindowInput } from "./ProfileContextInputs";
import { ContextCompactionRows, UnsupportedContextRows } from "./ContextCompactionRows";
import { claudeCompactsAt, claudePercentBlock, codexPercentBlock, contextBlocked, contextReasonMessage, formatTokens, fromClaude, fromCodexRow, MODEL_CONTEXT_V1_FEATURE, toClaude, toCodexRow, claudeModelValue, type UnifiedCompact, type UnifiedContext } from "../../lib/contextCompaction";
import { changedContext, compactField, defaultNumbers, layeredView, windowField, withoutContext } from "../../lib/contextLayers";
import { formatWindow } from "../../lib/contextPresets";
import { MAX_COMPACTION_MODELS, sameCompaction, withModelCompaction, type ClaudeCompaction, type CompactionModels } from "../../../../shared/claudeCompaction";
import { useTargetApi, useTargetFeatures, useTargetHostId } from "../../lib/targetHost";
import { useOverlayRoot } from "../../lib/ownerContext";

/** A Claude model's own compaction (cutex claude-compaction-models): its table entry for `ids` (the row and the aliases
 *  folded into it); `profile` is what it follows when unset; `window` the model's context. */
export interface ClaudeDialogCompaction {
  table: CompactionModels | null;
  profile: ClaudeCompaction | null;
  disabled?: boolean;
  ids: readonly string[];
  window: number | null;
  onDetail(detail: ProfileDetail): void;
}

/**
 * Add / edit one model entry of a profile. `catalog`: the entry's catalog row is editable (context,
 * compaction, efforts…); `names`: cutex keeps per-entry display names (profile-model-display-names);
 * `claude`: the model's own 上下文窗口 / 自动压缩 (Claude). Saving writes everything at once.
 */
export function ProfileModelDialog({ model, profile, view, variant = false, catalog = true, names = false, claude, onClose, onSaved }: { model: CatalogModel | null; profile: string; view: ProfileModelsView; variant?: boolean; catalog?: boolean; names?: boolean; claude?: ClaudeDialogCompaction; onClose(): void; onSaved(v: ProfileModelsView): void }) {
  const overlayRoot = useOverlayRoot();
  const api = useTargetApi();
  const targetHost = useTargetHostId();
  const { t, locale } = useI18n();
  const modelName = useModelName();
  const v1Host = useTargetFeatures().has(MODEL_CONTEXT_V1_FEATURE);
  const reason = (code: string) => { const r = contextReasonMessage(code); return t(r.key as MessageKey, r.vars); };
  // profile-model-context-v1 on a migrated Profile: the row's own values win over the Profile's and it has its own percent.
  // P13 B: the host resolves layers; context edits migrate on demand (also the first model of an API-key Profile).
  const layeredHost = layeredView(view);
  const rowBlock = codexPercentBlock(v1Host, view, true, { migratesOnEdit: layeredHost });
  const v1Row = rowBlock === null;
  const claudeBlock = claudePercentBlock(v1Host, view);
  // Same rule as the Profile page: an unsupported reason other than the known old-adapter / old-runtime ones disables the rows.
  const blocked = contextBlocked(view);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [id, setId] = useState(variant ? "" : (model?.id ?? ""));
  // P13 B: the controls show this row's own setting (an upgrade-preserved value wins over the owner's), never the
  // flat catalog numbers; only the fields the owner changes are sent (lib/contextLayers changedContext).
  const layers = layeredHost && !!model && !variant && !!model.contextSettings;
  const winF = layers ? windowField(model!) : null;
  const cmpF = layers ? compactField(model!) : null;
  const [initialCtx] = useState<CatalogModelPatch>(() => !layeredHost ? {} : {
    contextWindow: winF?.value ?? null,
    autoCompactPercent: cmpF?.value && "percent" in cmpF.value ? cmpF.value.percent : null,
    autoCompactTokenLimit: cmpF?.value && "tokens" in cmpF.value ? cmpF.value.tokens : null,
  });
  const [initialDraft] = useState<CatalogModelPatch>(() => ({ ...modelDraft(model), ...(!model && !isClaudeModelsView(view) ? { supportedReasoningEfforts: [], defaultReasoningEffort: null } : {}), ...(variant ? { displayName: "" } : {}), ...(v1Row && model ? { autoCompactPercent: model.autoCompactPercent ?? null } : {}), ...initialCtx }));
  const [draft, setDraft] = useState<CatalogModelPatch>(initialDraft);
  const [entryName, setEntryName] = useState(variant ? "" : (model?.entryDisplayName ?? ""));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [valid, setValid] = useState({ max: true, context: true, claude: true });
  const ownClaude = claude ? (claude.ids.map((x) => claude.table?.[x]).find((c) => !!c) ?? null) : null;
  /** The Claude entry draft: undefined = unchanged, null = follow the Profile. */
  const [claudeDraft, setClaudeDraft] = useState<ClaudeCompaction | null | undefined>(undefined);
  const creating = variant || !model;
  const taken = creating && !!id.trim() && modelNameTaken(id, view.models);
  const requestModel = variant ? (model?.requestModel || model?.id) : model?.requestModel;
  const requestRow = view.models.find((m) => m.id === requestModel);
  const overridden = view.profileOverrides.modelContextWindow !== null || view.profileOverrides.modelAutoCompactTokenLimit !== null;
  useEffect(() => {
    const el = dialog.current!;
    el.showModal();
    el.querySelector<HTMLInputElement>("input:not([disabled])")?.focus();
    return () => el.close();
  }, []);
  const efforts = draft.supportedReasoningEfforts ?? [];
  const codex = !isClaudeModelsView(view);
  const effortName = (id: string) => { const key = `composer.effort.${id}` as MessageKey; return t(key) === key ? id : t(key); };
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const entry = id.trim();
      let next: ProfileModelsView | null = null;
      if (catalog) {
        const full = variant && model ? modelVariantPatch(model, { ...draft, displayName: entry }) : draft;
        const patch = layeredHost ? { ...withoutContext(full), ...changedContext(initialCtx, draft) } : full;
        next = await api.patchModel(profile, entry, patch);
      }
      const names_ = names ? entryNamePatch(entry, entryName, creating ? null : (model?.entryDisplayName ?? null)) : null;
      const body: ProfilePatch = {};
      if (names_) body.modelDisplayNames = names_;
      if (claude && claudeDraft !== undefined) {
        const table = withModelCompaction(claude.table, claude.ids, claudeDraft);
        // cutex refuses more than 32 entries.
        if (table && Object.keys(table).length > MAX_COMPACTION_MODELS) throw new Error(t("agent-config.profile.modelCompaction.limit", { n: MAX_COMPACTION_MODELS }));
        body.claudeCompactionModels = table;
      }
      if (Object.keys(body).length) {
        const detail = await api.patchProfile(profile, body);
        if (names_) updateProfileModelNames(detail);
        updateCachedProfile(profile, { detail }, targetHost);
        claude?.onDetail(detail);
        next = await api.profileModels(profile);
      }
      if (next) onSaved(next);
      else onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const dirty = JSON.stringify(draft) !== JSON.stringify(initialDraft) || entryName !== (variant ? "" : (model?.entryDisplayName ?? "")) || claudeDraft !== undefined;
  /** 使用此模型原设置: its own request (cutex refuses it together with an edit of the same field). */
  const restore = async (field: "window" | "compact") => {
    setBusy(true);
    setError(null);
    try {
      onSaved(await api.patchModel(profile, id, field === "window" ? { restorePreservedContextWindow: true } : { restorePreservedAutoCompaction: true }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const mc = (k: string, v?: Record<string, string | number>) => t(`settings.modelContext.${k}` as MessageKey, v);
  const compactText = (c: UnifiedCompact) => !c ? mc("default") : "percent" in c ? mc("percentOfWindow", { p: c.percent }) : formatWindow(c.tokens);
  /** An upgrade-preserved value in force on this field (and not being edited): say so, with the one-click restore. */
  const preservedLine = (field: "window" | "compact") => {
    const f = field === "window" ? winF : cmpF;
    if (!f?.preserved) return null;
    const untouched = field === "window"
      ? (draft.contextWindow ?? null) === (initialCtx.contextWindow ?? null)
      : (draft.autoCompactPercent ?? null) === (initialCtx.autoCompactPercent ?? null) && (draft.autoCompactTokenLimit ?? null) === (initialCtx.autoCompactTokenLimit ?? null);
    if (!untouched) return null;
    const show = (v: number | null | UnifiedCompact) => field === "window" ? (v == null ? mc("default") : formatWindow(v as number)) : compactText(v as UnifiedCompact);
    return (
      <span className="block text-warn" data-preserved={field}>
        {mc("preservedNote", { value: show(f.value), own: show(f.owner) })}{" "}
        <button type="button" disabled={busy || dirty} title={dirty ? mc("restoreDirty") : undefined} onClick={() => void restore(field)} className="text-accent hover:underline disabled:opacity-50" data-restore-preserved={field}>{mc("restorePreserved")}</button>
      </span>
    );
  };
  // P13 B: 默认 labels only with a number the backend resolved (defaultValues.model: as if this row's own setting were cleared).
  const defaults = layeredHost ? defaultNumbers(model && !variant ? model.defaultValues?.model : null) : null;
  // Director 2026-11-18 (review of 552e908b7): a backend default holds only for the saved inputs it was resolved from.
  // While the draft changes one of them it reads plain 默认 (never a number computed here); the number returns after
  // save / refresh. The window default depends on the cap; the compaction default on the resolved window (row window, cap).
  const maxChanged = (draft.maxContextWindow ?? null) !== (initialDraft.maxContextWindow ?? null);
  const windowChanged = (draft.contextWindow ?? null) !== (initialCtx.contextWindow ?? null);
  const defaultLabels = defaults ? {
    window: defaults.window !== null && !maxChanged ? mc("defaultWith", { value: formatWindow(defaults.window) }) : mc("default"),
    compact: defaults.compactAt !== null && !maxChanged && !windowChanged ? mc("defaultAbout", { value: formatTokens(defaults.compactAt, locale) }) : mc("default"),
  } : undefined;
  const reset = async () => {
    setBusy(true);
    setError(null);
    try {
      onSaved(await api.resetModel(profile, id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return createPortal(
    <FormFields><dialog ref={dialog} aria-labelledby={titleId} onCancel={(e) => { e.preventDefault(); if (!busy) onClose(); }} className="fixed inset-0 m-auto max-h-[85vh] w-[580px] max-w-[95vw] overflow-y-auto rounded-2xl border border-border bg-surface p-5 text-foreground shadow-2xl backdrop:bg-black/40">
        <div className="mb-3 flex items-center">
          <h3 id={titleId} className="font-semibold">{variant ? t("agent-config.profile.addVariant") : model ? t("agent-config.profile.editModel") : t("agent-config.profile.addModel")}</h3>
          <span className="ml-auto">
            <IconButton label={t("settings.cancel")} disabled={busy} onClick={onClose}>
              <X size={15} />
            </IconButton>
          </span>
        </div>
        {codex && <p className="mb-3 text-xs text-subtle">{t("settings.profileParity.modelEntryHint" as MessageKey)}</p>}
        <fieldset disabled={busy}>
        {requestModel && <SettingRow source="host" agents="none" label={t("agent-config.profile.baseModel")} info={t("agent-config.profile.variantHint")}>
          <span className="text-sm" title={requestModel}>{modelName(requestModel, requestRow?.displayName, profile)}</span>
        </SettingRow>}
        {(creating || !requestModel) && <SettingRow source="host" agents={catalog && creating ? "next" : "none"} label={t(variant ? "agent-config.profile.variantName" : "agent-config.profile.modelId")}>
          <TextInput mono={!variant} value={id} disabled={!creating} maxLength={200} onChange={setId} placeholder={variant ? "Astra [400K]" : "glm-5"} autoFocus={creating} />
        </SettingRow>}
        {names ? (
          <SettingRow source="host" agents="none" label={t("agent-config.profile.displayName")} hint={t("agent-config.profile.entryNameHint")}>
            <TextInput value={entryName} maxLength={80} onChange={setEntryName} placeholder={model?.displayName || model?.id || id || undefined} />
          </SettingRow>
        ) : !variant && catalog && <SettingRow source="host" agents="none" label={t("agent-config.profile.displayName")}>
          <TextInput value={draft.displayName ?? ""} onChange={(v) => setDraft({ ...draft, displayName: v || null })} />
        </SettingRow>}
        {blocked && (claude || catalog) && <UnsupportedContextRows reason={reason(blocked)} />}
        {claude && !blocked && (() => {
          const current = claudeDraft !== undefined ? claudeDraft : ownClaude;
          const at = claudeCompactsAt(current ?? claude.profile, claude.window);
          // A model's own record always shows its percent: a fixed window at 100 % ({500K, 100}, what a window-only edit
          // stores) overrides the Profile's percent, so it must not read 跟随 Profile (re-review of 070c5dd09, P2).
          const value = claudeModelValue(current);
          // A Claude model record must carry a percent (cutex claude-compaction-models): 跟随 Profile while this model
          // has its own record (window or percent) removes the whole record, its own window included — said in place
          // below. Without a record, a window pick creates one at 100 %.
          const toModel = (v: UnifiedContext) => (v.compact === null && current ? null : toClaude(v, claudeBlock === null));
          const windowCleared = claudeDraft === null && fromClaude(ownClaude).window !== null;
          return (
            <ContextCompactionRows
              runtime="claude"
              onValidityChange={(ok) => setValid((s) => ({ ...s, claude: ok }))}
              inherit
              percentBlock={claudeBlock === null ? null : reason(claudeBlock)}
              disabled={claude.disabled}
              value={value}
              check={(v) => { const c = toModel(v); return c && "unsupported" in c ? c.unsupported : null; }}
              onChange={(v) => { const c = toModel(v); if (!(c && "unsupported" in c)) setClaudeDraft(sameCompaction(c, ownClaude) ? undefined : c); }}
              windowHint={t("settings.modelContext.claudeWindowOnly" as MessageKey)}
              compactHint={<>
                {at ? t(`settings.modelContext.${current ? "modelCompactOwn" : claude.profile ? "modelCompactProfile" : "modelCompactDefault"}` as MessageKey, { at: formatTokens(at, locale) }) : null}
                {windowCleared && <span className="block text-warn" data-claude-window-cleared="">{mc("claudeWindowCleared")}</span>}
              </>}
            />
          );
        })()}
        {catalog && <>
        {!blocked && <ContextCompactionRows
          runtime="codex"
          onValidityChange={(ok) => setValid((s) => ({ ...s, context: ok }))}
          inherit={v1Row}
          // Legacy: a percentage of an unset row window is a share of the model's maximum.
          percentBlock={v1Row || draft.maxContextWindow ? null : reason(rowBlock!)}
          value={fromCodexRow(draft.contextWindow, draft.maxContextWindow, draft.autoCompactTokenLimit, draft.autoCompactPercent, v1Row)}
          check={(v) => { const w = toCodexRow(v, draft.maxContextWindow, v1Row); return "unsupported" in w ? w.unsupported : null; }}
          onChange={(v) => { const w = toCodexRow(v, draft.maxContextWindow, v1Row); if (!("unsupported" in w)) setDraft({ ...draft, ...w }); }}
          defaultLabels={defaultLabels}
          windowHint={<>{v1Row ? t("settings.modelContext.modelWins" as MessageKey) : t("agent-config.profile.contextWindowHint")}{preservedLine("window")}</>}
          compactHint={preservedLine("compact")}
        />}
        <SettingRow source="host" agents="next" label={t("agent-config.profile.maxContextWindow")} hint={t("agent-config.profile.maxContextWindowHint")}>
          <WindowInput value={draft.maxContextWindow ?? null} onChange={(v) => setDraft({ ...draft, maxContextWindow: v })} onValidityChange={(v) => setValid((s) => ({ ...s, max: v }))} allowInherit inheritLabel={t("agent-config.profile.unset")} />
        </SettingRow>
        <SettingRow source="host" agents="next" label={t("agent-config.profile.vision")}>
          <Toggle
            checked={(draft.inputModalities ?? []).includes("image")}
            onChange={(v) => setDraft({ ...draft, inputModalities: v ? ["text", "image"] : ["text"] })}
          />
        </SettingRow>
        <SettingRow source="host" agents="next" label={t("agent-config.profile.efforts")} hint={t((codex ? "settings.profileParity.capabilityDeclaration" : "agent-config.profile.effortsHint") as MessageKey)}>
          <span className="flex max-w-72 flex-wrap justify-end gap-1">
            {MODEL_EFFORTS.map((e) => {
              const on = efforts.includes(e);
              return (
                <button
                  key={e}
                  title={e}
                  aria-pressed={on}
                  onClick={() => {
                    const next = on ? efforts.filter((x) => x !== e) : MODEL_EFFORTS.filter((x) => x === e || efforts.includes(x));
                    setDraft({ ...draft, supportedReasoningEfforts: next, defaultReasoningEffort: next.includes(draft.defaultReasoningEffort ?? "") ? draft.defaultReasoningEffort : (next[0] ?? null) });
                  }}
                  className={`rounded-md border px-2 py-0.5 text-xs ${on ? "border-accent text-accent" : "border-border text-subtle"}`}
                >
                  {codex ? effortName(e) : e}
                </button>
              );
            })}
          </span>
        </SettingRow>
        <SettingRow source="host" agents="next" label={t("agent-config.profile.defaultEffort")} hint={codex ? t("settings.profileParity.entryEffortDefaultHint" as MessageKey) : undefined}>
          <Select value={draft.defaultReasoningEffort ?? ""} options={[...(codex ? [{ value: "", label: t("settings.profileParity.runtimeEffortDefault" as MessageKey) }] : []), ...efforts.map((e) => ({ value: e, label: codex ? effortName(e) : e }))]} onChange={(v) => setDraft({ ...draft, defaultReasoningEffort: v || null })} />
        </SettingRow>
        </>}

        </fieldset>
        {!catalog && !claude && <p className="mt-3 text-xs text-subtle">{t("agent-config.profile.entryNameOnly")}</p>}
        {/* Migrated (and B) rows: the model's own value wins, so the Profile does not override it. */}
        {catalog && overridden && !v1Row && <p className="mt-2 text-xs text-warn">{t("agent-config.profile.variantOverridden")}</p>}
        {taken && <p className="mt-2 text-xs text-danger">{t("agent-config.profile.modelNameTaken")}</p>}
        {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
        <div className="mt-4 flex items-center gap-2">
          {model && !variant && catalog && <Button disabled={busy} onClick={() => void reset()}>{t("agent-config.profile.smartReset")}</Button>}
          <div className="ml-auto flex gap-2">
            <Button disabled={busy} onClick={onClose}>{t("settings.cancel")}</Button>
            <Button primary disabled={busy || !id.trim() || taken || !Object.values(valid).every(Boolean)} onClick={() => void save()}>{t("settings.save")}</Button>
          </div>
        </div>
    </dialog></FormFields>, overlayRoot,
  );
}

