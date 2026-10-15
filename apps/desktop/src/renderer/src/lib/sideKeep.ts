// Keep-mounted holds (docs/desktop-modules.md §18.13, contract v1.9) and the instance layer's mount
// plan. A keepAlive "hidden" component may ask, from its Body / Actions (`SideBodyProps.keepMounted`),
// that one instance stays mounted while it holds something live (a lease, a session …). A held
// instance is never evicted by the off-screen LRU (`sideKeepHidden` most recent ones), stays mounted
// (hidden) when its binding is not visible and when the view scope switches to another host (a
// snapshot of the instance is kept here for that), and unmounts only when the component releases it,
// the tab is closed, its module stops, its host is removed or reconnects with a new epoch, or the
// app exits. Holds are per window, in memory only, at most `sideKeepMounted` (★4, 1–8) at a time.
// v1.10: `services.side.open(kind, params, { hold: true })` creates (or reuses) an instance and takes
// its first hold in the same call, so a background card nobody sees is mounted (hidden) from its first
// render; the caller gets a `SideHoldLocator` that can only drop that pre-hold (releaseHold).
import { create } from "zustand";
import { hostEpoch } from "../../../shared/hosts";
import { useApp } from "../store";
import { getUiPrefs } from "./prefs";
import type { SideHoldLocator } from "../modules/slots";
import type { SideInstance } from "./sideLayout";

export type { SideHoldLocator };

/** Off-screen LRU size for keepAlive "hidden" instances (setting 1–12, ★4). */
export const KEEP_HIDDEN_RANGE = [1, 12] as const;
export const KEEP_HIDDEN_DEFAULT = 4;
/** Keep-mounted holds per window (setting 1–8, ★4), counted apart from the LRU. */
export const KEEP_MOUNTED_RANGE = [1, 8] as const;
export const KEEP_MOUNTED_DEFAULT = 4;

export const clampSetting = (v: unknown, range: readonly [number, number], def: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(range[1], Math.max(range[0], Math.round(v))) : def;

export interface SideHold {
  /** The view scope whose layout owns the instance ("host:<id>"). */
  scope: string;
  id: string;
  /** The latest copy of the instance (rendered from it while the scope is elsewhere). */
  inst: SideInstance;
  /** The bound host's connection epoch when held (null = not connected then). */
  epoch: string | null;
  /** setState while out of scope: written back when the scope returns. */
  dirty: boolean;
  /** v1.10: taken by services.side.open({ hold: true }); only that open's locator may drop it (and discard a card it created). */
  ticket?: HoldTicket;
}

export interface HoldTicket {
  token: string;
  /** The open created the instance (false = it reused an existing one: never discarded through the locator). */
  created: boolean;
}

export type SideHolds = Readonly<Record<string, SideHold>>;

export const holdKey = (scope: string, id: string): string => `${scope}\u0000${id}`;

// ── Pure rules ──────────────────────────────────────────────────────────────────────────────────

export type HoldRequest = { scope: string; id: string; inst: SideInstance; keepAlive: "unmount" | "hidden" | undefined; epoch: string | null };

/** Applies keepMounted(hold) and returns the new holds and whether the instance is held afterwards. `ticket`: a new hold taken by open({ hold }). */
export function applyHold(holds: SideHolds, req: HoldRequest, hold: boolean, limit: number, ticket?: HoldTicket): { holds: SideHolds; held: boolean } {
  const key = holdKey(req.scope, req.id);
  if (!hold) {
    if (!holds[key]) return { holds, held: false };
    const next = { ...holds };
    delete next[key];
    return { holds: next, held: false };
  }
  if (holds[key]) return { holds, held: true };
  // Only components that already live hidden off screen; never more than the window's limit.
  if (req.keepAlive !== "hidden" || Object.keys(holds).length >= limit) return { holds, held: false };
  const h: SideHold = { scope: req.scope, id: req.id, inst: req.inst, epoch: req.epoch, dirty: false, ...(ticket ? { ticket } : {}) };
  return { holds: { ...holds, [key]: h }, held: true };
}

export interface HoldScopeInput {
  /** The binding's host is known (local, or in the host list). */
  known: boolean;
  /** The binding's host is in the loaded view scope (the scope's hosts or its focus host). */
  inScope: boolean;
  /** Agent bindings: the agent is on its host's sidebar (null = no agent binding, or that sidebar is not loaded yet). */
  agentKnown: boolean | null;
  /** The host's connection epoch now (null = not connected). */
  epoch: string | null;
  /** open({ holdEpoch }): the epoch the caller's request belongs to. */
  expectEpoch?: string;
}

/**
 * v1.10 scope rule of open({ hold: true }): the card is created in the loaded view scope's layout (the
 * focus host's), bound to the given binding, without selecting its agent or switching scope. A binding
 * the loaded scope cannot show is refused instead of switching scope implicitly.
 */
export function holdScopeCheck(input: HoldScopeInput): "ok" | "scope-invalid" | "scope-unsupported" | "host-offline" | "stale" {
  if (!input.known) return "scope-invalid";
  if (!input.inScope) return "scope-unsupported";
  if (input.agentKnown === false) return "scope-invalid";
  if (input.epoch === null) return "host-offline";
  if (input.expectEpoch !== undefined && input.expectEpoch !== input.epoch) return "stale";
  return "ok";
}

/** v1.10: why open({ hold: true }) cannot take a hold, checked before anything changes. */
export type HoldAdmission = "ok" | "not-holdable" | "hold-limit";

/**
 * Whether open({ hold: true }) may hold instance `id` of `scope` (null = a new instance): only keepAlive
 * "hidden" components, and within the window's limit unless that instance is already held — the same
 * rule and the same count as keepMounted(true), no separate quota.
 */
export function admitHold(holds: SideHolds, scope: string, id: string | null, keepAlive: "unmount" | "hidden" | undefined, limit: number): HoldAdmission {
  if (keepAlive !== "hidden") return "not-holdable";
  if (id !== null && holds[holdKey(scope, id)]) return "ok";
  return Object.keys(holds).length >= limit ? "hold-limit" : "ok";
}

/**
 * releaseHold(locator): drops the hold only while it is still the one this locator's open took (same
 * scope, id and ticket token). A hold the Body released (or re-took itself), one the shell revoked, and
 * every other instance's hold are left alone. `discard` also asks for the card to be closed — only when
 * that open created it.
 */
export function releaseTicket(holds: SideHolds, loc: SideHoldLocator, discard: boolean): { holds: SideHolds; released: boolean; close: boolean } {
  const key = holdKey(loc.scope, loc.instanceId);
  const h = holds[key];
  if (!h || !h.ticket || !loc.token || h.ticket.token !== loc.token) return { holds, released: false, close: false };
  const next = { ...holds };
  delete next[key];
  return { holds: next, released: true, close: discard && h.ticket.created };
}

export interface PruneInput {
  /** The scope whose layout is loaded now and its instances. */
  scope: string | null;
  instances: Readonly<Record<string, SideInstance>>;
  /** The component is registered (module on) and keeps alive "hidden". */
  keeps(kind: string): boolean;
  /** The host is still known (local is always known). */
  hostKnown(hostId: string): boolean;
  /** The host's current connection epoch (null = not connected). */
  epochOf(hostId: string): string | null;
}

/**
 * Drops holds that no longer apply: the tab was closed (not in its own scope's layout any more), the
 * component is gone or no longer hidden-alive, the host was removed, or it reconnected with a new
 * epoch (a disconnect alone keeps the hold). Refreshes the snapshot of the loaded scope's held
 * instances. Returns the same object when nothing changed.
 */
export function pruneHolds(holds: SideHolds, input: PruneInput): SideHolds {
  let next: Record<string, SideHold> | null = null;
  const edit = () => (next ??= { ...holds });
  for (const [key, h] of Object.entries(holds)) {
    const here = h.scope === input.scope;
    const inst = here ? input.instances[h.id] : h.inst;
    const now = inst ? input.epochOf(inst.binding.hostId) : null;
    const gone =
      !inst ||
      !input.keeps(inst.kind) ||
      !input.hostKnown(inst.binding.hostId) ||
      (h.epoch !== null && now !== null && now !== h.epoch);
    if (gone) {
      delete edit()[key];
      continue;
    }
    const epoch = h.epoch ?? now;
    if (here && (inst !== h.inst || epoch !== h.epoch) && !h.dirty) edit()[key] = { ...h, inst, epoch };
    else if (epoch !== h.epoch) edit()[key] = { ...h, epoch };
  }
  return next ?? holds;
}

export interface MountPlanInput {
  /** Instances with a placeholder on screen (registered kinds only). */
  onScreen: readonly string[];
  /** Last render's LRU order (most recent first). */
  kept: readonly string[];
  /** keepAlive "hidden" and binding-visible: may take an LRU place. */
  keepable(id: string): boolean;
  /** Held in the loaded scope (§18.13): mounted regardless of the LRU and of visibility. */
  held: ReadonlySet<string>;
  /** Kept through a maximise / full-screen mode. */
  modeKept: readonly string[];
  keepHidden: number;
}

/** Which instances of the loaded scope are mounted, sorted by id, and the next LRU order. */
export function mountPlan(input: MountPlanInput): { mounted: string[]; kept: string[] } {
  const onScreen = new Set(input.onScreen);
  const lru = (id: string) => input.keepable(id) && !input.held.has(id);
  const recent = [...input.onScreen.filter(lru), ...input.kept.filter((id) => !onScreen.has(id))].filter((id, k, all) => lru(id) && all.indexOf(id) === k);
  const hidden = recent.filter((id) => !onScreen.has(id)).slice(0, input.keepHidden);
  const mounted = [...new Set([...input.onScreen, ...hidden, ...input.modeKept, ...input.held])].sort();
  return { mounted, kept: [...input.onScreen.filter(lru), ...hidden] };
}

// ── Store ───────────────────────────────────────────────────────────────────────────────────────

export const useSideKeep = create<{ holds: SideHolds }>(() => ({ holds: {} }));

export const keepHiddenLimit = (): number => clampSetting(getUiPrefs().sideKeepHidden, KEEP_HIDDEN_RANGE, KEEP_HIDDEN_DEFAULT);
export const keepMountedLimit = (): number => clampSetting(getUiPrefs().sideKeepMounted, KEEP_MOUNTED_RANGE, KEEP_MOUNTED_DEFAULT);

/** SideBodyProps.keepMounted for instance `id` of `scope`: true = hold, false = release; returns whether it is held now. */
export function setSideHold(scope: string | null, id: string, inst: SideInstance, keepAlive: "unmount" | "hidden" | undefined, hold: boolean): boolean {
  if (!scope) return false;
  const holds = useSideKeep.getState().holds;
  const r = applyHold(holds, { scope, id, inst, keepAlive, epoch: hostEpoch(useApp.getState().hosts, inst.binding.hostId) }, hold, keepMountedLimit());
  if (r.holds !== holds) useSideKeep.setState({ holds: r.holds });
  return r.held;
}

/**
 * v1.10 open({ hold }): takes the pre-hold of an instance just placed (admitted before the layout
 * changed, so this cannot hit the limit). An instance already held (the Body's own hold, or another
 * open's) stays as it is: the locator then has an empty token and drops nothing.
 */
export function takeTicketHold(scope: string, id: string, inst: SideInstance, created: boolean): SideHoldLocator | null {
  const holds = useSideKeep.getState().holds;
  const token = newToken();
  const r = applyHold(holds, { scope, id, inst, keepAlive: "hidden", epoch: hostEpoch(useApp.getState().hosts, inst.binding.hostId) }, true, keepMountedLimit(), { token, created });
  if (!r.held) return null;
  if (r.holds === holds) return { scope, instanceId: id, token: "" };
  useSideKeep.setState({ holds: r.holds });
  return { scope, instanceId: id, token };
}

/** v1.10 services.side.releaseHold: drops this locator's pre-hold; returns whether it did and whether its card is to be closed. */
export function releaseSideHold(loc: SideHoldLocator, discard: boolean): { released: boolean; close: boolean } {
  const holds = useSideKeep.getState().holds;
  const r = releaseTicket(holds, loc, discard);
  if (r.holds !== holds) useSideKeep.setState({ holds: r.holds });
  return { released: r.released, close: r.close };
}

function newToken(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** setState of a held instance while its scope is not loaded: kept on the snapshot, written back on return. */
export function setHeldState(scope: string, id: string, state: SideInstance["state"], v: number): void {
  const holds = useSideKeep.getState().holds;
  const key = holdKey(scope, id);
  const h = holds[key];
  if (!h) return;
  useSideKeep.setState({ holds: { ...holds, [key]: { ...h, inst: { ...h.inst, state, v }, dirty: true } } });
}

/** The dirty snapshot states of the loaded scope were written back: clear the flags. */
export function clearHeldDirty(scope: string, ids: readonly string[]): void {
  const holds = useSideKeep.getState().holds;
  let next: Record<string, SideHold> | null = null;
  for (const id of ids) {
    const key = holdKey(scope, id);
    if (holds[key]?.dirty) (next ??= { ...holds })[key] = { ...holds[key]!, dirty: false };
  }
  if (next) useSideKeep.setState({ holds: next });
}

/** Tests only. */
export function resetSideHolds(): void {
  useSideKeep.setState({ holds: {} });
}
