// DSH model choices (docs/design/048). cutex says which models DSH offers: an existing chat's `model/list`
// (Composer → listModels; DSH's own provider catalog) and a DSH Profile's `GET /v2/profiles/{p}/models`.
// Forms without either (a new Profile, a DSH variant of a cute-codex Profile, an older host, a failed read) fall
// back to the list DSH 0.2.1-rc.3 reports over `model/list` — the only place these names are written down.
// Pure (no React, no store) so it is unit-tested.
import { isAcpRuntime } from "./acpRuntimes";

/** DSH 0.2.1-rc.3 `model/list` (r265 C1): `deepseek-flash` (default; text + image) and `deepseek-v4-pro` (text). */
export const DSH_FALLBACK_MODELS: readonly string[] = ["deepseek-flash", "deepseek-v4-pro"];
/** What DSH marks as its default model (first of the fallback list). */
export const DSH_DEFAULT_MODEL = DSH_FALLBACK_MODELS[0]!;
/** DSH reasoning levels (DeepSeek's models share them; cutex validates the same four). */
export const DSH_EFFORTS = ["off", "low", "high", "max"] as const;
export type DshEffort = (typeof DSH_EFFORTS)[number];

type CatalogLike = { models?: readonly { id: string }[] | null } | null | undefined;

/**
 * Model ids to offer for a DSH Profile or variant: the catalog cutex returned when it has rows, else the fallback;
 * `keep` (the stored / current value, e.g. an older `deepseek-v4-flash`) is always kept so a choice is never lost.
 */
export function dshModelIds(catalog: CatalogLike, keep?: string | null): string[] {
  const listed = (catalog?.models ?? []).map((m) => m.id).filter((id) => typeof id === "string" && id.trim() !== "");
  const ids = listed.length ? listed : [...DSH_FALLBACK_MODELS];
  const current = keep?.trim();
  return current && !ids.includes(current) ? [...ids, current] : ids;
}

/** A DSH effort value, or undefined for anything else (main checks again). */
export function dshEffortOf(value: string | null | undefined): DshEffort | undefined {
  return (DSH_EFFORTS as readonly string[]).includes(value ?? "") ? (value as DshEffort) : undefined;
}

/**
 * The chat's live model / effort, else (ACP runtimes: DSH, Kimi) the session's defaults (cutex `runtimeDefaults`, where a change on
 * the chat lands too) — never the creation value of its launch binding. A DSH runtime started after the chat was
 * opened (a fork's first message) sends no settings event, so without this the footer kept 「…」 (r265 D6).
 */
export function chatModelAndEffort(
  live: { model?: string | null; effort?: string | null } | null | undefined,
  runtime: string | null | undefined,
  defaults: { model?: unknown; reasoningEffort?: unknown } | null | undefined,
): { model: string | null; effort: string | null } {
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const acp = isAcpRuntime(runtime);
  return {
    model: text(live?.model) ?? (acp ? text(defaults?.model) : null),
    effort: text(live?.effort) ?? (acp ? text(defaults?.reasoningEffort) : null),
  };
}
