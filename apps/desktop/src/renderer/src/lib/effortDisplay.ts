// Reasoning effort as shown (owner 2026-11-20, docs/design/024-model-list.md 三): an explicit level (低 / 中 / 高 …),
// never 「默认」. Without a reliable value, or on a model without levels, 「—」 with the tooltip 未上报 / 不支持.
// Context / compaction 「默认（约 X）」 labels are not affected. The host's wire fields are read in
// shared/modelResolution; this file only decides what is shown.
import type { MessageKey } from "../i18n";
import { readReasoningResolution, type ReasoningResolution, type SkippedChoice } from "../../../shared/modelResolution";

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

export type EffortNone = "unreported" | "unsupported";

export interface EffortShown {
  /** The level shown; null = 「—」. */
  level: string | null;
  /** Why there is no level (null when there is one). */
  none: EffortNone | null;
  /** Saved choices the host passed over as unsupported by the model (hover / settings hint). */
  skipped: readonly SkippedChoice[];
}

export const levelShown = (level: string, skipped: readonly SkippedChoice[] = []): EffortShown => ({ level, none: null, skipped });
export const noneShown = (none: EffortNone, skipped: readonly SkippedChoice[] = []): EffortShown => ({ level: null, none, skipped });

/** A host resolution as shown: its level, else 不支持 / 未上报. A missing block (older host) is 未上报. */
export function resolutionShown(r: ReasoningResolution | null | undefined): EffortShown {
  if (!r) return noneShown("unreported");
  if (r.value && r.source !== "unsupported" && r.source !== "unreported") return levelShown(r.value, r.skipped);
  return noneShown(r.source === "unsupported" ? "unsupported" : "unreported", r.skipped);
}

/** Claude reports "none" for 「Claude Code's own default」: not a level it names, so never shown as one. */
export const explicitLevel = (level: string | null | undefined, claude: boolean): string | null =>
  level && level.trim() && !(claude && level === "none") ? level : null;

/** A level in the app language (models add new ones, e.g. "ultra": the raw id then). */
export function effortName(t: T, level: string): string {
  const key = `composer.effort.${level}` as MessageKey;
  const text = t(key);
  return text === key ? level : text;
}

/** The chip / value text: the level, or 「—」. */
export const effortText = (t: T, shown: EffortShown): string => (shown.level ? effortName(t, shown.level) : "—");

/** One line per saved choice the model cannot use: 「Profile 设的「超高」对这个模型不可用，已跳过」. */
export const skippedLines = (t: T, skipped: readonly SkippedChoice[]): string[] =>
  skipped.map((s) => t(s.source === "model" ? "effortLabel.skippedModel" : "effortLabel.skippedProfile", { effort: effortName(t, s.value) }));

/** The hover text: why 「—」, and any saved choices the host skipped. */
export function effortTip(t: T, shown: EffortShown): string | undefined {
  const lines = [
    shown.none ? t(shown.none === "unsupported" ? "effortLabel.unsupported" : "effortLabel.unreported") : null,
    ...skippedLines(t, shown.skipped),
  ].filter((x): x is string => !!x);
  return lines.length ? lines.join("\n") : undefined;
}

/** The 「不指定」 choice of a selector, with what applies then: 「不指定（中）」 / 「不指定（未上报）」. */
export function unsetChoice(t: T, shown: EffortShown | null): string {
  if (!shown) return t("effortLabel.unsetBare");
  return t("effortLabel.unset", { effort: shown.level ? effortName(t, shown.level) : t(shown.none === "unsupported" ? "effortLabel.unsupportedShort" : "effortLabel.unreportedShort") });
}

/** A Profile catalog row's resolution (`reasoningEffort`); null on an older host. */
export const rowResolution = (row: { reasoningEffort?: unknown } | null | undefined): ReasoningResolution | null => readReasoningResolution(row?.reasoningEffort);

/**
 * A new agent / chat with no level picked: the host's resolution for that Profile row when it gives one (owner
 * per-model → Profile → runtime default, contract order), else the level the client worked out the old way (an
 * older host, a DSH / Kimi variant), else 「—」 (不支持 when the row says it has no levels).
 */
export function launchEffortShown(picked: string | null | undefined, row: { reasoningEffort?: unknown; supportedReasoningEfforts?: readonly string[]; effortSupportKnown?: boolean } | null | undefined, computed: string | null | undefined, claude: boolean): EffortShown {
  const own = explicitLevel(picked, claude);
  if (own) return levelShown(own);
  const r = rowResolution(row);
  if (r) return resolutionShown(r);
  // A row that says it has no levels (a trusted empty list): 不支持 before any locally computed level.
  if (row && row.effortSupportKnown === true && !row.supportedReasoningEfforts?.length) return noneShown("unsupported");
  const fallback = explicitLevel(computed, claude);
  return fallback ? levelShown(fallback) : noneShown("unreported");
}

/**
 * What the Profile effort selector's 「不指定」 runs with for the selected model. A model known to offer no levels (the
 * host's `unsupported`, or a trusted empty list) is 不支持 whatever is saved (cross-review 8addfc85e #2). The host's
 * resolution (when the Profile sets none) already applies the owner's per-model level and skips what the model cannot
 * use — a skipped 超高 resolving to 高 shows 高 (cross-review 0ef2e1044 #4). Otherwise: the owner's per-model level
 * if the model offers it and the host did not skip it, the catalog's level, else 未上报.
 */
export function profileUnsetShown(
  row: { reasoningEffort?: unknown; modelReasoningEffort?: string | null; defaultReasoningEffort?: string | null; effortSupportKnown?: boolean } | null | undefined,
  storedEffort: string | null, levels: readonly string[], claude: boolean,
): EffortShown {
  const r = rowResolution(row);
  if (r?.source === "unsupported" || (row?.effortSupportKnown === true && !levels.length)) return noneShown("unsupported", r?.skipped ?? []);
  if (!storedEffort && r) return resolutionShown(r);
  const skippedOwn = r?.skipped.some((s) => s.source === "model" && s.value === row?.modelReasoningEffort);
  const own = row?.modelReasoningEffort && !skippedOwn && (!levels.length || levels.includes(row.modelReasoningEffort)) ? row.modelReasoningEffort : null;
  if (own) return levelShown(own);
  const catalog = explicitLevel(row?.defaultReasoningEffort, claude);
  return catalog ? levelShown(catalog) : noneShown("unreported");
}
