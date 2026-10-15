// Model display names (owner 2026-10-11): per profile, per model entry. Each profile keeps its own
// name for each of its models in cutex (`profile-model-display-names`: profile items
// `modelDisplayNames`, edited in Settings → Profiles → 模型). Display only — what is sent to cutex,
// stored in a profile, typed into an input or used as a select value stays the raw id.
//
// Resolution: the profile's entry name → the catalog display name → a catalog display name seen
// before for that id (any model list or catalog loaded so far) → the raw id. Callers pass the
// profile (id or name) whenever they know it; without one only the catalog name / id apply. The raw
// id is for tooltips only (`rawIdTitle`; UI review #16: one name per model everywhere).
// The global rule list (Settings → 通用 → 模型显示名, localStorage) is gone.
import { useEffect, useSyncExternalStore } from "react";
import type { ProfileItem } from "../../../shared/ipc";
import { onHostSwitch } from "./hostSwitch";

type NamedProfile = Pick<ProfileItem, "id" | "name" | "modelDisplayNames">;

/** profile id and name → (model id → entry name). */
let names = new Map<string, Readonly<Record<string, string>>>();
/** model id → a catalog display name seen for it ("DeepSeek V4 Flash"). */
let catalogNames = new Map<string, string>();
let version = 0;
let emitQueued = false;
let requested = false;
const listeners = new Set<() => void>();

function emit(): void {
  version++;
  for (const l of listeners) l();
}

/** Deferred: catalog names are also noted while rendering (`modelLabel`), never emit from there. */
function emitSoon(): void {
  if (emitQueued) return;
  emitQueued = true;
  queueMicrotask(() => {
    emitQueued = false;
    emit();
  });
}

/**
 * Remember catalog display names (session model lists, profile catalogs), so a caller that only has
 * the id shows the same name as the composer's model picker.
 */
export function noteCatalogNames(entries: Iterable<{ id: string | null | undefined; displayName?: string | null }>): void {
  let changed = false;
  for (const e of entries) {
    const id = e.id?.trim();
    const name = e.displayName?.trim();
    if (!id || !name || name === id || catalogNames.get(id) === name) continue;
    catalogNames.set(id, name);
    changed = true;
  }
  if (changed) emitSoon();
}

/** Forget the remembered catalog names (host switch; tests). */
export function forgetCatalogNames(): void {
  catalogNames = new Map();
}

/** Replace all profiles' entry names (a fresh profile list). */
export function setProfileModelNames(profiles: readonly NamedProfile[]): void {
  const next = new Map<string, Readonly<Record<string, string>>>();
  for (const p of profiles) {
    const map = p.modelDisplayNames ?? {};
    next.set(p.id, map);
    next.set(p.name, map);
  }
  names = next;
  emit();
}

/** One profile changed (an edit in the profile page). */
export function updateProfileModelNames(profile: NamedProfile): void {
  const map = profile.modelDisplayNames ?? {};
  const next = new Map(names);
  // A rename leaves the old name behind; drop every key that pointed at this profile's old map.
  const old = names.get(profile.id);
  if (old) for (const [k, v] of names) if (v === old) next.delete(k);
  next.set(profile.id, map);
  next.set(profile.name, map);
  names = next;
  emit();
}

/** The profile's own name for a model entry, if it has one. */
export function entryName(profile: string | null | undefined, id: string | null | undefined): string | null {
  if (!profile || !id) return null;
  return names.get(profile)?.[id] ?? null;
}

/** The name to show: the entry name, else the catalog display name, else the id ("" when none). */
export function modelLabel(id: string | null | undefined, displayName: string | null | undefined, entry?: string | null): string {
  const catalog = displayName?.trim();
  if (id && catalog) noteCatalogNames([{ id, displayName: catalog }]);
  return entry?.trim() || catalog || (id ? catalogNames.get(id) : undefined) || id || "";
}

/** `label(id, catalogDisplayName?, profile?)`: the shown name of a model. */
export type ModelNameFn = (id: string | null | undefined, displayName?: string | null, profile?: string | null) => string;

/** Non-React callers (menus, string builders): the name with the current profile names. */
export const modelName: ModelNameFn = (id, displayName, profile) => modelLabel(id, displayName ?? null, entryName(profile, id));

let labelFn: { version: number; fn: ModelNameFn } = { version: -1, fn: modelName };
function snapshot(): ModelNameFn {
  // A new function identity per change, so memo deps of callers notice renames.
  if (labelFn.version !== version) labelFn = { version, fn: (id, displayName, profile) => modelName(id, displayName, profile) };
  return labelFn.fn;
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Loads the profile list (lib/profileSnapshot registers it; it feeds setProfileModelNames). */
let loader: (() => void) | null = null;
export function setProfileNamesLoader(load: () => void): void {
  loader = load;
}

onHostSwitch(() => {
  names = new Map();
  forgetCatalogNames();
  requested = false;
  emit();
});

/** The label function; the first use loads the profile list (cached afterwards). */
export function useModelName(): ModelNameFn {
  useEffect(() => {
    if (requested || !loader) return;
    requested = true;
    loader();
  }, []);
  return useSyncExternalStore(subscribe, snapshot);
}

/** Tooltip for a shown model name: the raw id when the shown text differs from it. */
export function rawIdTitle(id: string | null | undefined, shown: string): string | undefined {
  return id && shown !== id ? id : undefined;
}

/** A model control's tooltip: "模型 · <raw id>" when the shown name differs from the id, else the label. */
export function modelControlTitle(label: string, id: string | null | undefined, shown: string): string {
  return id && shown !== id ? `${label} · ${id}` : label;
}

/** Search helper: does `query` (already lower-cased) hit the raw id or the shown name? */
export function modelMatchesQuery(id: string | null | undefined, shown: string, query: string): boolean {
  if (!query) return true;
  return (!!id && id.toLowerCase().includes(query)) || shown.toLowerCase().includes(query);
}
