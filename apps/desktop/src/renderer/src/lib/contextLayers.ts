// P13 B (cutex docs/model-context-contract.md, owner decision B): a model row's context settings come in layers —
// catalog built-ins, the owner's own per-model setting, and a value preserved at upgrade — and window and compaction
// resolve independently, each with its own source. The desktop reads the layers and the backend's resolved defaults;
// it never computes a default number itself. Hosts without `contextSettings` keep the earlier (flat) behaviour.
// Pure (test/contextLayers.test.ts).
import type { CatalogModel, CatalogModelPatch, ContextEffective, ContextSource, ContextValues } from "../../../shared/ipc";
import type { UnifiedCompact } from "./contextCompaction";

/** The row reports its layers (P13 B): its flat numbers are catalog recommendations, not owner settings. */
export function hasLayers(row: Pick<CatalogModel, "contextSettings"> | null | undefined): boolean {
  return !!row?.contextSettings;
}

const num = (n: number | null | undefined): number | null => (typeof n === "number" ? n : null);

/** A layer's compaction (percent and absolute are one exclusive setting). */
export function compactOfLayer(v: ContextValues | undefined): UnifiedCompact {
  const p = num(v?.autoCompactPercent), t = num(v?.autoCompactTokenLimit);
  return p !== null ? { percent: p } : t !== null ? { tokens: t } : null;
}

/** The host speaks P13 B (resolved defaults / row layers): context edits migrate on demand, flat numbers are not owner values. */
export function layeredView(view: { profileDefaultValues?: unknown; models: readonly Pick<CatalogModel, "contextSettings">[] } | null | undefined): boolean {
  return !!view && (view.profileDefaultValues !== undefined || view.models.some(hasLayers));
}

/** One field of a row as the dialog edits it: `value` = what is in force on this row (preserved wins over owner);
 *  `owner` = the owner's own setting underneath; `preserved` = an upgrade-preserved value is in force. */
export interface LayeredField<T> {
  value: T;
  owner: T;
  preserved: boolean;
}

export function windowField(row: Pick<CatalogModel, "contextSettings">): LayeredField<number | null> {
  const cs = row.contextSettings;
  const owner = num(cs?.owner.contextWindow);
  const kept = num(cs?.preserved.contextWindow);
  return { value: kept ?? owner, owner, preserved: kept !== null };
}

export function compactField(row: Pick<CatalogModel, "contextSettings">): LayeredField<UnifiedCompact> {
  const cs = row.contextSettings;
  const owner = compactOfLayer(cs?.owner);
  const kept = compactOfLayer(cs?.preserved);
  return { value: kept ?? owner, owner, preserved: kept !== null };
}

const sameCompact = (a: UnifiedCompact, b: UnifiedCompact) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The context part of a model PATCH under B: only the fields the owner changed. Sending an unchanged value would turn
 * a catalog recommendation into an owner setting, or drop a preserved value (any explicit edit of a field clears its
 * preserved layer). `initial` / `draft` carry contextWindow, autoCompactTokenLimit, autoCompactPercent.
 */
export function changedContext(initial: CatalogModelPatch, draft: CatalogModelPatch): CatalogModelPatch {
  const out: CatalogModelPatch = {};
  if ((draft.contextWindow ?? null) !== (initial.contextWindow ?? null)) out.contextWindow = draft.contextWindow ?? null;
  const before = compactOfLayer(initial), after = compactOfLayer(draft);
  if (!sameCompact(before, after)) {
    out.autoCompactPercent = after && "percent" in after ? after.percent : null;
    out.autoCompactTokenLimit = after && "tokens" in after ? after.tokens : null;
  }
  return out;
}

/** A model PATCH without its context fields (they are added back by `changedContext`). */
export function withoutContext(patch: CatalogModelPatch): CatalogModelPatch {
  const { contextWindow: _w, autoCompactTokenLimit: _t, autoCompactPercent: _p, ...rest } = patch;
  return rest;
}

/** The message key suffix (settings.modelContext.source.*) of a source tag; generic, so a precedence change needs none. */
export function sourceKey(s: ContextSource | undefined): string {
  switch (s) {
    case "model": return "source.thisModel";
    case "profile": return "source.profile";
    case "catalog":
    case "reference": return "source.model";
    case "preserved": return "source.preserved";
    case "default90Percent": return "source.default90";
    case "runtimeDefault": return "source.runtimeDefault";
    case "unsupported": return "source.unsupported";
    default: return "source.unknown";
  }
}

/** The row's own setting (owner or preserved) is in force for this field: Profile edits do not reach it. */
export function pinnedSource(s: ContextSource | undefined): boolean {
  return s === "model" || s === "preserved";
}

/** The numbers a 默认 label may show, only as reported by the backend (null: show 默认 without a number). */
export function defaultNumbers(e: ContextEffective | null | undefined): { window: number | null; compactAt: number | null } {
  if (!e) return { window: null, compactAt: null };
  const known = (s: ContextSource | undefined) => s !== "unknown" && s !== "unsupported" && s !== "notApplicable";
  return {
    window: known(e.contextWindowSource) ? num(e.contextWindow) : null,
    compactAt: known(e.autoCompactTokenLimitSource) ? num(e.autoCompactTokenLimit) : null,
  };
}
