// Profile → 模型与上下文 (owner 2026-11-18): one pair of controls on every runtime — 上下文窗口 and 自动压缩 —
// mapped onto what each backend stores. Pure (test/contextCompaction.test.ts).
//
//   Codex (Native): `modelContextWindow` + `modelAutoCompactTokenLimit` (absolute tokens); no limit = 90 % of the
//     window. cutex profile-model-context-v1 (docs/model-context-contract.md) adds `modelAutoCompactPercent`, exclusive
//     with the token limit, and — once a Profile is migrated — per-model values that win over the Profile's.
//   Claude: `claudeCompaction {window, percent}` (window 100K–1M is Claude Code's compaction window, not the model's;
//     null = Claude Code decides). "About N tokens" is {window: N + 33000, percent: 100} (docs/design/036).
//     profile-model-context-v1: the window may be null — only the percent, of the model's own window.
//
// Without profile-model-context-v1 a percentage needs a fixed window (it is stored as window × percent). A value read
// from a host and not touched is never rewritten: each mapping is the identity for every valid stored value.
import { compactAt, validCompaction, type ClaudeCompaction } from "../../../shared/claudeCompaction";
import type { ContextSettingsLayers, ModelContextSupport } from "../../../shared/ipc";
import { formatWindow, WINDOW_PRESETS } from "./contextPresets";
import { compactField, compactOfLayer, windowField } from "./contextLayers";

/** cutex host capability: percent compaction, Claude percent-only, per-model values win (after migration). */
export const MODEL_CONTEXT_V1_FEATURE = "profile-model-context-v1";

/** The percentage choices of 自动压缩 (owner 2026-11-18: 75 / 80 / 90, plus 自定义). */
export const COMPACT_PERCENT_CHOICES = [75, 80, 90] as const;

/** Claude Code reserves 20000 for the reply and compacts 13000 below that: "about N tokens" = window N + 33000 at 100 %. */
export const CLAUDE_TOKENS_OFFSET = 33_000;

export type UnifiedCompact = { percent: number } | { tokens: number } | null;

/** The two controls' value. `window` null = 按模型 (or, in a model's dialog, 跟随 Profile); `compact` null = 默认. */
export interface UnifiedContext {
  window: number | null;
  compact: UnifiedCompact;
}

export type ContextWriteError = "percentNeedsWindow" | "limitNotBelowWindow" | "outOfRange";
type Refused = { unsupported: ContextWriteError };

const isPreset = (w: number) => (WINDOW_PRESETS as readonly number[]).includes(w);
const percentOf = (window: number, p: number) => Math.floor((window * p) / 100);

/**
 * Why a Codex percentage cannot stand without a fixed window on this Profile (null: it can): a suffix of
 * `settings.modelContext.reason.*`, or the raw cutex reason code.
 */
export function codexPercentBlock(v1Host: boolean, item: { modelContextSettingsV1?: boolean; modelContextSettingsSupport?: ModelContextSupport }, percentEditable: boolean, opts: { migratesOnEdit?: boolean } = {}): string | null {
  if (!v1Host) return "hostV1";
  const support = item.modelContextSettingsSupport;
  if (support && !support.supported) return support.reason ?? "unknown";
  // P13 B hosts migrate a supporting Profile on its first context edit (an API-key Profile without a catalog: the first
  // model edit creates the catalog and migrates in one step), so "not migrated yet" blocks nothing there.
  if (!item.modelContextSettingsV1 && opts.migratesOnEdit && support?.supported) return null;
  if (!item.modelContextSettingsV1) return "notMigrated";
  return percentEditable ? null : "unknown";
}

/** Why a Claude percent cannot stand alone (null: it can): the host API and the selected adapter must both support it.
 *  Fixed-window values keep working either way. */
export function claudePercentBlock(v1Host: boolean, item: { modelContextSettingsSupport?: ModelContextSupport }): string | null {
  if (!v1Host) return "hostV1";
  const support = item.modelContextSettingsSupport;
  return support && !support.supported ? (support.reason ?? "unknown") : null;
}

/** Support reasons that leave the legacy (fixed-window / absolute) controls usable: only the new modes are greyed. */
export const LEGACY_STILL_WORKS = new Set(["nativeModelContextSettingsV1Required", "nativeModelContextSettingsV2Required", "claudeModelContextSettingsV1Required"]);

/**
 * P13: an API-key Profile with no model catalog yet, on a runtime that supports the unified settings and not migrated:
 * cutex creates the catalog (and migrates) with the first model edit, while a Profile-level context edit fails until
 * then ("model catalog unavailable"). Hosts without the flags: false.
 */
export function catalogFirst(view: { discoverySupported?: boolean; catalogPresent?: boolean; modelContextSettingsV1?: boolean; modelContextSettingsSupport?: ModelContextSupport } | null | undefined): boolean {
  return !!view && view.discoverySupported === true && view.catalogPresent === false && view.modelContextSettingsV1 === false && view.modelContextSettingsSupport?.supported === true;
}

/** The reason the context rows are not editable at all (null: they are). Any reported reason other than the known
 *  old-adapter / old-runtime ones disables them — at Profile level and in a model's dialog alike. */
export function contextBlocked(item: { modelContextSettingsSupport?: ModelContextSupport }): string | null {
  const support = item.modelContextSettingsSupport;
  if (!support || support.supported) return null;
  return LEGACY_STILL_WORKS.has(support.reason ?? "") ? null : (support.reason ?? "unknown");
}

// ---------- Codex ----------

/**
 * `percent`: the stored modelAutoCompactPercent. `detect`: read a token limit that is exactly 75 / 80 / 90 % of the
 * fixed window as that percentage (hosts without percent fields, where that is how a percentage is stored; v1 never
 * fabricates a percentage from a custom token value).
 */
export function fromCodex(window: number | null | undefined, limit: number | null | undefined, percent?: number | null, detect = true): UnifiedContext {
  const w = window ?? null;
  if (percent != null) return { window: w, compact: { percent } };
  if (!limit) return { window: w, compact: null };
  const p = detect && w ? COMPACT_PERCENT_CHOICES.find((x) => Math.round((w * x) / 100) === limit) : undefined;
  return { window: w, compact: p ? { percent: p } : { tokens: limit } };
}

export type CodexWrite = { modelContextWindow: number | null; modelAutoCompactTokenLimit: number | null; modelAutoCompactPercent?: number | null };

/** The fields to store, or why not. `percentField`: the host stores modelAutoCompactPercent (profile-model-context-v1). */
export function toCodex(v: UnifiedContext, percentField = false): CodexWrite | Refused {
  if (v.compact && "percent" in v.compact) {
    if (percentField) return { modelContextWindow: v.window, modelAutoCompactTokenLimit: null, modelAutoCompactPercent: v.compact.percent };
    if (!v.window) return { unsupported: "percentNeedsWindow" };
    return { modelContextWindow: v.window, modelAutoCompactTokenLimit: Math.round((v.window * v.compact.percent) / 100) };
  }
  const limit = v.compact ? v.compact.tokens : null;
  // cutex refuses a limit at or above an explicit window.
  if (limit !== null && v.window !== null && limit >= v.window) return { unsupported: "limitNotBelowWindow" };
  return { modelContextWindow: v.window, modelAutoCompactTokenLimit: limit, ...(percentField ? { modelAutoCompactPercent: null } : {}) };
}

type CodexRow = { contextWindow: number | null; maxContextWindow: number | null; autoCompactTokenLimit: number | null; autoCompactPercent?: number | null; contextSettings?: ContextSettingsLayers };

/**
 * What a Codex model runs with under a Profile draft, so the hints follow the controls before saving.
 * Legacy (not migrated): the Profile's window capped at the model's maximum, else the row's; compaction =
 * min(limit, 90 % of the window), no limit = 90 %. Migrated (`v1`, contract "Native runtime seam"): the row's window,
 * else the Profile's, else the maximum (capped); the row's compaction, else the Profile's, else 90 %; `own` = the row's.
 */
export function codexEffective(row: CodexRow, v: UnifiedContext, v1 = false): { window: number | null; compactAt: number | null; own: boolean; ownWindow?: boolean } {
  const max = row.maxContextWindow ?? Infinity;
  if (v1) {
    // P13 B (row layers present): per field, preserved > owner > Profile > catalog built-in; the flat numbers are only
    // recommendations. Without layers (A hosts) the flat row values are the row's own.
    const cs = row.contextSettings;
    const ownWindow = cs ? windowField(row).value : row.contextWindow;
    const builtinWindow = cs?.catalog.contextWindow ?? null;
    const raw = ownWindow ?? v.window ?? builtinWindow ?? row.maxContextWindow;
    const window = raw ? Math.min(raw, max) : null;
    const rowCompact: UnifiedCompact = cs ? compactField(row).value : row.autoCompactPercent != null ? { percent: row.autoCompactPercent } : row.autoCompactTokenLimit != null ? { tokens: row.autoCompactTokenLimit } : null;
    const compact = rowCompact ?? v.compact ?? (cs ? compactOfLayer(cs.catalog) : null);
    if (!window) return { window: null, compactAt: compact && "tokens" in compact ? compact.tokens : null, own: !!rowCompact, ...(ownWindow != null ? { ownWindow: true } : {}) };
    const cap = percentOf(window, 90);
    const at = !compact ? cap : "percent" in compact ? Math.min(percentOf(window, compact.percent), cap) : Math.min(compact.tokens, cap);
    return { window, compactAt: at, own: !!rowCompact, ...(ownWindow != null ? { ownWindow: true } : {}) };
  }
  const window = v.window ? Math.min(v.window, max) : (row.contextWindow ?? row.maxContextWindow ?? null);
  const write = toCodex(v);
  const limit = ("unsupported" in write ? null : write.modelAutoCompactTokenLimit) ?? row.autoCompactTokenLimit;
  if (!window) return { window: null, compactAt: limit, own: false };
  const cap = Math.floor((window * 9) / 10);
  return { window, compactAt: limit ? Math.min(limit, cap) : cap, own: false };
}

// ---------- a Codex catalog row (the model's dialog) ----------
// Legacy: an unset row window means the model's maximum, so a percentage there is a share of the maximum.
// Migrated (v1): unset follows the Profile; the row has its own percent field.

export function fromCodexRow(window: number | null | undefined, max: number | null | undefined, limit: number | null | undefined, percent?: number | null, v1 = false): UnifiedContext {
  if (v1) return fromCodex(window, limit, percent, false);
  return { window: window ?? null, compact: fromCodex(window ?? max, limit).compact };
}

export type CodexRowWrite = { contextWindow: number | null; autoCompactTokenLimit: number | null; autoCompactPercent?: number | null };

export function toCodexRow(v: UnifiedContext, max: number | null | undefined, v1 = false): CodexRowWrite | Refused {
  if (v1) {
    if (v.compact && "percent" in v.compact) return { contextWindow: v.window, autoCompactTokenLimit: null, autoCompactPercent: v.compact.percent };
    const limit = v.compact ? v.compact.tokens : null;
    const cap = v.window ?? max ?? null;
    if (limit !== null && cap !== null && limit >= cap) return { unsupported: "limitNotBelowWindow" };
    return { contextWindow: v.window, autoCompactTokenLimit: limit, autoCompactPercent: null };
  }
  const w = toCodex({ ...v, window: v.window ?? max ?? null });
  return "unsupported" in w ? w : { contextWindow: v.window, autoCompactTokenLimit: w.modelAutoCompactTokenLimit };
}

// ---------- Claude ----------

/** A stored {w, 100} that is "about N tokens" (the earlier 30 / 50 / 70 万 presets and custom token entries). */
function tokensOf(c: ClaudeCompaction): number | null {
  if (c.window == null || c.percent !== 100 || isPreset(c.window)) return null;
  const n = c.window - CLAUDE_TOKENS_OFFSET;
  return n > 0 && n % 10_000 === 0 ? n : null;
}

export function fromClaude(c: ClaudeCompaction | null | undefined): UnifiedContext {
  if (!c) return { window: null, compact: null };
  if (c.window == null) return { window: null, compact: { percent: c.percent } };
  const tokens = tokensOf(c);
  if (tokens !== null) return { window: null, compact: { tokens } };
  return { window: c.window, compact: c.percent === 100 ? null : { percent: c.percent } };
}

/** A Claude *model* record as the per-model control shows it: like fromClaude, but a fixed window at 100 % reads as
 *  its explicit 100 % — in that control 默认 means 跟随 Profile, and the record overrides the Profile's percent. */
export function claudeModelValue(c: ClaudeCompaction | null | undefined): UnifiedContext {
  const v = fromClaude(c);
  return c && v.window !== null && v.compact === null ? { window: v.window, compact: { percent: c.percent } } : v;
}

/** The window is decided by a token count (Claude): the 上下文窗口 control shows it as locked. */
export function claudeWindowLocked(v: UnifiedContext): boolean {
  return !!v.compact && "tokens" in v.compact;
}

/** `percentOnly`: the host stores a percent without a window (profile-model-context-v1). */
export function toClaude(v: UnifiedContext, percentOnly = false): ClaudeCompaction | null | Refused {
  let c: ClaudeCompaction | null;
  if (v.compact && "tokens" in v.compact) c = { window: v.compact.tokens + CLAUDE_TOKENS_OFFSET, percent: 100 };
  else if (v.compact) {
    if (!v.window && !percentOnly) return { unsupported: "percentNeedsWindow" };
    c = { window: v.window ?? null, percent: v.compact.percent };
  } else c = v.window ? { window: v.window, percent: 100 } : null;
  if (c && !validCompaction(c)) return { unsupported: "outOfRange" };
  return c;
}

/** Where Claude Code compacts for a model of context `modelContext` (null: it decides — its own rule at that context). */
export function claudeCompactsAt(c: ClaudeCompaction | null, modelContext: number | null | undefined): number | null {
  if (c?.window != null) return compactAt({ window: c.window, percent: c.percent }, modelContext);
  return modelContext ? compactAt({ window: modelContext, percent: c?.percent ?? 100 }) : null;
}

/** A token amount in the hints and the catalog: 万 in Chinese ("43.2 万"), else K / M. */
export function formatTokens(n: number, locale: string): string {
  return locale.startsWith("zh") && n >= 10_000 ? `${+(n / 10_000).toFixed(1)} 万` : formatWindow(n);
}

// ---------- 自定义 text ----------

/** "85%" → percent 85; "450k" / "450000" / "45万" / "1.2m" → tokens; else undefined. */
export function parseCustomCompact(text: string): UnifiedCompact | undefined {
  const pct = /^\s*(\d{1,3})\s*%\s*$/.exec(text);
  if (pct) {
    const p = Number(pct[1]);
    return p >= 1 && p <= 100 ? { percent: p } : undefined;
  }
  const m = /^\s*(\d+(?:\.\d+)?)\s*(k|m|万)?\s*$/i.exec(text);
  if (!m) return undefined;
  const unit = m[2]?.toLowerCase();
  const n = Math.round(Number(m[1]) * (unit === "m" ? 1_000_000 : unit === "k" ? 1000 : unit === "万" ? 10_000 : 1));
  return Number.isSafeInteger(n) && n > 0 ? { tokens: n } : undefined;
}

/** The 自定义 text of a value (what the input shows). */
export function customCompactText(c: UnifiedCompact): string {
  if (!c) return "";
  if ("percent" in c) return `${c.percent}%`;
  return c.tokens % 1000 === 0 ? `${c.tokens / 1000}k` : String(c.tokens);
}

/** Which 自动压缩 choice a value is: "default", "p75" / "p80" / "p90", else "custom". */
export function compactChoice(c: UnifiedCompact): "default" | `p${number}` | "custom" {
  if (!c) return "default";
  if ("percent" in c && (COMPACT_PERCENT_CHOICES as readonly number[]).includes(c.percent)) return `p${c.percent}`;
  return "custom";
}

/** The message of a reason from `codexPercentBlock` or a cutex support reason code. */
export function contextReasonMessage(code: string): { key: string; vars?: Record<string, string> } {
  switch (code) {
    case "hostV1":
    case "notMigrated":
      return { key: `settings.modelContext.reason.${code}` };
    case "nativeModelContextSettingsV1Required":
    case "nativeModelContextSettingsV2Required":
      return { key: "settings.modelContext.reason.nativeV1Required" };
    case "needsCatalog":
      return { key: "settings.modelContext.reason.needsCatalog" };
    case "claudeModelContextSettingsV1Required":
      return { key: "settings.modelContext.reason.claudeV1Required" };
    case "dshContextSettingsUnsupported":
      return { key: "settings.modelContext.unsupportedDsh" };
    case "kimiContextSettingsUnsupported":
      return { key: "settings.modelContext.unsupportedKimi" };
    default:
      return { key: "settings.modelContext.reason.other", vars: { code } };
  }
}
