// A profile's default model / effort picked from Settings → Profiles (the overview card's 模型 value).
// Codex profiles write their config's `model` / `modelReasoningEffort`; Claude profiles the same
// PATCH fields on a cutex with `claude-profile-default-model` (lib/profileKind defaultModelEditable).
// The menu lists the profile's models (`GET /v2/profiles/{p}/models`) under their display names, the
// current one ticked, and a 推理强度 submenu with the levels the current model supports.
import type { ProfileModelsView, ProfilePatch } from "../../../shared/ipc";
import type { MenuEntry } from "./contextMenu";
import type { ModelNameFn } from "./modelDisplay";
import { claudeEffortLevels } from "./profileModels";

export interface DefaultModelMenuInput {
  view: ProfileModelsView;
  /** Profile id (per-entry display names). */
  profileId: string;
  claude: boolean;
  /** The profile's current default model / effort (the item's `model` / `modelReasoningEffort`). */
  model: string | null;
  effort: string | null;
  modelName: ModelNameFn;
  /** Translated texts: tick mark row hint, the effort submenu title, "model default" entry, effort names. */
  labels: { current: string; effort: string; effortDefault: string; effortName(level: string): string };
  onPick(patch: ProfilePatch): void;
}

export function defaultModelMenu(input: DefaultModelMenuInput): MenuEntry[] {
  const { view, profileId, claude, model, effort, modelName, labels, onPick } = input;
  const current = model ?? view.selectedModel ?? view.models.find((m) => m.isDefault)?.id ?? null;
  const rows = view.models.map((m) => ({ id: m.id, label: modelName(m.id, m.displayName, profileId) }));
  // A default the list does not know (e.g. a full id typed elsewhere) stays visible and ticked.
  if (current && !rows.some((r) => r.id === current)) rows.unshift({ id: current, label: modelName(current, null, profileId) });
  const offers = (id: string, level: string) => {
    const levels = view.models.find((m) => m.id === id)?.supportedReasoningEfforts ?? [];
    return levels.length === 0 || levels.includes(level);
  };
  const entries: MenuEntry[] = rows.map((r) => ({
    label: r.label,
    title: r.label === r.id ? undefined : r.id,
    hint: r.id === current ? labels.current : undefined,
    disabled: r.id === current,
    // The effort stays unless the new model does not offer it (then: the model's own default).
    onSelect: () => onPick(effort && !offers(r.id, effort) ? { model: r.id, modelReasoningEffort: null } : { model: r.id }),
  }));
  const row = view.models.find((m) => m.id === current);
  const levels = claude ? claudeEffortLevels(row) : (row?.supportedReasoningEfforts ?? []);
  if (levels.length) {
    const ownDefault = row?.defaultReasoningEffort && !effort ? row.defaultReasoningEffort : null;
    entries.push("separator", {
      label: labels.effort,
      hint: effort ? labels.effortName(effort) : ownDefault ? labels.effortName(ownDefault) : undefined,
      onSelect: () => {},
      submenu: [
        { label: labels.effortDefault, hint: effort ? undefined : labels.current, disabled: !effort, onSelect: () => onPick({ modelReasoningEffort: null }) },
        ...levels.map((level) => ({
          label: labels.effortName(level),
          hint: level === effort ? labels.current : undefined,
          disabled: level === effort,
          onSelect: () => onPick({ modelReasoningEffort: level }),
        })),
      ],
    });
  }
  return entries;
}
