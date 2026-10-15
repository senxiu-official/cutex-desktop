// Mainline API adapter over the standalone lifecycle engine. Keep renderer-facing
// Map/slot/prefs snapshots stable; module execution and rollback belong to plugin-host.
import {
  createModuleHost as createStandaloneHost,
  createModulePreferenceStore,
  type ModuleScope,
  type ModuleStatus as StandaloneStatus,
  type ModuleState as StandaloneState,
  type ModuleSlotEntry,
} from "@cutex-desktop/plugin-host";
import {
  MODULE_ID_RE, MODULES_PREFS_KEY, modulePrefsKey, placeKey,
  type HostInput, type HostsInput, type Json, type KeyValueStorage, type ModuleDefinition,
  type ModuleHost, type ModuleId, type ModulePrefs, type ModulesPrefs,
  type ModuleState, type ModuleStatus, type SlotEntry, type SlotItemBase,
  type SlotMapOf, type SlotSpec,
} from "./types";

export interface ModuleHostOptions<M extends SlotMapOf<M>, Svc, K extends string> {
  modules: readonly ModuleDefinition<M, Svc, K>[];
  slots: { readonly [S in keyof M]: SlotSpec };
  host: HostInput;
  /** v1.5: the other connected hosts and the scope (default: `host` alone). */
  hosts?: HostsInput;
  storage: KeyValueStorage;
  /** Compatibility provider; arbitrary services cannot be automatically fenced. */
  services(id: ModuleId): Svc;
  /** Preferred: bind service reads/writes/subscriptions to this activation scope. */
  scopedServices?(scope: ModuleScope): Svc;
  t?(key: K, vars?: Record<string, string | number>): string;
  activateTimeoutMs?: number;
  log?(message: string, error?: unknown): void;
  /**
   * App-level registration checks (v1.2: status surfaces / supportedSurfaces). Returns the rejected
   * module ids with why. Initial registry: those modules fail in isolation; addModules: the whole
   * batch rejects before anything registers. `existing` = the definitions already registered.
   */
  validate?(candidates: readonly ModuleDefinition<M, Svc, K>[], existing: readonly ModuleDefinition<M, Svc, K>[]): ReadonlyMap<string, string>;
}

function finiteJson(value: unknown, seen = new Set<object>()): value is Json {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  const prototype = Object.getPrototypeOf(value);
  const valid = Array.isArray(value)
    ? Object.keys(value).length === value.length && Array.from(value).every((item) => finiteJson(item, seen))
    : (prototype === Object.prototype || prototype === null) && Object.values(value).every((item) => finiteJson(item, seen));
  seen.delete(value);
  return valid;
}

export function createModuleHost<M extends SlotMapOf<M>, Svc = unknown, K extends string = string>(options: ModuleHostOptions<M, Svc, K>): ModuleHost<M, Svc, K> {
  const { storage } = options;
  let modules = options.modules;
  const log = options.log ?? ((message: string, error?: unknown) => console.warn(`[modules] ${message}`, error ?? ""));
  const preferenceStore = createModulePreferenceStore(storage);
  const listeners = new Set<() => void>();
  let queued = false;
  let disposed = false;
  const changed = () => {
    if (queued || disposed) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      for (const listener of [...listeners]) {
        try { listener(); } catch (error) { log("module observer threw", error); }
      }
    });
  };

  // The renderer's useSyncExternalStore needs the same JSON object until the
  // stored namespace changes. The neutral persistence helper returns clones;
  // retain the established mainline read-through snapshot behavior here.
  const prefApis = new Map<string, ModulePrefs>();
  const modulePrefs = (id: string): ModulePrefs => {
    const cached = prefApis.get(id);
    if (cached) return cached;
    let previousRaw: string | null | undefined;
    let values: Record<string, Json> = {};
    const subscriptions = new Set<() => void>();
    const read = () => {
      let raw: string | null;
      try { raw = storage.getItem(modulePrefsKey(id)); } catch (error) { log(`could not read prefs of ${id}`, error); return values; }
      if (raw === previousRaw) return values;
      previousRaw = raw;
      try {
        const parsed: unknown = JSON.parse(raw ?? "null");
        values = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, Json> : {};
      } catch { values = {}; }
      return values;
    };
    const api: ModulePrefs = {
      get<T extends Json>(key: string, fallback: T): T {
        const object = read();
        return Object.hasOwn(object, key) ? object[key] as T : fallback;
      },
      // Same error semantics as the engine's forModule(): a non-JSON value throws TypeError, and a
      // storage failure (quota, blocked storage) propagates to the caller with nothing changed or
      // notified, so a write is never reported as saved when it was not. Reads that fail keep the
      // last known values. Unlike forModule(), reads stay read-through and reference-stable for
      // useSyncExternalStore.
      set(key, value) {
        if (!finiteJson(value)) throw new TypeError("Module preference must be finite JSON");
        storage.setItem(modulePrefsKey(id), JSON.stringify({ ...read(), [key]: value }));
        for (const listener of [...subscriptions]) {
          try { listener(); } catch (error) { log(`preference observer of ${id} threw`, error); }
        }
      },
      subscribe(listener) { subscriptions.add(listener); return () => { subscriptions.delete(listener); }; },
    };
    prefApis.set(id, api); return api;
  };

  // Invalid IDs and duplicate records remain isolated failures in mainline's
  // public status Map. Do not send them to a constructor which rejects them.
  const accepted = new Map<string, ModuleDefinition<M, Svc, K>>();
  const registryFailures = new Map<string, ModuleStatus>();
  for (const definition of modules) {
    if (!MODULE_ID_RE.test(definition.id) || accepted.has(definition.id)) {
      registryFailures.set(definition.id, { state: { kind: "failed", at: Date.now(),
        error: `${accepted.has(definition.id) ? "duplicate" : "invalid"} module id "${definition.id}"` } });
    } else accepted.set(definition.id, definition);
  }
  for (const [id, error] of options.validate?.([...accepted.values()], []) ?? []) {
    if (!accepted.delete(id)) continue;
    registryFailures.set(id, { state: { kind: "failed", at: Date.now(), error } });
  }
  let placementOverrides = preferenceStore.load().place;
  const persist = (next: ModulesPrefs) => {
    const enabled = { ...next.enabled };
    for (const definition of modules) {
      if (definition.required || enabled[definition.id] === (definition.defaultEnabled ?? true)) delete enabled[definition.id];
    }
    try {
      // Placement may be written by a separate mainline settings control.
      preferenceStore.save({ v: 1, enabled, place: placementOverrides });
    } catch (error) { log("could not save module prefs", error); }
  };
  const host = createStandaloneHost<M, Svc, K>({
    modules: [...accepted.values()], slots: options.slots, host: options.host, ...(options.hosts ? { hosts: options.hosts } : {}),
    prefs: preferenceStore.load(), onPrefsChange: persist,
    createServices: scope => options.scopedServices ? options.scopedServices(scope) : options.services(scope.id),
    createPrefs: scope => modulePrefs(scope.id),
    t: options.t, activationTimeoutMs: options.activateTimeoutMs,
  });
  let registrySource = host.modules;
  const off = host.subscribe(() => {
    if (registrySource !== host.modules) {
      registrySource = host.modules;
      modules = Object.freeze([...registrySource, ...options.modules.filter(def => registryFailures.has(def.id))]);
      accepted.clear();
      for (const definition of registrySource) accepted.set(definition.id, definition);
      statusSource = null;
    }
    changed();
  });
  const clearedErrors = new Map<string, StandaloneStatus["lastError"]>();
  let statusSource: ReturnType<typeof host.statuses> | null = null;
  let statusCache: ReadonlyMap<string, ModuleStatus> = new Map();
  const statusRows = new Map<string, { source: StandaloneStatus; suppressed: boolean; value: ModuleStatus }>();
  const state = (value: StandaloneState): ModuleState => {
    if (value.kind === "unavailable") return { kind: value.kind, missing: { ...value.missing,
      capabilities: [...value.missing.capabilities], modules: [...value.missing.modules] } };
    if (value.kind === "failed") return { ...value, error: value.error
      .replace(/^Duplicate contribution:/, "duplicate contribution:")
      .replace(/^Module activation timed out after (\d+) ms$/, "activate() did not finish within $1 ms") };
    return value;
  };
  const statuses = (): ReadonlyMap<string, ModuleStatus> => {
    const source = host.statuses();
    if (source === statusSource) return statusCache;
    statusSource = source;
    const next = new Map<string, ModuleStatus>();
    for (const definition of modules) {
      const invalid = registryFailures.get(definition.id);
      if (invalid) { next.set(definition.id, invalid); continue; }
      const current = source[definition.id];
      if (!current) continue;
      const suppressed = current.lastError !== undefined && clearedErrors.get(definition.id) === current.lastError;
      const previous = statusRows.get(definition.id);
      const value = previous && previous.source === current && previous.suppressed === suppressed ? previous.value
        : { state: state(current.state), ...(current.lastError && !suppressed ? { lastError: { ...current.lastError } } : {}) };
      statusRows.set(definition.id, { source: current, suppressed, value }); next.set(definition.id, value);
    }
    if (next.size !== statusCache.size || [...next].some(([id, value]) => statusCache.get(id) !== value)) statusCache = next;
    return statusCache;
  };
  const slotCache = new Map<keyof M, { source: readonly ModuleSlotEntry<M[keyof M]>[]; value: readonly SlotEntry<M[keyof M]>[] }>();
  const isEnabled = (id: string): boolean => {
    const definition = accepted.get(id) ?? modules.find(module => module.id === id);
    if (!definition) return false;
    const enabled = host.getPrefs().enabled;
    return !!definition.required || (Object.hasOwn(enabled, id) ? enabled[id]! : definition.defaultEnabled ?? true);
  };
  return {
    get modules() { return modules; }, statuses,
    addModules: definitions => {
      const rejected = options.validate?.(definitions, host.modules);
      if (rejected?.size) return Promise.reject(new Error([...rejected].map(([id, error]) => `${id}: ${error}`).join("; ")));
      return host.addModules(definitions);
    },
    removeModule: id => host.removeModule(id),
    snapshot<S extends keyof M>(slot: S): readonly SlotEntry<M[S]>[] {
      const source = host.snapshot(slot);
      const previous = slotCache.get(slot);
      if (previous?.source === source) return previous.value as readonly SlotEntry<M[S]>[];
      const next: SlotEntry<M[S]>[] = [];
      for (const entry of source) {
        if (!entry.available && entry.unavailable === "hide") continue;
        const mode = entry.available ? "show" : entry.unavailable;
        if (mode === "hide") continue;
        const missing = [...new Set([...entry.missing.capabilities, ...entry.missing.modules])];
        const existing = previous?.value.find(row => row.item === entry.item && row.moduleId === entry.moduleId && row.mode === mode
          && row.waiting === entry.missing.waiting && row.missing.length === missing.length && row.missing.every((value, index) => value === missing[index]));
        // The cache is keyed by slot; this assertion narrows its heterogeneous
        // storage back to that slot's item type without changing the item object.
        next.push(existing as SlotEntry<M[S]> | undefined ?? { item: entry.item, moduleId: entry.moduleId, mode, missing, waiting: entry.missing.waiting });
      }
      const same = previous?.value.length === next.length && next.every((value, index) => value === previous.value[index]);
      const value = same ? previous.value as readonly SlotEntry<M[S]>[] : next;
      slotCache.set(slot, { source, value }); return value;
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    isEnabled,
    setEnabled(id, on) {
      const definition = accepted.get(id);
      if (!definition || definition.required) return Promise.resolve();
      if (isEnabled(id) === on) {
        persist({ ...host.getPrefs(), enabled: { ...host.getPrefs().enabled, [id]: on } });
        return host.whenSettled();
      }
      return host.setEnabled(id, on);
    },
    setHost: target => host.setHost(target),
    setHosts: input => host.setHosts(input),
    retry(id) {
      if (!accepted.has(id)) return Promise.resolve();
      const current = host.statuses()[id];
      if (!current) return Promise.resolve();
      if (current.lastError) { clearedErrors.set(id, current.lastError); statusSource = null; changed(); }
      // Mainline's render-error retry clears its report without restarting a
      // healthy module (the entry ErrorBoundary handles its own rerender).
      return current.state.kind === "failed" ? host.retry(id) : host.whenSettled();
    },
    reportError(id, error) { if (accepted.has(id)) host.recordError(id, error); },
    prefs: modulePrefs,
    placement(slot, item) {
      const spec = options.slots[slot].placement;
      if (!spec) return "";
      const stored = placementOverrides[placeKey(String(slot), item.id)];
      return stored !== undefined && spec.values.includes(stored) ? stored : spec.default(item);
    },
    setPlacement(slot, item, value) {
      const spec = options.slots[slot].placement;
      if (!spec || !spec.values.includes(value)) {
        log(`ignored placement "${value}" for ${item.id} in ${String(slot)}`);
        return;
      }
      const next = { ...preferenceStore.load().place };
      const key = placeKey(String(slot), item.id);
      if (value === spec.default(item)) delete next[key];
      else next[key] = value;
      placementOverrides = next;
      host.setPlacement(slot, item.id, value);
      // A no-op neutral placement still has mainline's explicit persistence semantics.
      persist(host.getPrefs());
      changed();
    },
    placements: () => placementOverrides,
    idle: () => host.whenSettled(),
    dispose() {
      const stopped = host.dispose();
      return stopped.finally(() => { disposed = true; off(); listeners.clear(); });
    },
  };
}
