// Preview mock of cutex profile-model-context-v1 (docs/model-context-contract.md): `?mcv1` turns the capability on.
// Codex profiles are migrated (modelContextSettingsV1), so a model's own window / compaction wins over the Profile's;
// percentages are their own fields, exclusive with the token limits; Claude takes a percent without a window. DSH and
// Kimi report unsupported with their reason codes. Only dev/mockBridge.ts imports this (the Claude part lives in modules/agent-config/mock.ts).
const QUERY = new URLSearchParams(typeof location === "undefined" ? "" : location.search);
export const MODEL_CONTEXT_V1_SCENE = !QUERY.has("legacy") && (QUERY.has("mcv1") || QUERY.has("mcb"));

type Kind = string | undefined;
type Config = Record<string, unknown>;
type Compact = { percent: number } | { tokens: number } | null;
type Row = { contextWindow: number | null; maxContextWindow: number | null; autoCompactTokenLimit: number | null; autoCompactPercent?: number | null };

const support = (kind: Kind) =>
  kind === "dsh" ? { supported: false, reason: "dshContextSettingsUnsupported" }
  : kind === "kimi" ? { supported: false, reason: "kimiContextSettingsUnsupported" }
  : { supported: true, reason: null };

/** Profile list / detail item fields. */
export function v1ItemFields(kind: Kind, config: Config) {
  return { modelAutoCompactPercent: (config.modelAutoCompactPercent as number | null) ?? null, modelContextSettingsV1: kind !== "claude" && kind !== "dsh" && kind !== "kimi", modelContextSettingsSupport: support(kind) };
}

/** Models resource fields. */
export function v1ModelsFields(kind: Kind) {
  const native = kind !== "claude" && kind !== "dsh" && kind !== "kimi";
  return { modelContextSettingsV1Supported: kind !== "dsh" && kind !== "kimi", modelContextSettingsV1: native, modelContextSettingsSupport: support(kind) };
}

/** A migrated Codex row's effective values: the row's own, else the Profile's, else the maximum / 90 %. */
export function v1Effective(row: Row, config: Config) {
  const max = row.maxContextWindow ?? Infinity;
  const profileWindow = (config.modelContextWindow as number | null) ?? null;
  const raw = row.contextWindow ?? profileWindow ?? row.maxContextWindow;
  const window = raw ? Math.min(raw, max) : null;
  const contextWindowSource = row.contextWindow ? "model" : profileWindow ? "profile" : row.maxContextWindow ? "catalog" : "unknown";
  const own: Compact = row.autoCompactPercent != null ? { percent: row.autoCompactPercent } : row.autoCompactTokenLimit != null ? { tokens: row.autoCompactTokenLimit } : null;
  const pp = (config.modelAutoCompactPercent as number | null) ?? null;
  const pt = (config.modelAutoCompactTokenLimit as number | null) ?? null;
  const prof: Compact = pp != null ? { percent: pp } : pt != null ? { tokens: pt } : null;
  const c: Compact = own ?? prof;
  const source = own ? "model" : prof ? "profile" : "default90Percent";
  const cap = window ? Math.floor((window * 90) / 100) : null;
  const at = !window ? (c && "tokens" in c ? c.tokens : null) : !c ? cap : "percent" in c ? Math.min(Math.floor((window * c.percent) / 100), cap!) : Math.min(c.tokens, cap!);
  return {
    contextWindow: window, contextWindowSource,
    autoCompactTokenLimit: at, autoCompactTokenLimitSource: source,
    autoCompactPercent: c && "percent" in c ? c.percent : null, autoCompactPercentSource: c && "percent" in c ? source : "unknown",
  };
}

/** Applies the exclusive percent / token pair of a PATCH (Profile or model) like cutex; both non-null is refused. */
export function applyExclusive(target: Record<string, unknown>, patch: Record<string, unknown>, percentKey: string, tokenKey: string): void {
  const p = patch[percentKey], t = patch[tokenKey];
  if (p != null && t != null) throw new Error(`invalid_request: ${percentKey} and ${tokenKey} are exclusive`);
  if (p !== undefined && p !== null && (!Number.isInteger(p) || (p as number) < 1 || (p as number) > 100)) throw new Error(`invalid_request: ${percentKey}: 1..100`);
  if (p != null) target[tokenKey] = null;
  if (t != null) target[percentKey] = null;
}
