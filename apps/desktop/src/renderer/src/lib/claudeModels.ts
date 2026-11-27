// One entry per real Claude model (docs/design/024-model-list.md). The Claude runtime lists every id
// Claude Code accepts: family aliases (`opus`, `sonnet`, …) that follow the newest model, their `[1m]`
// forms, fixed ids (`claude-opus-5-5`, dated `claude-haiku-4-5-20251001`), and the modes `best`,
// `opusplan` and `default`. Shown as is, the newest model appears two or three times.
//
// Folding (pure; works on the session `model/list` and on the profile catalog alike, from ids alone):
// - each family keeps ONE row, and that row selects the alias (it keeps following the newest model, as Claude Code
//   does): label 「Opus 5.5」 — family + version, no 「最新」 / 「(alias)」 (owner 2026-11-23). The version: the SDK
//   handshake's display version (shared/modelResolution), else the catalog name of the model that last answered
//   (`observedVersion`, set by the composer), else none (「Opus」) — never the catalog's newest version. Menus mark
//   alias rows with the 「跟随最新」 tag (`tag`), so an alias and its fixed model of the same version stay apart;
// - the alias's `[1m]` form folds into that row (the current models already have a 1M window), unless it is the
//   current selection. The alias's target (the reported resolution, else the newest fixed id of the family) does NOT
//   fold: it stays a fixed row under 「更多」 so the current generation can be pinned (owner 2026-11-28; it was
//   folded away before, leaving only older fixed versions); the alias row records it as `follows`;
// - older fixed models, `[1m]` forms of fixed ids (labelled with their window), the modes and unknown
//   ids follow, in that order. The current selection is never folded away.

import { aliasResolutionOf, type AliasFields } from "../../../shared/modelResolution";

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
  /** Other ids this row stands for (an alias's `[1m]` form). */
  folded: string[];
  /** An alias row: the fixed id it currently resolves to in this list (its own row under 「更多」), for settings that
   *  read the same model's window / per-model values. */
  follows?: string | null;
  /** false: below the newest model of each family (the picker's 「更多」). */
  primary: boolean;
  /** A family alias (`opus`, `opus[1m]`): `name` is the family; `version` from the handshake, else the last answer. */
  alias?: { version: string | null };
}

/** The alias fields of a list item (model/list option, catalog row); strings carry none. */
const defaultFields = (item: unknown): AliasFields | null => (item && typeof item === "object" ? (item as AliasFields) : null);

/** Whether a model list is Claude's (aliases or fixed claude-* ids). */
export function looksClaude(ids: readonly string[]): boolean {
  return ids.some((id) => claudeIdInfo(id).kind === "alias" || claudeIdInfo(id).kind === "pinned");
}

export function foldClaudeModels<T>(items: readonly T[], idOf: (item: T) => string, nameOf: (item: T) => string | null | undefined, current: string | null, fieldsOf: (item: T) => AliasFields | null | undefined = defaultFields): FoldedModel<T>[] {
  const infos = items.map((item) => ({ item, id: idOf(item), info: claudeIdInfo(idOf(item)) }));
  const resolutionOf = (x: (typeof infos)[number] | undefined) => (x ? aliasResolutionOf(fieldsOf(x.item)) : null);
  // The version an alias row shows: the handshake's display version, else the last answer's catalog version.
  const versionOf = (x: (typeof infos)[number] | undefined) => (x ? (resolutionOf(x)?.version ?? observedVersionOfItem(x.item)) : null);
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
    if (!alias) continue;
    const resolved = resolutionOf(alias);
    // What the alias stands for in this list: the reported target when listed, else the family's newest fixed id.
    const target = (resolved && infos.find((x) => x.id.toLowerCase() === resolved.resolvedModel.toLowerCase() && x.info.kind === "pinned")) || newest.get(family);
    const folded: string[] = [];
    const oneM = infos.find((x) => x.info.kind === "alias" && x.info.family === family && x.info.oneM);
    if (oneM && !isCurrent(oneM.id)) {
      folded.push(oneM.id);
      used.add(oneM.id);
    }
    used.add(alias.id);
    out.push({ item: alias.item, name: cap(family), tag: "latest", folded, follows: target?.id ?? null, primary: true, alias: { version: versionOf(alias) } });
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
    if (x.info.kind === "alias") {
      const plain = infos.find((y) => y.info.kind === "alias" && y.info.family === x.info.family && !y.info.oneM);
      out.push({ item: x.item, name: cap(x.info.family!), tag: x.info.oneM ? "oneM" : "latest", folded: [], primary: false, alias: { version: versionOf(x) ?? versionOf(plain) } });
      continue;
    }
    out.push({ item: x.item, name: pinnedName(x.id.replace(/\[1m\]$/i, ""), x.info.oneM ? null : nameOf(x.item)), tag: x.info.oneM ? "oneM" : null, folded: [], primary: false });
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

/** An alias label: 「Opus 5.5」, or 「Opus」 without a version (owner 2026-11-23; the same in every language). */
export const aliasLabel = (family: string, version: string | null | undefined): string => (version ? `${family} ${version}` : family);

/** The row's name (modes get theirs here) and its one-line explanation. */
export function presentClaudeRow<I>(row: FoldedModel<I>, t: T): { name: string; description: string } {
  const name = row.alias ? aliasLabel(row.name, row.alias.version) : row.name;
  switch (row.tag) {
    case "latest":
      // No alias explanation line (owner 2026-11-18).
      return { name, description: "" };
    case "oneM":
      return { name: t("claudeModels.oneMName", { model: name }), description: t("claudeModels.oneM") };
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

/** A Claude model list as picker items: folded, ordered, named; `primary` rows first; alias rows tagged 「跟随最新」. */
export function claudePickerItems<I extends { model: string; displayName: string; description?: string }>(models: readonly I[], current: string | null, t: T): (I & { primary: boolean; tag?: string })[] {
  return foldClaudeModels(models, (m) => m.model, (m) => m.displayName, current).map((row) => {
    const shown = presentClaudeRow(row, t);
    return { ...row.item, displayName: shown.name, description: shown.description, primary: row.primary, ...(row.alias ? { tag: t("claudeModels.latestTag") } : {}) };
  });
}

/** Short name for `id` within a Claude list (the composer chip): 「Sonnet 5.5」 for `sonnet` with a handshake or
 *  last-answer version in the item's fields, else 「Sonnet」. */
export function claudeShortName(ids: readonly ({ id: string; displayName?: string | null; observedVersion?: string | null } & AliasFields)[], id: string | null, t: T): string | null {
  if (!id) return null;
  const rows = foldClaudeModels(ids.some((x) => x.id === id) ? ids : [...ids, { id, displayName: null }], (x) => x.id, (x) => x.displayName, id);
  const row = foldedRowFor(rows, (x) => x.id, id);
  return row ? presentClaudeRow(row, t).name : null;
}

/** A profile catalog (`GET /v2/profiles/{p}/models`) is Claude's. */
export function isClaudeCatalog(view: { modelsSource?: { kind?: string | null } | null } | null | undefined): boolean {
  return !!view?.modelsSource?.kind?.startsWith("claude");
}

/** Catalog rows as folded choices in display order. `tag`: 「跟随最新」 on alias rows (for menus). `option`: the text
 *  for a plain select — the name, with 「 · 跟随最新」 only where an alias and a fixed model would read the same. */
export function claudeCatalogChoices(models: readonly ({ id: string; displayName?: string | null } & AliasFields)[], current: string | null, t: T): { id: string; name: string; description: string; primary: boolean; tag?: string; option: string }[] {
  const rows = foldClaudeModels(models, (m) => m.id, (m) => m.displayName, current).map((row) => ({ id: row.item.id, ...presentClaudeRow(row, t), primary: row.primary, ...(row.alias ? { tag: t("claudeModels.latestTag") } : {}) }));
  return rows.map((r) => ({ ...r, option: r.tag && rows.some((o) => o !== r && !o.tag && o.name === r.name) ? `${r.name} · ${r.tag}` : r.name }));
}

/** Every alias item of a list (`opus`, `opus[1m]`) by the alias rule, whether or not folding keeps it as a row of
 *  its own (menus that list the raw items): the family label with the item's handshake / last-answer version — a
 *  `[1m]` alias without one takes its plain alias's (as `foldClaudeModels`). `oneM`: the caller wraps the name. */
export function claudeAliasLabels<I>(items: readonly I[], idOf: (item: I) => string, fieldsOf: (item: I) => AliasFields | null | undefined = defaultFields): Map<string, { name: string; oneM: boolean }> {
  const versionOf = (item: I | undefined) => (item === undefined ? null : (aliasResolutionOf(fieldsOf(item))?.version ?? observedVersionOfItem(item)));
  const out = new Map<string, { name: string; oneM: boolean }>();
  for (const item of items) {
    const info = claudeIdInfo(idOf(item));
    if (info.kind !== "alias") continue;
    const plain = info.oneM ? items.find((y) => { const x = claudeIdInfo(idOf(y)); return x.kind === "alias" && x.family === info.family && !x.oneM; }) : undefined;
    out.set(idOf(item), { name: aliasLabel(cap(info.family!), versionOf(item) ?? versionOf(plain)), oneM: info.oneM });
  }
  return out;
}

/** The name of a Claude family alias (or the best / opusplan mode) known only by id — no list row with its handshake
 *  at hand: the family alone (「Opus」; never a version borrowed from elsewhere). null for any other id. */
export function claudeAliasName(id: string, t: T): string | null {
  const info = claudeIdInfo(id);
  if (info.kind === "alias") {
    const name = cap(info.family!);
    return info.oneM ? t("claudeModels.oneMName", { model: name }) : name;
  }
  if (info.mode === "best") return t("claudeModels.best");
  if (info.mode === "opusplan") return t("claudeModels.opusplan");
  return null;
}

/** The last-answer version a list item carries (`observedVersion`, composer only). */
function observedVersionOfItem(item: unknown): string | null {
  const v = item && typeof item === "object" ? (item as { observedVersion?: unknown }).observedVersion : null;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** The catalog row of a fixed model id (same family and version; a date suffix or `[1m]` does not matter). */
export function catalogRowFor<R extends { id: string }>(rows: readonly R[], id: string | null | undefined): R | undefined {
  if (!id) return undefined;
  const exact = rows.find((r) => r.id === id);
  if (exact) return exact;
  const info = claudeIdInfo(id);
  if (info.kind !== "pinned") return undefined;
  const same = (r: R) => { const x = claudeIdInfo(r.id); return x.kind === "pinned" && x.family === info.family && cmp(x.version!, info.version!) === 0; };
  return rows.find((r) => same(r) && !claudeIdInfo(r.id).oneM) ?? rows.find(same);
}

/**
 * The version an alias of `family` shows from the model that last answered (`lastObservedModel`): that model's catalog
 * name without the family word (「Opus 5.5」 → 「5.5」). Null when it is another family, not a fixed model, or has no
 * catalog name — the raw id is never shown.
 */
export function observedVersionFor(observed: string | null | undefined, family: string | null | undefined, rows: readonly { id: string; displayName?: string | null }[]): string | null {
  if (!observed || !family) return null;
  const info = claudeIdInfo(observed);
  if (info.kind !== "pinned" || info.family !== family.toLowerCase()) return null;
  const name = catalogRowFor(rows, observed)?.displayName?.replace(/\s*\(alias\)\s*$/i, "").replace(/\s*(?:\(1M\)|·\s*1M\b.*|\b1M)\s*$/i, "").trim();
  if (!name || !name.toLowerCase().startsWith(`${family.toLowerCase()} `)) return null;
  return name.slice(family.length).trim() || null;
}
