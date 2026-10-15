import type { Json, ModulePrefs, ModulesPrefs } from "@cutex-desktop/plugin-sdk";

export interface ModulePreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
const MODULES_KEY = "cutex-desktop.modules";
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parse(storage: ModulePreferenceStorage, key: string): Record<string, unknown> {
  try { const value: unknown = JSON.parse(storage.getItem(key) ?? "null"); return record(value) ? value : {}; }
  catch { return {}; }
}
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function json(value: unknown, seen = new Set<object>()): value is Json {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  const valid = Array.isArray(value)
    ? Object.keys(value).length === value.length && Array.from(value).every(v => json(v, seen))
    : (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
      && Object.values(value).every(v => json(v, seen));
  seen.delete(value); return valid;
}
/** Device-scoped UI preferences only. No migration, daemon state, or global storage access. */
export function createModulePreferenceStore(storage: ModulePreferenceStorage) {
  const modules = new Map<string, ModulePrefs>();
  return {
    load(): ModulesPrefs {
      const raw = parse(storage, MODULES_KEY);
      const prefs: ModulesPrefs = { v: 1, enabled: {}, place: {} };
      if (raw.v !== 1) return prefs;
      if (record(raw.enabled)) for (const [id, value] of Object.entries(raw.enabled)) {
        if (/^[a-z][a-z0-9-]{0,63}$/.test(id) && typeof value === "boolean") prefs.enabled[id] = value;
      }
      if (record(raw.place)) for (const [id, value] of Object.entries(raw.place)) {
        if (id.includes(":") && typeof value === "string") Object.defineProperty(prefs.place, id, { value, enumerable: true, configurable: true, writable: true });
      }
      return prefs;
    },
    save(prefs: ModulesPrefs): void { storage.setItem(MODULES_KEY, JSON.stringify(prefs)); },
    forModule(id: string): ModulePrefs {
      if (!/^[a-z][a-z0-9-]{0,63}$/.test(id)) throw new Error("Invalid module preference namespace");
      const existing = modules.get(id); if (existing) return existing;
      const storageKey = `cutex-desktop.module.${id}`;
      let values = parse(storage, storageKey);
      const listeners = new Set<() => void>();
      const prefs: ModulePrefs = {
        get<T extends Json>(key: string, fallback: T): T {
          return clone(own(values, key) && json(values[key]) ? values[key] as T : fallback);
        },
        set(key, value) {
          if (!json(value)) throw new TypeError("Module preference must be finite JSON");
          const next = { ...values, [key]: clone(value) };
          // Do not report successful persistence if the storage adapter rejects a write.
          storage.setItem(storageKey, JSON.stringify(next)); values = next;
          for (const listener of [...listeners]) { try { listener(); } catch { /* Other consumers still receive the update. */ } }
        },
        subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
      };
      modules.set(id, prefs); return prefs;
    },
  };
}
