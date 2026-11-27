// Keyboard shortcut schemes (快捷键方案, owner 2026-11-26; like VS Code keybinding profiles / JetBrains keymaps):
// the built-in 默认 (read-only: copy it to edit) and the owner's schemes, each storing only its overrides over the
// built-in parent, so a command added later gets its default everywhere. Each device has an active scheme.
//
// A scheme binding is platform-neutral (`keys`, "Mod" = Ctrl / ⌘) with optional per-platform lists
// (`windows` / `linux` / `mac`) that win on that platform. Stored in localStorage `cutex.keybindingSchemes`; the
// old this-desktop overrides (`cutex.keybindings` v1) become the scheme 「我的快捷键」 once, made active, so
// nothing presses differently (the old key is left as it was).
//
// Sync (同步 page, lib/settingsSync on ui/settings-sync): `keybindingSyncFields` / `applyKeybindingSyncFields` are
// the category's read / write — one field per synced scheme (`scheme:<id>`, null = deleted) plus `active` once the
// owner switched on purpose (a migrated device never pushes its first choice over another's). A scheme marked
// 「不同步」 stays on this device: left out of read, untouched by write. The on/off switch is the sync engine's.
import { COMMANDS, commandDef, defaultBindings, isCommandId, keyPlatform, normaliseCombo, parseCombo, type CommandId, type KeyPlatform, KEY_PLATFORMS } from "./keybindingCore";

export const BUILTIN_SCHEME_ID = "default";
export const SCHEMES_STORAGE_KEY = "cutex.keybindingSchemes";
export const LEGACY_STORAGE_KEY = "cutex.keybindings";
export const MAX_SCHEMES = 20;
export const SCHEME_NAME_MAX = 40;
const MAX_KEYS = 4;
const MAX_TOMBSTONES = 50;

/** Overrides of one command: neutral `keys`, and per-platform lists that replace them there. */
export interface SchemeBinding {
  keys?: string[];
  windows?: string[];
  linux?: string[];
  mac?: string[];
}
export type BindingTarget = "keys" | KeyPlatform;

export interface KeyScheme {
  id: string;
  /** null: the migrated 「我的快捷键」 (shown in the current language until renamed). */
  name: string | null;
  /** The built-in it derives from (only 默认 today). */
  parent: typeof BUILTIN_SCHEME_ID;
  bindings: Partial<Record<CommandId, SchemeBinding>>;
  /** Synced to the owner's other devices (when sync is on). */
  sync: boolean;
  updatedAt: number;
}

export interface SchemeLibrary {
  v: 1;
  schemes: KeyScheme[];
  /** This device's active scheme (BUILTIN_SCHEME_ID = 默认). */
  active: string;
  /** `active` is offered to the other devices (set by a deliberate switch or by following one). */
  activeShared: boolean;
  /** The last `active` another device sent (followed once per change). */
  remoteActive?: string;
  /** Deleted synced schemes (id → when), sent as null so the other devices drop them too. */
  deleted: Record<string, number>;
}

export const emptyLibrary = (): SchemeLibrary => ({ v: 1, schemes: [], active: BUILTIN_SCHEME_ID, activeShared: false, deleted: {} });

// ── Parsing ──────────────────────────────────────────────────────────────────────────────────────

/** A list of combos for `id`: valid, digits-family when the command is, de-duplicated, at most four. */
function cleanList(id: CommandId, raw: unknown, p: KeyPlatform | null): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const digits = !!commandDef(id).digits;
  const out: string[] = [];
  for (const x of raw) {
    if (typeof x !== "string") continue;
    // Neutral keys keep their spelling (Ctrl stays a Mac's ⌃); a platform list is normalised for its platform.
    const norm = p ? normaliseCombo(x, p) : parseCombo(x, "windows") && parseCombo(x, "mac") ? x : null;
    if (norm && norm.endsWith("Digits") === digits && !out.includes(norm)) out.push(norm);
  }
  return out.slice(0, MAX_KEYS);
}

function readBindings(raw: unknown): Partial<Record<CommandId, SchemeBinding>> {
  const out: Partial<Record<CommandId, SchemeBinding>> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isCommandId(id) || !value || typeof value !== "object") continue;
    const v = value as Record<string, unknown>;
    const b: SchemeBinding = {};
    const keys = cleanList(id, v.keys, null);
    if (keys) b.keys = keys;
    for (const p of KEY_PLATFORMS) {
      const list = cleanList(id, v[p], p);
      if (list) b[p] = list;
    }
    if (Object.keys(b).length) out[id] = b;
  }
  return out;
}

export function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.replace(/\s+/g, " ").trim().slice(0, SCHEME_NAME_MAX);
  return name || null;
}

const SCHEME_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** One scheme as stored or synced (id given separately for sync fields); null when not one. */
export function readScheme(raw: unknown, id?: string): KeyScheme | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const sid = id ?? r.id;
  if (typeof sid !== "string" || !SCHEME_ID.test(sid) || sid === BUILTIN_SCHEME_ID) return null;
  return {
    id: sid,
    name: cleanName(r.name),
    parent: BUILTIN_SCHEME_ID,
    bindings: readBindings(r.bindings),
    sync: r.sync !== false,
    updatedAt: typeof r.updatedAt === "number" && Number.isFinite(r.updatedAt) ? r.updatedAt : 0,
  };
}

export function readLibrary(raw: unknown): SchemeLibrary | null {
  if (!raw || typeof raw !== "object" || (raw as { v?: unknown }).v !== 1) return null;
  const r = raw as Record<string, unknown>;
  const schemes: KeyScheme[] = [];
  for (const s of Array.isArray(r.schemes) ? r.schemes : []) {
    const scheme = readScheme(s);
    if (scheme && !schemes.some((x) => x.id === scheme.id)) schemes.push(scheme);
  }
  const active = typeof r.active === "string" && schemes.some((s) => s.id === r.active) ? r.active : BUILTIN_SCHEME_ID;
  const deleted: Record<string, number> = {};
  if (r.deleted && typeof r.deleted === "object")
    for (const [id, t] of Object.entries(r.deleted as Record<string, unknown>)) if (SCHEME_ID.test(id) && typeof t === "number") deleted[id] = t;
  return { v: 1, schemes: schemes.slice(0, MAX_SCHEMES), active, activeShared: r.activeShared === true, ...(typeof r.remoteActive === "string" && { remoteActive: r.remoteActive }), deleted };
}

/** The old this-desktop overrides (`cutex.keybindings` v1): unknown commands and malformed combos dropped; `[]` = no key. */
export function parseOverrides(raw: unknown): Partial<Record<CommandId, string[]>> {
  const src = raw && typeof raw === "object" && (raw as { v?: unknown }).v === 1 ? (raw as { bindings?: unknown }).bindings : null;
  if (!src || typeof src !== "object") return {};
  const out: Partial<Record<CommandId, string[]>> = {};
  for (const [id, list] of Object.entries(src as Record<string, unknown>)) {
    if (!isCommandId(id) || !Array.isArray(list)) continue;
    out[id] = cleanList(id, list, keyPlatform()) ?? [];
  }
  return out;
}

/**
 * The library a device without schemes starts from: its old overrides as 「我的快捷键」 (active), else just 默认.
 * A command whose default differs on macOS keeps its old key for this platform only (the neutral spelling would
 * change the Mac's).
 */
export function migrateLegacy(legacy: Partial<Record<CommandId, string[]>>, id: string, now: number, p: KeyPlatform = keyPlatform()): SchemeLibrary {
  const lib = emptyLibrary();
  const entries = Object.entries(legacy) as [CommandId, string[]][];
  if (!entries.length) return lib;
  const bindings: Partial<Record<CommandId, SchemeBinding>> = {};
  for (const [cmd, list] of entries) bindings[cmd] = commandDef(cmd).mac ? { [p]: list } : { keys: list };
  lib.schemes.push({ id, name: null, parent: BUILTIN_SCHEME_ID, bindings, sync: true, updatedAt: now });
  lib.active = id;
  return lib;
}

// ── Resolving ────────────────────────────────────────────────────────────────────────────────────

/** Which list of `binding` holds on `p` (its own list, else the neutral one); null = the parent's default. */
export function bindingSource(binding: SchemeBinding | undefined, p: KeyPlatform): BindingTarget | null {
  if (binding?.[p]) return p;
  if (binding?.keys) return "keys";
  return null;
}

/** The keys of `id` on `p` under `scheme` (null = 默认), normalised for `p`. */
export function schemeBindings(scheme: KeyScheme | null, id: CommandId, p: KeyPlatform): string[] {
  const b = scheme?.bindings[id];
  const source = bindingSource(b, p);
  const list = source ? b![source]! : defaultBindings(id, p);
  const out: string[] = [];
  for (const x of list) {
    const norm = normaliseCombo(x, p);
    if (norm && !out.includes(norm)) out.push(norm);
  }
  return out;
}

/**
 * Where an edit of `id` seen on `p` is written: the platform's own list when it has one, or when the built-in
 * default differs by platform (⌃` on a Mac) — else the neutral keys every platform shares.
 */
export function editTarget(scheme: KeyScheme, id: CommandId, p: KeyPlatform): BindingTarget {
  if (scheme.bindings[id]?.[p]) return p;
  return commandDef(id).mac ? p : "keys";
}

// ── Library edits (pure) ─────────────────────────────────────────────────────────────────────────

const touch = (s: KeyScheme, now: number): KeyScheme => ({ ...s, updatedAt: Math.max(now, s.updatedAt + 1) });

function replace(lib: SchemeLibrary, next: KeyScheme): SchemeLibrary {
  return { ...lib, schemes: lib.schemes.map((s) => (s.id === next.id ? next : s)) };
}

/** Set the list of `id` at `target` (null removes it). An entry equal to the parent's default everywhere is dropped. */
export function withBinding(lib: SchemeLibrary, schemeId: string, id: CommandId, target: BindingTarget, list: readonly string[] | null, now: number): SchemeLibrary {
  const scheme = lib.schemes.find((s) => s.id === schemeId);
  if (!scheme) return lib;
  const b: SchemeBinding = { ...scheme.bindings[id] };
  if (list) b[target] = cleanList(id, list, target === "keys" ? null : target) ?? [];
  else delete b[target];
  // A neutral list equal to the default on every platform, or a platform list equal to its default, says nothing.
  const defaultsOn = (p: KeyPlatform) => defaultBindings(id, p).map((x) => normaliseCombo(x, p)!);
  if (b.keys && KEY_PLATFORMS.every((p) => same(b.keys!.map((x) => normaliseCombo(x, p)!), defaultsOn(p)))) delete b.keys;
  for (const p of KEY_PLATFORMS) if (b[p] && !b.keys && same(b[p]!, defaultsOn(p))) delete b[p];
  const bindings = { ...scheme.bindings };
  if (Object.keys(b).length) bindings[id] = b;
  else delete bindings[id];
  return replace(lib, touch({ ...scheme, bindings }, now));
}

function same(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

export function newSchemeId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  const raw = c?.randomUUID ? c.randomUUID().replace(/-/g, "") : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `s-${raw.slice(0, 16)}`;
}

/** A new scheme copied from `fromId` (默认 = no overrides), made active. */
export function withNewScheme(lib: SchemeLibrary, name: string, fromId: string, id: string, now: number): SchemeLibrary {
  if (lib.schemes.length >= MAX_SCHEMES) return lib;
  const from = lib.schemes.find((s) => s.id === fromId);
  const scheme: KeyScheme = { id, name: cleanName(name), parent: BUILTIN_SCHEME_ID, bindings: from ? structuredClone(from.bindings) : {}, sync: from ? from.sync : true, updatedAt: now };
  return { ...lib, schemes: [...lib.schemes, scheme], active: id, activeShared: true };
}

export function withName(lib: SchemeLibrary, id: string, name: string, now: number): SchemeLibrary {
  const scheme = lib.schemes.find((s) => s.id === id);
  const clean = cleanName(name);
  if (!scheme || !clean) return lib;
  return replace(lib, touch({ ...scheme, name: clean }, now));
}

/**
 * 「同步到我的其他设备」 for one scheme. Off: it stays on this device only, and the copies it already sent are dropped on
 * the other devices (sent as deleted; this device keeps its own). On again: it is sent as a whole.
 */
export function withSync(lib: SchemeLibrary, id: string, sync: boolean, now: number): SchemeLibrary {
  const scheme = lib.schemes.find((s) => s.id === id);
  if (!scheme || scheme.sync === sync) return lib;
  const { [id]: _was, ...rest } = lib.deleted;
  const deleted = sync ? rest : pruneTombstones({ ...lib.deleted, [id]: now });
  return { ...replace(lib, touch({ ...scheme, sync }, now)), deleted };
}

/** Delete a scheme; the active one falls back to 默认. A synced one is remembered so the other devices drop it. */
export function withoutScheme(lib: SchemeLibrary, id: string, now: number): SchemeLibrary {
  const scheme = lib.schemes.find((s) => s.id === id);
  if (!scheme) return lib;
  const deleted = scheme.sync ? pruneTombstones({ ...lib.deleted, [id]: now }) : lib.deleted;
  const wasActive = lib.active === id;
  return { ...lib, schemes: lib.schemes.filter((s) => s.id !== id), deleted, active: wasActive ? BUILTIN_SCHEME_ID : lib.active, activeShared: wasActive ? true : lib.activeShared };
}

function pruneTombstones(d: Record<string, number>): Record<string, number> {
  const entries = Object.entries(d).sort((a, b) => b[1] - a[1]).slice(0, MAX_TOMBSTONES);
  return Object.fromEntries(entries);
}

export function withActive(lib: SchemeLibrary, id: string): SchemeLibrary {
  if (id !== BUILTIN_SCHEME_ID && !lib.schemes.some((s) => s.id === id)) return lib;
  return { ...lib, active: id, activeShared: true };
}

// ── Sync fields (the 同步 category's read / write) ────────────────────────────────────────────────

export type SyncFields = Record<string, unknown>;
const FIELD = "scheme:";

/** What this device offers: its synced schemes, deleted ones as null, and `active` once shared. */
export function syncFieldsOf(lib: SchemeLibrary): SyncFields {
  const out: SyncFields = {};
  for (const s of lib.schemes) if (s.sync) out[FIELD + s.id] = { name: s.name, parent: s.parent, bindings: s.bindings, updatedAt: s.updatedAt };
  for (const id of Object.keys(lib.deleted)) if (!(FIELD + id in out)) out[FIELD + id] = null;
  if (lib.activeShared) out.active = lib.active;
  return out;
}

/** Take the fields another device wrote (only those that differ). A scheme kept 「不同步」 here is left alone. */
export function withSyncFields(lib: SchemeLibrary, fields: SyncFields): SchemeLibrary {
  let next = lib;
  for (const [key, value] of Object.entries(fields)) {
    if (!key.startsWith(FIELD)) continue;
    const id = key.slice(FIELD.length);
    const local = next.schemes.find((s) => s.id === id);
    if (local && !local.sync) continue;
    if (value === null) {
      if (local) next = withoutScheme(next, id, local.updatedAt);
      continue;
    }
    const scheme = readScheme(value, id);
    if (!scheme) continue;
    const { [id]: _gone, ...deleted } = next.deleted;
    if (local) next = { ...replace(next, { ...scheme, sync: true }), deleted };
    else if (next.schemes.length < MAX_SCHEMES) next = { ...next, schemes: [...next.schemes, { ...scheme, sync: true }], deleted };
  }
  // Follow another device's switch once per change; one this device does not have (yet) waits for its scheme.
  const active = fields.active;
  if (typeof active === "string" && active !== next.remoteActive) {
    const known = active === BUILTIN_SCHEME_ID || next.schemes.some((s) => s.id === active);
    if (known) next = { ...next, active, activeShared: true, remoteActive: active };
  }
  if (!next.schemes.some((s) => s.id === next.active) && next.active !== BUILTIN_SCHEME_ID) next = { ...next, active: BUILTIN_SCHEME_ID };
  return next;
}

// ── Export / import (JSON) ───────────────────────────────────────────────────────────────────────

export const EXPORT_KIND = "cutex-keybinding-scheme";

export function exportScheme(scheme: KeyScheme, fallbackName: string): string {
  return JSON.stringify({ kind: EXPORT_KIND, v: 1, name: scheme.name ?? fallbackName, parent: scheme.parent, bindings: scheme.bindings }, null, 2);
}

/** A pasted export: its name and overrides (unknown commands and bad combos dropped); null when not one. */
export function parseSchemeExport(text: string): { name: string | null; bindings: Partial<Record<CommandId, SchemeBinding>> } | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.kind !== EXPORT_KIND || r.v !== 1) return null;
  return { name: cleanName(r.name), bindings: readBindings(r.bindings) };
}

export function withImported(lib: SchemeLibrary, imported: { name: string | null; bindings: Partial<Record<CommandId, SchemeBinding>> }, name: string, id: string, now: number): SchemeLibrary {
  if (lib.schemes.length >= MAX_SCHEMES) return lib;
  return { ...lib, schemes: [...lib.schemes, { id, name: cleanName(imported.name ?? name) ?? cleanName(name), parent: BUILTIN_SCHEME_ID, bindings: imported.bindings, sync: true, updatedAt: now }], active: id, activeShared: true };
}

/** Commands a scheme changes (for the picker's count). */
export function overriddenCount(scheme: KeyScheme): number {
  return COMMANDS.filter((c) => scheme.bindings[c.id]).length;
}
