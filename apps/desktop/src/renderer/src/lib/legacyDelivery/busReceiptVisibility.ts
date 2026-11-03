// LEGACY(input-ledger-v1): frozen delivery inference for older hosts.
// Delete only when EVERY host advertises input-ledger-v1 (including hachimi).
// Device-local display preferences only. Acceptance is not delivery; these
// operations never acknowledge, cancel or resend a server message.
import { useMemo, useSyncExternalStore } from "react";
import type { AdmissionNextStep } from "@cutex-desktop/protocol";
import { onEveryAppWindow } from "../appWindowSet";

const LEGACY_HIDDEN = "cutex-desktop.hiddenBusReceipts.v1:";
const LEGACY_RESTORED = "cutex-desktop.restoredBusReceipts.v1:";
const OPERATIONS = "cutex-desktop.busReceiptVisibility.v2:";
type Operation = { version: 2; revision: number; state: "hidden" | "restored" };
type Entry = Operation & { writer: string };
type Scope = { host: string; session: string; entries: Map<string, Entry>; hidden: ReadonlySet<string>; restored: ReadonlySet<string> };
const scopes = new Map<string, Scope>();
const listeners = new Set<() => void>();
let stopStorage: (() => void) | null = null;
let writer: string | undefined;

/** Only the host's explicit acceptance qualifies a row for local hiding. */
export function isDismissibleReceipt(item: AdmissionNextStep): boolean {
  return !!item.id && item.waitReason === "nativeReceipt" && item.askId == null
    && (item.deliveryKind === "bus" || item.deliveryKind === "tell" || item.deliveryKind === "alarm");
}

const scopeKey = (host: string, session: string) => JSON.stringify([host, session]);
// Each renderer owns its own register for each ID. Concurrent writers cannot
// overwrite one another even when events are delayed or either renderer exits.
const operationKey = (scope: Scope, id: string, author: string) => OPERATIONS + JSON.stringify([scope.host, scope.session, id, author]);

function operation(raw: string | null): Operation | undefined {
  try {
    const value = JSON.parse(raw ?? "null") as Operation | null;
    if (value?.version === 2 && Number.isSafeInteger(value.revision) && value.revision >= 0
      && (value.state === "hidden" || value.state === "restored")) return value;
  } catch { /* a malformed record cannot erase another valid operation */ }
  return undefined;
}

function route(key: string): [string, string, string, string] | undefined {
  if (!key.startsWith(OPERATIONS)) return;
  try {
    const value: unknown = JSON.parse(key.slice(OPERATIONS.length));
    if (Array.isArray(value) && value.length === 4 && value.every(part => typeof part === "string" && !!part)) return value as [string, string, string, string];
  } catch { /* unrelated/malformed storage key */ }
  return undefined;
}

function ids(raw: string | null): string[] {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string" && !!id) : [];
  } catch { return []; }
}

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function merge(scope: Scope, id: string, incoming: Entry): boolean {
  const before = scope.entries.get(id);
  // Lamport revision: a later explicit re-hide reads all persisted writers and
  // advances beyond their tombstones. Concurrent equal revisions restore first.
  if (before && (incoming.revision < before.revision || (incoming.revision === before.revision
    && (before.state === "restored" || incoming.state === before.state)))) return false;
  scope.entries.set(id, incoming);
  if (before?.state === incoming.state) return false;
  const hidden = new Set(scope.hidden), restored = new Set(scope.restored);
  hidden.delete(id); restored.delete(id);
  (incoming.state === "hidden" ? hidden : restored).add(id);
  scope.hidden = hidden; scope.restored = restored;
  return true;
}

function legacy(scope: Scope, prefix: string, raw: string | null): boolean {
  let changed = false;
  for (const id of ids(raw)) changed = merge(scope, id, { version: 2, revision: 0, state: prefix === LEGACY_HIDDEN ? "hidden" : "restored", writer: "legacy" }) || changed;
  return changed;
}

function refresh(scope: Scope): boolean {
  const suffix = scopeKey(scope.host, scope.session);
  let changed = legacy(scope, LEGACY_HIDDEN, read(LEGACY_HIDDEN + suffix));
  changed = legacy(scope, LEGACY_RESTORED, read(LEGACY_RESTORED + suffix)) || changed;
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      const binding = key && route(key);
      if (!binding || binding[0] !== scope.host || binding[1] !== scope.session) continue;
      const value = operation(localStorage.getItem(key!));
      if (value) changed = merge(scope, binding[2], { ...value, writer: binding[3] }) || changed;
    }
  } catch { /* memory remains authoritative for this renderer when storage fails */ }
  return changed;
}

function snapshot(host: string, session: string): Scope {
  const key = scopeKey(host, session);
  let scope = scopes.get(key);
  if (!scope) {
    scope = { host, session, entries: new Map(), hidden: new Set(), restored: new Set() };
    scopes.set(key, scope); refresh(scope);
  }
  return scope;
}

// Migration is additive and outside render. Leave original arrays intact;
// absence, age, corrupt data and a storage deletion never evict a known ID.
function migrate(scope: Scope): void {
  for (const [id, entry] of scope.entries) {
    if (entry.revision !== 0) continue;
    const key = operationKey(scope, id, "legacy");
    const existing = operation(read(key));
    if (existing && (existing.revision > 0 || existing.state === "restored" || existing.state === entry.state)) continue;
    try { localStorage.setItem(key, JSON.stringify({ version: 2, revision: 0, state: entry.state })); } catch { /* best effort */ }
  }
}

/** Bumped on every visible change: the host-wide list (useHiddenReceiptsOf) re-reads on it. */
let storeRevision = 0;
function notify(): void { storeRevision++; for (const listener of listeners) listener(); }

function onStorage(event: StorageEvent): void {
  try { if (event.storageArea && event.storageArea !== localStorage) return; } catch { return; }
  if (!event.key || event.newValue === null) return;
  const binding = route(event.key);
  if (binding) {
    const value = operation(event.newValue);
    if (value && merge(snapshot(binding[0], binding[1]), binding[2], { ...value, writer: binding[3] })) notify();
    return;
  }
  const prefix = event.key.startsWith(LEGACY_HIDDEN) ? LEGACY_HIDDEN : event.key.startsWith(LEGACY_RESTORED) ? LEGACY_RESTORED : null;
  if (!prefix) return;
  const scope = scopes.get(event.key.slice(prefix.length));
  if (scope) {
    const changed = legacy(scope, prefix, event.newValue);
    migrate(scope);
    if (changed) notify();
  }
}

function subscribe(listener: () => void): () => void {
  if (!listeners.size) stopStorage = onEveryAppWindow(win => {
    win.addEventListener("storage", onStorage);
    return () => win.removeEventListener("storage", onStorage);
  });
  listeners.add(listener);
  let changed = false;
  for (const scope of scopes.values()) { changed = refresh(scope) || changed; migrate(scope); }
  if (changed) notify();
  return () => { listeners.delete(listener); if (!listeners.size) { stopStorage?.(); stopStorage = null; } };
}

export function useHiddenReceiptIds(host: string, session: string): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, () => snapshot(host, session).hidden, () => snapshot(host, session).hidden);
}

export function useRestoredReceiptIds(host: string, session: string): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, () => snapshot(host, session).restored, () => snapshot(host, session).restored);
}

/** Sessions of `host` with any stored visibility record (v2 operations or v1 hidden arrays). */
function hostSessions(host: string): string[] {
  const sessions = new Set<string>();
  for (const scope of scopes.values()) if (scope.host === host) sessions.add(scope.session);
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key) continue;
      const binding = route(key);
      if (binding) { if (binding[0] === host) sessions.add(binding[1]); continue; }
      if (!key.startsWith(LEGACY_HIDDEN)) continue;
      try {
        const value: unknown = JSON.parse(key.slice(LEGACY_HIDDEN.length));
        if (Array.isArray(value) && value.length === 2 && value[0] === host && typeof value[1] === "string" && value[1]) sessions.add(value[1]);
      } catch { /* unrelated key */ }
    }
  } catch { /* the scopes in memory still count */ }
  return [...sessions];
}

export interface HiddenReceipt { session: string; id: string }

/** Every locally hidden receipt of `host`, across its sessions (Settings → 协作 → 高级 → 待清理). */
export function hiddenReceiptsOf(host: string): HiddenReceipt[] {
  const rows: HiddenReceipt[] = [];
  for (const session of hostSessions(host).sort()) for (const id of snapshot(host, session).hidden) rows.push({ session, id });
  return rows;
}

const getStoreRevision = () => storeRevision;
export function useHiddenReceiptsOf(host: string): HiddenReceipt[] {
  const at = useSyncExternalStore(subscribe, getStoreRevision, getStoreRevision);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `at` stands for the store's contents
  return useMemo(() => hiddenReceiptsOf(host), [host, at]);
}

function write(host: string, session: string, id: string, state: Operation["state"]): void {
  if (!host || !session || !id) return;
  const scope = snapshot(host, session);
  let changed = refresh(scope);
  const before = scope.entries.get(id);
  if (before?.state === state) { migrate(scope); if (changed) notify(); return; }
  const revision = (before?.revision ?? 0) + 1;
  // Never wrap a revision into an older operation.
  if (!Number.isSafeInteger(revision)) { if (changed) notify(); return; }
  writer ??= crypto.randomUUID();
  const value: Operation = { version: 2, revision, state };
  changed = merge(scope, id, { ...value, writer }) || changed;
  try { localStorage.setItem(operationKey(scope, id, writer), JSON.stringify(value)); } catch { /* still works in memory */ }
  if (changed) notify();
}

/** Explicit owner restore, also called after confirmed server closure. */
export function restoreReceipt(host: string, session: string, id: string): void { write(host, session, id, "restored"); }

export function dismissReceipt(host: string, session: string, item: AdmissionNextStep): void {
  if (isDismissibleReceipt(item)) write(host, session, item.id, "hidden");
}
