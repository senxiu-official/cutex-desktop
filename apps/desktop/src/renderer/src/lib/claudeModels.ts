// One entry per real Claude model (docs/design/024-model-list.md). The Claude runtime lists every id
// Claude Code accepts: family aliases (`opus`, `sonnet`, …) that follow the newest model, their `[1m]`
// forms, fixed ids (`claude-opus-5-5`, dated `claude-haiku-4-5-20251001`), and the modes `best`,
// `opusplan` and `default`. Shown as is, the newest model appears two or three times.
//
// Folding (pure; works on the session `model/list` and on the profile catalog alike, from ids alone):
// - each family keeps ONE row for its newest model, and that row selects the alias (it keeps following
//   the newest model, as Claude Code does): label = the newest fixed model's name + 「跟随最新」;
// - the newest fixed id of the family and the alias's `[1m]` form fold into that row (the current
//   models already have a 1M window), unless one of them is the current selection;
// - older fixed models, `[1m]` forms of fixed ids (labelled with their window), the modes and unknown
//   ids follow, in that order. The current selection is never folded away.

export type ClaudeFamily = "opus" | "sonnet" | "fable" | "haiku";
const FAMILIES: readonly ClaudeFamily[] = ["opus", "sonnet", "fable", "haiku"];
const MODES = ["best", "opusplan", "default"] as const;
export type ClaudeMode = (typeof MODES)[number];

export interface ClaudeIdInfo {
  kind: "alias" | "pinned" | "mode" | "other";
  family: ClaudeFamily | null;
  /** `[1m]` suffix. */
  oneM: boolean;
  /** Pinned: [major, minor] (minor 0 when absent). */
  version: [number, number] | null;
  mode: ClaudeMode | null;
}

const PINNED = /^claude-(opus|sonnet|fable|haiku)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/i;

export function claudeIdInfo(id: string): ClaudeIdInfo {
  const oneM = /\[1m\]$/i.test(id);
  const base = id.replace(/\[1m\]$/i, "").trim().toLowerCase();
  if ((FAMILIES as readonly string[]).includes(base)) return { kind: "alias", family: base as ClaudeFamily, oneM, version: null, mode: null };
  if ((MODES as readonly string[]).includes(base) && !oneM) return { kind: "mode", family: null, oneM, version: null, mode: base as ClaudeMode };
  const m = PINNED.exec(base);
  if (m) return { kind: "pinned", family: m[1]!.toLowerCase() as ClaudeFamily, oneM, version: [Number(m[2]), m[3] ? Number(m[3]) : 0], mode: null };
  return { kind: "other", family: null, oneM, version: null, mode: null };
}

const cmp = (a: [number, number], b: [number, number]) => a[0] - b[0] || a[1] - b[1];
const cap = (f: string) => f.charAt(0).toUpperCase() + f.slice(1);

/** "Opus 5.5" from a pinned id (the catalog name when given). */
export function pinnedName(id: string, displayName?: string | null): string {
  const clean = displayName?.replace(/\s*\(alias\)\s*$/i, "").trim();
  if (clean && clean !== id) return clean;
  const info = claudeIdInfo(id);
  if (info.kind !== "pinned" || !info.version) return id;
  return `${cap(info.family!)} ${info.version[1] ? `${info.version[0]}.${info.version[1]}` : info.version[0]}`;
}

export type FoldedLabelKey = "latest" | "oneM" | "mode.best" | "mode.opusplan" | "mode.default";

export interface FoldedModel<T> {
  item: T;
  /** The shown name (no 「(alias)」). */
  name: string;
  /** What the extra tag says, if anything (translated by the caller). */
  tag: FoldedLabelKey | null;
  /** Other ids this row stands for (its alias target, `[1m]` form). */
  folded: string[];
  /** false: below the newest model of each family (the picker's 「更多」). */
  primary: boolean;
}

/** Whether a model list is Claude's (aliases or fixed claude-* ids). */
export function looksClaude(ids: readonly string[]): boolean {
  return ids.some((id) => claudeIdInfo(id).kind === "alias" || claudeIdInfo(id).kind === "pinned");
}

export function foldClaudeModels<T>(items: readonly T[], idOf: (item: T) => string, nameOf: (item: T) => string | null | undefined, current: string | null): FoldedModel<T>[] {
  const infos = items.map((item) => ({ item, id: idOf(item), info: claudeIdInfo(idOf(item)) }));
  // Newest fixed (non-[1m]) model per family.
  const newest = new Map<ClaudeFamily, (typeof infos)[number]>();
  for (const x of infos) {
    if (x.info.kind !== "pinned" || x.info.oneM) continue;
    const prev = newest.get(x.info.family!);
    if (!prev || cmp(x.info.version!, prev.info.version!) > 0) newest.set(x.info.family!, x);
  }
  const has = (id: string) => infos.some((x) => x.id.toLowerCase() === id);
  const used = new Set<string>();
  const out: FoldedModel<T>[] = [];
  const isCurrent = (id: string) => !!current && id === current;
  // 1. One row per family: the alias, named after its newest model.
  for (const family of FAMILIES) {
    const alias = infos.find((x) => x.info.kind === "alias" && x.info.family === family && !x.info.oneM);
    const target = newest.get(family);
    if (!alias) continue;
    const folded: string[] = [];
    if (target && !isCurrent(target.id)) {
      folded.push(target.id);
      used.add(target.id);
    }
    const oneM = infos.find((x) => x.info.kind === "alias" && x.info.family === family && x.info.oneM);
    if (oneM && !isCurrent(oneM.id)) {
      folded.push(oneM.id);
      used.add(oneM.id);
    }
    used.add(alias.id);
    out.push({ item: alias.item, name: target ? pinnedName(target.id, nameOf(target.item)) : cap(family), tag: "latest", folded, primary: true });
  }
  // A family with only fixed ids: its newest one is primary.
  for (const family of FAMILIES) {
    const target = newest.get(family);
    if (!target || used.has(target.id) || has(family)) continue;
    used.add(target.id);
    out.push({ item: target.item, name: pinnedName(target.id, nameOf(target.item)), tag: null, folded: [], primary: true });
  }
  // 2. Older fixed models (newest first within a family), `[1m]` forms labelled with their window.
  const rest = infos.filter((x) => !used.has(x.id));
  const pinnedRest = rest
    .filter((x) => x.info.kind === "pinned" || (x.info.kind === "alias" && x.info.oneM))
    .sort((a, b) => FAMILIES.indexOf(a.info.family!) - FAMILIES.indexOf(b.info.family!) || (b.info.version && a.info.version ? cmp(b.info.version, a.info.version) : a.info.version ? 1 : -1) || Number(a.info.oneM) - Number(b.info.oneM));
  for (const x of pinnedRest) {
    used.add(x.id);
    const base = x.info.kind === "alias" ? (newest.get(x.info.family!) ? pinnedName(newest.get(x.info.family!)!.id, nameOf(newest.get(x.info.family!)!.item)) : cap(x.info.family!)) : pinnedName(x.id.replace(/\[1m\]$/i, ""), x.info.oneM ? null : nameOf(x.item));
    out.push({ item: x.item, name: base, tag: x.info.oneM ? "oneM" : x.info.kind === "alias" ? "latest" : null, folded: [], primary: false });
  }
  // 3. Modes, then anything else (custom / SDK-only ids keep their own names).
  for (const mode of MODES) {
    const x = rest.find((r) => r.info.mode === mode && !used.has(r.id));
    if (!x) continue;
    used.add(x.id);
    out.push({ item: x.item, name: "", tag: `mode.${mode}`, folded: [], primary: false });
  }
  for (const x of rest) {
    if (used.has(x.id)) continue;
    used.add(x.id);
    out.push({ item: x.item, name: nameOf(x.item)?.replace(/\s*\(alias\)\s*$/i, "").trim() || x.id, tag: null, folded: [], primary: false });
  }
  // The current selection first among primaries when it is not one (so it is never hidden in 「更多」).
  const at = current ? out.findIndex((r) => idOf(r.item) === current) : -1;
  if (at > 0 && !out[at]!.primary) {
    const [row] = out.splice(at, 1);
    const lastPrimary = out.reduce((n, r, i) => (r.primary ? i + 1 : n), 0);
    out.splice(lastPrimary, 0, { ...row!, primary: true });
  }
  return out;
}

/** The row standing for `id` (itself, or the row it folded into). */
export function foldedRowFor<T>(rows: readonly FoldedModel<T>[], idOf: (item: T) => string, id: string | null): FoldedModel<T> | undefined {
  if (!id) return undefined;
  return rows.find((r) => idOf(r.item) === id) ?? rows.find((r) => r.folded.includes(id));
}

type T = (key: import("../i18n").MessageKey, vars?: Record<string, string | number>) => string;

/** The row's name (modes get theirs here) and its one-line explanation. */
export function presentClaudeRow<I>(row: FoldedModel<I>, t: T): { name: string; description: string } {
  const family = (name: string) => name.replace(/\s+[\d.]+$/, "");
  switch (row.tag) {
    case "latest":
      return { name: row.name, description: t("claudeModels.latest", { family: family(row.name), model: row.name }) };
    case "oneM":
      return { name: t("claudeModels.oneMName", { model: row.name }), description: t("claudeModels.oneM") };
    case "mode.best":
      return { name: t("claudeModels.best"), description: t("claudeModels.bestHint") };
    case "mode.opusplan":
      return { name: t("claudeModels.opusplan"), description: t("claudeModels.opusplanHint") };
    case "mode.default":
      return { name: t("claudeModels.default"), description: t("claudeModels.defaultHint") };
    default:
      return { name: row.name, description: "" };
  }
}

/** A Claude model list as picker items: folded, ordered, named; `primary` rows first. */
export function claudePickerItems<I extends { model: string; displayName: string; description?: string }>(models: readonly I[], current: string | null, t: T): (I & { primary: boolean })[] {
  return foldClaudeModels(models, (m) => m.model, (m) => m.displayName, current).map((row) => {
    const shown = presentClaudeRow(row, t);
    return { ...row.item, displayName: shown.name, description: shown.description, primary: row.primary };
  });
}

/** Short name for `id` within a Claude list (the composer chip): "Sonnet 5.5" for `sonnet`. */
export function claudeShortName(ids: readonly { id: string; displayName?: string | null }[], id: string | null, t: T): string | null {
  if (!id) return null;
  const rows = foldClaudeModels(ids.some((x) => x.id === id) ? ids : [...ids, { id, displayName: null }], (x) => x.id, (x) => x.displayName, id);
  const row = foldedRowFor(rows, (x) => x.id, id);
  return row ? presentClaudeRow(row, t).name : null;
}

/** A profile catalog (`GET /v2/profiles/{p}/models`) is Claude's. */
export function isClaudeCatalog(view: { modelsSource?: { kind?: string | null } | null } | null | undefined): boolean {
  return !!view?.modelsSource?.kind?.startsWith("claude");
}

/** Catalog rows as folded choices: `{id, name, description, primary}` in display order. */
export function claudeCatalogChoices(models: readonly { id: string; displayName?: string | null }[], current: string | null, t: T): { id: string; name: string; description: string; primary: boolean }[] {
  return foldClaudeModels(models, (m) => m.id, (m) => m.displayName, current).map((row) => ({ id: row.item.id, ...presentClaudeRow(row, t), primary: row.primary }));
}
