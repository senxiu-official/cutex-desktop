// Claude auto-compaction per profile (cutex `claude-compaction`, docs/design/036): the profile's
// `claudeCompaction {window, percent} | null`, stored by cutex in `profiles/<id>/claude-runtime.json`
// and passed to Claude Code at the next runtime start.

export const CLAUDE_COMPACTION_FEATURE = "claude-compaction";
/** Per-model table (docs/design/037): `claudeCompactionModels {"<model id>": {window, percent}} | null`. */
export const CLAUDE_COMPACTION_MODELS_FEATURE = "claude-compaction-models";
/** cutex accepts at most this many entries; the adapter matches ids exactly. */
export const MAX_COMPACTION_MODELS = 32;

/** `window` null / absent (cutex profile-model-context-v1): the model's / Claude Code's own window, only the percent. */
export interface ClaudeCompaction {
  window?: number | null;
  percent: number;
}

/** A value with a fixed compaction window. */
export type FixedCompaction = { window: number; percent: number };

export const WINDOW_MIN = 100_000;
export const WINDOW_MAX = 1_000_000;
/** Claude Code reserves min(max output, 20000) for the reply and compacts 13000 below that. */
const OUTPUT_RESERVE = 20_000;
const MARGIN = 13_000;

export function validCompaction(c: ClaudeCompaction): boolean {
  const windowOk = c.window == null || (Number.isInteger(c.window) && c.window >= WINDOW_MIN && c.window <= WINDOW_MAX);
  return windowOk && Number.isInteger(c.percent) && c.percent >= 1 && c.percent <= 100;
}

/** Same stored value (an absent window is the same as null). */
export function sameCompaction(a: ClaudeCompaction | null | undefined, b: ClaudeCompaction | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return (a.window ?? null) === (b.window ?? null) && a.percent === b.percent;
}

/**
 * Where Claude Code 2.1.301 compacts on a model whose context is at least `window`:
 * E = window − 20000; min(floor(E × percent / 100), E − 13000). A smaller model context caps `window`.
 */
export function compactAt(c: FixedCompaction, modelContext?: number | null): number {
  const w = modelContext ? Math.min(c.window, modelContext) : c.window;
  const e = w - OUTPUT_RESERVE;
  return Math.min(Math.floor((e * c.percent) / 100), e - MARGIN);
}

export function compactionOf(raw: unknown): ClaudeCompaction | null {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== "object" || typeof r.percent !== "number" || (r.window != null && typeof r.window !== "number")) return null;
  const c: ClaudeCompaction = { window: (r.window as number | null | undefined) ?? null, percent: r.percent };
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
