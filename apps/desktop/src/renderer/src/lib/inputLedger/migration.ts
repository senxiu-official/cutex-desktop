// 054 §4 / D5: only migrate the session whose host now advertises input-ledger-v1.
// Old-host data is untouched. A failed read/write never clears its source.
import type { InputGetResult, InputRecord } from "@cutex-desktop/protocol";
import type { LedgerOwnerOutbox } from "./owner";
import { viewKey } from "../viewKey";
import { persistLedgerOutbox } from "./outbox";

const STEERS = "cutex-desktop.pendingSteers.v1";
const HIDDEN = "cutex-desktop.hiddenRows";
const HIDDEN_BUS = "cutex-desktop.hiddenBusReceipts.v1:";
const RESTORED_BUS = "cutex-desktop.restoredBusReceipts.v1:";
const BUS_OPS = "cutex-desktop.busReceiptVisibility.v2:";
export const LEDGER_MIGRATION_PREFIX = "cutex-desktop.inputLedger.migrated.v1:";

export interface MigrationApi {
  inputGet(sessionId: string, inputIds: string[]): Promise<InputGetResult>;
  inputDismiss(sessionId: string, inputId: string, expectedRev: number): Promise<unknown>;
}

export interface MigrationResult {
  records: InputRecord[];
  /** Old steers absent from the ledger remain visible as unconfirmed drafts, never silently resent. */
  recovered: LedgerOwnerOutbox[];
}

function parse(target: Storage, key: string): unknown {
  const raw = target.getItem(key);
  return raw ? JSON.parse(raw) : null;
}
function strings(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];
}

/** The caller fences the result to its captured host connection and refreshes the ledger afterward. */
export async function migrateLegacyDelivery(hostId: string, sessionId: string, api: MigrationApi, target: Storage | null, memoryDrafts: readonly LedgerOwnerOutbox[] = []): Promise<MigrationResult> {
  const result: MigrationResult = { records: [], recovered: [] };
  if (!target) return result;
  const suffix = JSON.stringify([hostId, sessionId]);
  const marker = LEDGER_MIGRATION_PREFIX + suffix;
  if (target.getItem(marker) && !memoryDrafts.length) return result;
  const rawSteers = parse(target, STEERS);
  const lists = rawSteers && typeof rawSteers === "object" && !Array.isArray(rawSteers) ? rawSteers as Record<string, { steers?: unknown[] }> : {};
  const localKey = viewKey(hostId, sessionId);
  const steers = (lists[localKey]?.steers ?? []).filter((v): v is { id: string; text: string; extra?: unknown[] } =>
    !!v && typeof v === "object" && typeof (v as { id?: unknown }).id === "string" && typeof (v as { text?: unknown }).text === "string");
  const hiddenRows = strings(parse(target, HIDDEN));
  const hiddenCandidates = hiddenRows.filter(k => k.startsWith(`ask:${hostId}/`) || k.startsWith(`note:${hostId}/`));
  const hiddenIds = hiddenCandidates.map(k => k.slice(k.indexOf("/") + 1));
  const hiddenBus = new Set(strings(parse(target, HIDDEN_BUS + suffix)));
  for (const id of strings(parse(target, RESTORED_BUS + suffix))) hiddenBus.delete(id);
  // Resolve the latest persisted visibility operation, including an explicit restore.
  const operations = new Map<string, { revision: number; state: string }>();
  const opKeys: string[] = [];
  for (let i = 0; i < target.length; i++) {
    const key = target.key(i);
    if (!key?.startsWith(BUS_OPS)) continue;
    const route = JSON.parse(key.slice(BUS_OPS.length)) as unknown;
    if (!Array.isArray(route) || route[0] !== hostId || route[1] !== sessionId || typeof route[2] !== "string") continue;
    const op = parse(target, key) as { revision?: number; state?: string } | null;
    if (!op || typeof op.revision !== "number" || !["hidden", "restored"].includes(op.state ?? "")) continue;
    opKeys.push(key);
    const prev = operations.get(route[2]);
    if (!prev || op.revision > prev.revision || op.revision === prev.revision && op.state === "restored") operations.set(route[2], { revision: op.revision, state: op.state! });
  }
  for (const [id, op] of operations) (op.state === "hidden" ? hiddenBus.add(id) : hiddenBus.delete(id));
  const ids = [...new Set([...steers.map(s => s.id), ...memoryDrafts.map(s => s.inputId), ...hiddenIds, ...hiddenBus])];
  const found = new Map<string, InputRecord>();
  const missing = new Set<string>();
  for (let i = 0; i < ids.length; i += 100) {
    const response = await api.inputGet(sessionId, ids.slice(i, i + 100));
    for (const record of response.records) found.set(record.inputId, record);
    for (const id of response.missing) missing.add(id);
  }
  result.records = [...found.values()];
  const drafts = new Map(memoryDrafts.map(draft => [draft.inputId, draft]));
  for (const steer of steers) if (!drafts.has(steer.id)) drafts.set(steer.id, { hostId, sessionId, inputId: steer.id, text: steer.text,
    extra: (steer.extra ?? []) as LedgerOwnerOutbox["extra"], strategy: "auto", createdAt: new Date().toISOString(), phase: "unconfirmed" });
  for (const [id, draft] of drafts) {
    if (found.has(id)) continue;
    if (!missing.has(id)) throw new Error("input_migration_incomplete");
    if (!persistLedgerOutbox(draft, target)) throw new Error("input_migration_storage_full");
    result.recovered.push(draft);
  }
  const dismissals = [...new Set([...hiddenIds, ...hiddenBus])].map(id => found.get(id)).filter((record): record is InputRecord => !!record?.actions?.includes("dismiss"));
  for (let i = 0; i < dismissals.length; i += 4) await Promise.all(dismissals.slice(i, i + 4).map(record => api.inputDismiss(sessionId, record.inputId, record.rev)));
  // Re-read before changing shared maps: another window may have added a different session.
  const latestSteers = parse(target, STEERS) as Record<string, unknown> | null;
  if (latestSteers && typeof latestSteers === "object" && !Array.isArray(latestSteers)) {
    const latest = latestSteers[localKey] as { steers?: { id?: string }[] } | undefined;
    const processed = new Set(steers.map(s => s.id));
    const keep = latest?.steers?.filter(s => !s.id || !processed.has(s.id)) ?? [];
    if (keep.length) latestSteers[localKey] = { ...latest, steers: keep };
    else delete latestSteers[localKey];
    if (Object.keys(latestSteers).length) target.setItem(STEERS, JSON.stringify(latestSteers)); else target.removeItem(STEERS);
  }
  // hiddenRows is global; unknown ids can belong to another recipient and stay for its migration.
  const migratedRows = new Set(hiddenCandidates.filter(k => found.has(k.slice(k.indexOf("/") + 1))));
  const remaining = strings(parse(target, HIDDEN)).filter(k => !migratedRows.has(k));
  if (remaining.length) target.setItem(HIDDEN, JSON.stringify(remaining)); else target.removeItem(HIDDEN);
  target.removeItem(HIDDEN_BUS + suffix);
  target.removeItem(RESTORED_BUS + suffix);
  for (const key of opKeys) target.removeItem(key);
  const finalSteers = parse(target, STEERS) as Record<string, { steers?: unknown[] }> | null;
  if (!finalSteers?.[localKey]?.steers?.length) target.setItem(marker, "1");
  return result;
}
