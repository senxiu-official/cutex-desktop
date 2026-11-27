// This window's copy of the shortcut schemes (lib/keybindingSchemes): loaded from localStorage (migrating the old
// overrides once), saved on every change, shared with the other windows through the storage event, and the
// read / write of the 同步 category. lib/keybindings asks it for the keys in effect.
import { keyPlatform, type CommandId, type KeyPlatform } from "./keybindingCore";
import {
  BUILTIN_SCHEME_ID, LEGACY_STORAGE_KEY, SCHEMES_STORAGE_KEY, editTarget, emptyLibrary, migrateLegacy, newSchemeId, parseOverrides, readLibrary,
  schemeBindings, syncFieldsOf, withActive, withBinding, withImported, withName, withNewScheme, withSync, withSyncFields, withoutScheme,
  type BindingTarget, type KeyScheme, type SchemeLibrary, type SyncFields, parseSchemeExport,
} from "./keybindingSchemes";

let library: SchemeLibrary = load();
let version = 0;
const listeners = new Set<() => void>();

function storage(): Storage | null {
  return typeof localStorage === "undefined" ? null : localStorage;
}

function load(): SchemeLibrary {
  const s = storage();
  try {
    const stored = readLibrary(JSON.parse(s?.getItem(SCHEMES_STORAGE_KEY) ?? "null"));
    if (stored) return stored;
  } catch {
    // unreadable: start over from the old overrides below
  }
  let legacy = {};
  try {
    legacy = parseOverrides(JSON.parse(s?.getItem(LEGACY_STORAGE_KEY) ?? "null"));
  } catch {
    legacy = {};
  }
  const migrated = migrateLegacy(legacy, newSchemeId(), Date.now());
  write(migrated);
  return migrated;
}

function write(lib: SchemeLibrary): void {
  try {
    storage()?.setItem(SCHEMES_STORAGE_KEY, JSON.stringify(lib));
  } catch {
    // private mode / quota: the change still holds for this window
  }
}

function emit(): void {
  version++;
  for (const l of listeners) l();
}

function commit(next: SchemeLibrary): void {
  if (next === library) return;
  library = next;
  write(library);
  emit();
}

// Another window of this desktop changed them.
if (typeof window !== "undefined" && typeof window.addEventListener === "function")
  window.addEventListener("storage", (e) => {
    if (e.key !== SCHEMES_STORAGE_KEY) return;
    try {
      const next = readLibrary(JSON.parse(e.newValue ?? "null"));
      if (next) {
        library = next;
        emit();
      }
    } catch {
      // ignore a half-written value
    }
  });

// ── Reading ──────────────────────────────────────────────────────────────────────────────────────

export function schemeLibrary(): SchemeLibrary {
  return library;
}

/** The active scheme; null = the built-in 默认. */
export function activeScheme(): KeyScheme | null {
  return library.schemes.find((s) => s.id === library.active) ?? null;
}

export function schemeById(id: string): KeyScheme | null {
  return library.schemes.find((s) => s.id === id) ?? null;
}

/** The keys of `id` in effect on `p` (this device when omitted). */
export function effectiveBindings(id: CommandId, p: KeyPlatform = keyPlatform()): string[] {
  return schemeBindings(activeScheme(), id, p);
}

/** The active scheme leaves `id` at its default on `p`. */
export function isDefaultIn(id: CommandId, p: KeyPlatform = keyPlatform()): boolean {
  const b = activeScheme()?.bindings[id];
  return !b || (!b.keys && !b[p]);
}

export function subscribeSchemes(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function schemesVersion(): number {
  return version;
}

// ── Editing ──────────────────────────────────────────────────────────────────────────────────────

/** 默认 is read-only: a change made while it is active goes to a new 「我的快捷键」 (programmatic callers; Settings asks to copy first). */
function editable(): KeyScheme {
  const current = activeScheme();
  if (current) return current;
  const id = newSchemeId();
  // An empty name is the 「我的快捷键」 one (shown in the current language).
  library = withNewScheme(library, "", BUILTIN_SCHEME_ID, id, Date.now());
  return activeScheme()!;
}

/** Set `id`'s keys in the active scheme as seen on `p` (written where editTarget says, or at `target`). */
export function setSchemeBindings(id: CommandId, list: readonly string[], p: KeyPlatform = keyPlatform(), target?: BindingTarget): void {
  const scheme = editable();
  commit(withBinding(library, scheme.id, id, target ?? editTarget(scheme, id, p), list, Date.now()));
}

/** Back to the parent's default on `p`: its own list there, else the neutral one. With no id: the whole scheme. */
export function resetSchemeBindings(id?: CommandId, p: KeyPlatform = keyPlatform()): void {
  const scheme = activeScheme();
  if (!scheme) return;
  if (!id) return commit({ ...library, schemes: library.schemes.map((s) => (s.id === scheme.id ? { ...s, bindings: {}, updatedAt: Math.max(Date.now(), s.updatedAt + 1) } : s)) });
  const b = scheme.bindings[id];
  if (!b) return;
  commit(withBinding(library, scheme.id, id, b[p] ? p : "keys", null, Date.now()));
}

/** Give `id` its own list on `p` (starting from what it has now), or drop it (back to the shared keys). */
export function setPlatformSpecific(id: CommandId, p: KeyPlatform, on: boolean): void {
  const scheme = editable();
  if (on) commit(withBinding(library, scheme.id, id, p, schemeBindings(scheme, id, p), Date.now()));
  else commit(withBinding(library, scheme.id, id, p, null, Date.now()));
}

export function switchScheme(id: string): void {
  commit(withActive(library, id));
}

/** A new scheme copied from `fromId` (默认 = empty), active; its id. */
export function createScheme(name: string, fromId: string = BUILTIN_SCHEME_ID): string | null {
  const id = newSchemeId();
  const next = withNewScheme(library, name, fromId, id, Date.now());
  if (next === library) return null;
  commit(next);
  return id;
}

export function renameScheme(id: string, name: string): void {
  commit(withName(library, id, name, Date.now()));
}

export function deleteScheme(id: string): void {
  commit(withoutScheme(library, id, Date.now()));
}

export function setSchemeSync(id: string, sync: boolean): void {
  commit(withSync(library, id, sync, Date.now()));
}

/** Import a pasted export as a new active scheme; false when the text is not one. */
export function importScheme(text: string, fallbackName: string): boolean {
  const parsed = parseSchemeExport(text);
  if (!parsed) return false;
  const next = withImported(library, parsed, fallbackName, newSchemeId(), Date.now());
  if (next === library) return false;
  commit(next);
  return true;
}

// ── Sync category ────────────────────────────────────────────────────────────────────────────────

/** The 同步 category's read: synced schemes, deletions and the shared active scheme. */
export function keybindingSyncFields(): SyncFields {
  return syncFieldsOf(library);
}

/** The 同步 category's write: fields another device changed. */
export function applyKeybindingSyncFields(fields: SyncFields): void {
  commit(withSyncFields(library, fields));
}

// The sync engine says whether this category syncs on this device (shown as 已同步); off until it is wired.
let syncOn = false;
export function setKeybindingSyncOn(on: boolean): void {
  if (syncOn === on) return;
  syncOn = on;
  emit();
}
export function keybindingSyncOn(): boolean {
  return syncOn;
}

/** Tests: forget everything (built-in 默认 active, nothing stored read back). */
export function resetSchemesForTests(next: SchemeLibrary = emptyLibrary()): void {
  library = next;
  syncOn = false;
  emit();
}

/** Load again from storage (migration included): tests and the preview mock (dev/mockKeySchemes). */
export function reloadSchemesFromStorage(): void {
  library = load();
  emit();
}
