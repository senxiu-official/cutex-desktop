// Optional components per host, memory only (components spec v2 §4–§5): `GET /v2/components` of the
// hosts a component card looks at, the install / remove this desktop asked for and its answer. The
// host event `cutex/components/updated` (any change, install progress) triggers a re-read; a slow poll
// covers a missed one while something is going. Read while a card is mounted (lib/componentView
// useHostComponents) or on demand (componentUsableNow). No React / app-store imports: lib/jobStore uses it.
import { create } from "zustand";
import { COMPONENTS_FEATURE, componentEventOf, componentIndexEventOf, isOperationRunning, type ComponentAction, type ComponentConfigureRequest, type ComponentOperation, type ComponentOperationResult, type ComponentRefusal, type ComponentResult, type ComponentsList } from "../../../shared/components";
import { apiFor, bridge } from "../bridge";
import { componentUsable } from "./componentCard";
import { onHostReset } from "./hostSwitch";

export interface HostComponents {
  /** undefined: not read yet; null: the host has no components route (older cutex). */
  list: ComponentsList | null | undefined;
  /** The last read failed (the previous list stays shown). */
  error: string | null;
  /** An install / remove this desktop sent and cutex accepted, until the list shows it (or its end). */
  pending: { name: string; action: ComponentAction; at: number } | null;
  /** The last refusal / failure of a request of this desktop (shown on the card until the next one). */
  refusal: { name: string; action: ComponentAction | "configure" | "indexCheck"; error: ComponentRefusal } | null;
  /**
   * r269: the last terminal `result` cutex reported per component (event, reply or list), memory only. `done` never
   * means selected: the card says what `outcome` / `selected` say.
   */
  results: Readonly<Record<string, { action: string | null; result: ComponentOperationResult }>>;
  /** Hosts whose "update cutex" card the owner chose to skip (older host with a hand-made service). */
  bypass: readonly string[];
}

export const EMPTY_COMPONENTS: HostComponents = { list: undefined, error: null, pending: null, refusal: null, bypass: [], results: {} };

export const useComponentStore = create<{ byHost: Record<string, HostComponents> }>(() => ({ byHost: {} }));

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function patch(hostId: string, change: Partial<HostComponents>): void {
  useComponentStore.setState((s) => ({ byHost: { ...s.byHost, [hostId]: { ...(s.byHost[hostId] ?? EMPTY_COMPONENTS), ...change } } }));
}

export function hostComponents(hostId: string): HostComponents {
  return useComponentStore.getState().byHost[hostId] ?? EMPTY_COMPONENTS;
}

const inflight = new Map<string, Promise<void>>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
/** Bumped by a host reset: a read started before it must not patch the old host's state back in. */
const epochs = new Map<string, number>();
const epochOf = (hostId: string) => epochs.get(hostId) ?? 0;
/** When each remembered result was noted (a counter, per host and component): a read started before it must not drop it. */
let noteTick = 0;
const notedAt = new Map<string, Map<string, number>>();

/** Forget a host (reset / switch): drop its state and fence off reads still in flight. */
export function resetHostComponents(hostId: string): void {
  epochs.set(hostId, epochOf(hostId) + 1);
  inflight.delete(hostId);
  notedAt.delete(hostId);
  const t = timers.get(hostId);
  if (t) clearTimeout(t);
  timers.delete(hostId);
  useComponentStore.setState((s) => (s.byHost[hostId] ? { byHost: Object.fromEntries(Object.entries(s.byHost).filter(([id]) => id !== hostId)) } : s));
}

/** A request that never shows up in the list stops counting as pending after this. */
const PENDING_MAX_MS = 120_000;

/** The pending request is over once cutex's list no longer runs it and shows a settled state. */
function settled(list: ComponentsList, pending: NonNullable<HostComponents["pending"]>): boolean {
  if (Date.now() - pending.at > PENDING_MAX_MS) return true;
  const op = list.operation;
  if (op && op.name === pending.name) return !isOperationRunning(op);
  const c = list.components.find((x) => x.name === pending.name);
  if (!c) return true;
  if (c.state === "installing") return false;
  // No operation in the list: an install is over once the component left `missing`.
  return pending.action === "install" ? c.state !== "missing" : true;
}

export function loadComponents(hostId: string): Promise<void> {
  const running = inflight.get(hostId);
  if (running) return running;
  const epoch = epochOf(hostId);
  const readFrom = noteTick;
  const run = (async () => {
    try {
      const list = await apiFor(hostId).components();
      if (epochOf(hostId) !== epoch) return;
      const pending = hostComponents(hostId).pending;
      patch(hostId, { list, error: null, ...(pending && (!list || settled(list, pending)) ? { pending: null } : {}) });
      if (list?.operation) noteResult(hostId, list.operation);
      else if (list) forgetResults(hostId, readFrom);
    } catch (e) {
      if (epochOf(hostId) === epoch) patch(hostId, { error: errorText(e) });
    } finally {
      if (epochOf(hostId) === epoch) inflight.delete(hostId);
    }
  })();
  inflight.set(hostId, run);
  return run;
}

/** Keep a terminal r269 `result` of a named operation (index refreshes have none). */
function noteResult(hostId: string, op: ComponentOperation | null | undefined): void {
  if (!op?.result || !op.name || isOperationRunning(op)) return;
  const results = hostComponents(hostId).results;
  const cur = results[op.name];
  if (cur && cur.action === op.action && cur.result.outcome === op.result.outcome && cur.result.version === op.result.version && cur.result.selected === op.result.selected) return;
  patch(hostId, { results: { ...results, [op.name]: { action: op.action, result: op.result } } });
  const at = notedAt.get(hostId) ?? new Map<string, number>();
  at.set(op.name, ++noteTick);
  notedAt.set(hostId, at);
}

/**
 * cutex reports no operation any more (a daemon restart forgets the last one): drop the result rows it no longer
 * reports. Only those noted before this read started: a reply / event that came in meanwhile is newer than the list.
 */
function forgetResults(hostId: string, readFrom: number): void {
  const results = hostComponents(hostId).results;
  const at = notedAt.get(hostId);
  const keep = Object.entries(results).filter(([name]) => (at?.get(name) ?? 0) > readFrom);
  if (keep.length === Object.keys(results).length) return;
  for (const name of Object.keys(results)) if (!keep.some(([k]) => k === name)) at?.delete(name);
  patch(hostId, { results: Object.fromEntries(keep) });
}

/** Re-read a host soon (progress events come in bursts: coalesce them). */
export function scheduleComponentsReload(hostId: string, delayMs = 300): void {
  if (timers.has(hostId)) return;
  timers.set(
    hostId,
    setTimeout(() => {
      timers.delete(hostId);
      void loadComponents(hostId);
    }, delayMs),
  );
}

/**
 * Ask cutex to install / remove a component (empty body; 202 `{operation}`). cutex downloads, verifies,
 * prepares and selects it; this desktop only follows the state. Refusals stay on the card. r269:
 * `check` re-runs the external-install probe; install `{version}` picks a version of the effective verified offers.
 */
export async function requestComponent(hostId: string, name: string, action: ComponentAction, opts: { version?: string } = {}): Promise<void> {
  await send(hostId, name, action, () => (opts.version ? apiFor(hostId).componentAction(name, action, { version: opts.version }) : apiFor(hostId).componentAction(name, action)));
}

/**
 * r269 owner action (Moth's route, shared/componentIndex.ts; mocked until it lands): store the external npm
 * prefix / Node / rg paths of an adapter component on its host; cutex re-runs the readiness probe. Refusals stay on the card.
 */
export async function configureComponent(hostId: string, name: string, req: ComponentConfigureRequest): Promise<void> {
  await send(hostId, name, "configure", () => apiFor(hostId).componentConfigure(name, req));
}

/** r269: ask cutex to refresh the signed index (its own operation, GET `indexOperation`). `name`: the card that asked (shows a refusal). */
export async function checkComponentIndex(hostId: string, name: string): Promise<void> {
  await send(hostId, name, "indexCheck", () => apiFor(hostId).componentIndexCheck());
}

async function send(hostId: string, name: string, action: ComponentAction | "configure" | "indexCheck", call: () => Promise<ComponentResult>): Promise<void> {
  const epoch = epochOf(hostId);
  // configure / check / index check never install: nothing pending (the card keeps showing what cutex reports).
  const owns = action === "install" || action === "remove";
  const done = owns ? { pending: null } : {};
  // A new request on this component replaces the last outcome shown for it (an index refresh is not about it).
  const { [name]: _last, ...rest } = hostComponents(hostId).results;
  const results = action === "indexCheck" ? hostComponents(hostId).results : rest;
  patch(hostId, { ...(owns ? { pending: { name, action: action as ComponentAction, at: Date.now() } } : {}), refusal: null, results });
  try {
    const r = await call();
    if (epochOf(hostId) !== epoch) return;
    if (!r.ok) patch(hostId, { ...done, refusal: { name, action, error: r.error } });
    // cutex finished at once (or named no operation): nothing to wait for.
    else if (!isOperationRunning(r.value)) {
      patch(hostId, done);
      noteResult(hostId, r.value);
    }
  } catch (e) {
    if (epochOf(hostId) === epoch) patch(hostId, { ...done, refusal: { name, action, error: { code: "request_failed", message: errorText(e), status: 0 } } });
  }
  if (epochOf(hostId) === epoch) await loadComponents(hostId);
}

/** Show the page of an older host anyway (its service may be set up by hand); memory only. */
export function bypassUpdateCard(hostId: string, name: string): void {
  const cur = hostComponents(hostId).bypass;
  if (!cur.includes(name)) patch(hostId, { bypass: [...cur, name] });
}

let listeners = 0;
let offEvents: (() => void) | null = null;

/** Follow `cutex/components/updated` (and r269 `cutex/components/indexUpdated`) on every host while at least one card is mounted. */
export function retainEvents(): () => void {
  if (listeners++ === 0 && typeof bridge?.on === "function") {
    const off = bridge.on("hostEvent", ({ hostId, envelope }) => {
      const event = componentEventOf(envelope);
      if (event) noteResult(hostId, event.operation);
      if (event || componentIndexEventOf(envelope)) scheduleComponentsReload(hostId);
    });
    const offReset = onHostReset(resetHostComponents);
    offEvents = () => {
      off?.();
      offReset();
    };
  }
  return () => {
    if (--listeners === 0) {
      offEvents?.();
      offEvents = null;
    }
  };
}

/**
 * Non-React: may `name` be used on `hostId` now (lib/componentCard componentUsable)? An unread list
 * starts a read and answers false until it arrives — callers poll again (jobs), so nothing calls a
 * missing service in between.
 */
export function componentUsableNow(hostId: string, name: string, features: ReadonlySet<string>): boolean {
  if (!features.has(COMPONENTS_FEATURE)) return true;
  const entry = hostComponents(hostId);
  if (entry.list === undefined && !inflight.has(hostId)) void loadComponents(hostId);
  return componentUsable(features, entry.list, name);
}
