// Optional components per host, memory only (components spec v2 §4–§5): `GET /v2/components` of the
// hosts a component card looks at, the install / remove this desktop asked for and its answer. The
// host event `cutex/components/updated` (any change, install progress) triggers a re-read; a slow poll
// covers a missed one while something is going. Read while a card is mounted (lib/componentView
// useHostComponents) or on demand (componentUsableNow). No React / app-store imports: lib/jobStore uses it.
import { create } from "zustand";
import { COMPONENTS_FEATURE, componentEventOf, isOperationRunning, type ComponentAction, type ComponentsList } from "../../../shared/components";
import type { UpgradeRefusal } from "../../../shared/backendUpgrade";
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
  refusal: { name: string; action: ComponentAction; error: UpgradeRefusal } | null;
  /** Hosts whose "update cutex" card the owner chose to skip (older host with a hand-made service). */
  bypass: readonly string[];
}

export const EMPTY_COMPONENTS: HostComponents = { list: undefined, error: null, pending: null, refusal: null, bypass: [] };

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

/** Forget a host (reset / switch): drop its state and fence off reads still in flight. */
export function resetHostComponents(hostId: string): void {
  epochs.set(hostId, epochOf(hostId) + 1);
  inflight.delete(hostId);
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
  const run = (async () => {
    try {
      const list = await apiFor(hostId).components();
      if (epochOf(hostId) !== epoch) return;
      const pending = hostComponents(hostId).pending;
      patch(hostId, { list, error: null, ...(pending && (!list || settled(list, pending)) ? { pending: null } : {}) });
    } catch (e) {
      if (epochOf(hostId) === epoch) patch(hostId, { error: errorText(e) });
    } finally {
      if (epochOf(hostId) === epoch) inflight.delete(hostId);
    }
  })();
  inflight.set(hostId, run);
  return run;
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
 * prepares and selects it; this desktop only follows the state. Refusals stay on the card.
 */
export async function requestComponent(hostId: string, name: string, action: ComponentAction): Promise<void> {
  const epoch = epochOf(hostId);
  patch(hostId, { pending: { name, action, at: Date.now() }, refusal: null });
  try {
    const r = await apiFor(hostId).componentAction(name, action);
    if (epochOf(hostId) !== epoch) return;
    if (!r.ok) patch(hostId, { pending: null, refusal: { name, action, error: r.error } });
    // cutex finished at once (or named no operation): nothing to wait for.
    else if (!isOperationRunning(r.value)) patch(hostId, { pending: null });
  } catch (e) {
    if (epochOf(hostId) === epoch) patch(hostId, { pending: null, refusal: { name, action, error: { code: "request_failed", message: errorText(e), status: 0 } } });
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

/** Follow `cutex/components/updated` on every host while at least one card is mounted. */
export function retainEvents(): () => void {
  if (listeners++ === 0 && typeof bridge?.on === "function") {
    const off = bridge.on("hostEvent", ({ hostId, envelope }) => {
      if (componentEventOf(envelope)) scheduleComponentsReload(hostId);
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
