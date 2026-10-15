// Renderer facade contracts; the neutral engine uses ModuleSlotEntry internally.
import type { Json, ModuleId, ModuleDefinition, ModuleStatus, ModulePrefs, SlotItemBase, ModuleHostTarget, ModuleHostContext, ModuleHostsTarget } from './modules';
export type HostInput = ModuleHostTarget;
/** v1.5 */
export type HostsInput = ModuleHostsTarget;
export type HostInfo = ModuleHostContext;
export type PageParams = Readonly<Record<string, string | undefined>>;
export type Unavailable = 'hide' | 'disable' | 'notice';
export type SlotMapOf<M> = { [S in keyof M]: SlotItemBase };
export interface KeyValueStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export interface SlotEntry<T extends SlotItemBase> {
  item: T; moduleId: ModuleId; mode: 'show' | 'disable' | 'notice'; missing: readonly string[]; waiting: boolean;
}
export const MODULE_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;
export interface ModuleHost<M extends SlotMapOf<M>, Svc = unknown, K extends string = string> {
  readonly modules: readonly ModuleDefinition<M, Svc, K>[];
  /** Validates a complete batch before registering it; existing owners keep running. */
  addModules(definitions: readonly ModuleDefinition<M, Svc, K>[]): Promise<void>;
  /** Revokes a module and its dependents immediately; preserves preferences. Required modules reject removal. */
  removeModule(id: ModuleId): Promise<void>;
  /** Stable reference until something changes. */
  statuses(): ReadonlyMap<ModuleId, ModuleStatus>;
  /** Visible items of a slot, sorted; stable reference until the slot's content changes. */
  snapshot<S extends keyof M>(slot: S): readonly SlotEntry<M[S]>[];
  subscribe(listener: () => void): () => void;
  isEnabled(id: ModuleId): boolean;
  setEnabled(id: ModuleId, on: boolean): Promise<void>;
  /** Host or capability change → every module restarts (no-op when nothing changed). v1.5: = setHosts with the focus alone. */
  setHost(host: HostInput): Promise<void>;
  /**
   * v1.5: every connected host. A focus change (id, kind, capabilities) restarts every module; other
   * hosts / scope changes only re-evaluate (modules that became (un)available start / stop; ctx.hosts notifies).
   */
  setHosts(hosts: HostsInput): Promise<void>;
  retry(id: ModuleId): Promise<void>;
  /** A render / command error of a running module: recorded as `lastError`, the module keeps running. */
  reportError(id: ModuleId, error: unknown): void;
  prefs(id: ModuleId): ModulePrefs;
  /**
   * Placement of an item in a slot with `SlotSpec.placement` (§5): the owner's override when it is
   * one of the slot's values, else the slot's default for the item. Slots without placement: "".
   */
  placement<S extends keyof M>(slot: S, item: M[S]): string;
  /** Saves a placement override (a value equal to the default removes it). Unknown values are ignored. */
  setPlacement<S extends keyof M>(slot: S, item: M[S], value: string): void;
  /** The stored overrides (`${slot}:${itemId}` → value); stable reference until one changes. */
  placements(): Readonly<Record<string, string>>;
  /** Resolves when no lifecycle pass is pending. */
  idle(): Promise<void>;
  /** Stops every module (tests, HMR). */
  dispose(): Promise<void>;
}

export const MODULES_PREFS_KEY = "cutex-desktop.modules";
/** Key of a placement override in `ModulesPrefs.place`. */
export const placeKey = (slot: string, itemId: string) => `${slot}:${itemId}`;
export const modulePrefsKey = (id: ModuleId) => `cutex-desktop.module.${id}`;
