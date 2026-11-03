// Transient UI state for an owner operation refused before execution. Business state stays in cutex.
import { create } from "zustand";
import { translate } from "../i18n";
import { withHostBusyRetry } from "../../../shared/queueSteerRetry";
import { hostBusyActionError, type HostBusyActionKind } from "../../../shared/hostBusyAction";

export interface HostBusyAction {
  key: string; hostId: string; sessionId: string; name: string; kind: HostBusyActionKind;
  state: "retrying" | "exhausted" | "cancelled" | "uncertain";
  detail?: string;
  retry(): void;
}
export const useHostBusyActions = create<{ rows: HostBusyAction[] }>(() => ({ rows: [] }));
const active = new Map<string, Promise<unknown>>();
const remove = (key: string) => useHostBusyActions.setState(s => ({ rows: s.rows.filter(row => row.key !== key) }));
export const dismissHostBusyAction = (key: string) => { if (!active.has(key)) remove(key); };
export const hostBusyActionKey = (host: string, session: string, kind: HostBusyActionKind) => JSON.stringify([host, session, kind]);
export const hostBusyActionShown = (key: string) => useHostBusyActions.getState().rows.some(row => row.key === key);
export class HostBusyActionExhausted extends Error {
  constructor() { super(translate("hostAction.exhausted")); }
}
export class HostBusyActionCancelled extends Error {
  constructor() { super(translate("hostAction.cancelled")); }
}
export class HostBusyActionUncertain extends Error {
  constructor(error: unknown) { super(translate("hostAction.uncertain"), {cause:error}); }
}
export const isHostBusyActionPending = (error: unknown) => error instanceof HostBusyActionExhausted || error instanceof HostBusyActionCancelled || error instanceof HostBusyActionUncertain;

/** Manual retry reuses the exact captured operation/fences; it never re-reads new consent parameters. */
export function runHostBusyAction<T>(options: Omit<HostBusyAction, "state" | "retry"> & { current(): boolean; onError(error: unknown): void; onRetryResult?(result: T): void }, run: () => Promise<T>): Promise<T> {
  const previous = active.get(options.key);
  if (previous) return previous as Promise<T>;
  const launch = (manualRetry = false): Promise<T> => {
    const inFlight = active.get(options.key);
    if (inFlight) return inFlight as Promise<T>;
    let cancelledBeforeDispatch = false;
    const show = (state: HostBusyAction["state"], detail?: string) => useHostBusyActions.setState(s => ({ rows: [
      ...s.rows.filter(row => row.key !== options.key),
      { ...options, state, detail, retry: () => { if (active.has(options.key)) return; void launch(true).then(result => { if (options.current()) options.onRetryResult?.(result); }).catch(error => { if (!isHostBusyActionPending(error) && options.current()) options.onError(error); }); } },
    ] }));
    if (manualRetry) show("retrying"); else remove(options.key);
    const check = () => { if (!options.current()) { cancelledBeforeDispatch = true; throw new HostBusyActionCancelled(); } };
    const operation = withHostBusyRetry(async () => {
      check();
      try { return await run(); }
      catch (error) { throw hostBusyActionError(error) ?? error; }
    }, check, () => { check(); show("retrying"); }).then(result => { remove(options.key); return result; }, error => {
      if (!options.current()) {
        if (cancelledBeforeDispatch || hostBusyActionError(error)) { show("cancelled"); throw new HostBusyActionCancelled(); }
        show("uncertain", error instanceof Error ? error.message : String(error));
        throw new HostBusyActionUncertain(error);
      }
      if (hostBusyActionError(error) && options.current()) { show("exhausted"); throw new HostBusyActionExhausted(); }
      remove(options.key); throw error;
    }).finally(() => { if (active.get(options.key) === operation) active.delete(options.key); });
    active.set(options.key, operation);
    return operation;
  };
  return launch();
}
