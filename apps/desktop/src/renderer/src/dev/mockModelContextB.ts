// Preview mock of cutex P13 owner decision B (docs/model-context-contract.md): `?mcb` (implies ?mcv1). Per field:
// preserved > owner > Profile > catalog built-in; rows carry contextSettings {catalog, owner, preserved} and the
// backend's resolved defaultValues; the models resource carries profileDefaultValues. Seeded: gamma's Profile
// 200K / 150K with gpt-5.5 owner 128K / 90K preserved at 200K / 150K, gpt-6-astra owner window only (window from the
// model, compaction from the Profile); relay is an API-key Profile with no catalog yet (the first model creates it).
// Only dev/mockBridge.ts imports this.
const QUERY = new URLSearchParams(typeof location === "undefined" ? "" : location.search);
export const MODEL_CONTEXT_B_SCENE = !QUERY.has("legacy") && QUERY.has("mcb");

type Values = { contextWindow?: number | null; autoCompactPercent?: number | null; autoCompactTokenLimit?: number | null };
type Config = Record<string, unknown>;
/** A mock catalog row: its flat numbers are the catalog built-ins; the owner / preserved layers ride along. */
export type BRow = { id: string; contextWindow: number | null; maxContextWindow: number | null; autoCompactTokenLimit: number | null; autoCompactPercent?: number | null; ctxOwner?: Values; ctxPreserved?: Values };

const n = (v: number | null | undefined) => (typeof v === "number" ? v : null);
type Compact = { percent: number } | { tokens: number } | null;
const compactOf = (v: Values | undefined): Compact => n(v?.autoCompactPercent) !== null ? { percent: v!.autoCompactPercent! } : n(v?.autoCompactTokenLimit) !== null ? { tokens: v!.autoCompactTokenLimit! } : null;

function resolve(row: BRow, config: Config, skip: { own?: boolean; profile?: boolean }) {
  const catalog: Values = { contextWindow: row.contextWindow, autoCompactTokenLimit: row.autoCompactTokenLimit, autoCompactPercent: row.autoCompactPercent ?? null };
  const pw = skip.profile ? null : n(config.modelContextWindow as number);
  const windows: [number | null, string][] = [[skip.own ? null : n(row.ctxPreserved?.contextWindow), "preserved"], [skip.own ? null : n(row.ctxOwner?.contextWindow), "model"], [pw, "profile"], [n(catalog.contextWindow), "catalog"]];
  const [rawWindow, wSource] = windows.find(([v]) => v !== null) ?? [null, "unknown"];
  const max = row.maxContextWindow ?? Infinity;
  const window = rawWindow !== null ? Math.min(rawWindow, max) : null;
  const pc: Compact = skip.profile ? null : n(config.modelAutoCompactPercent as number) !== null ? { percent: config.modelAutoCompactPercent as number } : n(config.modelAutoCompactTokenLimit as number) !== null ? { tokens: config.modelAutoCompactTokenLimit as number } : null;
  const compacts: [Compact, string][] = [[skip.own ? null : compactOf(row.ctxPreserved), "preserved"], [skip.own ? null : compactOf(row.ctxOwner), "model"], [pc, "profile"], [compactOf(catalog), "catalog"]];
  const [c, cSource] = compacts.find(([v]) => v !== null) ?? [null, "default90Percent"];
  const cap = window !== null ? Math.floor((window * 90) / 100) : null;
  const at = cap === null ? (c && "tokens" in c ? c.tokens : null) : !c ? cap : "percent" in c ? Math.min(Math.floor((window! * c.percent) / 100), cap) : Math.min(c.tokens, cap);
  return {
    contextWindow: window, contextWindowSource: wSource,
    autoCompactTokenLimit: at, autoCompactTokenLimitSource: cSource,
    autoCompactPercent: c && "percent" in c ? c.percent : null, autoCompactPercentSource: c && "percent" in c ? cSource : "unknown",
  };
}

/** A row's B fields: effective, contextSettings, defaultValues. */
export function bRowFields(row: BRow, config: Config) {
  return {
    effective: resolve(row, config, {}),
    contextSettings: {
      catalog: { contextWindow: row.contextWindow, autoCompactTokenLimit: row.autoCompactTokenLimit, autoCompactPercent: row.autoCompactPercent ?? null },
      owner: { ...row.ctxOwner }, preserved: { ...row.ctxPreserved },
    },
    defaultValues: { model: resolve(row, config, { own: true }), profile: resolve(row, config, { own: true, profile: true }) },
  };
}

/** The models resource's profileDefaultValues. An uncatalogued selected model: capacity unknown (never a guessed number). */
export function bProfileDefaults(rows: BRow[], config: Config, selectedModel: string | null) {
  const byModel = Object.fromEntries(rows.map((r) => [r.id, resolve(r, config, { own: true, profile: true })]));
  const selected = selectedModel ? (byModel[selectedModel] ?? { contextWindow: null, contextWindowSource: "unknown", autoCompactTokenLimit: 244_800, autoCompactTokenLimitSource: "runtimeDefault", autoCompactPercent: null, autoCompactPercentSource: "unknown" }) : null;
  return { selectedModel, selected, byModel };
}

/** A model PATCH: context fields set the owner layer and drop that category's preserved value; restore flags drop it
 *  only (refused together with an edit of the same field, like cutex). Returns the patch without the context keys. */
export function bApplyModelPatch(row: BRow, patch: Record<string, unknown>): Record<string, unknown> {
  const { contextWindow, autoCompactPercent, autoCompactTokenLimit, restorePreservedContextWindow, restorePreservedAutoCompaction, ...rest } = patch;
  const editsWindow = contextWindow !== undefined, editsCompact = autoCompactPercent !== undefined || autoCompactTokenLimit !== undefined;
  if (restorePreservedContextWindow && editsWindow) throw new Error("cannot restore and edit contextWindow together");
  if (restorePreservedAutoCompaction && editsCompact) throw new Error("cannot restore and edit compaction together");
  if (restorePreservedContextWindow || restorePreservedAutoCompaction) {
    if (Object.keys(rest).length || editsWindow || editsCompact) throw new Error("restore must be a separate model settings action");
    const kept = { ...row.ctxPreserved };
    if (restorePreservedContextWindow) delete kept.contextWindow;
    if (restorePreservedAutoCompaction) { delete kept.autoCompactPercent; delete kept.autoCompactTokenLimit; }
    row.ctxPreserved = kept;
    return {};
  }
  const owner = { ...row.ctxOwner }, kept = { ...row.ctxPreserved };
  if (editsWindow) { owner.contextWindow = contextWindow as number | null; delete kept.contextWindow; }
  if (editsCompact) {
    if (autoCompactPercent != null && autoCompactTokenLimit != null) throw new Error("invalid_request: autoCompactPercent and autoCompactTokenLimit are exclusive");
    owner.autoCompactPercent = (autoCompactPercent as number | null | undefined) ?? null;
    owner.autoCompactTokenLimit = (autoCompactTokenLimit as number | null | undefined) ?? null;
    delete kept.autoCompactPercent; delete kept.autoCompactTokenLimit;
  }
  row.ctxOwner = owner;
  row.ctxPreserved = kept;
  return rest;
}

/** Reset: owner and preserved layers go; the row inherits again. */
export function bReset(row: BRow): void {
  row.ctxOwner = {};
  row.ctxPreserved = {};
}

/** The seeded scene (mutates the mock profiles once at load). */
export function bSeed(profiles: Record<string, { config: Config; models: BRow[] }>): void {
  const gamma = profiles.gamma;
  if (gamma) {
    gamma.config.modelContextWindow = 200_000;
    gamma.config.modelAutoCompactTokenLimit = 150_000;
    const g55 = gamma.models.find((m) => m.id === "gpt-5.5");
    if (g55) { g55.ctxOwner = { contextWindow: 128_000, autoCompactTokenLimit: 90_000 }; g55.ctxPreserved = { contextWindow: 200_000, autoCompactTokenLimit: 150_000 }; }
    const astra = gamma.models.find((m) => m.id === "gpt-6-astra");
    if (astra) astra.ctxOwner = { contextWindow: 400_000 };
  }
  if (profiles.relay) profiles.relay.models = [];
}
