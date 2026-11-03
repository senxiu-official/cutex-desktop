// 054 §2.8: per-session alignment of the input ledger (`{epoch, rev, delivery, records}`).
//
// Pure reducers: every function takes the session state and returns the next one plus the reads the caller
// must issue (`fetches`). No IO, no timers, no store wiring. The reducers never mutate their input.
//
// Rules (054 §2.8; the refinements are marked ▲ and explained where they are implemented):
//  1. Event (`cutex/input/stateChanged`, `cutex/session/deliveryChanged`):
//     - another epoch → full `input/list` (▲ the read, not the event, switches the epoch);
//     - older record rev → ignore; equal rev may fill missing host-projection preview/actions only;
//     - `stateRevision > local rev + 1` → a change was missed: `input/list{sinceRevision: local rev}`;
//     - local rev = max(local rev, stateRevision).
//  2. `input/list`, `queue/list`, `input/get`, bootstrap results: records merge one by one on `rev`; the
//     session delivery only moves forward. A stale response never overwrites newer data (#14, RC3).
//  3. `cutex/stream/reset` or a lagged subscription → full read.
//  4. Reconnect (after replaying the stream from its cursor) → `input/list{sinceRevision: local rev}`.
//
// Generations: every fetch carries the session's `generation`; pass it back with the result (also for reads
// the caller makes on its own, e.g. queue/list: take `session.generation` when sending the request). A result
// of an older generation is dropped. The generation moves when the epoch is switched or questioned.

import type {
  InputListResult,
  InputGetResult,
  InputRecord,
  InputStateChangedEvent,
  QueueListResult,
  SessionDelivery,
  SessionDeliveryChangedEvent,
} from "@cutex-desktop/protocol";
import { INPUT_STATE_CHANGED, SESSION_DELIVERY_CHANGED } from "@cutex-desktop/protocol";

export interface InputLedgerSession {
  /** The ledger epoch the records belong to; null before the first read. */
  readonly epoch: string | null;
  /** Highest session `stateRevision` seen in this epoch (054 "本地 rev"). */
  readonly rev: number;
  readonly delivery: SessionDelivery | null;
  /** The `stateRevision` the held `delivery` is known to be current at (0: none). */
  readonly deliveryRevision: number;
  readonly records: ReadonlyMap<string, InputRecord>;
  /** Epochs known to be older than the current one: anything still carrying one is dropped. */
  readonly retiredEpochs: ReadonlySet<string>;
  /** Fetches carry it; a result of an older generation is dropped. */
  readonly generation: number;
  /**
   * Epochs seen on the stream that are not `epoch` (not yet known to be newer or older), with the highest
   * stateRevision seen in each, and the generation of the full read that settles them. Null: none.
   */
  readonly probe: { readonly epochs: ReadonlyMap<string, number>; readonly generation: number } | null;
}

export type InputLedgerFetchReason = "initial" | "epoch" | "gap" | "resync" | "streamReset" | "lagged" | "reconnect";

/** A read the caller must issue: `cutex/input/list` with these params, then pass the result back with `generation`. */
export interface InputLedgerFetch {
  method: "cutex/input/list";
  params: { sinceRevision?: number };
  generation: number;
  reason: InputLedgerFetchReason;
}

export interface InputLedgerStep {
  session: InputLedgerSession;
  fetches: InputLedgerFetch[];
}

/**
 * What a read result covers:
 * - `full`: every record of the session at `stateRevision` (input/list without sinceRevision, bootstrap);
 * - `since`: every record changed in (sinceRevision, stateRevision] (input/list with sinceRevision);
 * - `partial`: some records only (queue/list `inputs`, input/get).
 */
export type InputLedgerCoverage = { kind: "full" } | { kind: "since"; sinceRevision: number } | { kind: "partial" };

export interface InputLedgerSnapshot {
  ledgerEpoch: string;
  stateRevision: number;
  records: readonly InputRecord[];
  delivery?: SessionDelivery | null;
  resyncRequired?: boolean;
  coverage: InputLedgerCoverage;
  /** `session.generation` when the request was sent (a fetch's `generation`). Without it the read cannot switch epochs. */
  generation?: number;
}

export function emptyInputLedgerSession(): InputLedgerSession {
  return { epoch: null, rev: 0, delivery: null, deliveryRevision: 0, records: new Map(), retiredEpochs: new Set(), generation: 0, probe: null };
}

function fetchFull(session: InputLedgerSession, reason: InputLedgerFetchReason): InputLedgerFetch {
  return { method: "cutex/input/list", params: {}, generation: session.generation, reason };
}

function fetchSince(session: InputLedgerSession, sinceRevision: number, reason: InputLedgerFetchReason): InputLedgerFetch {
  return { method: "cutex/input/list", params: { sinceRevision }, generation: session.generation, reason };
}

/** Merge on record `rev`, with equal-version projection hydration; unchanged maps retain identity. */
function mergeRecords(records: ReadonlyMap<string, InputRecord>, incoming: readonly InputRecord[]): ReadonlyMap<string, InputRecord> {
  let next: Map<string, InputRecord> | null = null;
  for (const record of incoming) {
    const local = (next ?? records).get(record.inputId);
    if (local && record.rev < local.rev) continue;
    if (local && record.rev === local.rev) {
      // A host projection may arrive first without preview/actions. The session projection or a
      // point read of that SAME version can fill those fields; it cannot replace authoritative state.
      if (record.stateRevision !== local.stateRevision) continue;
      const preview = local.preview === undefined && record.preview !== undefined ? record.preview : local.preview;
      const actions = local.actions === undefined && record.actions !== undefined ? record.actions : local.actions;
      if (preview === local.preview && actions === local.actions) continue;
      next ??= new Map(records);
      next.set(record.inputId, { ...local, ...(preview !== undefined ? { preview } : {}), ...(actions !== undefined ? { actions } : {}) });
      continue;
    }
    next ??= new Map(records);
    next.set(record.inputId, record);
  }
  return next ?? records;
}

/**
 * Delivery only moves forward. ▲ A delivery read at `revision` is current at that revision, so it replaces the
 * held one when `revision` is not older than the held one's. (054 says "only when stateRevision ≥ local rev";
 * that is a sufficient condition — comparing with the held delivery's revision is equally safe, and it also
 * recovers a missed deliveryChanged from a since-list that arrives after newer record events.)
 */
function mergeDelivery(session: InputLedgerSession, delivery: SessionDelivery | null | undefined, revision: number, strict: boolean): Pick<InputLedgerSession, "delivery" | "deliveryRevision"> {
  const held = { delivery: session.delivery, deliveryRevision: session.deliveryRevision };
  if (!delivery) return held;
  const newer = strict ? revision > session.deliveryRevision : revision >= session.deliveryRevision;
  return newer ? { delivery, deliveryRevision: revision } : held;
}

interface EventEnvelope {
  ledgerEpoch: string;
  stateRevision: number;
}

/**
 * ▲ An event of an epoch that is not the current one. The stream cannot tell whether it is newer (the ledger was
 * rebuilt) or older (a replay from before a rebuild this client already read), and epochs are opaque. So the
 * event is not applied; it opens a probe: one full read (new generation), whose answer decides — the epoch it
 * answers in is current, every epoch seen before the read was sent and not answered is older.
 */
function probeEpoch(session: InputLedgerSession, event: EventEnvelope): InputLedgerStep {
  const known = session.probe?.epochs.get(event.ledgerEpoch);
  if (session.probe && known !== undefined) {
    if (event.stateRevision <= known) return { session, fetches: [] };
    const epochs = new Map(session.probe.epochs).set(event.ledgerEpoch, event.stateRevision);
    return { session: { ...session, probe: { ...session.probe, epochs } }, fetches: [] };
  }
  const generation = session.generation + 1;
  const epochs = new Map(session.probe?.epochs ?? []).set(event.ledgerEpoch, event.stateRevision);
  const next: InputLedgerSession = { ...session, generation, probe: { epochs, generation } };
  return { session: next, fetches: [fetchFull(next, session.epoch === null ? "initial" : "epoch")] };
}

function applyEvent(session: InputLedgerSession, event: EventEnvelope, merge: (session: InputLedgerSession) => InputLedgerSession): InputLedgerStep {
  if (session.retiredEpochs.has(event.ledgerEpoch)) return { session, fetches: [] };
  if (session.epoch !== event.ledgerEpoch) return probeEpoch(session, event);
  const merged = merge(session);
  const fetches = event.stateRevision > session.rev + 1 ? [fetchSince(merged, session.rev, "gap")] : [];
  const rev = Math.max(merged.rev, event.stateRevision);
  return { session: rev === merged.rev ? merged : { ...merged, rev }, fetches };
}

export function applyInputStateChanged(session: InputLedgerSession, event: InputStateChangedEvent): InputLedgerStep {
  return applyEvent(session, event, base => {
    const records = mergeRecords(base.records, [event.record]);
    return records === base.records ? base : { ...base, records };
  });
}

export function applySessionDeliveryChanged(session: InputLedgerSession, event: SessionDeliveryChangedEvent): InputLedgerStep {
  return applyEvent(session, event, base => {
    const delivery = mergeDelivery(base, event.delivery, event.stateRevision, true);
    return delivery.delivery === base.delivery ? base : { ...base, ...delivery };
  });
}

/** Dispatch a session-stream notification; anything that is not an input-ledger event is ignored. */
export function applyInputLedgerNotification(session: InputLedgerSession, method: string, params: unknown): InputLedgerStep {
  if (method === INPUT_STATE_CHANGED) return applyInputStateChanged(session, params as InputStateChangedEvent);
  if (method === SESSION_DELIVERY_CHANGED) return applySessionDeliveryChanged(session, params as SessionDeliveryChangedEvent);
  return { session, fetches: [] };
}

/** Apply a read result (input/list, queue/list, input/get, bootstrap). */
export function applyInputLedgerSnapshot(session: InputLedgerSession, snapshot: InputLedgerSnapshot): InputLedgerStep {
  const epoch = snapshot.ledgerEpoch;
  if (snapshot.generation !== undefined && snapshot.generation < session.generation) return { session, fetches: [] };
  if (session.retiredEpochs.has(epoch)) return { session, fetches: [] };
  const fetches: InputLedgerFetch[] = [];
  let base = session;
  // Highest revision the stream showed in the answered epoch while it was being probed.
  let probedRevision = 0;

  // A read sent after the probe opened settles it: `epoch` is current, every other probed epoch is older.
  if (session.probe && snapshot.generation !== undefined && snapshot.generation >= session.probe.generation) {
    const retired = new Set(session.retiredEpochs);
    for (const [probed, revision] of session.probe.epochs) {
      if (probed === epoch) probedRevision = revision;
      else retired.add(probed);
    }
    base = { ...base, retiredEpochs: retired, probe: null };
  }

  let adopted = false;
  if (base.epoch !== epoch) {
    // Only a read known to be newer than the current epoch may replace it: one sent after the current epoch
    // was adopted (its generation is current). A read without a generation may only set the first epoch.
    if (base.epoch !== null && snapshot.generation === undefined) {
      const step = probeEpoch(base, { ledgerEpoch: epoch, stateRevision: snapshot.stateRevision });
      return { session: step.session, fetches: [...fetches, ...step.fetches] };
    }
    const retired = new Set(base.retiredEpochs);
    if (base.epoch !== null) retired.add(base.epoch);
    base = { ...base, epoch, rev: 0, delivery: null, deliveryRevision: 0, records: new Map(), retiredEpochs: retired, generation: base.generation + 1 };
    adopted = true;
    // A since-list of another epoch is relative to revisions that meant something else; a partial read never
    // covers the session. Only a full read stands on its own.
    if (snapshot.coverage.kind !== "full") fetches.push(fetchFull(base, session.epoch === null ? "initial" : "epoch"));
  }
  if (snapshot.resyncRequired) {
    fetches.push(fetchFull(base, "resync"));
    return { session: base, fetches };
  }
  const coverage = adopted && snapshot.coverage.kind !== "full" ? { kind: "partial" as const } : snapshot.coverage;
  let records = mergeRecords(base.records, snapshot.records);
  if (coverage.kind === "full") {
    // Whatever the full read at R does not list was not there at R (or is outside its settled window).
    // Records changed after R (newer events) stay.
    const listed = new Set(snapshot.records.map(record => record.inputId));
    let pruned: Map<string, InputRecord> | null = null;
    for (const [id, record] of records) {
      if (listed.has(id) || record.stateRevision > snapshot.stateRevision) continue;
      pruned ??= new Map(records);
      pruned.delete(id);
    }
    if (pruned) records = pruned;
  }
  // ▲ A partial read at R > local rev may hide changes it does not list (054 says "the same rule"; for a
  // partial read even R = local rev + 1 can be a change outside it, so the check is R > local rev).
  if (coverage.kind === "partial" && !adopted && snapshot.stateRevision > base.rev) fetches.push(fetchSince(base, base.rev, "gap"));
  // Events of this epoch the stream showed while it was probed (not applied) and the read predates.
  if (coverage.kind !== "partial" && probedRevision > snapshot.stateRevision) fetches.push(fetchSince(base, snapshot.stateRevision, "gap"));
  const delivery = mergeDelivery(base, snapshot.delivery, snapshot.stateRevision, false);
  const rev = Math.max(base.rev, snapshot.stateRevision);
  const next: InputLedgerSession = records === base.records && delivery.delivery === base.delivery && rev === base.rev
    ? base
    : { ...base, records, ...delivery, rev };
  return { session: next, fetches };
}

/** `cutex/input/list` result for `params` (as sent). */
export function inputListSnapshot(result: InputListResult, params: { sinceRevision?: number }, generation?: number): InputLedgerSnapshot {
  const snapshot: InputLedgerSnapshot = {
    ledgerEpoch: result.ledgerEpoch,
    stateRevision: result.stateRevision,
    records: result.records,
    delivery: result.delivery ?? null,
    resyncRequired: result.resyncRequired === true,
    coverage: params.sinceRevision === undefined ? { kind: "full" } : { kind: "since", sinceRevision: params.sinceRevision },
  };
  if (generation !== undefined) snapshot.generation = generation;
  return snapshot;
}

/** `cutex/userInput/queue/list` ledger fields; null on a cutex without input-ledger-v1. */
export function queueListSnapshot(result: QueueListResult, generation?: number): InputLedgerSnapshot | null {
  if (result.ledgerEpoch === undefined || result.stateRevision === undefined) return null;
  const snapshot: InputLedgerSnapshot = {
    ledgerEpoch: result.ledgerEpoch,
    stateRevision: result.stateRevision,
    records: result.inputs ?? [],
    delivery: result.delivery ?? null,
    coverage: { kind: "partial" },
  };
  if (generation !== undefined) snapshot.generation = generation;
  return snapshot;
}

/** `cutex/input/get` result: some records by id. */
export function inputGetSnapshot(result: InputGetResult, generation?: number): InputLedgerSnapshot {
  const snapshot: InputLedgerSnapshot = { ledgerEpoch: result.ledgerEpoch, stateRevision: result.stateRevision, records: result.records, coverage: { kind: "partial" } };
  if (generation !== undefined) snapshot.generation = generation;
  return snapshot;
}

/**
 * Bootstrap (`cutexState`) ledger fields: unsettled + recently settled records, i.e. a full read. Not in the
 * C1 schema yet (054 §2.7 lists them for bootstrap; expected with C5).
 */
export function bootstrapSnapshot(state: { ledgerEpoch?: string; stateRevision?: number; inputs?: InputRecord[]; delivery?: SessionDelivery | null }, generation?: number): InputLedgerSnapshot | null {
  if (state.ledgerEpoch === undefined || state.stateRevision === undefined) return null;
  const snapshot: InputLedgerSnapshot = { ledgerEpoch: state.ledgerEpoch, stateRevision: state.stateRevision, records: state.inputs ?? [], delivery: state.delivery ?? null, coverage: { kind: "full" } };
  if (generation !== undefined) snapshot.generation = generation;
  return snapshot;
}

/** `cutex/stream/reset` or a lagged subscription: read everything again (records stay until the read prunes them). */
export function inputLedgerStreamReset(session: InputLedgerSession, reason: "streamReset" | "lagged" = "streamReset"): InputLedgerStep {
  return { session, fetches: [fetchFull(session, reason)] };
}

/** After reconnecting and replaying the stream from its cursor: one incremental read (full when nothing is known yet). */
export function inputLedgerReconnected(session: InputLedgerSession): InputLedgerStep {
  if (session.epoch === null) return { session, fetches: [fetchFull(session, "initial")] };
  return { session, fetches: [fetchSince(session, session.rev, "reconnect")] };
}
