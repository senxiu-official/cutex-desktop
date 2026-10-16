/** Built-in module contracts aligned with desktop-modules.md v1; no React imports. */
export type ModuleId = string;
export type ItemId = `${string}.${string}`;
export type HostKind = "local" | "ssh";
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface ModuleRequires {
  capabilities?: readonly string[];
  modules?: readonly ModuleId[];
  hostKinds?: readonly HostKind[];
  /** v1.5: only the focus host counts (default: any connected host satisfying the requirements activates the module). */
  focusHost?: boolean;
  /**
   * v1.15: an optional cutex component (spec name, e.g. "job-service") this module's pages need. The
   * module still activates on its capabilities; the app renders a component card instead of a page
   * body while the target host's component is not ready / external. The engine does not gate on it.
   */
  component?: string;
}
export interface SlotItemBase {
  id: ItemId;
  order?: number;
  requires?: { capabilities?: readonly string[] };
  unavailable?: "hide" | "disable" | "notice";
}
export interface SessionItemBase<AgentFeature extends string = string> extends SlotItemBase {
  agentFeature?: AgentFeature;
}
export interface SlotSpec<T extends SlotItemBase = SlotItemBase> {
  unavailable: "hide" | "disable" | "notice";
  placement?: { values: readonly string[]; default(item: T): string };
}
export interface ModuleMissing {
  capabilities: readonly string[];
  modules: readonly ModuleId[];
  hostKind: boolean;
  waiting: boolean;
}
export type ModuleState =
  | { kind: "disabled" }
  | { kind: "unavailable"; missing: ModuleMissing }
  | { kind: "activating" } | { kind: "active" } | { kind: "stopping" }
  | { kind: "failed"; error: string; at: number };
export interface ModuleStatus {
  readonly state: ModuleState;
  readonly lastError?: { readonly message: string; readonly at: number };
}
export interface ModulesPrefs {
  v: 1;
  enabled: Record<ModuleId, boolean>;
  place: Record<string, string>;
}
export interface ModulePrefs {
  get<T extends Json>(key: string, fallback: T): T;
  set(key: string, value: Json): void;
  subscribe(listener: () => void): () => void;
}
/** null means featureList has not loaded; an empty Set means loaded but empty. */
export interface ModuleHostTarget {
  readonly id: string;
  readonly kind: HostKind;
  readonly features: ReadonlySet<string> | null;
}
export interface ModuleHostContext {
  readonly id: string;
  readonly kind: HostKind;
  readonly features: ReadonlySet<string>;
}
/** v1.5 engine input: every connected host. The focus is the host the UI shows (= ctx.host). */
export interface ModuleHostsTarget {
  readonly focus: ModuleHostTarget;
  /** Connected hosts other than the focus. */
  readonly others: readonly ModuleHostTarget[];
  /** Host ids in the view scope (multi-host P0: the focus only). */
  readonly scope: readonly string[];
}
/** v1.5: one connected host as modules see it. */
export interface ModuleHostEntry extends ModuleHostContext {
  /** featureList has loaded (features is empty until then). */
  readonly featuresKnown: boolean;
  readonly focus: boolean;
  readonly inScope: boolean;
}
/** v1.5: live view of the connected hosts; changes do not restart modules (subscribe). */
export interface ModuleHostsContext {
  /** Connected hosts, focus first. */
  list(): readonly ModuleHostEntry[];
  get(id: string): ModuleHostEntry | undefined;
  /** Called when the connected hosts, their capabilities or the scope change; ends with the module. */
  subscribe(listener: () => void): () => void;
}
export interface ModuleScope {
  readonly id: ModuleId;
  readonly signal: AbortSignal;
  readonly generation: number;
  readonly host: ModuleHostContext;
  /** v1.5 */
  readonly hosts: ModuleHostsContext;
  isCurrent(): boolean;
  onDispose(dispose: () => void | Promise<void>): void;
}
export interface ModuleContext<M extends { [S in keyof M]: SlotItemBase }, Services = unknown, MessageKey extends string = string> {
  readonly id: ModuleId;
  readonly signal: AbortSignal;
  readonly generation: number;
  readonly host: ModuleHostContext;
  /** v1.5 */
  readonly hosts: ModuleHostsContext;
  readonly services: Services;
  readonly prefs: ModulePrefs;
  contribute<S extends keyof M>(slot: S, item: M[S]): () => void;
  t(key: MessageKey, vars?: Record<string, string | number>): string;
}
export interface ModuleDefinition<M extends { [S in keyof M]: SlotItemBase }, Services = unknown, MessageKey extends string = string> {
  id: ModuleId;
  titleKey: MessageKey;
  /** Plain user-provided title for dynamic external modules; titleKey remains the typed fallback. */
  displayName?: string;
  descriptionKey?: MessageKey;
  requires?: ModuleRequires;
  required?: boolean;
  defaultEnabled?: boolean;
  contributes?: { readonly [S in keyof M]?: readonly M[S][] };
  activate?(context: ModuleContext<M, Services, MessageKey>): void | Promise<void>;
}
export interface ModuleSlotEntry<T extends SlotItemBase> {
  readonly moduleId: ModuleId;
  readonly item: T;
  readonly available: boolean;
  readonly unavailable: "hide" | "disable" | "notice";
  readonly missing: ModuleMissing;
  readonly placement?: string;
  readonly missingAgentFeature?: string;
}
export interface ModuleEngineOptions<M extends { [S in keyof M]: SlotItemBase }, Services = unknown, MessageKey extends string = string> {
  modules: readonly ModuleDefinition<M, Services, MessageKey>[];
  slots: { readonly [S in keyof M]: SlotSpec<M[S]> };
  host: ModuleHostTarget;
  /** v1.5: the other connected hosts and the scope (default: the focus host alone). */
  hosts?: ModuleHostsTarget;
  prefs?: ModulesPrefs;
  onPrefsChange?(prefs: ModulesPrefs): void;
  createServices?(scope: ModuleScope): Services;
  createPrefs?(scope: ModuleScope): ModulePrefs;
  t?(key: MessageKey, vars?: Record<string, string | number>): string;
  activationTimeoutMs?: number;
}
