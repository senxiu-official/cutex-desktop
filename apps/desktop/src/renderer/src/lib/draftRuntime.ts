// The runtime a new quick chat (modules/quick-chats/PendingChat) will run on, and where its model / effort choices
// come from. A quick chat sends no `variantId`, so cutex starts it on the Profile's DEFAULT variant
// (profile-runtime-variants, docs/design/048) — e.g. a cute-codex Profile whose default variant is DSH starts a DSH
// chat. The draft's controls and defaults follow that variant, not the Profile kind (QA 2026-10-27): no Codex
// permission / model overrides for a DSH chat. Older hosts (no variants): the Profile kind, as before. Pure.
import type { ProfileItem } from "../../../shared/ipc";
import type { ProfileRuntimeVariant, VariantRuntime } from "../../../shared/profileVariants";
import { defaultVariantOf, variantsOn } from "./profileVariants";
import { isClaudeProfile } from "./newAgentClaude";
import { dshModelIds } from "./dshModels";
import { isAcpRuntime } from "./acpRuntimes";
import { runtimeEfforts } from "./runtimeChoices";

/** The model fields the draft bar reads (a profile catalog row or a variant catalog row). */
export interface DraftModelRow {
  id: string;
  displayName: string | null;
  inputModalities: string[];
  supportedReasoningEfforts: string[];
  defaultReasoningEffort: string | null;
  isDefault: boolean;
}

export interface DraftRuntime {
  /** The default variant's runtime; null on an older host (the Profile kind decides). */
  runtime: VariantRuntime | null;
  /** An ACP runtime (DSH, Kimi Code; lib/acpRuntimes): the store's flag for an ACP-only launch (no Codex fields). */
  dsh: boolean;
  claude: boolean;
  /** The default variant is not the Profile's own runtime: model / effort come from the variant, not the profile catalog. */
  variant: ProfileRuntimeVariant | null;
}

export function draftRuntime(item: ProfileItem | null | undefined, features: ReadonlySet<string>): DraftRuntime {
  const v = item && variantsOn(features) ? defaultVariantOf(item) : null;
  if (v) return { runtime: v.runtime, dsh: isAcpRuntime(v.runtime), claude: v.runtime === "claude", variant: v.primary ? null : v };
  return { runtime: null, dsh: isAcpRuntime(item?.cliKind), claude: isClaudeProfile(item), variant: null };
}

/**
 * A secondary variant's model choices: cutex's own catalog for it (`runtimeVariants[].models`), else (DSH) the names
 * DSH reports (lib/dshModels; no image input claimed without cutex's word). The variant's default model is kept.
 * Efforts a row does not list are the runtime's own (DSH, Kimi: lib/runtimeChoices).
 */
export function variantModelRows(v: ProfileRuntimeVariant): DraftModelRow[] {
  const dsh = v.runtime === "dsh";
  const runtimeEffortList = [...(runtimeEfforts(v.runtime) ?? [])];
  const listed = (v.models ?? []).filter((m) => typeof m.id === "string" && m.id.trim() !== "");
  const rows: DraftModelRow[] = listed.map((m) => ({
    id: m.id,
    displayName: m.displayName ?? null,
    inputModalities: m.inputModalities ?? [],
    supportedReasoningEfforts: m.supportedReasoningEfforts?.length ? m.supportedReasoningEfforts : runtimeEffortList,
    defaultReasoningEffort: m.defaultReasoningEffort ?? null,
    isDefault: !!m.isDefault,
  }));
  const keep = v.defaults.model?.trim() || null;
  const ids = dsh ? dshModelIds(listed.length ? { models: listed } : null, keep) : keep && !listed.some((m) => m.id === keep) ? [...listed.map((m) => m.id), keep] : [];
  for (const id of ids) {
    if (!rows.some((r) => r.id === id)) rows.push({ id, displayName: null, inputModalities: [], supportedReasoningEfforts: runtimeEffortList, defaultReasoningEffort: null, isDefault: false });
  }
  return rows;
}

/** The model a chat on the secondary variant gets without a pick: the variant's default, else its catalog's default. */
export function variantDefaultModel(v: ProfileRuntimeVariant, rows: readonly DraftModelRow[]): string | null {
  return v.defaults.model?.trim() || rows.find((r) => r.isDefault)?.id || null;
}
