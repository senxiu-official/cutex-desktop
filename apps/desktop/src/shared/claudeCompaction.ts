// Claude auto-compaction per profile (cutex `claude-compaction`, docs/design/036): the profile's
// `claudeCompaction {window, percent} | null`, stored by cutex in `profiles/<id>/claude-runtime.json`
// and passed to Claude Code at the next runtime start.

export const CLAUDE_COMPACTION_FEATURE = "claude-compaction";
/** Per-model table (docs/design/037): `claudeCompactionModels {"<model id>": {window, percent}} | null`. */
export const CLAUDE_COMPACTION_MODELS_FEATURE = "claude-compaction-models";
/** cutex accepts at most this many entries; the adapter matches ids exactly. */
export const MAX_COMPACTION_MODELS = 32;

export interface ClaudeCompaction {
  window: number;
  percent: number;
}

export const WINDOW_MIN = 100_000;
export const WINDOW_MAX = 1_000_000;
/** "Compact at about N tokens" presets (the 50 万 one is what the owner asked for). */
export const COMPACT_AT_PRESETS = [300_000, 500_000, 700_000] as const;

/** Window × percent presets (owner 2026-10-24): where they compact is shown next to the label (≈ compactAt). */
export const PRESET_WINDOWS = [400_000, 500_000, 600_000, 700_000, 800_000] as const;
export const PRESET_PERCENTS = [75, 80, 90] as const;
/** The grid, window-major (the select groups it by window). Includes the earlier 600K × 75%, 500K × 80% and 500K × 90%. */
export const WINDOW_PRESETS: readonly ClaudeCompaction[] = PRESET_WINDOWS.flatMap((window) => PRESET_PERCENTS.map((percent) => ({ window, percent })));

/** Claude Code reserves min(max output, 20000) for the reply and compacts 13000 below that. */
const OUTPUT_RESERVE = 20_000;
const MARGIN = 13_000;

export function validCompaction(c: ClaudeCompaction): boolean {
  return Number.isInteger(c.window) && c.window >= WINDOW_MIN && c.window <= WINDOW_MAX && Number.isInteger(c.percent) && c.percent >= 1 && c.percent <= 100;
}

/**
 * Where Claude Code 2.1.301 compacts on a model whose context is at least `window`:
 * E = window − 20000; min(floor(E × percent / 100), E − 13000). A smaller model context caps `window`.
 */
export function compactAt(c: ClaudeCompaction, modelContext?: number | null): number {
  const w = modelContext ? Math.min(c.window, modelContext) : c.window;
  const e = w - OUTPUT_RESERVE;
  return Math.min(Math.floor((e * c.percent) / 100), e - MARGIN);
}

/** The setting that compacts at about `tokens` (percent 100). */
export function compactionFor(tokens: number): ClaudeCompaction {
  return { window: tokens + OUTPUT_RESERVE + MARGIN, percent: 100 };
}

/** The preset a stored value is, else null (custom). */
export function presetOf(c: ClaudeCompaction | null): number | null {
  if (!c) return null;
  return COMPACT_AT_PRESETS.find((n) => c.window === compactionFor(n).window && c.percent === 100) ?? null;
}

/** The select value of a window × percent preset ("w600000x75"), null when `c` is not one. */
export function windowPresetValue(c: ClaudeCompaction | null): string | null {
  const hit = c && WINDOW_PRESETS.find((p) => p.window === c.window && p.percent === c.percent);
  return hit ? `w${hit.window}x${hit.percent}` : null;
}

/** The compaction a select value stands for: a compact-at preset ("500000"), a window × percent preset, else null. */
export function compactionOfValue(v: string): ClaudeCompaction | null {
  const wp = WINDOW_PRESETS.find((p) => windowPresetValue(p) === v);
  if (wp) return { ...wp };
  const n = Number(v);
  return COMPACT_AT_PRESETS.some((p) => p === n) ? compactionFor(n) : null;
}

export function compactionOf(raw: unknown): ClaudeCompaction | null {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== "object" || typeof r.window !== "number" || typeof r.percent !== "number") return null;
  const c = { window: r.window, percent: r.percent };
  return validCompaction(c) ? c : null;
}

export type CompactionModels = Record<string, ClaudeCompaction>;

export function compactionModelsOf(raw: unknown): CompactionModels | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: CompactionModels = {};
  for (const [id, v] of Object.entries(raw)) {
    const c = compactionOf(v);
    if (c) out[id] = c;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * The table with `ids` set to `value` (null = removed). An empty table is `null`, which cutex stores
 * as no file. Several ids at once cover a folded Claude row (alias + `[1m]` alias).
 */
export function withModelCompaction(table: CompactionModels | null, ids: readonly string[], value: ClaudeCompaction | null): CompactionModels | null {
  const next: CompactionModels = { ...table };
  for (const id of ids) {
    if (value) next[id] = value;
    else delete next[id];
  }
  return Object.keys(next).length ? next : null;
}
