import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { CatalogModel, CatalogModelPatch, ProfileModelsView } from "../../../../shared/ipc";
import { useI18n } from "../../i18n";
import { entryNamePatch, modelDraft, modelNameTaken, modelVariantPatch, MODEL_EFFORTS } from "../../lib/profileModels";
import { updateProfileModelNames, useModelName } from "../../lib/modelDisplay";
import { updateCachedProfile } from "../../lib/profileSnapshot";
import { Button, IconButton, SettingRow, Select, TextInput, Toggle } from "./Form";
import { CompactInput, WindowInput } from "./ProfileContextInputs";
import { useTargetApi, useTargetHostId } from "../../lib/targetHost";

/**
 * Add / edit one model entry of a profile. `catalog`: the entry's catalog row is editable (context,
 * compaction, efforts…); `names`: cutex keeps per-entry display names (profile-model-display-names).
 * With only `names`, the dialog edits just the entry's display name.
 */
export function ProfileModelDialog({ model, profile, view, variant = false, catalog = true, names = false, onClose, onSaved }: { model: CatalogModel | null; profile: string; view: ProfileModelsView; variant?: boolean; catalog?: boolean; names?: boolean; onClose(): void; onSaved(v: ProfileModelsView): void }) {
  const api = useTargetApi();
  const targetHost = useTargetHostId();
  const { t } = useI18n();
  const modelName = useModelName();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [id, setId] = useState(variant ? "" : (model?.id ?? ""));
  const [draft, setDraft] = useState<CatalogModelPatch>(() => ({ ...modelDraft(model), ...(variant ? { displayName: "" } : {}) }));
  const [entryName, setEntryName] = useState(variant ? "" : (model?.entryDisplayName ?? ""));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [valid, setValid] = useState({ context: true, max: true, compact: true });
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
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const entry = id.trim();
      let next: ProfileModelsView | null = null;
      if (catalog) {
        const patch = variant && model ? modelVariantPatch(model, { ...draft, displayName: entry }) : draft;
        next = await api.patchModel(profile, entry, patch);
      }
      const names_ = names ? entryNamePatch(entry, entryName, creating ? null : (model?.entryDisplayName ?? null)) : null;
      if (names_) {
        const detail = await api.patchProfile(profile, { modelDisplayNames: names_ });
        updateProfileModelNames(detail);
        updateCachedProfile(profile, { detail }, targetHost);
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
    <dialog ref={dialog} aria-labelledby={titleId} onCancel={(e) => { e.preventDefault(); if (!busy) onClose(); }} className="fixed inset-0 m-auto max-h-[85vh] w-[580px] max-w-[95vw] overflow-y-auto rounded-2xl border border-border bg-surface p-5 text-foreground shadow-2xl backdrop:bg-black/40">
        <div className="mb-3 flex items-center">
          <h3 id={titleId} className="font-semibold">{variant ? t("agent-config.profile.addVariant") : model ? t("agent-config.profile.editModel") : t("agent-config.profile.addModel")}</h3>
          <span className="ml-auto">
            <IconButton label={t("settings.cancel")} disabled={busy} onClick={onClose}>
              <X size={15} />
            </IconButton>
          </span>
        </div>
        <fieldset disabled={busy}>
        {requestModel && <SettingRow label={t("agent-config.profile.baseModel")} hint={t("agent-config.profile.variantHint")}>
          <span className="text-sm" title={requestModel}>{modelName(requestModel, requestRow?.displayName, profile)}</span>
        </SettingRow>}
        {(creating || !requestModel) && <SettingRow label={t(variant ? "agent-config.profile.variantName" : "agent-config.profile.modelId")}>
          <TextInput mono={!variant} value={id} disabled={!creating} maxLength={200} onChange={setId} placeholder={variant ? "Astra [400K]" : "glm-5"} autoFocus={creating} />
        </SettingRow>}
        {names ? (
          <SettingRow label={t("agent-config.profile.displayName")} hint={t("agent-config.profile.entryNameHint")}>
            <TextInput value={entryName} maxLength={80} onChange={setEntryName} placeholder={model?.displayName || model?.id || id || undefined} />
          </SettingRow>
        ) : !variant && catalog && <SettingRow label={t("agent-config.profile.displayName")}>
          <TextInput value={draft.displayName ?? ""} onChange={(v) => setDraft({ ...draft, displayName: v || null })} />
        </SettingRow>}
        {catalog && <>
        <SettingRow label={t("agent-config.profile.contextWindow")} hint={t("agent-config.profile.contextWindowHint")}>
          <WindowInput value={draft.contextWindow ?? null} onChange={(v) => setDraft({ ...draft, contextWindow: v })} onValidityChange={(v) => setValid((s) => ({ ...s, context: v }))} allowInherit inheritLabel={t("agent-config.profile.unset")} />
        </SettingRow>
        <SettingRow label={t("agent-config.profile.maxContextWindow")} hint={t("agent-config.profile.maxContextWindowHint")}>
          <WindowInput value={draft.maxContextWindow ?? null} onChange={(v) => setDraft({ ...draft, maxContextWindow: v })} onValidityChange={(v) => setValid((s) => ({ ...s, max: v }))} allowInherit inheritLabel={t("agent-config.profile.unset")} />
        </SettingRow>
        <SettingRow label={t("agent-config.profile.autoCompact")}>
          <CompactInput value={draft.autoCompactTokenLimit ?? null} window={draft.contextWindow ?? draft.maxContextWindow ?? null} onChange={(v) => setDraft({ ...draft, autoCompactTokenLimit: v })} onValidityChange={(v) => setValid((s) => ({ ...s, compact: v }))} allowInherit />
        </SettingRow>
        <SettingRow label={t("agent-config.profile.vision")}>
          <Toggle
            checked={(draft.inputModalities ?? []).includes("image")}
            onChange={(v) => setDraft({ ...draft, inputModalities: v ? ["text", "image"] : ["text"] })}
          />
        </SettingRow>
        <SettingRow label={t("agent-config.profile.efforts")} hint={t("agent-config.profile.effortsHint")}>
          <span className="flex max-w-72 flex-wrap justify-end gap-1">
            {MODEL_EFFORTS.map((e) => {
              const on = efforts.includes(e);
              return (
                <button
                  key={e}
                  onClick={() => {
                    const next = on ? efforts.filter((x) => x !== e) : MODEL_EFFORTS.filter((x) => x === e || efforts.includes(x));
                    setDraft({ ...draft, supportedReasoningEfforts: next, defaultReasoningEffort: next.includes(draft.defaultReasoningEffort ?? "") ? draft.defaultReasoningEffort : (next[0] ?? null) });
                  }}
                  className={`rounded-md border px-2 py-0.5 text-xs ${on ? "border-accent text-accent" : "border-border text-subtle"}`}
                >
                  {e}
                </button>
              );
            })}
          </span>
        </SettingRow>
        <SettingRow label={t("agent-config.profile.defaultEffort")}>
          <Select value={draft.defaultReasoningEffort ?? ""} options={efforts.map((e) => ({ value: e, label: e }))} onChange={(v) => setDraft({ ...draft, defaultReasoningEffort: v })} />
        </SettingRow>
        </>}
        </fieldset>
        {catalog ? <p className="mt-3 text-xs text-subtle">{t("agent-config.profile.appliesNext")}</p> : <p className="mt-3 text-xs text-subtle">{t("agent-config.profile.entryNameOnly")}</p>}
        {catalog && overridden && <p className="mt-2 text-xs text-warn">{t("agent-config.profile.variantOverridden")}</p>}
        {taken && <p className="mt-2 text-xs text-danger">{t("agent-config.profile.modelNameTaken")}</p>}
        {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
        <div className="mt-4 flex items-center gap-2">
          {model && !variant && catalog && <Button disabled={busy} onClick={() => void reset()}>{t("agent-config.profile.smartReset")}</Button>}
          <div className="ml-auto flex gap-2">
            <Button disabled={busy} onClick={onClose}>{t("settings.cancel")}</Button>
            <Button primary disabled={busy || !id.trim() || taken || !Object.values(valid).every(Boolean)} onClick={() => void save()}>{t("settings.save")}</Button>
          </div>
        </div>
    </dialog>, document.body,
  );
}

