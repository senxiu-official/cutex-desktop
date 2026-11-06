// 后台操作 (owner 2026-11-05): what this desktop asked cutex to do in bulk — batch start / stop, restore, stop idle
// and its undo, runtime-package upgrades, host-busy retries — one receipt per click with a result per agent, shown by
// the tray's button (components/BackgroundOperations). A title is `operations.kind.*` with `{n}` = how many agents.
// Desktop receipts only. Dispatch, eligibility, concurrency and runtime state remain in cutex
// and the existing callers. Memory survives dialogs and desk windows, not a renderer restart.
import { create } from "zustand";
import type { MessageKey } from "../i18n";

export type OperationItemState = "queued" | "running" | "done" | "skipped" | "failed" | "cancelled" | "uncertain";
export interface OperationItem {
  key: string;
  name: string;
  state: OperationItemState;
  detail?: string;
  retry?: () => void | Promise<unknown>;
  /** Host-busy retry owns this receipt after the initial caller returns. */
  busyOwned?: boolean;
  captureBusy?: boolean;
}
export interface BackgroundOperation {
  id: string;
  hostId: string;
  titleKey: MessageKey;
  titleVars?: Record<string, string | number>;
  startedAt: number;
  items: OperationItem[];
  unreadFailure: boolean;
}
export interface OperationTarget { operationId: string; key: string }
export const useBackgroundOperations = create<{ operations: BackgroundOperation[] }>(() => ({ operations: [] }));
export const itemRunning = (item: OperationItem) => item.state === "queued" || item.state === "running";
export const operationRunning = (op: BackgroundOperation) => op.items.some(itemRunning);
const failed = (item: OperationItem) => item.state === "failed" || item.state === "uncertain";

export function beginOperation(hostId: string, titleKey: MessageKey, items: Pick<OperationItem, "key" | "name">[], titleVars?: BackgroundOperation["titleVars"]): string {
  const id = crypto.randomUUID();
  useBackgroundOperations.setState(s => ({ operations: [
    { id, hostId, titleKey, titleVars: titleVars ?? { n: items.length }, startedAt: Date.now(), items: items.map(i => ({ ...i, state: "queued" })), unreadFailure: false },
    // Bound read history; never discard running work or an unread failure.
    ...s.operations.filter((op, index) => index < 29 || operationRunning(op) || op.unreadFailure),
  ] }));
  return id;
}

export function operationItem(target: OperationTarget): OperationItem | undefined {
  return useBackgroundOperations.getState().operations.find(op => op.id === target.operationId)?.items.find(item => item.key === target.key);
}
export function updateOperationItem(target: OperationTarget, patch: Partial<Omit<OperationItem, "key">>): void {
  useBackgroundOperations.setState(s => ({ operations: s.operations.map(op => {
    if (op.id !== target.operationId) return op;
    let unreadFailure = op.unreadFailure;
    const items = op.items.map(item => {
      if (item.key !== target.key) return item;
      const next = { ...item, ...patch };
      if (failed(next) && (!failed(item) || item.detail !== next.detail)) unreadFailure = true;
      return next;
    });
    return { ...op, items, unreadFailure: unreadFailure && items.some(failed) };
  }) }));
}
export function replaceOperationItems(operationId: string, items: OperationItem[]): void {
  useBackgroundOperations.setState(s => ({ operations: s.operations.map(op => op.id !== operationId ? op : {
    ...op, items, unreadFailure: items.some(failed) && (op.unreadFailure || items.some(item => failed(item) && !op.items.some(old => old.key === item.key && failed(old) && old.detail === item.detail))),
  }) }));
}
export function acknowledgeOperations(ids: readonly string[]): void {
  useBackgroundOperations.setState(s => ({ operations: s.operations.map(op => ids.includes(op.id) && op.unreadFailure ? { ...op, unreadFailure: false } : op) }));
}
/** Exactly one matching in-flight caller can adopt host-busy feedback; ambiguity gets its own receipt. */
export function activeOperationItem(hostId: string, key: string): OperationTarget | null {
  const targets = useBackgroundOperations.getState().operations.flatMap(op => op.hostId === hostId ? op.items.filter(item => item.key === key && item.captureBusy && itemRunning(item)).map(() => ({ operationId: op.id, key })) : []);
  return targets.length === 1 ? targets[0]! : null;
}
const executing = new Map<string, Promise<unknown>>();
export function trackedOperationItem<T>(target: OperationTarget, run: () => Promise<T>): Promise<T> {
  const key = JSON.stringify([target.operationId,target.key]);
  const previous = executing.get(key);
  if (previous) return previous as Promise<T>;
  const retry = async () => { try { await trackedOperationItem(target, run); } catch { /* recorded */ } };
  const work = (async () => {
    updateOperationItem(target, { state: "running", detail: undefined, retry: undefined, busyOwned: false, captureBusy: true });
    try {
      const result = await run();
      updateOperationItem(target, { state: "done", detail: undefined, retry: undefined });
      return result;
    } catch (error) {
      if (!operationItem(target)?.busyOwned) updateOperationItem(target, { state: "failed", detail: error instanceof Error ? error.message : String(error), retry });
      throw error;
    }
  })();
  const tracked = work.finally(() => { if (executing.get(key) === tracked) executing.delete(key); });
  executing.set(key, tracked);
  return tracked;
}
export function operationsSummary(operations: readonly BackgroundOperation[]) {
  const running = operations.filter(operationRunning);
  const items = running.flatMap(op => op.items);
  return { running: running.length, done: items.filter(item => !itemRunning(item)).length, total: items.length, unreadFailure: operations.some(op => op.unreadFailure) };
}
/** 清除已结束的: drops finished operations the owner has seen (running ones and unread failures stay). */
export function clearFinishedOperations(): void {
  useBackgroundOperations.setState(s => ({ operations: s.operations.filter(op => operationRunning(op) || op.unreadFailure) }));
}
