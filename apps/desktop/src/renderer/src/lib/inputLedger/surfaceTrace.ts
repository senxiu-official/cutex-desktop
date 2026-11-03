// 054 §5.2: the common assertions every scenario's surface trace must satisfy (TS twin of the Rust
// `assertSurfaceTrace` in cutex `tests/input_ledger_e2e*`).
//
// Trace format: JSON Lines, one entry per line, as a recorder subscribed to the session / host stream writes it.
// Events are copied verbatim from the wire (`method`, `params`); snapshots are read results.
//   {"at":"2026-11-01T10:00:00.120Z","event":{"method":"cutex/input/stateChanged","params":{…}}}
//   {"at":"2026-11-01T10:00:00.300Z","event":{"method":"cutex/session/deliveryChanged","params":{…}}}
//   {"at":"2026-11-01T10:00:01.000Z","snapshot":{"cutexSessionId":"…","ledgerEpoch":"…","stateRevision":12,"records":[…]}}
// Other methods (legacy `cutex/userInput/*`, `cutex/stream/reset`, …) may be present and are ignored.
// `at` is RFC 3339 (or epoch milliseconds).

import type { InputRecord, InputSurface, SessionDelivery } from "@cutex-desktop/protocol";
import { INPUT_STATE_CHANGED, SESSION_DELIVERY_CHANGED, isInputSettled } from "@cutex-desktop/protocol";

export interface SurfaceTraceEvent {
  at: string | number;
  event: { method: string; params: unknown };
}

export interface SurfaceTraceSnapshot {
  at: string | number;
  snapshot: {
    cutexSessionId: string;
    ledgerEpoch: string;
    stateRevision: number;
    records: InputRecord[];
    delivery?: SessionDelivery | null;
  };
}

export type SurfaceTraceEntry = SurfaceTraceEvent | SurfaceTraceSnapshot;

export type SurfaceTraceRule =
  | "format"
  | "oneSurface" //         an inputId is on exactly one surface at any time
  | "surfaceDirection" //   only nextUp→timeline, pendingNotes→timeline, *→none (owner retry excepted)
  | "deadline" //           settled within the last deadline + grace
  | "stateRevision" //      per session: increasing batches, distinct members may share a revision; no holes
  | "recordRev"; //         per record: monotonic

export interface SurfaceTraceViolation {
  rule: SurfaceTraceRule;
  /** 0-based entry index (the trace line). */
  index: number;
  cutexSessionId?: string;
  inputId?: string;
  message: string;
}

export interface SurfaceTraceOptions {
  /** Settle grace after the last deadline (054: 5 s). */
  graceMs?: number;
  /** End of the observation (default: the last entry's `at`); unsettled records past deadline + grace fail. */
  endAt?: string | number;
}

export function parseSurfaceTrace(jsonl: string): SurfaceTraceEntry[] {
  const out: SurfaceTraceEntry[] = [];
  for (const line of jsonl.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    out.push(JSON.parse(line) as SurfaceTraceEntry);
  }
  return out;
}

function timeOf(at: string | number): number {
  return typeof at === "number" ? at : Date.parse(at);
}

/** Allowed surface moves (054 §2.1 invariant 3, §2.5). An owner resend (→ waiting{ownerRetry}) recomputes the surface. */
export function surfaceMoveAllowed(from: InputSurface, to: InputSurface, next: Pick<InputRecord, "state" | "reason">): boolean {
  if (from === to) return true;
  if (next.state === "waiting" && next.reason === "ownerRetry") return true;
  if (to === "none") return true;
  return to === "timeline" && (from === "nextUp" || from === "pendingNotes");
}

interface RecordTrack {
  rev: number;
  surface: InputSurface;
  state: InputRecord["state"];
  deadline: number | null;
  deadlineReported: boolean;
}

interface SessionTrack {
  epoch: string;
  /** Last event stateRevision in this epoch; null before the first event. */
  revision: number | null;
  /** C5 atomic batches can emit several distinct inputs (and delivery) at one session revision. */
  revisionMembers: Set<string>;
  records: Map<string, RecordTrack>;
}

/** All violations of the §5.2 common assertions; empty = the trace passes. */
export function checkSurfaceTrace(trace: readonly SurfaceTraceEntry[], options: SurfaceTraceOptions = {}): SurfaceTraceViolation[] {
  const grace = options.graceMs ?? 5000;
  const violations: SurfaceTraceViolation[] = [];
  const sessions = new Map<string, SessionTrack>();

  const sessionFor = (id: string, epoch: string): SessionTrack => {
    let track = sessions.get(id);
    if (!track || track.epoch !== epoch) {
      // A new ledger epoch rebuilds the records: revisions and surfaces start over.
      track = { epoch, revision: null, revisionMembers: new Set(), records: new Map() };
      sessions.set(id, track);
    }
    return track;
  };

  const observe = (index: number, at: number, session: string, track: SessionTrack, record: InputRecord, fromEvent: boolean) => {
    const id = record.inputId;
    const before = track.records.get(id);
    const where = { index, cutexSessionId: session, inputId: id };
    let reported = before?.deadlineReported ?? false;
    if (before) {
      if (fromEvent ? record.rev <= before.rev : record.rev < before.rev) {
        violations.push({ rule: "recordRev", ...where, message: `rev ${record.rev} after ${before.rev}` });
        return;
      }
      if (record.rev === before.rev) return;
      if (!surfaceMoveAllowed(before.surface, record.surface, record)) {
        violations.push({ rule: "surfaceDirection", ...where, message: `${before.surface} → ${record.surface} (${record.state}${record.reason ? `{${record.reason}}` : ""})` });
      }
      if (before.deadline !== null && !reported && at > before.deadline + grace) {
        violations.push({ rule: "deadline", ...where, message: `${before.state} past its deadline by ${at - before.deadline} ms` });
        reported = true;
      }
    }
    const deadline = !isInputSettled(record.state) && record.deadline ? timeOf(record.deadline) : null;
    const carried = before && before.state === record.state && before.deadline === deadline ? reported : false;
    track.records.set(id, { rev: record.rev, surface: record.surface, state: record.state, deadline, deadlineReported: carried });
  };

  let lastAt = Number.NEGATIVE_INFINITY;
  trace.forEach((entry, index) => {
    const at = timeOf(entry.at);
    if (!Number.isFinite(at)) {
      violations.push({ rule: "format", index, message: `bad at: ${String(entry.at)}` });
      return;
    }
    lastAt = Math.max(lastAt, at);
    if ("snapshot" in entry) {
      const snap = entry.snapshot;
      const track = sessionFor(snap.cutexSessionId, snap.ledgerEpoch);
      const seen = new Set<string>();
      for (const record of snap.records) {
        if (seen.has(record.inputId)) {
          violations.push({ rule: "oneSurface", index, cutexSessionId: snap.cutexSessionId, inputId: record.inputId, message: "listed twice in one snapshot" });
          continue;
        }
        seen.add(record.inputId);
        observe(index, at, snap.cutexSessionId, track, record, false);
      }
      return;
    }
    const { method, params } = entry.event;
    if (method !== INPUT_STATE_CHANGED && method !== SESSION_DELIVERY_CHANGED) return;
    const p = params as { cutexSessionId?: string; ledgerEpoch?: string; stateRevision?: number; record?: InputRecord };
    if (typeof p?.cutexSessionId !== "string" || typeof p.ledgerEpoch !== "string" || typeof p.stateRevision !== "number") {
      violations.push({ rule: "format", index, message: `${method} without cutexSessionId / ledgerEpoch / stateRevision` });
      return;
    }
    const track = sessionFor(p.cutexSessionId, p.ledgerEpoch);
    const member = method === INPUT_STATE_CHANGED ? `input:${p.record?.inputId}` : "delivery";
    const batchMember = p.stateRevision === track.revision && !track.revisionMembers.has(member);
    if (track.revision !== null && p.stateRevision !== track.revision + 1 && !batchMember) {
      violations.push({
        rule: "stateRevision", index, cutexSessionId: p.cutexSessionId,
        message: p.stateRevision <= track.revision ? `stateRevision ${p.stateRevision} after ${track.revision}` : `hole: ${track.revision} → ${p.stateRevision}`,
      });
    }
    if (track.revision === null || p.stateRevision > track.revision) track.revisionMembers = new Set();
    track.revisionMembers.add(member);
    track.revision = track.revision === null ? p.stateRevision : Math.max(track.revision, p.stateRevision);
    if (method === INPUT_STATE_CHANGED) {
      if (!p.record || typeof p.record.inputId !== "string") {
        violations.push({ rule: "format", index, message: "stateChanged without record" });
        return;
      }
      if (p.record.stateRevision !== p.stateRevision) {
        violations.push({ rule: "stateRevision", index, cutexSessionId: p.cutexSessionId, inputId: p.record.inputId, message: `record.stateRevision ${p.record.stateRevision} ≠ event ${p.stateRevision}` });
      }
      observe(index, at, p.cutexSessionId, track, p.record, true);
    }
  });

  const end = options.endAt !== undefined ? timeOf(options.endAt) : lastAt;
  for (const [session, track] of sessions) {
    for (const [inputId, record] of track.records) {
      if (record.deadline !== null && !record.deadlineReported && end > record.deadline + grace) {
        violations.push({ rule: "deadline", index: trace.length, cutexSessionId: session, inputId, message: `still ${record.state} ${end - record.deadline} ms after its deadline` });
      }
    }
  }
  return violations;
}

/** Throws with every violation listed when the trace breaks a §5.2 common assertion. */
export function assertSurfaceTrace(trace: readonly SurfaceTraceEntry[] | string, options: SurfaceTraceOptions = {}): void {
  const entries = typeof trace === "string" ? parseSurfaceTrace(trace) : trace;
  const violations = checkSurfaceTrace(entries, options);
  if (violations.length === 0) return;
  const lines = violations.map(v => `  [${v.rule}] line ${v.index + 1}${v.cutexSessionId ? ` ${v.cutexSessionId}` : ""}${v.inputId ? `/${v.inputId}` : ""}: ${v.message}`);
  throw new Error(`surface trace: ${violations.length} violation(s)\n${lines.join("\n")}`);
}

/** Per input (`cutexSessionId/inputId`), the sequence of surfaces it was on — to compare a rendered trace with cutex's. */
export function surfaceSequences(trace: readonly SurfaceTraceEntry[]): Map<string, InputSurface[]> {
  const out = new Map<string, InputSurface[]>();
  const push = (session: string, record: InputRecord) => {
    const key = `${session}/${record.inputId}`;
    const list = out.get(key) ?? [];
    if (list[list.length - 1] !== record.surface) list.push(record.surface);
    out.set(key, list);
  };
  for (const entry of trace) {
    if ("snapshot" in entry) {
      for (const record of entry.snapshot.records) push(entry.snapshot.cutexSessionId, record);
    } else if (entry.event.method === INPUT_STATE_CHANGED) {
      const p = entry.event.params as { cutexSessionId: string; record: InputRecord };
      push(p.cutexSessionId, p.record);
    }
  }
  return out;
}
