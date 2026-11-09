// Final R4 captured replay. Historical C2 files require explicit trace selection.
import type { InputRecord, InputLease, InputListParams, InputListResult, SessionDelivery, SubmitStrategy, QueueItem, UserInputQueueMergeParams, InputInterruptSendParams, InputInterruptSendResult } from "@cutex-desktop/protocol";
import { capturedOperations, parseCapturedTrace, replayCapturedTrace } from "../lib/inputLedger/capturedTraces";
import { emptyInputLedgerSession } from "../lib/inputLedger/alignment";
import { mergeQueueInputs } from "../../../shared/queueMerge";

export const INPUT_LEDGER_FIXTURE_NOTICE = "Public anonymized derivative of controlled-native backend E2E captures; preview session remapping; actual captured delivery when present. Interactive mutation responses and absent-delivery overlays are SYNTHETIC, not provider acceptance evidence.";
const traces = import.meta.glob<string>("./inputLedgerFixtures/**/*.jsonl", { query: "?raw", import: "default", eager: true });
export const CAPTURED_LEDGER_TRACES = Object.keys(traces).map(path => path.replace("./inputLedgerFixtures/", ""));
export const DEFAULT_LEDGER_TRACES: Readonly<Record<LedgerScene, string>> = { idle: "r4-final-8be40c64/s01-codex.jsonl", turn: "r4-final-8be40c64/s26-codex.jsonl", offline: "r4-final-8be40c64/s13-codex.jsonl", starting: "r4-final-8be40c64/s13-codex.jsonl", held: "r4-final-8be40c64/s07-codex.jsonl", bus: "r4-final-8be40c64/s11-codex.jsonl", uncertain: "r4-final-8be40c64/s12-codex.jsonl", lease: "r4-final-8be40c64/s16-codex.jsonl" };
export const R4_CAPTURE_SET = { directory: "r4-final-8be40c64", sourceCommit: "withheld-public-projection", manifestSha256: "3df886d14fcd4c5a0ba44b532b606aedcec977c91dd0a3d96870b4c1d47be6c2", run: "One coherent backend E2E controlled-native run: 82 pass, 0 fail, 3 ignored; run 1; 2026-11-03T03:39:20Z" } as const;
export const LEDGER_CAPTURE_DIAGNOSTICS = { ignoredAbsent: [] as readonly string[], historicalDirectories: ["r4-final-f7e1725a/", "r4-final-d8ca82a5/"], supersededDirectories: ["r4-final/", "r4-final-SUPERSEDED/"] } as const;
/** Project only captured operations up to this line. No inferred native states or invented read responses. */
export function capturedPreview(trace: string, line?: number, sourceSessionId?: string) {
  const raw = traces[`./inputLedgerFixtures/${trace}`];
  if (!raw) throw new Error(`unknown captured ledger trace: ${trace}`);
  const entries = parseCapturedTrace(raw);
  let items: QueueItem[] = [], queueRevision = 0;
  const selected = entries.filter(entry => line === undefined || entry.line <= line);
  const operations = capturedOperations(selected);
  // Multi-session bus traces can start with the sender's idle delivery. Choose the first
  // explicit record's session for the whole file, including prefixes before that record.
  const all = capturedOperations(entries);
  if (sourceSessionId !== undefined && !all.some(operation => operation.type !== "ignored" && operation.sessionId === sourceSessionId)) throw new Error(`unknown captured ledger session: ${sourceSessionId}`);
  const primary = all.find(operation => operation.type === "event" && !!operation.params.record
    || operation.type === "snapshot" && operation.snapshot.records.length > 0 || operation.type === "response" && operation.records.length > 0)
    ?? all.find(operation => operation.type !== "ignored" && operation.sessionId !== "cutex.host");
  const sessionId = sourceSessionId ?? (primary && primary.type !== "ignored" ? primary.sessionId : "");
  const first = operations.find(operation => operation.type !== "ignored" && operation.sessionId === sessionId && (operation.type === "event" ? typeof operation.params.ledgerEpoch === "string" : operation.type === "snapshot"));
  // Preview-only epoch anchor permits checkpoints before the first recorded read. It supplies NO
  // records, read replies or delivery. All merge/hydration/epoch/revision rules remain D1's.
  const anchorEpoch = first?.type === "event" ? first.params.ledgerEpoch as string : first?.type === "snapshot" ? first.snapshot.ledgerEpoch : null;
  const initialSessions = anchorEpoch ? new Map([[sessionId, { ...emptyInputLedgerSession(), epoch: anchorEpoch }]]) : undefined;
  const replay = replayCapturedTrace(selected, { initialSessions });
  const session = replay.sessions.get(sessionId) ?? emptyInputLedgerSession();
  for (const operation of operations) {
    if (operation.type === "ignored" || operation.sessionId !== sessionId) continue;
    if (operation.entry.kind === "queueList") { items = structuredClone(operation.entry.payload.items as QueueItem[] ?? []); queueRevision = operation.entry.payload.revision as number; }
  }
  return { trace, line: selected.at(-1)?.line ?? 0, sourceSessionId: sessionId, epoch: session.epoch ?? "", revision: session.rev, queueRevision, records: [...session.records.values()], delivery: structuredClone(session.delivery), items, raw,
    epochAnchor: "SYNTHETIC preview initial epoch only; no fabricated read reply", fetches: replay.fetches };
}
export function inputLedgerMockEnabled(search: string): boolean {
  const q = new URLSearchParams(search);
  return q.has("inputLedger") && !q.has("legacy");
}
export type LedgerScene = "idle" | "turn" | "offline" | "starting" | "held" | "bus" | "uncertain" | "lease";
export const LEDGER_SCENES: readonly LedgerScene[] = ["idle", "turn", "offline", "starting", "held", "bus", "uncertain", "lease"];
const EPOCH = "synthetic-preview-r274";
type Emit = (session: string, method: string, params: Record<string, unknown>) => void;
interface Session { epoch: string; revision: number; queueRevision: number; records: Map<string, InputRecord>; delivery: SessionDelivery; items: QueueItem[] }

export function createMockInputLedger(scene: LedgerScene = "turn", emit: Emit = () => {}, clock = Date.now, capture?: { trace?: string; line?: number; sourceSessionId?: string }) {
  const sessions = new Map<string, Session>();
  const provenance = new Map<string, unknown>();
  const iso = () => new Date(clock()).toISOString();
  const baseDelivery = (state: SessionDelivery["state"], revision: number): SessionDelivery => ({ state, reason: null, turn: null, lease: null, runtimeConnected: state !== "offline" && state !== "starting", runtimeGeneration: 1, heldCount: 0, heldUntil: null, stateRevision: revision, observedAt: iso() });
  function syntheticDelivery() {
    const state = ["idle", "turn", "offline", "starting", "held"].includes(scene) ? scene as SessionDelivery["state"] : scene === "lease" ? "held" : "idle";
    const delivery = baseDelivery(state, 0);
    if (state === "turn") delivery.turn = { turnId: "synthetic-preview-turn", kind: "owner", askId: null, startedAt: iso(), inputIds: [] };
    if (state === "held") Object.assign(delivery, { reason: scene === "lease" ? "eventLease" : "hostBusy", heldCount: 1 });
    if (scene === "lease") delivery.lease = { holder: "event", turnId: "synthetic-ended-turn", since: iso(), runtimeGeneration: 1, inputIds: [], reconcile: { state: "stale", lastCheckedAt: iso(), nextCheckAt: null, lastResult: "turnNotFound" } };
    return delivery;
  }
  function get(id: string): Session {
    let s = sessions.get(id);
    if (s) return s;
    s = { epoch: EPOCH, revision: 0, queueRevision: 0, records: new Map(), delivery: baseDelivery("idle", 0), items: [] };
    sessions.set(id, s);
    s.delivery = syntheticDelivery();
    try { loadCapture(id, capture?.trace ?? DEFAULT_LEDGER_TRACES[scene], capture?.line, capture?.sourceSessionId); }
    catch (error) { sessions.delete(id); provenance.delete(id); throw error; }
    return s;
  }
  function loadCapture(id: string, trace: string, requestedLine?: number, sourceSessionId?: string) {
    const raw = traces[`./inputLedgerFixtures/${trace}`];
    if (!raw) throw new Error(`unknown captured ledger trace: ${trace}`);
    const entries = parseCapturedTrace(raw);
    const checkpoints = sourceSessionId === undefined ? entries : entries.filter(entry => entry.cutexSessionId === sourceSessionId);
    // Useful captured checkpoints, never rewriting the captured states/surfaces.
    const isR4 = trace.startsWith("r4-final-8be40c64/");
    const offered = checkpoints.find(entry => entry.source === "session" && entry.kind === "stateChanged" && (entry.payload.record as InputRecord)?.actions?.includes("interruptSend"));
    // Prefer the later actual binding checkpoint for the default S26 scene. Earlier
    // interruptible checkpoints remain selectable by line; never fill missing ids.
    const bound = offered && checkpoints.find(entry => entry.line > offered.line && entry.source === "session" && entry.kind === "stateChanged"
      && (entry.payload.record as InputRecord)?.inputId === (offered.payload.record as InputRecord).inputId
      && !!(entry.payload.record as InputRecord)?.timelineItemId);
    const realCheckpoint = isR4 ? scene === "turn" && offered
      ? bound ?? checkpoints.find(entry => entry.line > offered.line && entry.source === "session" && entry.kind === "deliveryChanged" && (entry.payload.delivery as SessionDelivery)?.state === "turn") ?? offered
      : checkpoints.find(entry => entry.source === "session" && entry.kind === "deliveryChanged" && (scene === "lease" ? !!(entry.payload.delivery as SessionDelivery)?.lease : (entry.payload.delivery as SessionDelivery)?.state === scene)) : undefined;
    const checkpoint = realCheckpoint ?? checkpoints.find(entry => entry.source === "snapshot" && entry.kind === "queueList" && (entry.payload.items as unknown[])?.length >= 2)
      ?? checkpoints.find(entry => entry.source === "session" && entry.kind === "stateChanged" && (entry.payload.record as InputRecord)?.reason === (scene === "held" ? "hostBusy" : scene === "bus" ? "passive" : "nativeConflict"));
    const projection = capturedPreview(trace, requestedLine ?? checkpoint?.line, sourceSessionId);
    const s = sessions.get(id)!;
    s.epoch = projection.epoch || EPOCH;
    s.revision = projection.revision;
    s.records = new Map(projection.records.map(record => [record.inputId, { ...record, cutexSessionId: id }]));
    s.items = projection.items;
    s.queueRevision = projection.queueRevision;
    s.delivery = projection.delivery ? structuredClone(projection.delivery) : { ...syntheticDelivery(), stateRevision: s.revision };
    const evidence = { ...projection, raw: undefined, remappedSessionId: id, deliverySource: projection.delivery ? "ACTUAL captured SessionDelivery via D1 replay" : "SYNTHETIC absent-delivery overlay", interactiveMutations: "SYNTHETIC", captureSet: isR4 ? R4_CAPTURE_SET : null, captureClass: isR4 ? "Public anonymized derivative of R4 backend E2E controlled-native capture" : trace.startsWith("r4-final-f7e1725a/") ? "Explicit historical immutable R4 f7e1725a archive; not current acceptance evidence" : trace.startsWith("r4-final-d8ca82a5/") ? "Explicit historical immutable R4 d8ca82a5 archive; not current acceptance evidence" : trace.startsWith("r4-final") ? "SUPERSEDED mixed R4 archive; not acceptance evidence" : "Explicit historical C2 archive; raw old policy preserved" };
    provenance.set(id, evidence);
    return evidence;
  }
  function replay(id: string, trace: string, line?: number, sourceSessionId?: string) {
    get(id);
    const provenance = loadCapture(id, trace, line, sourceSessionId);
    emit(id, "cutex/stream/reset", { cutexSessionId: id });
    return provenance;
  }
  function put(id: string, inputId: string, patch: Partial<InputRecord>, notify = true): InputRecord {
    const s = get(id), prev = s.records.get(inputId), at = iso();
    const record: InputRecord = { inputId, cutexSessionId: id, kind: "owner", sender: { kind: "owner", id: "owner", name: "Owner", host: null, cutexSessionId: null }, intent: { strategy: "auto", deliveryMode: null, timing: "afterTurn" }, preview: inputId, createdAt: at, state: "received", reason: null, since: at, deadline: null, stage: null, surface: "timeline", order: null, turnId: null, timelineItemId: null, runtimeGeneration: 1, attempt: 1, supersededBy: null, batchId: null, askId: null, remote: null, stalled: null, actions: [], error: null, evidence: null, details: { fixture: INPUT_LEDGER_FIXTURE_NOTICE }, ...prev, ...patch, rev: (prev?.rev ?? 0) + 1, stateRevision: ++s.revision, updatedAt: at };
    s.records.set(inputId, record);
    if (notify) emit(id, "cutex/input/stateChanged", { cutexSessionId: id, ledgerEpoch: s.epoch, stateRevision: s.revision, record: structuredClone(record) });
    return structuredClone(record);
  }
  function setDelivery(id: string, state: SessionDelivery["state"], patch: Partial<SessionDelivery> = {}) {
    const s = get(id);
    s.delivery = { ...baseDelivery(state, 0), ...patch, stateRevision: ++s.revision };
    const evidence = provenance.get(id) as Record<string, unknown> | undefined;
    if (evidence) provenance.set(id, { ...evidence, deliverySource: "SYNTHETIC explicit interactive delivery overlay", delivery: structuredClone(s.delivery) });
    emit(id, "cutex/session/deliveryChanged", { cutexSessionId: id, ledgerEpoch: s.epoch, stateRevision: s.revision, delivery: structuredClone(s.delivery) });
  }
  function snapshot(id: string) {
    const s = get(id);
    return structuredClone({ ledgerEpoch: s.epoch, stateRevision: s.revision, inputs: [...s.records.values()], delivery: s.delivery });
  }
  function cas(id: string, inputId: string, rev: number) {
    const r = get(id).records.get(inputId);
    if (!r) throw new Error("input_not_found");
    if (r.rev !== rev) throw new Error("input_revision_conflict");
    return r;
  }
  const api = {
    async inputInterruptSend(id: string, params: InputInterruptSendParams): Promise<InputInterruptSendResult> {
      const s = get(id), record = cas(id, params.inputId, params.expectedRev);
      if (!record.actions?.includes("interruptSend")) throw new Error("input_not_interruptible");
      if (s.delivery.turn?.turnId !== params.expectedTurnId || s.delivery.runtimeGeneration !== params.expectedRuntimeGeneration) throw new Error("revision_conflict");
      // Interactive mock authority only; real captured control results are replayed by line.
      const input = put(id, params.inputId, { state: "sending", reason: "interruptSend", surface: "timeline", actions: [], details: { ...record.details, simulation: "SYNTHETIC interactive interruptSend", interruptedTurnId: params.expectedTurnId } });
      return { ledgerEpoch: s.epoch, stateRevision: s.revision, outcome: "interrupted", interruptedTurnId: params.expectedTurnId, record: input };
    },
    async queueMerge(id: string, params: UserInputQueueMergeParams) {
      const s = get(id);
      if (params.items.length < 2 || params.items.length > 20 || new Set(params.items.map(item => item.queueId)).size !== params.items.length) throw new Error("queue_merge_failed:changed");
      const selected = params.items.map(request => s.items.find(item => item.queueId === request.queueId && item.revision === request.expectedRevision));
      if (selected.some(item => !item || item.state !== "queued" || s.records.get(item.clientUserMessageId)?.state !== "waiting" || !s.records.get(item.clientUserMessageId)?.actions?.includes("sendNow"))) throw new Error("queue_merge_failed:changed");
      const items = selected as QueueItem[];
      const carrier = items[0]!;
      const input = params.input ?? mergeQueueInputs(items.map(item => item.input));
      // Synthetic atomic authority: all CAS checks finish before changing any queue/ledger value.
      const item = { ...carrier, input, revision: ++s.queueRevision, updatedAt: iso() };
      const affectedQueueIds = items.map(item => item.queueId);
      s.items = s.items.flatMap(old => old.queueId === carrier.queueId ? [item] : affectedQueueIds.includes(old.queueId) ? [] : [old]);
      const inputs = items.map((old, index) => put(id, old.clientUserMessageId, index === 0
        ? { preview: input.filter(part => (part as { type?: string }).type === "text").map(part => (part as { text?: string }).text ?? "").join("\n").slice(0, 80) }
        : { state: "superseded", reason: "mergedInsert", surface: "none", supersededBy: carrier.clientUserMessageId, actions: [], order: null }));
      return structuredClone({ revision: s.queueRevision, affectedQueueIds, item, inputs });
    },
    async inputGet(id: string, ids: readonly string[]) {
      if (ids.length < 1 || ids.length > 100) throw new RangeError("input/get takes 1..100 ids");
      const s = get(id);
      return structuredClone({ ledgerEpoch: s.epoch, stateRevision: s.revision, records: ids.flatMap(key => s.records.has(key) ? [s.records.get(key)!] : []), missing: ids.filter(key => !s.records.has(key)) });
    },
    async inputList(id: string, query: InputListParams = {}): Promise<InputListResult> {
      const s = get(id), ahead = query.sinceRevision !== undefined && query.sinceRevision > s.revision;
      const records = [...s.records.values()].filter(r => query.sinceRevision === undefined || r.stateRevision > query.sinceRevision);
      return structuredClone({ ledgerEpoch: s.epoch, stateRevision: s.revision, records: ahead ? [] : records, complete: query.sinceRevision === undefined, ...(ahead ? { resyncRequired: true } : {}), delivery: s.delivery });
    },
    async inputDismiss(id: string, inputId: string, rev: number) {
      const r = cas(id, inputId, rev);
      if (!r.actions?.includes("dismiss")) throw new Error("input_dismiss_refused");
      const record = put(id, inputId, { state: "discarded", reason: "ownerDiscarded", surface: "none", deadline: null, actions: [], since: iso() });
      return { ledgerEpoch: get(id).epoch, stateRevision: get(id).revision, records: [record], failed: [] };
    },
    async inputRetry(id: string, inputId: string, rev: number) {
      const r = cas(id, inputId, rev);
      if (!r.actions?.includes("retry")) throw new Error("input_retry_refused");
      return put(id, inputId, { state: "waiting", reason: "ownerRetry", surface: r.kind === "owner" && r.state === "failed" && r.surface === "timeline" && r.turnId === null ? "timeline" : "nextUp", attempt: r.attempt + 1, stage: null, actions: ["dismiss"], since: iso() });
    },
    async inputLeaseRelease(id: string, lease: InputLease) {
      const s = get(id);
      if (JSON.stringify(s.delivery.lease) !== JSON.stringify(lease)) throw new Error("input_lease_conflict");
      if (lease.reconcile.state !== "stale") throw new Error("input_lease_not_stale");
      setDelivery(id, "idle");
      return { released: true };
    },
  };
  function queueSnapshot(id: string) { const s = get(id); return { revision: s.queueRevision, items: structuredClone(s.items), paused: false, pause: null, ...snapshot(id) }; }
  function promote(id: string, queueId: string, expectedRevision: number) {
    const s = get(id), item = s.items.find(item => item.queueId === queueId);
    if (!item || item.revision !== expectedRevision) throw new Error("queue item changed or already sent");
    s.items = s.items.filter(old => old.queueId !== queueId);
    const input = advance(id, item.clientUserMessageId, "accepted");
    return { result: { disposition: "steered" as const, turnId: s.delivery.turn?.turnId ?? null, input }, clientUserMessageId: item.clientUserMessageId, input: item.input };
  }
  function remove(id: string, queueId: string, expectedRevision?: number) {
    const s = get(id), item = s.items.find(item => item.queueId === queueId);
    if (!item || expectedRevision !== undefined && item.revision !== expectedRevision) throw new Error("queue item changed or already sent");
    s.items = s.items.filter(old => old.queueId !== queueId);
    put(id, item.clientUserMessageId, { state: "discarded", reason: "ownerDiscarded", surface: "none", actions: [] });
  }
  function submit(id: string, text: string, strategy: SubmitStrategy, inputId: string) {
    const s = get(id), previous = s.records.get(inputId);
    if (previous) return { disposition: "deduplicated" as const, turnId: previous.turnId, input: structuredClone(previous) };
    const offline = s.delivery.state === "offline" || s.delivery.state === "starting";
    const queued = strategy === "queue" || offline;
    const held = !queued && s.delivery.state === "held";
    const heldNextUp = held && (s.delivery.reason !== "hostBusy" || s.delivery.turn !== null);
    const input = put(id, inputId, { preview: text.slice(0, 80), intent: { strategy, deliveryMode: null, timing: "afterTurn" }, state: queued ? "waiting" : held ? "held" : "accepted", reason: offline ? "agentOffline" : queued ? "explicitQueue" : held ? "hostBusy" : null, surface: queued || heldNextUp ? "nextUp" : "timeline", order: queued ? { admissionKey: inputId, position: s.records.size } : null, deadline: queued || held ? null : new Date(clock() + 60000).toISOString(), actions: strategy === "queue" ? ["cancel", "sendNow", "edit"] : queued ? ["dismiss"] : [] });
    if (strategy === "queue") s.items.push({ queueId: `synthetic-${inputId}`, clientUserMessageId: inputId, origin: { kind: "other", clientId: "preview-simulation" }, input: [{ type: "text", text }], position: s.items.length, revision: 1, state: "queued", createdAt: iso(), updatedAt: iso() });
    if (offline) setDelivery(id, "starting");
    return { disposition: queued ? "queued" as const : held ? "held" as const : s.delivery.state === "turn" ? "steered" as const : "started" as const, turnId: s.delivery.turn?.turnId ?? null, input };
  }
  // Browser console / tests advance the mock authority explicitly, then observe the real renderer.
  function advance(id: string, inputId: string, state: "accepted" | "inContext" | "uncertain") {
    const r = get(id).records.get(inputId);
    if (!r) throw new Error("input_not_found");
    return put(id, inputId, { state, reason: state === "uncertain" ? "outcomeUnknown" : null, surface: state === "uncertain" ? r.surface : "timeline", order: state === "uncertain" ? r.order : null, since: iso(), deadline: state === "accepted" ? new Date(clock() + 60000).toISOString() : null, actions: state === "uncertain" ? ["retry", "dismiss"] : [], evidence: state === "inContext" ? "contextPersisted" : null, turnId: state === "inContext" ? get(id).delivery.turn?.turnId ?? r.turnId ?? "synthetic-preview-turn" : r.turnId });
  }
  return { notice: INPUT_LEDGER_FIXTURE_NOTICE, scene, api, snapshot, queueSnapshot, promote, remove, submit, advance, put, setDelivery, replay, provenance: (id: string) => { get(id); return structuredClone(provenance.get(id)); } };
}
