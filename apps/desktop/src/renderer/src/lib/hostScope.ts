// The view scope (multi-host RFC §3, §7, §8; P1 step 1) — pure model, no React / store imports
// (unit-tested in test/hostScope.test.ts). The React side is lib/useHostScope.ts.
//
// - Connection ≠ view: main connects every auto-connect host (+ the scope's hosts); the scope only
//   filters what the UI shows. Counts / notifications / approvals keep coming from every connected host.
// - The scope lives in main (hosts.json `scope`, persisted there; `setScope`). The focus host
//   (`HostsState.active`, `bridge.api`) is defined by main (P0): the scope's host, a group's first member,
//   this machine for "all devices".
// - Identity of anything a host owns is `(hostId, id)`: keys are `hostKey(hostId, id)` (lib/hostKeys,
//   `JSON.stringify([hostId, id])`), never a bare session / project id.
// - A host's look (color, label, platform icon, version) comes from its `HostView` only — see `HostLook`.
//
// Contract for the parallel P1 work: docs/research/multi-host-p1-interfaces.md.
import type { CutexBuild } from "@cutex-desktop/cutex-client";
import { HOST_PALETTE, LOCAL_HOST_ID, scopeHosts, type HostPlatform, type HostsState, type HostView, type ViewScope } from "../../../shared/hosts";
import type { ApprovalRecord, DaemonState, ServiceView, SidebarSnapshot } from "../../../shared/ipc";
import { hostKey, type HostKey } from "./hostKeys";
import { connIndicator, type HostIndicator } from "./hosts";
import { cutexBuildText } from "./settingsNav";

export type { ViewScope } from "../../../shared/hosts";
export { hostKey, parseHostKey, type HostKey } from "./hostKeys";

export const ALL_HOSTS: ViewScope = { kind: "all" };
export const singleHostScope = (id: string): ViewScope => ({ kind: "host", id });

/**
 * Storage / layout key of a scope (RFC §12, ★ Q17): `host:<id>` | `group:<id>` | `all`. Use it for
 * per-scope UI state (right-side layouts, scroll positions); never for data.
 */
export type ScopeKey = `host:${string}` | `group:${string}` | "all";
export function scopeKey(scope: ViewScope): ScopeKey {
  return scope.kind === "all" ? "all" : `${scope.kind}:${scope.id}`;
}

/** Everything the UI shows about one host (from its HostView + the store's live daemon state). */
export interface HostLook {
  id: string;
  kind: HostView["kind"];
  /** Display name (SSH: the configured label; this machine: its host name). */
  label: string;
  /** This machine (adds 「· 本机」 in the switcher). */
  local: boolean;
  /** `#rrggbb`: the configured host color (palette default). Use it for dots / chips / bars, never text. */
  color: string;
  /** From cutex `/v2/host.platform` at the last connect; null = never connected (generic server icon). */
  platform: HostPlatform | null;
  /** The host has a connection (connected, connecting or retrying); false = ⏻ off / not connected. */
  connected: boolean;
  /** Live status (focus: store `daemon`; others: their `byHost` slice; `disconnected` without a connection). */
  indicator: HostIndicator;
  /** cutex build of the current connection (null: not read yet / not connected / cutex before r224). */
  build: CutexBuild | null;
  /** Short version tag for the switcher: `r224`, else the short commit; null when unknown. */
  version: string | null;
  autoConnect: boolean;
  inScope: boolean;
  /** The focus host (`bridge.api`; P0 definition, main). */
  focus: boolean;
  view: HostView;
}

/** What `useHostScope()` returns (resolveHostScope for non-React code). */
export interface HostScope {
  scope: ViewScope;
  /** `scopeKey(scope)`. */
  key: ScopeKey;
  /** Every configured host in switcher order (this machine first). */
  hosts: HostLook[];
  /** The hosts in the scope, same order (connected or not). */
  hostsInScope: HostLook[];
  /** Ids of `hostsInScope`. */
  ids: string[];
  /** More than one host in the scope (all devices / a group). */
  multi: boolean;
  /**
   * Show per-host marks (dot / chip) on rows, group headers and list rows (RFC §8.2): always when
   * `multi`; in a one-host scope only with Settings → 主机 「单主机也显示主机标记」 (★ Q7 off).
   */
  showHostMarks: boolean;
  /** The focus host id (`HostsState.active`). */
  focus: string;
  isInScope(hostId: string): boolean;
  /** The look of any configured host (null: unknown / removed). */
  host(hostId: string): HostLook | null;
}

/** The slice of the store the scope is computed from (store `useApp` state). */
export interface ScopeSource {
  hosts: HostsState | null;
  /** The focus host's live daemon state. */
  daemon: DaemonState;
  /** Other connected hosts (their live daemon state). */
  byHost: Readonly<Record<string, { daemon: DaemonState }>>;
}

/** Short version tag: release (`r224`) or a 7-char commit; null when unknown. */
export function hostVersion(build: CutexBuild | null | undefined): string | null {
  if (!build) return null;
  if (build.release) return build.release;
  return build.commit ? build.commit.slice(0, 7) : null;
}

/** Full version text for tooltips (lib/settingsNav cutexBuildText style). */
export function hostVersionTitle(build: CutexBuild | null | undefined, text: { dev: string; legacy: string }): string {
  return cutexBuildText(build, text);
}

/** A host's configured color (palette default for older test fixtures / views without one). */
export function hostColor(host: Pick<HostView, "id" | "color"> | null | undefined, index = 0): string {
  if (host?.color) return host.color;
  return host?.id === LOCAL_HOST_ID ? HOST_PALETTE[0] : HOST_PALETTE[1 + (index % (HOST_PALETTE.length - 1))]!;
}

/** The live daemon state of `hostId`: the focus host's top-level state, a slice's, else the host notification's. */
export function hostDaemon(source: ScopeSource, hostId: string): DaemonState | null {
  const view = source.hosts?.hosts.find((h) => h.id === hostId);
  if (!view?.conn?.epoch && hostId !== source.hosts?.active) return null;
  if (hostId === (source.hosts?.active ?? LOCAL_HOST_ID)) return source.daemon;
  return source.byHost[hostId]?.daemon ?? view?.conn?.daemon ?? null;
}

export function hostLook(source: ScopeSource, view: HostView, inScope: boolean, index = 0): HostLook {
  const focus = view.id === (source.hosts?.active ?? LOCAL_HOST_ID);
  // Mock / early views may lack `conn.epoch` for the focus host: it is connected when the store says so.
  const connected = !!view.conn?.epoch || (focus && !!view.conn);
  const daemon = hostDaemon(source, view.id) ?? view.conn?.daemon ?? { kind: "unreachable", baseUrl: "", message: "not connected" };
  const build = connected ? (view.conn?.cutexBuild ?? null) : null;
  return {
    id: view.id,
    kind: view.kind,
    label: view.label,
    local: view.kind === "local",
    color: hostColor(view, index),
    platform: view.platform ?? null,
    connected,
    indicator: connIndicator(view.kind, view.conn?.tunnel ?? null, daemon, connected),
    build,
    version: hostVersion(build),
    autoConnect: view.autoConnect ?? true,
    inScope,
    focus,
    view,
  };
}

/** The scope model for a store state; `hostMarksSingle` = the 单主机也显示主机标记 pref. */
export function resolveHostScope(source: ScopeSource, hostMarksSingle = false): HostScope {
  const state = source.hosts;
  const scope: ViewScope = state?.scope ?? { kind: "host", id: LOCAL_HOST_ID };
  const inScope = new Set(state ? scopeHosts(state) : [LOCAL_HOST_ID]);
  const views = state?.hosts ?? [];
  const hosts = views.map((v, i) => hostLook(source, v, inScope.has(v.id), i));
  const hostsInScope = hosts.filter((h) => h.inScope);
  const byId = new Map(hosts.map((h) => [h.id, h] as const));
  const multi = hostsInScope.length > 1;
  return {
    scope,
    key: scopeKey(scope),
    hosts,
    hostsInScope,
    ids: hostsInScope.map((h) => h.id),
    multi,
    showHostMarks: multi || hostMarksSingle,
    focus: state?.active ?? LOCAL_HOST_ID,
    isInScope: (hostId) => inScope.has(hostId),
    host: (hostId) => byId.get(hostId) ?? null,
  };
}

/**
 * Hosts whose connected cutex version differs from another connected host in the scope (the
 * switcher highlights their version tag, RFC §7.2). Unknown versions never count.
 */
export function versionOutliers(hosts: readonly HostLook[]): Set<string> {
  const known = hosts.filter((h) => h.inScope && h.connected && h.version);
  const counts = new Map<string, number>();
  for (const h of known) counts.set(h.version!, (counts.get(h.version!) ?? 0) + 1);
  if (counts.size <= 1) return new Set();
  const top = Math.max(...counts.values());
  const majority = [...counts.entries()].filter(([, n]) => n === top).map(([v]) => v);
  // A tie has no majority: every host is "different".
  return new Set(known.filter((h) => majority.length > 1 || h.version !== majority[0]).map((h) => h.id));
}

/** The text of the switcher button (RFC §7.1): one host's name; 所有设备; a group's name. */
export function scopeTitle(scope: ViewScope, state: Pick<HostsState, "hosts" | "groups"> | null, text: { all: string }): string {
  if (scope.kind === "all") return text.all;
  if (scope.kind === "group") return state?.groups.find((g) => g.id === scope.id)?.name ?? scope.id;
  return state?.hosts.find((h) => h.id === scope.id)?.label ?? scope.id;
}

// ---------- per-host data (focus = top-level store fields; others = byHost slices) ----------

/** One connected host's data, the same shape for the focus host and the others. */
export interface HostData {
  hostId: string;
  focus: boolean;
  daemon: DaemonState;
  features: ReadonlySet<string>;
  featuresKnown: boolean;
  sidebar: SidebarSnapshot | null;
  approvals: ApprovalRecord[] | null;
  services: ServiceView[] | null;
}

/** The store fields `hostData` reads (store `useApp` state). */
export interface HostDataSource extends ScopeSource {
  features: ReadonlySet<string>;
  featuresKnown: boolean;
  sidebar: SidebarSnapshot | null;
  approvals: ApprovalRecord[] | null;
  services: ServiceView[] | null;
  byHost: Readonly<Record<string, Omit<HostData, "hostId" | "focus">>>;
}

/** `hostId`'s data; null when that host is neither the focus host nor followed (not connected). */
export function hostData(source: HostDataSource, hostId: string): HostData | null {
  if (hostId === (source.hosts?.active ?? LOCAL_HOST_ID)) {
    const { daemon, features, featuresKnown, sidebar, approvals, services } = source;
    return { hostId, focus: true, daemon, features, featuresKnown, sidebar, approvals, services };
  }
  const slice = source.byHost[hostId];
  if (!slice) return null;
  return { hostId, focus: false, daemon: slice.daemon, features: slice.features, featuresKnown: slice.featuresKnown, sidebar: slice.sidebar, approvals: slice.approvals, services: slice.services };
}

/**
 * Data of the given hosts (default: every host in the scope) that have any, in switcher order.
 * Disconnected hosts are left out — callers that keep showing them (RFC §8.5 greyed rows) use `HostLook`.
 */
export function scopedHostData(source: HostDataSource, ids?: readonly string[]): HostData[] {
  const wanted = ids ?? (source.hosts ? scopeHosts(source.hosts) : [LOCAL_HOST_ID]);
  const order = source.hosts?.hosts.map((h) => h.id) ?? [LOCAL_HOST_ID];
  const sorted = [...new Set(wanted)].sort((a, b) => rank(order, a) - rank(order, b));
  return sorted.map((id) => hostData(source, id)).filter((d): d is HostData => d !== null);
}

const rank = (order: readonly string[], id: string) => {
  const i = order.indexOf(id);
  return i < 0 ? order.length : i;
};

/** One item of a merged cross-host list. `key` = hostKey(hostId, id): unique across hosts. */
export interface HostItem<T> {
  hostId: string;
  key: HostKey;
  item: T;
}

/**
 * Merge per-host lists into one (cross-host pages: approvals, tasks, services, archive, …). Items keep
 * their host; `key` is the React / selection key. Without `compare` the result is host order (as
 * given) then each host's own order; with it, a stable sort over all items.
 */
export function mergeHostLists<T>(parts: Iterable<{ hostId: string; items: readonly T[] | null | undefined }>, id: (item: T) => string, compare?: (a: HostItem<T>, b: HostItem<T>) => number): HostItem<T>[] {
  const out: HostItem<T>[] = [];
  for (const part of parts) for (const item of part.items ?? []) out.push({ hostId: part.hostId, key: hostKey(part.hostId, id(item)), item });
  return compare ? out.map((x, i) => [x, i] as const).sort((a, b) => compare(a[0], b[0]) || a[1] - b[1]).map(([x]) => x) : out;
}

/** Sum a per-host number over hosts (counts / badges; RFC §10: counts span every connected host, not just the scope). */
export function sumHosts<T>(parts: Iterable<T>, count: (part: T) => number): number {
  let total = 0;
  for (const part of parts) total += count(part) || 0;
  return total;
}

/**
 * The host mark (dot / chip) for an entry of `hostId` in the sidebar: none when marks are off, and
 * none for the local host unless `localMarks` (only other hosts carry a mark, so “waveline” vs
 * “waveline · host-b” still tells same-named projects apart).
 */
export function sidebarMark(hosts: { marks: boolean; localMarks: boolean; look(hostId: string | undefined): HostLook | null } | null, hostId: string | undefined): HostLook | null {
  if (!hosts?.marks) return null;
  const look = hosts.look(hostId);
  return look && (!look.local || hosts.localMarks) ? look : null;
}
