// A profile's default model / effort picked from Settings → Profiles (the overview card's 模型 value).
// Codex profiles write their config's `model` / `modelReasoningEffort`; Claude profiles the same
// PATCH fields on a cutex with `claude-profile-default-model` (lib/profileKind defaultModelEditable).
// The menu lists the profile's models (`GET /v2/profiles/{p}/models`) under their display names, the
// current one ticked, and a 推理强度 submenu with the levels the current model supports.
import { rowResolution } from "./effortDisplay";
import type { ProfileModelsView, ProfilePatch } from "../../../shared/ipc";
import type { MenuEntry } from "./contextMenu";
import type { ModelNameFn } from "./modelDisplay";
import { claudeEffortLevels } from "./profileModels";
import { claudeAliasLabels } from "./claudeModels";

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
  labels: { current: string; effort: string; effortDefault: string; effortName(level: string): string; /** 「跟随最新」 (Claude alias rows that read like a fixed row). */ latest?: string; /** 「{model} · 1M 上下文」 (`claudeModels.oneMName`; default 「{model} · 1M」). */ oneMName?(model: string): string };
  onPick(patch: ProfilePatch): void;
}

export function defaultModelMenu(input: DefaultModelMenuInput): MenuEntry[] {
  const { view, profileId, claude, model, effort, modelName, labels, onPick } = input;
  const current = model ?? view.selectedModel ?? view.models.find((m) => m.isDefault)?.id ?? null;
  // Claude (owner 2026-11-23): every alias row (`opus`, `opus[1m]`) is 「Opus 5.5」 / 「Opus 5.5 · 1M」 (handshake
  // version) or 「Opus」; where one reads like a fixed row, it says 「 · 跟随最新」 (docs/design/024-model-list.md 三).
  // The menu lists the raw items, so every alias item is named here — also one the fold would hide under its alias.
  const aliasNames = new Map<string, string>();
  if (claude) for (const [id, a] of claudeAliasLabels(view.models, (m) => m.id)) {
    aliasNames.set(id, a.oneM ? (labels.oneMName?.(a.name) ?? `${a.name} · 1M`) : a.name);
  }
  const rows = view.models.map((m) => ({ id: m.id, label: modelName(m.id, aliasNames.get(m.id) ?? m.displayName, profileId) }));
  if (labels.latest) for (const r of rows) {
    if (aliasNames.has(r.id) && rows.some((o) => o !== r && !aliasNames.has(o.id) && o.label === r.label)) r.label = `${r.label} · ${labels.latest}`;
  }
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
    // With no Profile level: what applies (the host's resolution for the row, else the catalog's level; explicit only).
    const resolved = rowResolution(row);
    const ownDefault = effort ? null : (resolved ? resolved.value : row?.defaultReasoningEffort && !(claude && row.defaultReasoningEffort === "none") ? row.defaultReasoningEffort : null);
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
