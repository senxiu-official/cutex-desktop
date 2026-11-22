// 后台操作 (owner 2026-11-05): what this desktop asked cutex to do in bulk — batch start / stop, restore, stop idle
// and its undo, runtime-package upgrades, host-busy retries — one receipt per click with a result per agent, shown by
// the tray's button (components/BackgroundOperations). A title is `operations.kind.*` with `{n}` = how many agents.
// Desktop receipts only. Dispatch, eligibility, concurrency and runtime state remain in cutex
// and the existing callers.
// State surfaces WP-D4 (fix plan S8 / L6, audit table 4.7): every item has an absolute deadline from beginOperation
// (never renewed): still waiting past it, the item becomes `unconfirmed` (结果未确认) and no longer holds its
// operation. 结束跟进 on a waiting item sets `trackingStopped` (final: a late result does not change it; the action
// already sent is not withdrawn). Each finished item clears on its own. Items still waiting (and unconfirmed ones not
// cleared yet) are persisted in localStorage, so after a renderer restart they show as unconfirmed instead of vanishing.
import { create } from "zustand";
import type { MessageKey } from "../i18n";

export type OperationItemState = "queued" | "running" | "done" | "skipped" | "failed" | "cancelled" | "uncertain" | "unconfirmed" | "trackingStopped";
export interface OperationItem {
  key: string;
  name: string;
  state: OperationItemState;
  detail?: string;
  retry?: () => void | Promise<unknown>;
  /** Host-busy retry owns this receipt after the initial caller returns. */
  busyOwned?: boolean;
  captureBusy?: boolean;
  /** The cutex action id of the request, when the caller has one (kept with a persisted receipt). */
  actionId?: string;
  /** Absolute deadline (ms) of this item; default its operation's. */
  deadline?: number;
  /** Why it is `unconfirmed`: its deadline passed, or the desktop restarted while it waited. */
  unconfirmedBy?: "deadline" | "restart";
}
export interface BackgroundOperation {
  id: string;
  hostId: string;
  titleKey: MessageKey;
  titleVars?: Record<string, string | number>;
  startedAt: number;
  items: OperationItem[];
  unreadFailure: boolean;
  /** Absolute deadline (ms) of its items: startedAt + OPERATION_DEADLINE_MS. */
  deadline: number;
  /** Finished items cleared one by one (still counted in the progress). */
  cleared?: number;
  /** Keys of the cleared items: a later snapshot of the operation (replaceOperationItems) never brings them back. */
  clearedKeys?: string[];
}
export interface OperationTarget { operationId: string; key: string }
/** How long an item may wait for its result before it reads 结果未确认 (absolute, from beginOperation). */
export const OPERATION_DEADLINE_MS = 15 * 60_000;
export const useBackgroundOperations = create<{ operations: BackgroundOperation[] }>(() => ({ operations: [] }));
export const itemRunning = (item: Pick<OperationItem, "state">) => item.state === "queued" || item.state === "running";
export const operationRunning = (op: BackgroundOperation) => op.items.some(itemRunning);
/** Needs the owner's look: failed, outcome unknown or unconfirmed (marks the tray button until seen). */
export const itemNeedsLook = (item: OperationItem) => item.state === "failed" || item.state === "uncertain" || item.state === "unconfirmed";
const failed = itemNeedsLook;
/** 结束跟进 applies: the item still waits for its result. */
export const canStopWaiting = itemRunning;
/** A final item: no later result changes it. */
const settledForGood = (item: OperationItem) => item.state === "trackingStopped";

export function beginOperation(hostId: string, titleKey: MessageKey, items: Pick<OperationItem, "key" | "name" | "actionId">[], titleVars?: BackgroundOperation["titleVars"]): string {
  const id = crypto.randomUUID();
  const startedAt = Date.now();
  useBackgroundOperations.setState(s => ({ operations: [
    { id, hostId, titleKey, titleVars: titleVars ?? { n: items.length }, startedAt, deadline: startedAt + OPERATION_DEADLINE_MS, items: items.map(i => ({ ...i, state: "queued" })), unreadFailure: false },
    // Bound read history; never discard running work or an unread failure.
    ...s.operations.filter((op, index) => index < 29 || operationRunning(op) || op.unreadFailure),
  ] }));
  ensureSweep();
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
      if (item.key !== target.key || settledForGood(item)) return item;
      // Past its deadline an item only takes a final result (a late answer shows; a retry loop's "running" does not).
      if (item.state === "unconfirmed" && patch.state && itemRunning({ state: patch.state })) return item;
      const next = { ...item, ...patch };
      if (failed(next) && (!failed(item) || item.detail !== next.detail)) unreadFailure = true;
      return next;
    });
    return { ...op, items, unreadFailure: unreadFailure && items.some(failed) };
  }) }));
}
export function replaceOperationItems(operationId: string, incoming: OperationItem[]): void {
  useBackgroundOperations.setState(s => ({ operations: s.operations.map(op => {
    if (op.id !== operationId) return op;
    // 结束跟进 is final, and an expired item takes only a final result (as updateOperationItem). A cleared item stays
    // cleared: the host's snapshot still lists it while other items run.
    const items = incoming.filter(item => !op.clearedKeys?.includes(item.key)).map(item => {
      const old = op.items.find(o => o.key === item.key);
      return old && (settledForGood(old) || (old.state === "unconfirmed" && itemRunning(item))) ? old : item;
    });
    return { ...op, items, unreadFailure: items.some(failed) && (op.unreadFailure || items.some(item => failed(item) && !op.items.some(old => old.key === item.key && failed(old) && old.detail === item.detail))) };
  }) }));
  ensureSweep();
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
  const cleared = running.reduce((n, op) => n + (op.cleared ?? 0), 0);
  return { running: running.length, done: items.filter(item => !itemRunning(item)).length + cleared, total: items.length + cleared, unreadFailure: operations.some(op => op.unreadFailure) };
}
/** 清除已结束的: drops every finished item the owner has seen (waiting items and unread failures stay). */
export function clearFinishedOperations(): void {
  useBackgroundOperations.setState(s => ({ operations: s.operations.flatMap(op => {
    if (op.unreadFailure) return [op];
    const items = op.items.filter(itemRunning);
    if (!items.length) return [];
    const gone = op.items.filter(item => !itemRunning(item)).map(item => item.key);
    return [{ ...op, items, cleared: (op.cleared ?? 0) + gone.length, clearedKeys: [...(op.clearedKeys ?? []), ...gone] }];
  }) }));
}

/** Clear one finished item (its operation goes when nothing is left). A waiting item is not cleared: end follow-up first. */
export function clearOperationItem(target: OperationTarget): void {
  useBackgroundOperations.setState(s => ({ operations: s.operations.flatMap(op => {
    if (op.id !== target.operationId) return [op];
    const item = op.items.find(i => i.key === target.key);
    if (!item || itemRunning(item)) return [op];
    const items = op.items.filter(i => i !== item);
    if (!items.length) return [];
    return [{ ...op, items, cleared: (op.cleared ?? 0) + 1, clearedKeys: [...(op.clearedKeys ?? []), item.key], unreadFailure: op.unreadFailure && items.some(failed) }];
  }) }));
}

/** 结束跟进 on a waiting item: `trackingStopped`, final. Nothing is sent to cutex: the action is not withdrawn. */
export function stopWaitingItem(target: OperationTarget): void {
  const item = operationItem(target);
  if (!item || !canStopWaiting(item)) return;
  updateOperationItem(target, { state: "trackingStopped", retry: undefined, captureBusy: false, busyOwned: false, detail: undefined });
}

/** Items still waiting past their absolute deadline become `unconfirmed` (they stop holding their operation). */
export function expireOperations(now = Date.now()): void {
  const ops = useBackgroundOperations.getState().operations;
  if (!ops.some(op => op.items.some(item => itemRunning(item) && now >= (item.deadline ?? op.deadline)))) return;
  useBackgroundOperations.setState(s => ({ operations: s.operations.map(op => {
    let expired = false;
    const items = op.items.map(item => {
      if (!itemRunning(item) || now < (item.deadline ?? op.deadline)) return item;
      expired = true;
      return { ...item, state: "unconfirmed" as const, unconfirmedBy: "deadline" as const, retry: undefined, captureBusy: false };
    });
    return expired ? { ...op, items, unreadFailure: true } : op;
  }) }));
}

// ---------- deadline sweep ----------

const SWEEP_MS = 15_000;
let sweep: ReturnType<typeof setInterval> | null = null;
function ensureSweep(): void {
  if (sweep || typeof setInterval === "undefined") return;
  sweep = setInterval(() => {
    expireOperations();
    if (!useBackgroundOperations.getState().operations.some(operationRunning) && sweep) {
      clearInterval(sweep);
      sweep = null;
    }
  }, SWEEP_MS);
}

// ---------- persisted receipts (L6) ----------

const STORAGE_KEY = "cutex-desktop.backgroundOperations.v1";
/** Most operations / items kept in storage (newest first). */
const MAX_STORED_OPERATIONS = 30;
const MAX_STORED_ITEMS = 300;

/** What survives a restart: who asked what, and which items had no result yet. */
export interface StoredOperation {
  operationId: string;
  hostId: string;
  titleKey: string;
  titleVars?: Record<string, string | number>;
  startedAt: number;
  items: { key: string; name: string; actionId?: string; state: "waiting" | "unconfirmed" }[];
}

/** The receipts to persist: items still waiting, and unconfirmed ones not cleared yet. Pure. */
export function storedOperations(operations: readonly BackgroundOperation[]): StoredOperation[] {
  let budget = MAX_STORED_ITEMS;
  const out: StoredOperation[] = [];
  for (const op of operations) {
    if (out.length >= MAX_STORED_OPERATIONS || budget <= 0) break;
    const items = op.items
      .filter(item => itemRunning(item) || item.state === "unconfirmed")
      .slice(0, budget)
      .map(item => ({ key: item.key, name: item.name, ...(item.actionId ? { actionId: item.actionId } : {}), state: itemRunning(item) ? "waiting" as const : "unconfirmed" as const }));
    if (!items.length) continue;
    budget -= items.length;
    out.push({ operationId: op.id, hostId: op.hostId, titleKey: op.titleKey, ...(op.titleVars ? { titleVars: op.titleVars } : {}), startedAt: op.startedAt, items });
  }
  return out;
}

/** After a restart: every stored item is unconfirmed (nothing waits for it any more). Pure. */
export function restoreOperations(stored: readonly StoredOperation[]): BackgroundOperation[] {
  return stored.map(op => ({
    id: op.operationId,
    hostId: op.hostId,
    titleKey: op.titleKey as MessageKey,
    titleVars: op.titleVars,
    startedAt: op.startedAt,
    deadline: op.startedAt + OPERATION_DEADLINE_MS,
    unreadFailure: true,
    items: op.items.map(item => ({ key: item.key, name: item.name, ...(item.actionId ? { actionId: item.actionId } : {}), state: "unconfirmed" as const, unconfirmedBy: item.state === "waiting" ? "restart" as const : "deadline" as const })),
  }));
}

function readStorage(): StoredOperation[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter((op): op is StoredOperation =>
      !!op && typeof op.operationId === "string" && typeof op.hostId === "string" && typeof op.titleKey === "string" && typeof op.startedAt === "number"
      && Array.isArray(op.items) && op.items.every((i: unknown) => !!i && typeof (i as { key?: unknown }).key === "string" && typeof (i as { name?: unknown }).name === "string"));
  } catch {
    return [];
  }
}

let lastWritten = "";
function writeStorage(operations: readonly BackgroundOperation[]): void {
  const text = JSON.stringify(storedOperations(operations));
  if (text === lastWritten) return;
  lastWritten = text;
  try {
    if (text === "[]") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, text);
  } catch {
    // best effort: the receipts still show for this session
  }
}
// Receipts of the last session: unconfirmed now (L6).
useBackgroundOperations.setState({ operations: restoreOperations(readStorage()) });
useBackgroundOperations.subscribe(s => writeStorage(s.operations));

/** Re-read storage (tests: a renderer restart). */
export function reloadOperationsFromStorage(): void {
  lastWritten = "";
  useBackgroundOperations.setState({ operations: restoreOperations(readStorage()) });
}
