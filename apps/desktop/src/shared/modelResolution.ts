// The host's resolved reasoning effort and Claude alias target (cutex `resolved-reasoning-effort`; backend contract
// "Explicit reasoning effort and Claude alias resolution", cutex a7fc3da1). Every read of those wire fields is here, so a renamed or
// added field changes this file only (main's model/list mapping and the renderer both use it). Older hosts send
// none of them: every reader returns null and the UI shows 「—」 (未上报), never 「默认」.

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** `source` of a resolution: who decided the level, or why there is none. */
export type EffortSource = "session" | "model" | "profile" | "catalog" | "claudeCodeDefault" | "cutexDefault" | "runtime" | "unsupported" | "unreported" | (string & {});

/** A saved choice the model cannot use (`skipped`: `{source: "model" | "profile", value, reason: "unsupportedByModel"}`). */
export interface SkippedChoice {
  /** Whose choice: the owner's per-model level (`model`) or the Profile's (`profile`). */
  source: "model" | "profile" | (string & {});
  value: string;
}

export interface ReasoningResolution {
  /** An explicit session selection; null = inherited. */
  configured: string | null;
  /** The level the runtime uses; null = none known (see `source`). */
  value: string | null;
  source: EffortSource;
  /** Saved choices passed over because the model does not offer them (e.g. a Profile 「超高」 on a model without it). */
  skipped: SkippedChoice[];
}

function skippedOf(raw: Record<string, unknown>): SkippedChoice[] {
  if (!Array.isArray(raw.skipped)) return [];
  return raw.skipped.flatMap((x) => {
    const r = obj(x), value = text(r?.value), source = text(r?.source);
    return value && source ? [{ source, value }] : [];
  });
}

/** A resolution block (`runtimeDefaults.reasoningResolution`, a Profile model row's `reasoningEffort`). */
export function readReasoningResolution(raw: unknown): ReasoningResolution | null {
  const r = obj(raw);
  if (!r) return null;
  const source = text(r.source);
  if (!source) return null;
  return { configured: text(r.configured), value: text(r.value), source, skipped: skippedOf(r) };
}

/** The session's resolution (`runtimeDefaults.reasoningResolution`); null on a legacy session (= unreported). */
export function sessionReasoningResolution(runtimeDefaults: unknown): ReasoningResolution | null {
  return readReasoningResolution(obj(runtimeDefaults)?.reasoningResolution);
}

/** What a Claude alias resolves to, as the SDK handshake reported it. */
export interface AliasResolution {
  /** The model id the alias resolved to (folding only; never parsed for a label). */
  resolvedModel: string;
  /** The version the label shows (「Opus 5.5」), as the host words it; null = the label has no version. */
  version: string | null;
}

/** The wire fields copied from model/list (main) and catalog rows, unchanged. */
export interface AliasFields {
  resolvedModel?: string | null;
  resolvedModelSource?: string | null;
  resolvedDisplayVersion?: string | null;
  resolvedDisplayName?: string | null;
}

/** The alias fields of a raw model/list or catalog row (main copies these into ModelOption). */
export function aliasFieldsOf(raw: unknown): AliasFields {
  const r = obj(raw);
  if (!r) return {};
  const out: AliasFields = {};
  for (const k of ["resolvedModel", "resolvedModelSource", "resolvedDisplayVersion", "resolvedDisplayName"] as const) {
    const v = text(r[k]);
    if (v) out[k] = v;
  }
  return out;
}

/**
 * Only `sdkHandshake` evidence names the alias target; the label has a version only when the host also sends
 * `resolvedDisplayVersion` (owner 2026-11-23 label 「Opus 5.5」; the contract's 「Opus latest (5.5)」 wording is not used). Never parsed from the model id.
 */
export function aliasResolutionOf(raw: AliasFields | null | undefined): AliasResolution | null {
  if (!raw || raw.resolvedModelSource !== "sdkHandshake") return null;
  const resolvedModel = text(raw.resolvedModel);
  if (!resolvedModel) return null;
  return { resolvedModel, version: text(raw.resolvedDisplayVersion) };
}

/** The session's own alias evidence (`runtimeDefaults.reasoningResolution` carries requestedModel / resolvedModel /
 *  resolvedModelSource), when it is about `model` (a model change the session has not started on yet says nothing). */
export function sessionAliasFields(runtimeDefaults: unknown, model: string | null): AliasFields {
  const r = obj(obj(runtimeDefaults)?.reasoningResolution);
  if (!r || !model || text(r.requestedModel) !== model) return {};
  return aliasFieldsOf(r);
}

/** `row` with the session's alias evidence laid over as a whole group: when the session reports any, none of the
 *  row's own alias fields are kept (a newer handshake target without a display version must not keep the catalog's
 *  older version). Without session evidence the row is unchanged. */
export function withSessionAlias<T extends object>(row: T, session: AliasFields): T {
  if (!session.resolvedModel && !session.resolvedModelSource) return row;
  const { resolvedModel: _m, resolvedModelSource: _s, resolvedDisplayVersion: _v, resolvedDisplayName: _n, ...rest } = row as T & AliasFields;
  return { ...rest, ...session } as T;
}
