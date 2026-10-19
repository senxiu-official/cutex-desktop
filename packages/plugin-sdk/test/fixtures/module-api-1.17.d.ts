// index.d.ts
/** Desktop module contract version (docs/desktop-modules.md). */
export declare const MODULE_API_VERSION: "1.17";
export * from './modules';
export * from './renderer';
export * from './packs';

// modules.d.ts
/** Built-in module contracts aligned with desktop-modules.md v1; no React imports. */
export type ModuleId = string;
export type ItemId = `${string}.${string}`;
export type HostKind = "local" | "ssh";
export type Json = null | boolean | number | string | Json[] | {
    [key: string]: Json;
};
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
    requires?: {
        capabilities?: readonly string[];
    };
    unavailable?: "hide" | "disable" | "notice";
}
export interface SessionItemBase<AgentFeature extends string = string> extends SlotItemBase {
    agentFeature?: AgentFeature;
}
export interface SlotSpec<T extends SlotItemBase = SlotItemBase> {
    unavailable: "hide" | "disable" | "notice";
    placement?: {
        values: readonly string[];
        default(item: T): string;
    };
}
export interface ModuleMissing {
    capabilities: readonly string[];
    modules: readonly ModuleId[];
    hostKind: boolean;
    waiting: boolean;
}
export type ModuleState = {
    kind: "disabled";
} | {
    kind: "unavailable";
    missing: ModuleMissing;
} | {
    kind: "activating";
} | {
    kind: "active";
} | {
    kind: "stopping";
} | {
    kind: "failed";
    error: string;
    at: number;
};
export interface ModuleStatus {
    readonly state: ModuleState;
    readonly lastError?: {
        readonly message: string;
        readonly at: number;
    };
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
export interface ModuleContext<M extends {
    [S in keyof M]: SlotItemBase;
}, Services = unknown, MessageKey extends string = string> {
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
export interface ModuleDefinition<M extends {
    [S in keyof M]: SlotItemBase;
}, Services = unknown, MessageKey extends string = string> {
    id: ModuleId;
    titleKey: MessageKey;
    /** Plain user-provided title for dynamic external modules; titleKey remains the typed fallback. */
    displayName?: string;
    descriptionKey?: MessageKey;
    requires?: ModuleRequires;
    required?: boolean;
    defaultEnabled?: boolean;
    contributes?: {
        readonly [S in keyof M]?: readonly M[S][];
    };
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
export interface ModuleEngineOptions<M extends {
    [S in keyof M]: SlotItemBase;
}, Services = unknown, MessageKey extends string = string> {
    modules: readonly ModuleDefinition<M, Services, MessageKey>[];
    slots: {
        readonly [S in keyof M]: SlotSpec<M[S]>;
    };
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

// packs.d.ts
import type { ModuleDefinition, SlotItemBase } from './modules';
/** Name of the global the app installs before importing a pack entry. */
export declare const MODULE_PACK_HOST_GLOBAL = "__CUTEX_MODULE_HOST__";
/** The host object packs read shared modules from (an import-map style shim). */
export interface ModulePackHost {
    /** The app's MODULE_API_VERSION. */
    readonly apiVersion: string;
    /** The app's namespace object for a shared specifier (`react`, `@cutex-desktop/app/store`, …); throws for unknown ones. */
    get(specifier: string): Readonly<Record<string, unknown>>;
}
/** Messages a pack brings: locale → { "<moduleId>.<key>": text }; only keys of its own module. */
export type ModulePackMessages = Readonly<Record<string, Readonly<Record<string, string>>>>;
/** What a pack entry module exports. */
export interface ModulePackEntry<M extends {
    [S in keyof M]: SlotItemBase;
} = Record<string, SlotItemBase>, Svc = unknown, K extends string = string> {
    /** semver range over MODULE_API_VERSION, e.g. "^1.16"; the same as in the signed index. */
    readonly moduleApi: string;
    readonly module: ModuleDefinition<M, Svc, K>;
    readonly messages?: ModulePackMessages;
}
/** One comparator of a parsed range; versions are [major, minor, patch]. */
export interface ModuleApiComparator {
    readonly op: '>=' | '>' | '<=' | '<' | '=';
    readonly version: readonly [number, number, number];
}
/**
 * A range as comparators (all must hold): `^1.16` (>=1.16.0 <2.0.0; `^0.3` = >=0.3.0 <0.4.0), `~1.16`
 * (>=1.16.0 <1.17.0), `>=1.16 <2` (a bare major = M.0.0), `1.16` / `=1.16` (exactly 1.16.0). Null when malformed.
 */
export declare function parseModuleApiRange(range: string): ModuleApiComparator[] | null;
/** Whether `version` (MODULE_API_VERSION, `M.m[.p]`) satisfies `range`; false for a malformed range or version. */
export declare function moduleApiSatisfies(range: string, version: string): boolean;
/**
 * Compatibility of a pack's range with the app: `ok`; `needsNewerApp` when the app is below what the
 * range asks (a lower bound above it, or a malformed range — an app that cannot read it is too old);
 * `needsNewerModule` when the app is past the range.
 */
export declare function moduleApiVerdict(range: string, version: string): 'ok' | 'needsNewerApp' | 'needsNewerModule';

// renderer.d.ts
import type { ModuleId, ModuleDefinition, ModuleStatus, ModulePrefs, SlotItemBase, ModuleHostTarget, ModuleHostContext, ModuleHostsTarget } from './modules';
export type HostInput = ModuleHostTarget;
/** v1.5 */
export type HostsInput = ModuleHostsTarget;
export type HostInfo = ModuleHostContext;
export type PageParams = Readonly<Record<string, string | undefined>>;
export type Unavailable = 'hide' | 'disable' | 'notice';
export type SlotMapOf<M> = {
    [S in keyof M]: SlotItemBase;
};
export interface KeyValueStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}
export interface SlotEntry<T extends SlotItemBase> {
    item: T;
    moduleId: ModuleId;
    mode: 'show' | 'disable' | 'notice';
    missing: readonly string[];
    waiting: boolean;
}
export declare const MODULE_ID_RE: RegExp;
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
export declare const MODULES_PREFS_KEY = "cutex-desktop.modules";
/** Key of a placement override in `ModulesPrefs.place`. */
export declare const placeKey: (slot: string, itemId: string) => string;
export declare const modulePrefsKey: (id: ModuleId) => string;
