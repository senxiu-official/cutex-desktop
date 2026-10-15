import type {
  Json, ModuleContext, ModuleDefinition, ModuleHostContext, ModuleEngineOptions, ModuleHostTarget,
  ModuleHostEntry, ModuleHostsContext, ModuleHostsTarget, ModuleId, ModuleMissing, ModulePrefs, ModuleRequires,
  ModuleScope, ModuleSlotEntry, ModuleState, ModuleStatus, ModulesPrefs, SlotItemBase,
} from "@cutex-desktop/plugin-sdk";

import { createModuleServiceScope } from "./module-services.js";

type Cleanup = () => void | Promise<void>;
interface Owner<T extends SlotItemBase> {
  id: string; definition: object; generation: number; controller: AbortController; closed: boolean;
  disposers: Cleanup[]; dynamic: { slot: PropertyKey; item: T; sequence: number }[];
  sequence: number; cancel: () => void; cancelled: Promise<void>; cleanup?: Promise<void>;
}
const text = (error: unknown) => error instanceof Error ? error.message : String(error);
function aborted(): Error { const error = new Error("Module scope has stopped"); error.name = "AbortError"; return error; }
const emptyMissing = (): ModuleMissing => ({ capabilities: [], modules: [], hostKind: false, waiting: false });
const unavailable = (missing: ModuleMissing) => missing.hostKind || missing.waiting || missing.capabilities.length > 0 || missing.modules.length > 0;
function freezeMissing(missing: ModuleMissing): ModuleMissing {
  return Object.freeze({ ...missing, capabilities: Object.freeze([...missing.capabilities]), modules: Object.freeze([...missing.modules]) });
}
/** What `requires` lacks on one host (capabilities, kind, or its featureList not loaded yet). */
function missingOn(target: ModuleHostTarget, requires: Pick<ModuleRequires, "capabilities" | "hostKinds"> | undefined): ModuleMissing {
  const capabilities = requires?.capabilities ?? [];
  return { capabilities: capabilities.filter(cap => !target.features?.has(cap)), modules: [],
    hostKind: !!requires?.hostKinds && !requires.hostKinds.includes(target.kind),
    waiting: target.features === null && capabilities.length > 0 };
}
const sameFeatures = (a: ReadonlySet<string> | null, b: ReadonlySet<string> | null) =>
  a === null || b === null ? a === b : a.size === b.size && [...a].every(cap => b.has(cap));
const sameTarget = (a: ModuleHostTarget, b: ModuleHostTarget) => a.id === b.id && a.kind === b.kind && sameFeatures(a.features, b.features);
function sameMissing(a: ModuleMissing, b: ModuleMissing): boolean {
  return a.hostKind === b.hostKind && a.waiting === b.waiting
    && a.capabilities.length === b.capabilities.length && a.capabilities.every((value, index) => value === b.capabilities[index])
    && a.modules.length === b.modules.length && a.modules.every((value, index) => value === b.modules[index]);
}
function readonlyFeatures(features: ReadonlySet<string> | null): ReadonlySet<string> {
  const values = new Set(features ?? []);
  const facade: ReadonlySet<string> = Object.freeze({
    get size() { return values.size; }, has: (value: string) => values.has(value),
    entries: () => values.entries(), keys: () => values.keys(), values: () => values.values(),
    [Symbol.iterator]: () => values[Symbol.iterator](),
    forEach: (callback: (value: string, key: string, set: ReadonlySet<string>) => void, thisArg?: unknown) => {
      values.forEach(value => callback.call(thisArg, value, value, facade));
    },
  });
  return facade;
}
function cloneJson<T extends Json>(value: T): T {
  const seen = new Set<object>();
  function check(part: unknown): void {
    if (part === null || typeof part === "string" || typeof part === "boolean" || typeof part === "number" && Number.isFinite(part)) return;
    if (typeof part !== "object" || !part || seen.has(part)) throw new Error("Module preferences must be finite acyclic JSON");
    seen.add(part);
    if (Array.isArray(part)) {
      if (Object.keys(part).length !== part.length) throw new Error("Module preferences must be dense JSON arrays");
      for (let i = 0; i < part.length; i++) { if (!Object.hasOwn(part, i)) throw new Error("Module preferences must be dense JSON arrays"); check(part[i]); }
    } else {
      if (Object.getPrototypeOf(part) !== Object.prototype && Object.getPrototypeOf(part) !== null) throw new Error("Module preferences must be plain JSON");
      for (const item of Object.values(part)) check(item);
    }
    seen.delete(part);
  }
  check(value); return JSON.parse(JSON.stringify(value)) as T;
}

/** Built-in module lifecycle and typed registries; no UI or daemon implementation. */
export class ModuleHost<M extends { [S in keyof M]: SlotItemBase }, Services = unknown, MessageKey extends string = string> {
  readonly ready: Promise<void>;
  private readonly definitions = new Map<ModuleId, ModuleDefinition<M, Services, MessageKey>>();
  private order: string[];
  private moduleSnapshot: readonly ModuleDefinition<M, Services, MessageKey>[] = [];
  private readonly removed = new Set<string>();
  private readonly contributionErrors = new Map<string, string>();
  private readonly graphErrors = new Map<string, string>();
  private readonly failures = new Map<string, { message: string; at: number }>();
  private readonly owners = new Map<string, Owner<M[keyof M]>>();
  private readonly generations = new Map<string, number>();
  private readonly retainedStatic = new Set<string>();
  private readonly state = new Map<string, ModuleStatus>();
  private readonly listeners = new Set<() => void>();
  private readonly snapshots = new Map<keyof M, readonly ModuleSlotEntry<M[keyof M]>[]>();
  private readonly memory = new Map<string, { values: Map<string, Json>; listeners: Set<() => void> }>();
  private readonly stopping = new Set<Promise<void>>();
  private statusSnapshot: Readonly<Record<ModuleId, ModuleStatus>> = Object.freeze({});
  private target: ModuleHostTarget;
  private hostContext: ModuleHostContext;
  /** v1.5: the other connected hosts, the view scope, and what ctx.hosts shows. */
  private others: readonly ModuleHostTarget[] = [];
  private scopeIds: readonly string[] = [];
  private hostEntries: readonly ModuleHostEntry[] = [];
  private readonly hostListeners = new Set<() => void>();
  private prefs: ModulesPrefs;
  private disposed = false;
  private epoch = 0;
  private running: Promise<void> | null = null;
  constructor(private readonly options: ModuleEngineOptions<M, Services, MessageKey>) {
    this.target = this.copyTarget(options.hosts?.focus ?? options.host);
    this.hostContext = this.contextHost();
    this.others = this.copyOthers(options.hosts?.others ?? []);
    this.scopeIds = Object.freeze([...(options.hosts?.scope ?? [this.target.id])]);
    this.hostEntries = this.entries();
    this.prefs = { v: 1, enabled: { ...(options.prefs?.enabled ?? {}) }, place: { ...(options.prefs?.place ?? {}) } };
    for (const definition of options.modules) {
      if (!/^[a-z][a-z0-9-]{0,63}$/.test(definition.id)) throw new Error(`Invalid module ID: ${definition.id}`);
      if (this.definitions.has(definition.id)) throw new Error(`Duplicate module ID: ${definition.id}`);
      this.definitions.set(definition.id, definition);
      this.state.set(definition.id, { state: { kind: "disabled" } });
    }
    const graph = this.validateGraph(this.definitions);
    this.order = graph.order;
    for (const [id, error] of graph.errors) this.graphErrors.set(id, error);
    for (const definition of this.definitions.values()) {
      try {
        for (const slot of Reflect.ownKeys(definition.contributes ?? {}) as (keyof M)[]) {
          const ids = new Set<string>();
          for (const item of definition.contributes?.[slot] ?? []) {
            this.validateItem(definition.id, slot, item);
            if (ids.has(item.id)) throw new Error(`Duplicate contribution: ${String(slot)}/${item.id}`);
            ids.add(item.id);
          }
        }
      } catch (error) { this.contributionErrors.set(definition.id, text(error)); this.graphErrors.set(definition.id, text(error)); }
    }
    this.moduleSnapshot = Object.freeze([...this.definitions.values()]);
    this.publish();
    this.ready = this.schedule();
  }
  private copyTarget(target: ModuleHostTarget): ModuleHostTarget {
    return Object.freeze({ id: target.id, kind: target.kind, features: target.features === null ? null : readonlyFeatures(target.features) });
  }
  private contextHost(): ModuleHostContext { return Object.freeze({ id: this.target.id, kind: this.target.kind, features: readonlyFeatures(this.target.features) }); }
  private copyOthers(others: readonly ModuleHostTarget[]): readonly ModuleHostTarget[] {
    return Object.freeze(others.filter(other => other.id !== this.target.id).map(other => this.copyTarget(other)));
  }
  private entries(): readonly ModuleHostEntry[] {
    return Object.freeze([this.target, ...this.others].map(target => Object.freeze({ id: target.id, kind: target.kind, features: readonlyFeatures(target.features),
      featuresKnown: target.features !== null, focus: target === this.target, inScope: target === this.target || this.scopeIds.includes(target.id) })));
  }
  /** Hosts whose capabilities decide what entries show: the focus, then the other hosts in the scope. */
  private scopeTargets(): readonly ModuleHostTarget[] {
    return [this.target, ...this.others.filter(other => this.scopeIds.includes(other.id))];
  }
  private assertOpen(): void { if (this.disposed) throw new Error("Module host is disposed"); }
  private definition(id: string): ModuleDefinition<M, Services, MessageKey> {
    const definition = this.definitions.get(id); if (!definition) throw new Error(`Unknown module: ${id}`); return definition;
  }
  private enabled(id: string): boolean {
    const definition = this.definition(id);
    return !!definition.required || (Object.hasOwn(this.prefs.enabled, id) ? this.prefs.enabled[id]! : definition.defaultEnabled ?? true);
  }
  private validateGraph(definitions: ReadonlyMap<string, ModuleDefinition<M, Services, MessageKey>>): { order: string[]; errors: Map<string, string> } {
    const errors = new Map<string, string>();
    for (const id of definitions.keys()) {
      for (const dependency of definitions.get(id)!.requires?.modules ?? []) {
        if (!definitions.has(dependency) && !this.removed.has(dependency)) errors.set(id, `Unknown module dependency: ${dependency}`);
      }
      // Search reachability back to each root independently. A shared DFS visited
      // set misses members of overlapping cycles reached through an earlier arm.
      const visited = new Set<string>();
      const cycle = (current: string, path: string[]): string[] | null => {
        visited.add(current);
        for (const dependency of definitions.get(current)!.requires?.modules ?? []) {
          if (dependency === id) return [...path, id];
          if (!definitions.has(dependency) || visited.has(dependency)) continue;
          const found = cycle(dependency, [...path, dependency]);
          if (found) return found;
        }
        return null;
      };
      const found = cycle(id, [id]);
      if (found) errors.set(id, `Module dependency cycle: ${found.join(" → ")}`);
    }
    // Stable topological layers, preserving registry order within each layer.
    const remaining = new Set(definitions.keys()); const result: string[] = [];
    while (remaining.size) {
      const layer = [...remaining].filter(id => (definitions.get(id)!.requires?.modules ?? []).every(dep => !remaining.has(dep)));
      if (!layer.length) { result.push(...remaining); break; }
      result.push(...layer); for (const id of layer) remaining.delete(id);
    }
    return { order: result, errors };
  }
  /** v1.5: any connected host satisfying the module's requirements activates it (`focusHost`: only the focus). */
  private environmentalMissing(id: string): ModuleMissing {
    const requires = this.definition(id).requires;
    const focus = missingOn(this.target, requires);
    if (requires?.focusHost || !unavailable(focus)) return focus;
    return this.others.some(other => !unavailable(missingOn(other, requires))) ? emptyMissing() : focus;
  }
  /** An entry's gating: module ∪ item capabilities on a host in the scope (the focus's gaps when none). */
  private itemMissing(id: string, item: SlotItemBase): ModuleMissing {
    const requires = this.definition(id).requires;
    const combined = { capabilities: [...new Set([...(requires?.capabilities ?? []), ...(item.requires?.capabilities ?? [])])], hostKinds: requires?.hostKinds };
    const focus = missingOn(this.target, combined);
    if (requires?.focusHost || !unavailable(focus)) return focus;
    return this.scopeTargets().some(target => !unavailable(missingOn(target, combined))) ? emptyMissing() : focus;
  }
  private eligible(id: string, seen = new Set<string>()): boolean {
    if (!this.definitions.has(id) || seen.has(id) || !this.enabled(id) || this.graphErrors.has(id) || this.failures.has(id)) return false;
    if (unavailable(this.environmentalMissing(id))) return false;
    const next = new Set(seen).add(id);
    return (this.definition(id).requires?.modules ?? []).every(dependency => this.eligible(dependency, next));
  }
  private missing(id: string, projected = false): ModuleMissing {
    const missing = this.environmentalMissing(id);
    return { ...missing, modules: (this.definition(id).requires?.modules ?? []).filter(dependency => projected
      ? !this.eligible(dependency) : this.state.get(dependency)?.state.kind !== "active") };
  }
  private setState(id: string, state: ModuleState): void {
    if (!this.definitions.has(id)) return;
    const prior = this.state.get(id);
    const frozen = Object.freeze(state.kind === "unavailable" ? { ...state, missing: freezeMissing(state.missing) } : { ...state });
    if (prior && JSON.stringify(prior.state) === JSON.stringify(frozen)) return;
    this.state.set(id, Object.freeze({ state: frozen, ...(prior?.lastError ? { lastError: prior.lastError } : {}) }));
  }
  private publish(): void {
    let changed = false;
    const statuses = Object.fromEntries(this.state);
    if (Object.keys(statuses).length !== Object.keys(this.statusSnapshot).length || Object.keys(statuses).some(id => statuses[id] !== this.statusSnapshot[id])) { this.statusSnapshot = Object.freeze(statuses); changed = true; }
    for (const slot of Reflect.ownKeys(this.options.slots) as (keyof M)[]) {
      const rows: { row: ModuleSlotEntry<M[keyof M]>; moduleOrder: number; sequence: number }[] = [];
      let moduleOrder = 0;
      for (const [id, definition] of this.definitions) {
        const index = moduleOrder++;
        if (this.disposed || !this.enabled(id) || this.graphErrors.has(id) || this.failures.has(id)) continue;
        const missing = this.missing(id, this.retainedStatic.has(id));
        const staticItems = (definition.contributes?.[slot] ?? []) as readonly M[keyof M][];
        const items: { item: M[keyof M]; sequence: number }[] = staticItems.map((item, sequence) => ({ item, sequence }));
        const owner = this.owners.get(id);
        if (owner && !owner.closed) for (const contribution of owner.dynamic) if (contribution.slot === slot) {
          items.push({ item: contribution.item as M[typeof slot], sequence: items.length + contribution.sequence });
        }
        for (const { item, sequence } of items) {
          const gated = { ...this.itemMissing(id, item), modules: missing.modules };
          const available = !unavailable(gated);
          const behavior = item.unavailable ?? this.options.slots[slot].unavailable;
          if (!available && behavior === "hide") continue;
          const placement = this.options.slots[slot].placement;
          const override = this.prefs.place[`${String(slot)}:${item.id}`];
          rows.push({ moduleOrder: index, sequence, row: { moduleId: id, item, available, unavailable: behavior, missing: freezeMissing(gated),
            ...(placement ? { placement: override !== undefined && placement.values.includes(override) ? override : placement.default(item) } : {}) } });
        }
      }
      rows.sort((a, b) => (a.row.item.order ?? 0) - (b.row.item.order ?? 0) || a.moduleOrder - b.moduleOrder || a.sequence - b.sequence);
      const old = this.snapshots.get(slot) ?? [];
      const next = rows.map(({ row }) => {
        const existing = old.find(value => value.moduleId === row.moduleId && value.item === row.item && value.available === row.available
          && value.unavailable === row.unavailable && value.placement === row.placement && sameMissing(value.missing, row.missing));
        return existing ?? Object.freeze(row);
      });
      if (!this.snapshots.has(slot) || old.length !== next.length || next.some((row, index) => row !== old[index])) {
        this.snapshots.set(slot, Object.freeze(next)); changed = true;
      }
    }
    if (changed) for (const listener of [...this.listeners]) { try { listener(); } catch { /* One consumer cannot block other observers or lifecycle. */ } }
  }
  private stop(owner: Owner<M[keyof M]>, after: Promise<void> = Promise.resolve()): Promise<void> {
    if (owner.cleanup) return owner.cleanup;
    owner.closed = true;
    // Install cleanup before abort callbacks run, and sequence async disposal
    // after dependents while revoking every affected signal immediately.
    owner.cleanup = (async () => {
      await after;
      for (const dispose of owner.disposers.splice(0).reverse()) {
        try { await dispose(); } catch (error) { if (this.definitions.get(owner.id) === owner.definition) this.recordError(owner.id, error); }
      }
      if (this.owners.get(owner.id) === owner) this.owners.delete(owner.id);
    })();
    this.stopping.add(owner.cleanup);
    void owner.cleanup.then(() => this.stopping.delete(owner.cleanup!));
    owner.controller.abort(); owner.cancel();
    if (this.definitions.get(owner.id) === owner.definition) this.setState(owner.id, { kind: "stopping" });
    return owner.cleanup;
  }
  private invalidate(all = false, id?: string): void {
    const affected = new Set<string>(id ? [id] : []);
    for (const key of this.order) if ((this.definition(key).requires?.modules ?? []).some(dep => affected.has(dep))) affected.add(key);
    const owners = [...this.order].reverse().filter(key => all || affected.has(key) || !this.eligible(key))
      .map(key => this.owners.get(key)).filter((owner): owner is Owner<M[keyof M]> => !!owner);
    // Revoke every affected service scope before any abort listener can call a sibling's services.
    for (const owner of owners) owner.closed = true;
    let prior = Promise.resolve();
    for (const owner of owners) prior = this.stop(owner, prior);
  }

  private schedule(): Promise<void> {
    ++this.epoch;
    if (!this.running) {
      let completedEpoch = this.epoch;
      this.running = Promise.resolve().then(async () => {
        let observed: number;
        do {
          observed = this.epoch;
          await Promise.all([...this.stopping]);
          if (this.disposed) break;
          if (observed !== this.epoch) continue;
          const evaluations = new Map<string, Promise<void>>();
          for (const id of this.order) {
            const prerequisites = (this.definition(id).requires?.modules ?? [])
              .map(dependency => evaluations.get(dependency)).filter((pending): pending is Promise<void> => !!pending);
            const evaluation = Promise.all(prerequisites).then(async () => {
              if (this.disposed || observed !== this.epoch) return;
              if (!this.enabled(id)) this.setState(id, { kind: "disabled" });
              else if (this.graphErrors.has(id)) {
                const previous = this.state.get(id)?.state;
                this.setState(id, { kind: "failed", error: this.graphErrors.get(id)!, at: previous?.kind === "failed" ? previous.at : Date.now() });
              } else if (this.failures.has(id)) {
                const failure = this.failures.get(id)!; this.setState(id, { kind: "failed", error: failure.message, at: failure.at });
              } else {
                const missing = this.missing(id);
                if (unavailable(missing)) this.setState(id, { kind: "unavailable", missing });
                else if (!this.owners.has(id)) await this.activate(id);
              }
              this.publish();
            });
            evaluations.set(id, evaluation);
          }
          await Promise.all(evaluations.values());
        } while (!this.disposed && observed !== this.epoch);
        completedEpoch = observed;
        if (observed === this.epoch) { this.retainedStatic.clear(); this.publish(); }
      }).then(() => {
        this.running = null;
        // A subscriber may enqueue work in a microtask after the loop's last
        // condition but before this continuation clears the running pointer.
        if (!this.disposed && completedEpoch !== this.epoch) return this.schedule();
      }, error => { this.running = null; throw error; });
    }
    return this.running;
  }
  private validateItem<S extends keyof M>(id: string, slot: S, item: M[S]): void {
    if (!Object.hasOwn(this.options.slots, slot)) throw new Error(`Unknown slot: ${String(slot)}`);
    if (!item.id.startsWith(id + ".") || item.id.length <= id.length + 1) throw new Error(`Contribution ID must start with ${id}.: ${item.id}`);
    if (item.order !== undefined && !Number.isFinite(item.order)) throw new Error(`Invalid contribution order: ${item.id}`);
  }
  private scopedPrefs(scope: ModuleScope): ModulePrefs {
    let stored = this.memory.get(scope.id);
    if (!stored) { stored = { values: new Map(), listeners: new Set() }; this.memory.set(scope.id, stored); }
    const data = stored;
    const raw: ModulePrefs = this.options.createPrefs?.(scope) ?? {
      get: <T extends Json>(key: string, fallback: T): T => cloneJson((data.values.has(key) ? data.values.get(key) : fallback) as T),
      set: (key, value) => { data.values.set(key, cloneJson(value)); for (const listener of [...data.listeners]) listener(); },
      subscribe: listener => { data.listeners.add(listener); return () => { data.listeners.delete(listener); }; },
    };
    return Object.freeze({
      get: <T extends Json>(key: string, fallback: T): T => { if (!scope.isCurrent()) throw aborted(); return raw.get(key, fallback); },
      set: (key: string, value: Json) => { if (scope.isCurrent()) raw.set(key, value); },
      subscribe: (listener: () => void) => createModuleServiceScope(scope).subscribe(fn => raw.subscribe(fn), listener),
    });
  }
  private async activate(id: string): Promise<void> {
    const generation = (this.generations.get(id) ?? 0) + 1; this.generations.set(id, generation);
    let cancel!: () => void;
    const owner: Owner<M[keyof M]> = { id, definition: this.definition(id), generation, controller: new AbortController(), closed: false, disposers: [], dynamic: [], sequence: 0,
      cancelled: new Promise<void>(resolve => { cancel = resolve; }), cancel: () => cancel() };
    const capturedHost = this.hostContext;
    const hosts: ModuleHostsContext = Object.freeze({
      list: () => { if (!isCurrent()) throw aborted(); return this.hostEntries; },
      get: (hostId: string) => { if (!isCurrent()) throw aborted(); return this.hostEntries.find(entry => entry.id === hostId); },
      subscribe: (listener: () => void) => {
        if (!isCurrent()) throw aborted();
        const notify = () => { if (isCurrent()) listener(); };
        this.hostListeners.add(notify);
        const off = () => { this.hostListeners.delete(notify); const index = owner.disposers.indexOf(off); if (index !== -1) owner.disposers.splice(index, 1); };
        owner.disposers.push(off);
        return off;
      },
    });
    this.owners.set(id, owner); this.setState(id, { kind: "activating" }); this.publish();
    const isCurrent = () => !this.disposed && !owner.closed && this.owners.get(id) === owner;
    const scope: ModuleScope = Object.freeze({ id, signal: owner.controller.signal, generation, host: capturedHost, hosts, isCurrent,
      onDispose: (dispose: Cleanup) => { if (!isCurrent()) throw aborted(); owner.disposers.push(dispose); } });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (!isCurrent()) return;
      const services = this.options.createServices?.(scope) as Services;
      if (!isCurrent()) return;
      const prefs = this.scopedPrefs(scope);
      const context: ModuleContext<M, Services, MessageKey> = Object.freeze({ id, signal: scope.signal, generation, host: scope.host, hosts,
        services, prefs,
        t: (key: MessageKey, vars?: Record<string, string | number>) => this.options.t?.(key, vars) ?? key,
        contribute: <S extends keyof M>(slot: S, item: M[S]) => {
          if (!isCurrent()) throw aborted();
          try {
            this.validateItem(id, slot, item);
            if ((this.definition(id).contributes?.[slot] ?? []).some(value => value.id === item.id)
              || owner.dynamic.some(value => value.slot === slot && value.item.id === item.id)) throw new Error(`Duplicate contribution: ${String(slot)}/${item.id}`);
          } catch (error) {
            this.failures.set(id, { message: text(error), at: Date.now() });
            this.invalidate(false, id); void this.schedule(); this.publish();
            throw error;
          }
          const entry = { slot, item, sequence: owner.sequence++ }; owner.dynamic.push(entry);
          const release = () => {
            const index = owner.dynamic.indexOf(entry);
            if (index === -1) return;
            owner.dynamic.splice(index, 1);
            const disposerIndex = owner.disposers.indexOf(release);
            if (disposerIndex !== -1) owner.disposers.splice(disposerIndex, 1);
            this.publish();
          };
          owner.disposers.push(release); this.publish(); return release;
        },
      });
      const task = Promise.resolve().then(() => { if (isCurrent()) return this.definition(id).activate?.(context); });
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`Module activation timed out after ${this.options.activationTimeoutMs ?? 10000} ms`)), this.options.activationTimeoutMs ?? 10000); });
      await Promise.race([task, timeout, owner.cancelled]);
      if (isCurrent()) this.setState(id, { kind: "active" });
    } catch (error) {
      if (isCurrent()) {
        const failure = { message: text(error), at: Date.now() }; this.failures.set(id, failure);
        await this.stop(owner);
        if (this.failures.get(id) === failure && this.definitions.get(id) === owner.definition) this.setState(id, { kind: "failed", error: failure.message, at: failure.at });
      }
    } finally { if (timer !== undefined) clearTimeout(timer); }
  }
  /** Registry identity changes only on successful registration/removal. */
  get modules(): readonly ModuleDefinition<M, Services, MessageKey>[] { return this.moduleSnapshot; }
  private refreshRegistry(): void {
    const graph = this.validateGraph(this.definitions);
    this.order = graph.order;
    this.graphErrors.clear();
    for (const [id, error] of graph.errors) this.graphErrors.set(id, error);
    for (const [id, error] of this.contributionErrors) if (this.definitions.has(id)) this.graphErrors.set(id, error);
    this.moduleSnapshot = Object.freeze([...this.definitions.values()]);
  }
  async addModules(definitions: readonly ModuleDefinition<M, Services, MessageKey>[]): Promise<void> {
    this.assertOpen();
    if (!definitions.length) return this.whenSettled();
    const candidate = new Map(this.definitions);
    for (const definition of definitions) {
      if (!/^[a-z][a-z0-9-]{0,63}$/.test(definition.id)) throw new Error(`Invalid module ID: ${definition.id}`);
      if (candidate.has(definition.id)) throw new Error(`Duplicate module ID: ${definition.id}`);
      candidate.set(definition.id, definition);
      for (const slot of Reflect.ownKeys(definition.contributes ?? {}) as (keyof M)[]) {
        const ids = new Set<string>();
        for (const item of definition.contributes?.[slot] ?? []) {
          this.validateItem(definition.id, slot, item);
          if (ids.has(item.id)) throw new Error(`Duplicate contribution: ${String(slot)}/${item.id}`);
          ids.add(item.id);
        }
      }
    }
    // Missing dependencies remain failed exactly as in the initial registry; cycles reject the batch.
    const graph = this.validateGraph(candidate);
    for (const [id, error] of graph.errors) {
      if (error.startsWith("Module dependency cycle:") && this.graphErrors.get(id) !== error) throw new Error(error);
    }
    for (const definition of definitions) {
      this.removed.delete(definition.id);
      this.definitions.set(definition.id, definition);
      this.state.set(definition.id, { state: { kind: "disabled" } });
    }
    this.refreshRegistry();
    const pending = this.schedule(); this.publish(); return pending;
  }
  async removeModule(id: string): Promise<void> {
    this.assertOpen();
    const definition = this.definitions.get(id);
    if (!definition) return this.whenSettled();
    if (definition.required) throw new Error(`Required module cannot be removed: ${id}`);
    const affected = new Set([id]);
    for (const key of this.order) if ((this.definition(key).requires?.modules ?? []).some(dep => affected.has(dep))) affected.add(key);
    const owners = [...this.order].reverse().filter(key => affected.has(key)).map(key => this.owners.get(key)).filter((owner): owner is Owner<M[keyof M]> => !!owner);
    // Publish registry removal before abort callbacks: a reentrant re-add is a newer registration.
    this.definitions.delete(id); this.state.delete(id); this.failures.delete(id);
    this.contributionErrors.delete(id); this.retainedStatic.delete(id); this.removed.add(id);
    this.refreshRegistry(); ++this.epoch;
    for (const owner of owners) owner.closed = true;
    let prior = Promise.resolve();
    for (const owner of owners) prior = this.stop(owner, prior);
    const pending = this.schedule(); this.publish(); return pending;
  }
  statuses = (): Readonly<Record<ModuleId, ModuleStatus>> => this.statusSnapshot;
  snapshot<S extends keyof M>(slot: S): readonly ModuleSlotEntry<M[S]>[] {
    const rows = this.snapshots.get(slot); if (!rows) throw new Error(`Unknown slot: ${String(slot)}`);
    return rows as readonly ModuleSlotEntry<M[S]>[];
  }
  subscribe = (listener: () => void): (() => void) => { this.assertOpen(); this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  whenSettled(): Promise<void> { return this.running ?? Promise.resolve(); }
  getPrefs(): ModulesPrefs { return { v: 1, enabled: { ...this.prefs.enabled }, place: { ...this.prefs.place } }; }
  private savePrefs(next: ModulesPrefs): void { this.options.onPrefsChange?.({ v: 1, enabled: { ...next.enabled }, place: { ...next.place } }); this.prefs = next; }
  setEnabled(id: string, on: boolean): Promise<void> {
    this.assertOpen(); const definition = this.definition(id);
    if (definition.required && !on) throw new Error(`Required module cannot be disabled: ${id}`);
    if (definition.required || this.enabled(id) === on) return this.whenSettled();
    this.savePrefs({ ...this.prefs, enabled: { ...this.prefs.enabled, [id]: on } });
    this.failures.delete(id); this.invalidate(); const pending = this.schedule(); this.publish(); return pending;
  }
  setHost(host: ModuleHostTarget): Promise<void> {
    return this.setHosts({ focus: host, others: [], scope: [host.id] });
  }
  setHosts(hosts: ModuleHostsTarget): Promise<void> {
    this.assertOpen();
    const others = hosts.others.filter(other => other.id !== hosts.focus.id);
    const sameOthers = others.length === this.others.length && others.every((other, index) => sameTarget(other, this.others[index]!));
    const sameScope = hosts.scope.length === this.scopeIds.length && hosts.scope.every((id, index) => id === this.scopeIds[index]);
    const focusChanged = !sameTarget(hosts.focus, this.target);
    if (!focusChanged && sameOthers && sameScope) return this.whenSettled();
    if (focusChanged) {
      // Keep established static entries in one batch across a host transition.
      // Initial activation still gates dependents on an actually active owner.
      for (const [id, status] of this.state) if (status.state.kind === "active") this.retainedStatic.add(id);
      this.target = this.copyTarget(hosts.focus); this.hostContext = this.contextHost(); this.failures.clear();
    }
    this.others = this.copyOthers(others);
    this.scopeIds = Object.freeze([...hosts.scope]);
    this.hostEntries = this.entries();
    // The focus is ctx.host: everything restarts. Other hosts / the scope: only modules whose
    // availability changed stop (invalidate) or start (schedule); entries are re-evaluated (publish).
    this.invalidate(focusChanged);
    const pending = this.schedule(); this.publish();
    if (!focusChanged) for (const listener of [...this.hostListeners]) { try { listener(); } catch { /* one subscriber cannot block the others */ } }
    return pending;
  }
  retry(id: string): Promise<void> {
    this.assertOpen(); this.definition(id); this.failures.delete(id); this.invalidate(false, id);
    const pending = this.schedule(); this.publish(); return pending;
  }
  setPlacement<S extends keyof M>(slot: S, itemId: M[S]["id"], value: string): void {
    this.assertOpen(); const spec = this.options.slots[slot]?.placement;
    if (!spec || !spec.values.includes(value)) throw new Error(`Invalid placement for ${String(slot)}: ${value}`);
    const exists = [...this.definitions.values()].some(definition => (definition.contributes?.[slot] ?? []).some(item => item.id === itemId))
      || [...this.owners.values()].some(owner => owner.dynamic.some(entry => entry.slot === slot && entry.item.id === itemId));
    if (!exists) throw new Error(`Unknown contribution: ${String(slot)}/${itemId}`);
    this.savePrefs({ ...this.prefs, place: { ...this.prefs.place, [`${String(slot)}:${itemId}`]: value } }); this.publish();
  }
  recordError(id: string, error: unknown): void {
    this.definition(id); const previous = this.state.get(id)!;
    this.state.set(id, Object.freeze({ ...previous, lastError: Object.freeze({ message: text(error), at: Date.now() }) })); this.publish();
  }
  async dispose(): Promise<void> {
    if (this.disposed) { await Promise.all([...this.stopping]); return; }
    this.disposed = true; ++this.epoch; this.invalidate(true); this.publish();
    await Promise.all([...this.stopping]); await this.running;
    for (const id of this.definitions.keys()) this.setState(id, { kind: "disabled" });
    this.publish(); this.listeners.clear();
  }
}
export function createModuleHost<M extends { [S in keyof M]: SlotItemBase }, Services = unknown, MessageKey extends string = string>(
  options: ModuleEngineOptions<M, Services, MessageKey>,
): ModuleHost<M, Services, MessageKey> { return new ModuleHost(options); }

/** Second-layer session gating. Unknown agent features remain available (lacks semantics). */
export function moduleSlotForAgent<T extends SlotItemBase & { agentFeature?: string }>(
  entries: readonly ModuleSlotEntry<T>[], features: Readonly<Record<string, boolean | undefined>> | null,
): readonly ModuleSlotEntry<T>[] {
  if (!features) return entries;
  let changed = false;
  const result: ModuleSlotEntry<T>[] = [];
  for (const entry of entries) {
    const feature = entry.item.agentFeature;
    if (!feature || features[feature] !== false) { result.push(entry); continue; }
    changed = true;
    if (entry.unavailable === "hide") continue;
    result.push(entry.missingAgentFeature === feature && !entry.available ? entry
      : Object.freeze({ ...entry, available: false, missingAgentFeature: feature }));
  }
  return changed ? Object.freeze(result) : entries;
}
