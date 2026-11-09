import type { InputRecord, OwnerJoinDelegation, SessionDelivery, SubmitStrategy } from "@cutex-desktop/protocol";
import type { ExtraInput } from "../../../../shared/ipc";
import { messageImages, messageSkills } from "../../../../shared/input";
import type { TimelineEntry, TurnView } from "../timeline";

/** O0 only: no delivery inference. D5 persists this until cutex acknowledges its id. */
export interface LedgerOwnerOutbox {
  inputId: string;
  sessionId: string;
  hostId: string;
  text: string;
  extra: ExtraInput[];
  strategy: SubmitStrategy;
  joinDelegation?: OwnerJoinDelegation;
  /** First-request prediction, kept until cutex supplies a record. Never recomputed on a connection change. */
  predictedSurface?: "timeline" | "nextUp";
  createdAt: string;
  phase: "sending" | "unconfirmed";
  error?: string;
}

/** The only permitted prediction: decision 8 overrides 054's older offline paragraph. */
export function predictedOwnerSurface(entry: Pick<LedgerOwnerOutbox, "strategy" | "predictedSurface">, delivery: SessionDelivery | null | undefined, idleBusyTimeline = false): "timeline" | "nextUp" {
  if (entry.predictedSurface) return entry.predictedSurface;
  return entry.strategy === "queue" || delivery?.state === "offline" || delivery?.state === "starting"
    || (delivery?.state === "held" && (delivery.reason === "paused" || delivery.reason === "stopHold"
      || (delivery.reason === "hostBusy" && (!idleBusyTimeline || delivery.turn != null)))) ? "nextUp" : "timeline";
}

export function ownerTimelineEntry(record: InputRecord, outbox?: LedgerOwnerOutbox): Extract<TimelineEntry, { kind: "user" }> {
  return {
    kind: "user", id: record.timelineItemId ?? record.inputId, clientId: record.inputId,
    turnId: record.turnId ?? "", text: outbox?.text ?? record.preview ?? "",
    images: messageImages(outbox?.extra ?? []),
    skills: messageSkills(outbox?.extra ?? []),
  };
}

export interface TimelineRecordIndex {
  byItemId: ReadonlyMap<string, readonly InputRecord[]>;
  byInputId: ReadonlyMap<string, InputRecord>;
}

// Keep a received row's memo props stable when an unrelated input changes.
// Weak keys follow the immutable records' lifetime; this stores no delivery state.
const itemGroups = new WeakMap<InputRecord, Map<string, InputRecord[]>>();

export function timelineRecordIndex(records: ReadonlyMap<string, InputRecord> | undefined): TimelineRecordIndex {
  const byItemId = new Map<string, InputRecord[]>();
  const byInputId = new Map<string, InputRecord>();
  const addItem = (itemId: string, record: InputRecord) => {
    const linked = byItemId.get(itemId);
    if (linked) linked.push(record); else byItemId.set(itemId, [record]);
  };
  for (const record of records?.values() ?? []) {
    if (record.surface !== "timeline") continue;
    byInputId.set(record.inputId, record);
    if (record.timelineItemId) addItem(record.timelineItemId, record);
    if (record.kind !== "owner" && record.inputId !== record.timelineItemId) addItem(record.inputId, record);
  }
  for (const [itemId, group] of byItemId) {
    const cached = itemGroups.get(group[0]!) ?? new Map<string, InputRecord[]>();
    const previous = cached.get(itemId);
    if (previous?.length === group.length && previous.every((record, index) => record === group[index])) byItemId.set(itemId, previous);
    else cached.set(itemId, group);
    itemGroups.set(group[0]!, cached);
  }
  return { byItemId, byInputId };
}

export function ownerRecordFor(records: ReadonlyMap<string, InputRecord> | undefined, entry: TimelineEntry, index?: TimelineRecordIndex): InputRecord | undefined {
  if (index) return index.byItemId.get(entry.id)?.[0] ?? (entry.kind === "user" && entry.clientId ? index.byInputId.get(entry.clientId) : entry.kind === "received" ? index.byInputId.get(entry.id) : undefined);
  if (!records) return undefined;
  // Common owner echo is O(1), including callers that have no memoized index.
  if (entry.kind === "user" && entry.clientId) {
    const record = records.get(entry.clientId);
    if (record?.surface === "timeline") return record;
  }
  // External-input items explicitly use the bus message id. Join that identity without
  // inferring delivery from its presence, turn activity or message text.
  if (entry.kind === "received") {
    const record = records.get(entry.id);
    if (record?.surface === "timeline") return record;
  }
  for (const record of records.values()) if (record.surface === "timeline" && record.timelineItemId === entry.id) return record;
  return undefined;
}

export interface TimelineHistoryWindow {
  /** Incremental loaded-turn membership supplied by native Timeline views. */
  hasTurn?: (turnId: string) => boolean;
  hasOlder: boolean;
  turns: readonly Pick<TurnView, "id" | "startedAt">[];
}

/** Join by ids only; text, native turn activity and elapsed time never prove delivery.
 * A bound, in-context record before the loaded history window belongs behind the older-page
 * control, not after the newest turn. This only scopes presentation; it never settles a record.
 * Turn startedAt is whole seconds and a note read into an older turn can enter context at that
 * turn's end, inside the second the next turn starts; the boundary is the end of that second.
 */
export function missingTimelineRecords(records: ReadonlyMap<string, InputRecord> | undefined, entries: readonly TimelineEntry[], index = timelineRecordIndex(records), history?: TimelineHistoryWindow): InputRecord[] {
  if (!records) return [];
  const joined = new Set<string>();
  for (const entry of entries) {
    for (const record of index.byItemId.get(entry.id) ?? []) joined.add(record.inputId);
    const record = ownerRecordFor(records, entry, index);
    if (record) joined.add(record.inputId);
  }
  const oldestStart = history?.hasOlder ? history.turns[0]?.startedAt : null;
  const loadedTurns = oldestStart != null && !history?.hasTurn ? new Set(history!.turns.map(turn => turn.id)) : null;
  const hasTurn = history?.hasTurn ?? (loadedTurns ? (id: string) => loadedTurns.has(id) : null);
  return [...index.byInputId.values()].filter(record => !joined.has(record.inputId))
    .filter(record => !(hasTurn && oldestStart != null && Number.isFinite(oldestStart)
      && record.state === "inContext" && record.timelineItemId && record.turnId
      && !hasTurn(record.turnId) && Date.parse(record.since) < (oldestStart! + 1) * 1000))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.inputId.localeCompare(b.inputId));
}

export function ownerOutboxTimelineEntry(entry: LedgerOwnerOutbox): Extract<TimelineEntry, { kind: "user" }> {
  return { kind: "user", id: entry.inputId, clientId: entry.inputId, turnId: "", text: entry.text, images: messageImages(entry.extra), skills: messageSkills(entry.extra) };
}

/**
 * `cutex/input/retry` answers normally when the resend itself was refused: `redelivery.ok` is false.
 * `nothingSent`: cutex says so (`user_input_in_progress` says it on a host before that flag). `null`: it went on.
 * `offline`: the runtime is away, the request never left this host.
 * `onlyDismiss`: cutex says no later resend can change this (`retryCannotHelp`).
 */
export function retryRefusal(result: unknown): { code: string; nothingSent: boolean; offline: boolean; onlyDismiss: boolean } | null {
  const redelivery = (result as { redelivery?: { ok?: unknown; error?: { code?: unknown; details?: { retryCannotHelp?: unknown; nothingSent?: unknown } } | null } } | null | undefined)?.redelivery;
  if (redelivery?.ok !== false) return null;
  const code = typeof redelivery.error?.code === "string" ? redelivery.error.code : "unknown";
  const offline = code === "app_server_unavailable" || code === "session_offline";
  return { code, nothingSent: offline || redelivery.error?.details?.nothingSent === true || code === "user_input_in_progress", offline, onlyDismiss: redelivery.error?.details?.retryCannotHelp === true };
}
