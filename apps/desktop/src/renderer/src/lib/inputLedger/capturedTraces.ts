/** Real C2–C5 recorder format. No IO, clocks, native-history inference or fabricated read replies. */
import type { InputRecord, SessionDelivery } from "@cutex-desktop/protocol";
import { INPUT_STATE_CHANGED, SESSION_DELIVERY_CHANGED } from "@cutex-desktop/protocol";
import {
  applyInputLedgerNotification, applyInputLedgerSnapshot, emptyInputLedgerSession,
  inputLedgerStreamReset, type InputLedgerFetch, type InputLedgerSession, type InputLedgerSnapshot,
} from "./alignment";
import type { SurfaceTraceEntry } from "./surfaceTrace";

type JsonObject = Record<string, unknown>;
export interface CapturedTraceEntry {
  /** Original one-based JSONL line, including blank lines in the count. */
  line: number;
  atMs: number;
  source: string;
  kind: string;
  cutexSessionId?: string;
  sequence?: number;
  payload: JsonObject;
  /** Untouched parsed envelope, including fields unknown to this reader. */
  raw: JsonObject;
}
interface OperationBase { entry: CapturedTraceEntry; sessionId: string }
export type CapturedOperation =
  | (OperationBase & { type: "event"; method: string; params: JsonObject })
  | (OperationBase & { type: "snapshot"; snapshot: InputLedgerSnapshot })
  | (OperationBase & { type: "response"; records: InputRecord[]; ledgerEpoch?: string; stateRevision?: number; outcome?: string; interruptedTurnId?: string | null })
  | { type: "ignored"; entry: CapturedTraceEntry; reason: string };

function object(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function fail(line: number, detail: string): never { throw new Error(`captured trace line ${line}: ${detail}`); }
function revision(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0; }
function records(value: unknown, line: number): InputRecord[] {
  if (!Array.isArray(value)) return fail(line, "expected records array");
  for (const record of value) {
    if (!object(record) || typeof record.inputId !== "string" || typeof record.cutexSessionId !== "string"
      || !revision(record.rev) || record.rev === 0 || !revision(record.stateRevision) || record.stateRevision === 0
      || typeof record.surface !== "string" || typeof record.state !== "string") fail(line, "malformed ledger record");
  }
  // Deliberately not a schema validator: unknown states/reasons must reach the UI's unknown-code path.
  return value as InputRecord[];
}

export function parseCapturedTrace(jsonl: string): CapturedTraceEntry[] {
  const entries: CapturedTraceEntry[] = [];
  jsonl.split(/\r?\n/).forEach((text, index) => {
    const line = index + 1;
    if (!text.trim()) return;
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { return fail(line, "invalid JSON"); }
    if (!object(raw) || typeof raw.atMs !== "number" || !Number.isFinite(raw.atMs)
      || typeof raw.source !== "string" || typeof raw.kind !== "string" || !object(raw.payload)) fail(line, "expected atMs/source/kind/payload envelope");
    if (raw.cutexSessionId !== undefined && typeof raw.cutexSessionId !== "string") fail(line, "invalid cutexSessionId");
    if (raw.sequence !== undefined && !revision(raw.sequence)) fail(line, "invalid sequence");
    entries.push({ line, atMs: raw.atMs, source: raw.source, kind: raw.kind, payload: raw.payload,
      ...(typeof raw.cutexSessionId === "string" ? { cutexSessionId: raw.cutexSessionId } : {}),
      ...(typeof raw.sequence === "number" ? { sequence: raw.sequence } : {}), raw });
  });
  return entries;
}

export function capturedOperations(entries: readonly CapturedTraceEntry[]): CapturedOperation[] {
  return entries.map(entry => {
    const { payload, line, source, kind } = entry;
    const ignored = (reason: string): CapturedOperation => ({ type: "ignored", entry, reason });
    if (source === "session" || source === "host") {
      const method = kind === "stateChanged" ? INPUT_STATE_CHANGED : kind === "deliveryChanged" ? SESSION_DELIVERY_CHANGED : kind === "streamReset" ? "cutex/stream/reset" : payload.method;
      if (method !== INPUT_STATE_CHANGED && method !== SESSION_DELIVERY_CHANGED && method !== "cutex/stream/reset") return ignored("non-ledger stream event");
      const params = kind === "stateChanged" || kind === "deliveryChanged" || kind === "streamReset" ? payload : payload.params;
      if (!object(params)) return fail(line, "ledger event has no params");
      const sessionId = typeof params.cutexSessionId === "string" ? params.cutexSessionId : entry.cutexSessionId;
      if (!sessionId) return fail(line, "ledger event has no session id");
      if (entry.cutexSessionId && entry.cutexSessionId !== sessionId) fail(line, "event session id disagrees with envelope");
      if (method !== "cutex/stream/reset") {
        if (typeof params.ledgerEpoch !== "string" || !revision(params.stateRevision)) fail(line, "ledger event has no epoch/revision");
        if (method === INPUT_STATE_CHANGED) {
          const [record] = records([params.record], line);
          if (record!.cutexSessionId !== sessionId || record!.stateRevision !== params.stateRevision) fail(line, "event/record session or revision mismatch");
        } else if (!object(params.delivery)) fail(line, "delivery event has no delivery");
      }
      return { type: "event", entry, sessionId, method, params };
    }
    if (source === "snapshot" && (kind === "inputList" || kind === "queueList" || kind === "inputGet" || kind === "bootstrap")) {
      if (payload.ledgerEpoch === undefined && kind === "queueList") return ignored("legacy queue snapshot");
      if (!entry.cutexSessionId || typeof payload.ledgerEpoch !== "string" || !revision(payload.stateRevision)) fail(line, "snapshot has no session/epoch/revision");
      const sinceRevision = payload.sinceRevision;
      const coverage = kind === "queueList" || kind === "inputGet" || payload.complete === false ? { kind: "partial" as const }
        : revision(sinceRevision) ? { kind: "since" as const, sinceRevision } : { kind: "full" as const };
      if (kind === "inputList" && typeof payload.complete !== "boolean") fail(line, "inputList has no complete flag");
      const incoming = records(kind === "queueList" || kind === "bootstrap" ? payload.inputs : payload.records, line);
      if (incoming.some(record => record.cutexSessionId !== entry.cutexSessionId)) fail(line, "snapshot records mix sessions");
      return { type: "snapshot", entry, sessionId: entry.cutexSessionId, snapshot: {
        ledgerEpoch: payload.ledgerEpoch, stateRevision: payload.stateRevision,
        records: incoming,
        ...(object(payload.delivery) ? { delivery: payload.delivery as unknown as SessionDelivery } : {}),
        resyncRequired: payload.resyncRequired === true, coverage,
      } };
    }
    if (source === "marker" && kind === "interruptSend") {
      // C5 recorder marks the result DIRECTLY, not Rust result.Ok and not result.input.
      const incoming = records([payload.record], line);
      if (typeof payload.ledgerEpoch !== "string" || !revision(payload.stateRevision) || payload.stateRevision < incoming[0]!.stateRevision
        || typeof payload.outcome !== "string" || !(payload.interruptedTurnId === null || typeof payload.interruptedTurnId === "string")) fail(line, "malformed interruptSend result");
      return { type: "response", entry, sessionId: incoming[0]!.cutexSessionId, records: incoming,
        ledgerEpoch: payload.ledgerEpoch, stateRevision: payload.stateRevision, outcome: payload.outcome, interruptedTurnId: payload.interruptedTurnId };
    }
    if (source === "marker" && kind === "interruptSendStale") return ignored("interruptSend CAS-conflict diagnostic (no ledger mutation)");
    if (source === "marker" && (kind === "ownerSubmit" || kind === "queueMerge")) {
      const result = object(payload.result) && object(payload.result.Ok) ? payload.result.Ok : null;
      if (!result) return ignored("unsuccessful mutation marker");
      const incoming = kind === "queueMerge" ? result.inputs : result.input ? [result.input] : [];
      const incomingRecords = records(incoming, line);
      if (!incomingRecords.length) return ignored("mutation has no ledger records");
      const sessionId = typeof payload.sid === "string" ? payload.sid : incomingRecords[0]!.cutexSessionId;
      if (incomingRecords.some(record => record.cutexSessionId !== sessionId)) fail(line, "mutation records mix sessions");
      return { type: "response", entry, sessionId, records: incomingRecords };
    }
    return ignored("non-ledger capture marker");
  });
}

export interface CapturedReplayOptions {
  initialSessions?: ReadonlyMap<string, InputLedgerSession>;
  streams?: "both" | "host" | "session";
  /** Captures contain completion times, not request-start generations. Supply them when known. */
  snapshotGeneration?: (operation: Extract<CapturedOperation, { type: "snapshot" }>, session: InputLedgerSession) => number | undefined;
  /** Mutation replies carry records but no epoch. Supply request epoch when known. */
  responseEpoch?: (operation: Extract<CapturedOperation, { type: "response" }>) => string | undefined;
}
export interface CapturedReplayFrame {
  entry: CapturedTraceEntry;
  operation: CapturedOperation;
  sessionId: string;
  session: InputLedgerSession;
}
export interface CapturedReplay {
  sessions: Map<string, InputLedgerSession>;
  frames: CapturedReplayFrame[];
  fetches: { line: number; sessionId: string; fetch: InputLedgerFetch }[];
  /** A reply before an actual epoch-bearing read cannot safely be attached to an epoch. */
  unresolvedResponses: Extract<CapturedOperation, { type: "response" }>[];
  /** New-epoch reads with no recorded request-start generation. D1 requests a trusted read;
   * the replay does not manufacture that reply or stamp the current generation onto this one. */
  unresolvedEpochReads: Extract<CapturedOperation, { type: "snapshot" }>[];
}

export function replayCapturedTrace(entries: readonly CapturedTraceEntry[], options: CapturedReplayOptions = {}): CapturedReplay {
  const result: CapturedReplay = { sessions: new Map(options.initialSessions), frames: [], fetches: [], unresolvedResponses: [], unresolvedEpochReads: [] };
  for (const operation of capturedOperations(entries)) {
    if (operation.type === "ignored") continue;
    const { entry, sessionId } = operation;
    if (operation.type === "event" && options.streams && options.streams !== "both" && entry.source !== options.streams) continue;
    const session = result.sessions.get(sessionId) ?? emptyInputLedgerSession();
    let step;
    if (operation.type === "event") step = operation.method === "cutex/stream/reset" ? inputLedgerStreamReset(session)
      : applyInputLedgerNotification(session, operation.method, operation.params);
    else if (operation.type === "snapshot") {
      const generation = options.snapshotGeneration?.(operation, session);
      if (session.epoch !== null && session.epoch !== operation.snapshot.ledgerEpoch && generation === undefined && !session.retiredEpochs.has(operation.snapshot.ledgerEpoch)) result.unresolvedEpochReads.push(operation);
      step = applyInputLedgerSnapshot(session, { ...operation.snapshot, ...(generation !== undefined ? { generation } : {}) });
    } else {
      const epoch = operation.ledgerEpoch ?? (options.responseEpoch ? options.responseEpoch(operation) : session.epoch);
      if (!epoch) { result.unresolvedResponses.push(operation); continue; }
      step = applyInputLedgerSnapshot(session, { ledgerEpoch: epoch, stateRevision: operation.stateRevision ?? Math.max(...operation.records.map(record => record.stateRevision)), records: operation.records, coverage: { kind: "partial" } });
    }
    result.sessions.set(sessionId, step.session);
    result.frames.push({ entry, operation, sessionId, session: step.session });
    for (const fetch of step.fetches) result.fetches.push({ line: entry.line, sessionId, fetch });
  }
  return result;
}

function eventKey(operation: Extract<CapturedOperation, { type: "event" }>): string {
  const p = operation.params;
  const record = object(p.record) ? p.record : null;
  return JSON.stringify([operation.sessionId, operation.method, p.ledgerEpoch, p.stateRevision, record?.inputId, record?.rev]);
}

function equivalent(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, index) => equivalent(value, b[index]));
  if (!object(a) || !object(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => key in b && equivalent(a[key], b[key]));
}

function sameProjection(a: Extract<CapturedOperation, { type: "event" }>, b: Extract<CapturedOperation, { type: "event" }>): boolean {
  if (a.method !== INPUT_STATE_CHANGED) return equivalent(a.params, b.params);
  const ar = a.params.record as JsonObject, br = b.params.record as JsonObject;
  const { preview: ap, actions: aa, ...ac } = ar;
  const { preview: bp, actions: ba, ...bc } = br;
  return equivalent({ ...a.params, record: ac }, { ...b.params, record: bc })
    && (ap === undefined || bp === undefined || equivalent(ap, bp))
    && (aa === undefined || ba === undefined || equivalent(aa, ba));
}

/** Backend stream audit: remove only host/session projection duplicates. Never sort or change records. */
export function capturedSurfaceTrace(entries: readonly CapturedTraceEntry[], options: { snapshots?: boolean } = {}): SurfaceTraceEntry[] {
  const operations = capturedOperations(entries);
  const sessionEvents = new Map(operations.filter((operation): operation is Extract<CapturedOperation, { type: "event" }> => operation.type === "event" && operation.entry.source === "session").map(operation => [eventKey(operation), operation]));
  const trace: SurfaceTraceEntry[] = [];
  for (const operation of operations) {
    if (operation.type === "event") {
      const sessionEvent = sessionEvents.get(eventKey(operation));
      // Conflicting projections stay in the audit. Removing them would hide a genuine wire failure.
      if (operation.entry.source === "host" && sessionEvent && sameProjection(operation, sessionEvent)) continue;
      trace.push({ at: operation.entry.atMs, event: { method: operation.method, params: operation.params } });
    } else if (operation.type === "snapshot" && options.snapshots !== false) {
      trace.push({ at: operation.entry.atMs, snapshot: { cutexSessionId: operation.sessionId, ledgerEpoch: operation.snapshot.ledgerEpoch,
        stateRevision: operation.snapshot.stateRevision, records: [...operation.snapshot.records], delivery: operation.snapshot.delivery } });
    }
  }
  return trace;
}

export interface CapturedPolicyDifference {
  rule: "ownerHostBusySurface";
  entry: CapturedTraceEntry;
  record: InputRecord;
  expectedSurface: "nextUp";
}

/** Diagnose only with an explicit running-turn observation. Original captures
 * without SessionDelivery cannot distinguish an idle busy host from a running
 * turn (owner decision 2026-11-04). Never rewrite historical surfaces. */
export function capturedPolicyDifferences(entries: readonly CapturedTraceEntry[]): CapturedPolicyDifference[] {
  const deliveries = new Map<string, SessionDelivery>();
  return capturedOperations(entries).flatMap(operation => {
    if (operation.type === "snapshot" && operation.snapshot.delivery) deliveries.set(operation.sessionId, operation.snapshot.delivery);
    if (operation.type === "event" && operation.method === SESSION_DELIVERY_CHANGED) deliveries.set(operation.sessionId, operation.params.delivery as unknown as SessionDelivery);
    if (operation.type !== "event" || operation.entry.source !== "session" || operation.method !== INPUT_STATE_CHANGED) return [];
    const record = operation.params.record as unknown as InputRecord;
    return deliveries.get(operation.sessionId)?.turn != null && record.kind === "owner" && record.state === "waiting" && record.reason === "hostBusy" && record.surface !== "nextUp"
      ? [{ rule: "ownerHostBusySurface" as const, entry: operation.entry, record, expectedSurface: "nextUp" as const }] : [];
  });
}
