import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";
import type { InputRecord } from "@cutex-desktop/protocol";
import { capturedOperations, capturedSurfaceTrace, parseCapturedTrace, replayCapturedTrace, type CapturedOperation, type CapturedTraceEntry } from "./capturedTraces";
import { applyInputLedgerSnapshot, applyInputLedgerNotification, emptyInputLedgerSession } from "./alignment";
import { checkSurfaceTrace, surfaceMoveAllowed, surfaceSequences } from "./surfaceTrace";
import { nextUpRecords, pendingNoteRecords, timelineRecords } from "./selectors";

const root = new URL("../../dev/inputLedgerFixtures/r4-final-8be40c64/", import.meta.url);
const bytes = (file: string) => readFileSync(new URL(file, root));
const manifest = JSON.parse(bytes("sha256.json").toString()) as Record<string, string>;
const provenance = JSON.parse(bytes("provenance.json").toString());
const files = Object.keys(manifest);
const read = (file: string) => parseCapturedTrace(bytes(file).toString("utf8"));
const schema = JSON.parse(bytes("../schema/cutex-methods-v2.20757152.json").toString());
const ajv = new Ajv2020({ strict: false, allErrors: true });
ajv.addFormat("date-time", { type: "string", validate: (value: string) => Number.isFinite(Date.parse(value)) });
const validator = (name: string) => ajv.compile({ $defs: schema.$defs, $ref: `#/$defs/${name}` });
const validateRecord = validator("inputRecord"), validateDelivery = validator("sessionDelivery"), validateInterruptResult = validator("inputInterruptSendResult");
const validateStateEvent = validator("inputStateChanged"), validateDeliveryEvent = validator("sessionDeliveryChanged"), validateList = validator("inputListResult");
const operations = (file: string) => capturedOperations(read(file));
const eventOps = (file: string) => operations(file).filter((op): op is Extract<CapturedOperation, { type: "event" }> => op.type === "event");



describe("S18/S18b actual bound-turn reconciliation", () => {
  for (const scenario of ["s18", "s18b"]) it.each(["codex", "claude"])(`${scenario} %s preserves result identity and authoritative lease state`, runtime => {
    const entries = read(`${scenario}-${runtime}.jsonl`);
    const ops = capturedOperations(entries);
    const records = ops.flatMap(op => op.type === "event" && op.entry.source === "session" && op.method === "cutex/input/stateChanged" && (op.params.record as InputRecord).kind === "delegationResult" ? [op.params.record as unknown as InputRecord] : []);
    expect(records.map(record => record.state)).toEqual(["waiting", "sending", "accepted", "inContext"]);
    expect(records.map(record => record.surface)).toEqual(["nextUp", "nextUp", "timeline", "timeline"]);
    expect(new Set(records.map(record => record.inputId)).size).toBe(1);
    expect(new Set(records.map(record => record.askId)).size).toBe(1);
    const final = records.at(-1)!;
    expect(final.turnId).toEqual(expect.any(String));
    expect(records.find(record => record.state === "accepted")?.turnId).toBe(final.turnId);
    const deliveries = ops.filter((op): op is Extract<CapturedOperation, { type: "event" }> => op.type === "event" && op.entry.source === "session" && op.sessionId === final.cutexSessionId && op.method === "cutex/session/deliveryChanged");
    const replay = replayCapturedTrace(entries);
    expect(replay.unresolvedEpochReads).toEqual([]);
    const session = replay.sessions.get(final.cutexSessionId)!;
    expect(session.records.get(final.inputId)).toEqual(final);
    if (scenario === "s18") {
      // Actual capture first exposes stale unreadability, then releases the lease while
      // retaining the same active turn. Neither the stale read nor release proves idle.
      expect(deliveries.some(op => {
        const delivery = op.params.delivery as { lease?: { turnId: string; reconcile: { state: string; lastResult: string } } };
        return delivery.lease?.turnId === final.turnId && delivery.lease.reconcile.state === "stale" && delivery.lease.reconcile.lastResult === "turnUnreadable";
      })).toBe(true);
      expect(deliveries.at(-1)?.params.delivery).toMatchObject({ state: "turn", lease: null, turn: { turnId: final.turnId, inputIds: [final.inputId] } });
      expect(session.delivery).toEqual(deliveries.at(-1)!.params.delivery);
    } else {
      expect(deliveries.some(op => (op.params.delivery as { lease?: { reconcile: { lastResult: string } } }).lease?.reconcile.lastResult === "turnActive")).toBe(true);
      expect(deliveries.at(-1)?.params.delivery).toMatchObject({ state: "idle", lease: null });
      expect(session.delivery).toMatchObject({ state: "idle", lease: null });
      expect(entries.find(entry => entry.kind === "historyReads")?.payload.statusReads).toBe(1);
    }
  });
});

function recordsOf(op: CapturedOperation): readonly InputRecord[] {
  if (op.type === "event" && op.method === "cutex/input/stateChanged") return [op.params.record as unknown as InputRecord];
  if (op.type === "snapshot") return op.snapshot.records;
  if (op.type === "response") return op.records;
  return [];
}

describe("R4 current inventory, dynamic manifest and unchanged ledger schema", () => {
  it("has 58 approved immutable captures including S18/S18b and two meta", () => {
    expect(files).toHaveLength(58);
    const sourceManifest = bytes("MANIFEST.txt");
    const manifestHash = createHash("sha256").update(sourceManifest).digest("hex");
    const provenanceHash = provenance.projection === "public-anonymized-derived" ? provenance.publicManifestSha256 : provenance.sourceManifestSha256;
    expect(provenanceHash).toBe(manifestHash);
    expect(provenance.originalJsonlCount).toBe(58);
    if (provenance.projection === "public-anonymized-derived") expect(provenance.originalCaptures).toBe(false);
    const approvedEntries = Object.fromEntries(sourceManifest.toString().split(/\r?\n/).flatMap(line => {
      const match = /^([0-9a-f]{64}) \*(.+)$/.exec(line);
      return match ? [[match[2]!, match[1]!]] : [];
    }));
    expect(manifest).toEqual(approvedEntries);
    expect(readdirSync(root).filter(name => name.endsWith(".jsonl")).sort()).toEqual([...files].sort());
    for (const scenario of ["s18", "s18b"]) for (const runtime of ["codex", "claude"]) expect(files).toContain(`${scenario}-${runtime}.jsonl`);
    expect(files).toContain("s17-codex.jsonl");
    expect(files).toContain("s19-codex.jsonl");
    expect(files.filter(file => !["harness.jsonl", "switch-off.jsonl"].includes(file))).toHaveLength(56);
    expect(files).toEqual(expect.arrayContaining(["harness.jsonl", "switch-off.jsonl"]));
    for (const file of files) expect(createHash("sha256").update(bytes(file)).digest("hex"), file).toBe(manifest[file]);
  });

  for (const file of files) it(`${file}: parse and validate every actual ledger record/delivery/result (all passed-run capture variants)`, () => {
    const entries = read(file), ops = capturedOperations(entries);
    expect(ops).toHaveLength(entries.length);
    for (const op of ops) {
      for (const record of recordsOf(op)) expect(validateRecord(record), `${file}:${op.entry.line} ${record.inputId}: ${JSON.stringify(validateRecord.errors)}`).toBe(true);
      const delivery = op.type === "event" && op.method === "cutex/session/deliveryChanged" ? op.params.delivery : op.type === "snapshot" ? op.snapshot.delivery : undefined;
      if (delivery) expect(validateDelivery(delivery), `${file}:${op.entry.line}: ${JSON.stringify(validateDelivery.errors)}`).toBe(true);
      if (op.type === "event" && op.method === "cutex/input/stateChanged") expect(validateStateEvent(op.params), `${file}:${op.entry.line}: ${JSON.stringify(validateStateEvent.errors)}`).toBe(true);
      if (op.type === "event" && op.method === "cutex/session/deliveryChanged") expect(validateDeliveryEvent(op.params), `${file}:${op.entry.line}: ${JSON.stringify(validateDeliveryEvent.errors)}`).toBe(true);
      if (op.type === "snapshot" && op.entry.kind === "inputList") expect(validateList(op.entry.payload), `${file}:${op.entry.line}: ${JSON.stringify(validateList.errors)}`).toBe(true);
      if (op.entry.kind === "interruptSend") expect(validateInterruptResult(op.entry.payload), JSON.stringify(validateInterruptResult.errors)).toBe(true);
    }
  });
});

describe("R4 audit — backend stream invariants, not complete product acceptance", () => {
  for (const file of files) it(`${file}: audits raw canonical events without sorting or changing captured values`, () => {
    expect(checkSurfaceTrace(capturedSurfaceTrace(read(file), { snapshots: false })), file).toEqual([]);
  });
});

describe("R4 D1 replay of immutable passed-run captures (not real-provider acceptance)", () => {
  for (const file of files) it(`${file}: checks rendered surfaces; S21 explicitly exposes missing read-start metadata`, () => {
    const replay = replayCapturedTrace(read(file));
    const previous = new Map<string, InputRecord>();
    for (const frame of replay.frames) {
      const visible = [timelineRecords(frame.session), nextUpRecords(frame.session), pendingNoteRecords(frame.session)].flat();
      expect(new Set(visible.map(record => record.inputId)).size).toBe(visible.length);
      for (const record of frame.session.records.values()) {
        const key = `${frame.sessionId}/${frame.session.epoch}/${record.inputId}`;
        const before = previous.get(key);
        if (before) {
          expect(record.rev, `${file}:${frame.entry.line} ${key}`).toBeGreaterThanOrEqual(before.rev);
          expect(surfaceMoveAllowed(before.surface, record.surface, record), `${file}:${frame.entry.line} ${key}`).toBe(true);
        }
        previous.set(key, record);
      }
    }
    const snapshots = operations(file).filter((op): op is Extract<CapturedOperation, { type: "snapshot" }> => op.type === "snapshot" && op.snapshot.coverage.kind === "full");
    for (const snapshot of snapshots) {
      const last = snapshots.filter(op => op.sessionId === snapshot.sessionId).at(-1)!;
      if (snapshot !== last) continue;
      const session = replay.sessions.get(snapshot.sessionId);
      if (file.startsWith("s21-")) {
        // This is a documented replay limitation, NOT an epoch-convergence pass. Raw JSONL lacks
        // request-start generations; preserve all new-epoch reads and the pending D1 fetches.
        const firstEpoch = snapshots.find(op => op.sessionId === snapshot.sessionId)!.snapshot.ledgerEpoch;
        const unstampedNewEpochReads = operations(file).filter((op): op is Extract<CapturedOperation, { type: "snapshot" }> => op.type === "snapshot" && op.sessionId === snapshot.sessionId && op.snapshot.ledgerEpoch !== firstEpoch);
        expect(replay.unresolvedEpochReads.map(op => op.entry.line)).toEqual(unstampedNewEpochReads.map(op => op.entry.line));
        expect(replay.unresolvedEpochReads.length).toBeGreaterThan(0);
        expect(session?.epoch).not.toBe(snapshot.snapshot.ledgerEpoch);
        expect(session?.probe?.epochs.has(snapshot.snapshot.ledgerEpoch)).toBe(true);
        expect(replay.fetches.some(request => request.fetch.reason === "streamReset")).toBe(true);
        continue;
      }
      expect(replay.unresolvedEpochReads).toEqual([]);
      expect(session?.epoch, `${file}: last actual full-read epoch`).toBe(snapshot.snapshot.ledgerEpoch);
      for (const record of snapshot.snapshot.records) {
        const actual = session!.records.get(record.inputId);
        expect(actual?.rev, `${file}: ${record.inputId}`).toBeGreaterThanOrEqual(record.rev);
      }
    }
  });
});

describe("S21 source-control-flow metadata, explicitly separate from captured wire", () => {
  it.each(["codex", "claude"])("%s: trusted post-reset read generation converges with reset record rev1", runtime => {
    const entries = read(`s21-${runtime}.jsonl`);
    const reset = entries.find(entry => entry.kind === "streamReset")!;
    const fullAfterReset = entries.find(entry => entry.source === "snapshot" && entry.kind === "inputList" && entry.line > reset.line)!;
    expect(fullAfterReset.line).toBeGreaterThan(reset.line);
    const newEpoch = fullAfterReset.payload.ledgerEpoch;
    const newRecord = entries.find(entry => entry.kind === "stateChanged" && entry.payload.ledgerEpoch === newEpoch)!;
    expect(newRecord.line).toBeLessThan(reset.line);
    expect(newRecord.payload.record).toMatchObject({ rev: 1, stateRevision: 1, inputId: "s21-queued" });
    // Additional controlled source-flow metadata from backend E2E s21 (not on wire):
    // the read is INVOKED only after w.wait observed streamReset. The trace already contains
    // the new-epoch record before that reset; no third epoch intervenes. Inject that request
    // generation for THIS read only. Do not stamp every response with its arrival generation.
    const replay = replayCapturedTrace(entries, {
      snapshotGeneration: (op, session) => op.entry.line === fullAfterReset.line ? session.probe?.generation : undefined,
    });
    expect(replay.unresolvedEpochReads).toEqual([]);
    const sessionId = fullAfterReset.cutexSessionId!;
    expect(replay.sessions.get(sessionId)?.epoch).toBe(newEpoch);
    // A later Codex echo can bind the item after the last full snapshot. Compare with
    // the newest captured session record, retaining that later authoritative revision.
    const finalRecord = capturedOperations(entries).filter(op => op.type === "snapshot" && op.snapshot.ledgerEpoch === newEpoch
      || op.type === "event" && op.entry.source === "session" && op.params.ledgerEpoch === newEpoch)
      .flatMap(recordsOf).filter(record => record.cutexSessionId === sessionId && record.inputId === "s21-queued")
      .toSorted((a, b) => a.rev - b.rev).at(-1)!;
    expect(finalRecord.state).toBe("inContext");
    expect(replay.sessions.get(sessionId)?.records.get("s21-queued")).toEqual(finalRecord);
  });
});

describe("R4 S23 actual one-revision merge", () => {
  it.each(["codex", "claude"])("%s: all three returned records share a revision and superseded ids stay hidden", runtime => {
    const ops = operations(`s23-${runtime}.jsonl`);
    const merge = ops.find((op): op is Extract<CapturedOperation, { type: "response" }> => op.type === "response" && op.entry.kind === "queueMerge")!;
    expect(merge.records).toHaveLength(3);
    expect(new Set(merge.records.map(record => record.stateRevision)).size).toBe(1);
    expect(merge.records.slice(1).map(record => [record.state, record.surface, record.supersededBy])).toEqual([["superseded", "none", "s23-m0"], ["superseded", "none", "s23-m0"]]);
    const session = replayCapturedTrace(read(`s23-${runtime}.jsonl`)).sessions.get(merge.sessionId)!;
    expect(session.records.get("s23-m0")?.state).toBe("inContext");
    expect(timelineRecords(session).map(record => record.inputId)).not.toContain("s23-m1");
  });
});

describe("R4 S26 actual interruptSend record, response and delivery-first batch", () => {
  it.each(["codex", "claude"])("%s: direct result is authoritative, CAS diagnostic preserved, one stable ledger id", runtime => {
    const file = `s26-${runtime}.jsonl`, entries = read(file), ops = capturedOperations(entries);
    const result = ops.find((op): op is Extract<CapturedOperation, { type: "response" }> => op.type === "response" && op.entry.kind === "interruptSend")!;
    expect(result.ledgerEpoch).toBe(result.entry.payload.ledgerEpoch);
    expect(result.stateRevision).toBe(result.entry.payload.stateRevision);
    expect(result.outcome).toBe("interrupted");
    expect(result.records[0]).toBe(result.entry.payload.record);
    expect(result.records[0]).toMatchObject({ inputId: "s26-m1", state: "inContext", surface: "timeline" });
    expect(result.stateRevision).toBeGreaterThanOrEqual(result.records[0]!.stateRevision);
    const stale = ops.find(op => op.entry.kind === "interruptSendStale")!;
    expect(stale.type).toBe("ignored");
    expect(stale.entry.payload).toMatchObject({ status: 409, body: { error: { code: "revision_conflict", details: { currentRev: expect.any(Number), currentTurnId: expect.any(String), currentRuntimeGeneration: expect.any(Number) } } } });
    const events = ops.filter((op): op is Extract<CapturedOperation, { type: "event" }> => op.type === "event" && op.entry.source === "session");
    const sendingIndex = events.findIndex(op => (op.params.record as InputRecord | undefined)?.reason === "interruptSend");
    const sending = events[sendingIndex]!;
    const delivery = events.slice(0, sendingIndex).findLast(op => op.method === "cutex/session/deliveryChanged" && op.params.stateRevision === sending.params.stateRevision)!;
    expect(delivery.params.delivery).toMatchObject({ state: "finishing" });
    const sendingRecord = sending.params.record as unknown as InputRecord;
    expect(sendingRecord).toMatchObject({ state: "sending", reason: "interruptSend", stateRevision: sending.params.stateRevision });
    expect(result.records[0]!.rev).toBeGreaterThan(sendingRecord.rev);
    const resultOnly = replayCapturedTrace([result.entry]);
    expect(resultOnly.unresolvedResponses).toEqual([]);
    expect(resultOnly.sessions.get(result.sessionId)?.records.get("s26-m1")?.state).toBe("inContext");
    expect([...surfaceSequences(capturedSurfaceTrace(entries, { snapshots: false })).values()]).toEqual([["timeline"]]);
    // Native capture rows omit input bodies. We assert stable LEDGER identity only, not native
    // body exactly-once/provider behavior; that is an upstream controlled-fake E2E assertion.
  });

  it("outcome interrupted never manufactures success for failed/uncertain records (explicit response-only variations)", () => {
    const result = read("s26-codex.jsonl").find(entry => entry.kind === "interruptSend")!;
    for (const state of ["failed", "uncertain", "inContext"] as const) {
      const record = { ...(result.payload.record as InputRecord), state };
      const variation: CapturedTraceEntry = { ...result, payload: { ...result.payload, record } };
      const replay = replayCapturedTrace([variation]);
      expect(replay.sessions.get(record.cutexSessionId)?.records.get(record.inputId)?.state).toBe(state);
      expect(capturedOperations([variation])[0]).toMatchObject({ type: "response", outcome: "interrupted" });
    }
  });
});

describe("R4 trimmed host projections and same-batch action refresh", () => {
  it("actual host records omit optional fields; session projection hydrates the same record revision", () => {
    const entries = read("s26-codex.jsonl"), ops = capturedOperations(entries);
    const full = ops.find((op): op is Extract<CapturedOperation, { type: "event" }> => op.type === "event" && op.entry.source === "session" && (op.params.record as InputRecord | undefined)?.actions?.includes("interruptSend") === true)!;
    const record = full.params.record as unknown as InputRecord;
    const host = ops.find((op): op is Extract<CapturedOperation, { type: "event" }> => op.type === "event" && op.entry.source === "host" && (op.params.record as InputRecord | undefined)?.inputId === record.inputId && (op.params.record as InputRecord | undefined)?.rev === record.rev)!;
    expect(host.params.record).not.toHaveProperty("actions");
    expect(host.params.record).not.toHaveProperty("preview");
    for (const order of [[host, full], [full, host]]) {
      let session = applyInputLedgerSnapshot(emptyInputLedgerSession(), { ledgerEpoch: full.params.ledgerEpoch as string, stateRevision: 0, records: [], coverage: { kind: "full" } }).session;
      for (const op of order) session = applyInputLedgerNotification(session, op.method, op.params).session;
      expect(session.records.get(record.inputId)).toEqual(record);
    }
  });

  it("a real delivery change refreshes actions with a newer record rev at that same session revision", () => {
    let pair: { before: InputRecord; after: InputRecord; event: Extract<CapturedOperation, { type: "event" }> } | undefined;
    const ops = eventOps("s19-codex.jsonl").filter(op => op.entry.source === "session");
    const prior = new Map<string, InputRecord>();
    for (const op of ops) {
      if (op.method !== "cutex/input/stateChanged") continue;
      const after = op.params.record as unknown as InputRecord, before = prior.get(after.inputId);
      if (before && after.state === before.state && after.surface === before.surface && JSON.stringify(before.actions) !== JSON.stringify(after.actions)) pair = { before, after, event: op };
      prior.set(after.inputId, after);
    }
    expect(pair).toBeDefined();
    expect(pair!.after.rev).toBe(pair!.before.rev + 1);
    const delivery = ops.find(op => op.method === "cutex/session/deliveryChanged" && op.params.stateRevision === pair!.after.stateRevision)!;
    expect(delivery.entry.line).toBeLessThan(pair!.event.entry.line);
    let session = applyInputLedgerSnapshot(emptyInputLedgerSession(), { ledgerEpoch: pair!.event.params.ledgerEpoch as string, stateRevision: pair!.before.stateRevision, records: [pair!.before], coverage: { kind: "full" } }).session;
    session = applyInputLedgerNotification(session, delivery.method, delivery.params).session;
    session = applyInputLedgerNotification(session, pair!.event.method, pair!.event.params).session;
    expect(session.records.get(pair!.after.inputId)?.actions).toEqual(pair!.after.actions);
    const stale = applyInputLedgerSnapshot(session, { ledgerEpoch: session.epoch!, stateRevision: pair!.before.stateRevision, records: [pair!.before], coverage: { kind: "partial" } }).session;
    expect(stale.records.get(pair!.after.inputId)?.actions).toEqual(pair!.after.actions);
  });
});

describe("S19 Codex actual captured variant scope", () => {
  it("preserves explicit owner-online recovery and does not call it an automatic reconnect acceptance", () => {
    const entries = read("s19-codex.jsonl");
    expect(entries.filter(entry => entry.kind === "ownerOnline")).toHaveLength(1);
    expect(files).toContain("s19-codex.jsonl");
    const states = eventOps("s19-codex.jsonl").filter(op => op.entry.source === "session" && op.method === "cutex/session/deliveryChanged").map(op => (op.params.delivery as { state: string }).state);
    expect(states).toContain("disconnected");
    expect(states).toContain("starting");
    expect(states.at(-1)).toBe("idle");
  });
});

describe("Current immutable S17/S19 recovery captures", () => {
  it.each(["codex", "claude"])("S17 %s: recovers after disconnect without an ownerOnline marker and settles queued owner inputs", runtime => {
    const file = `s17-${runtime}.jsonl`, entries = read(file), replay = replayCapturedTrace(entries);
    expect(entries.some(entry => entry.kind === "ownerOnline")).toBe(false);
    const deliveries = eventOps(file).filter(op => op.entry.source === "session" && op.method === "cutex/session/deliveryChanged");
    const disconnect = deliveries.findIndex(op => (op.params.delivery as { state: string }).state === "disconnected");
    expect(disconnect).toBeGreaterThanOrEqual(0);
    expect(deliveries.slice(disconnect + 1).some(op => (op.params.delivery as { state: string }).state === "turn")).toBe(true);
    const submit = entries.find(entry => entry.kind === "ownerSubmit" && entry.payload.clientUserMessageId === "s17-q0")!;
    const session = replay.sessions.get(submit.payload.sid as string)!;
    for (const id of ["s17-q0", "s17-q1", "s17-q2"]) expect(session.records.get(id)?.state).toBe("inContext");
    expect(session.delivery?.lease).toBeNull();
    const reads = entries.find(entry => entry.kind === "historyReads")!;
    expect(reads.payload.full).toBe(0); // Captured instrumented metric, not inferred from abbreviated native events.
  });

  it.each(["codex", "claude"])("S19 %s: preserves the exact recovery variant and final input state", runtime => {
    const file = `s19-${runtime}.jsonl`, entries = read(file), replay = replayCapturedTrace(entries);
    // The default suite runs both automatic and owner-online Codex variants with one capture filename.
    // This immutable file contains the owner-online variant; the manifest's overall suite pass is
    // separate evidence for the automatic test. Claude's capture contains no explicit ownerOnline.
    expect(entries.filter(entry => entry.kind === "ownerOnline")).toHaveLength(runtime === "codex" ? 1 : 0);
    const record = [...replay.sessions.values()].flatMap(session => [...session.records.values()]).find(record => record.inputId === "s19-m1")!;
    expect(record.state).toBe("inContext");
    expect(record.stalled).toBeNull();
  });
});

describe("Current immutable ledger-off compatibility captures", () => {
  it.each(["off-s10j-claude.jsonl", "off-s24-claude.jsonl", "off-s24-sender-claude.jsonl"])("%s: disabled ledger stays disabled while preserving legacy/native evidence", file => {
    const entries = read(file), ops = capturedOperations(entries);
    expect(ops.filter(op => op.type !== "ignored")).toEqual([]);
    expect(replayCapturedTrace(entries).sessions.size).toBe(0);
    expect(entries.find(entry => entry.kind === "note")?.payload).toMatchObject({ inputListError: { status: 403, body: { error: { code: "cutex_method_denied" } } } });
    expect(entries.some(entry => entry.kind === "legacy")).toBe(true);
    if (file === "off-s10j-claude.jsonl") {
      expect(entries.find(entry => entry.kind === "jobNotice")?.payload).toMatchObject({ status: 200, receipt: { status: "committed", schema: "cutex.job_service.completion.v1" } });
      expect(entries.some(entry => entry.kind === "native")).toBe(true);
    }
    if (file === "off-s24-sender-claude.jsonl") {
      const calls = entries.filter(entry => entry.kind === "mcpCall");
      expect(calls.some(entry => (entry.payload.arguments as { wake?: boolean }).wake === true && (entry.payload.result as { ok?: boolean }).ok)).toBe(true);
      expect(calls.some(entry => (entry.payload.arguments as { wake?: boolean }).wake === false && (entry.payload.result as { ok?: boolean }).ok)).toBe(true);
    }
    // Ledger-off/native activity is visible, but native rows do not contain full request bodies;
    // these assertions do not claim provider context/body delivery from abridged wire rows.
  });
});

describe("Current captured timeline bindings through D1 (controlled-fake evidence only)", () => {
  it("contains actual non-null bindings in 42 of the 58 manifest-listed files", () => {
    expect(files.filter(file => operations(file).some(op => recordsOf(op).some(record => record.timelineItemId !== null)))).toHaveLength(42);
  });

  for (const file of files) it(`${file}: replay preserves authoritative binding, identity and surface at each applied revision`, () => {
    const replay = replayCapturedTrace(read(file));
    for (const frame of replay.frames) {
      const op = frame.operation;
      const epoch = op.type === "snapshot" ? op.snapshot.ledgerEpoch : op.type === "event" ? op.params.ledgerEpoch : op.type === "response" ? op.ledgerEpoch : undefined;
      // S21's unstamped new-epoch reads remain unresolved; do not give them invented authority.
      if (epoch !== undefined && epoch !== frame.session.epoch) continue;
      for (const record of recordsOf(op)) {
        const actual = frame.session.records.get(record.inputId);
        expect(actual, `${file}:${frame.entry.line} ${record.inputId}`).toBeDefined();
        expect(actual!.rev).toBeGreaterThanOrEqual(record.rev);
        if (actual!.rev !== record.rev) continue; // Racing old reads cannot replace newer records.
        expect(actual, `${file}:${frame.entry.line}`).toMatchObject({
          inputId: record.inputId, kind: record.kind, askId: record.askId,
          timelineItemId: record.timelineItemId, turnId: record.turnId, surface: record.surface,
        });
        if (!record.timelineItemId) continue;
        expect(record.surface).toBe("timeline");
        expect(timelineRecords(frame.session)).toContain(actual);
        expect(nextUpRecords(frame.session)).not.toContain(actual);
        expect(pendingNoteRecords(frame.session)).not.toContain(actual);
        if (record.kind === "delegationRequest") {
          expect(record.timelineItemId).toMatch(/^cutex-ask-msg-/);
          expect(record.timelineItemId).not.toBe(record.askId);
          expect(record.inputId).toBe(record.askId);
        } else if (record.kind === "delegationResult") {
          // The actual batch covers event bindings. soon/owner are valid backend shapes,
          // but this regex does not claim that those two paths were captured here.
          expect(record.timelineItemId).toMatch(/^cutex-ask-(event|soon|owner)-/);
          expect(record.timelineItemId).not.toBe(record.askId);
          expect(record.timelineItemId).not.toBe(record.inputId);
        } else if (["agentMessage", "peerMessage", "alarm", "systemNotice"].includes(record.kind)) {
          expect(record.timelineItemId).toBe(record.inputId); // The recorded receipt identity.
        }
      }
    }
  });

  it.each(["codex", "claude"])("%s: batched results share a native binding while retaining separate ledger/ask identities", runtime => {
    const entries = read(`s15-${runtime}.jsonl`);
    const captured = capturedOperations(entries).flatMap(recordsOf).filter(record => record.kind === "delegationResult" && record.timelineItemId !== null);
    expect(captured.length).toBeGreaterThan(0);
    expect(captured.every(record => record.timelineItemId!.startsWith("cutex-ask-event-"))).toBe(true);
    const final = captured.at(-1)!;
    const session = replayCapturedTrace(entries).sessions.get(final.cutexSessionId)!;
    const joined = timelineRecords(session).filter(record => record.timelineItemId === final.timelineItemId);
    expect(joined).toHaveLength(2);
    expect(new Set(joined.map(record => record.inputId)).size).toBe(2);
    expect(new Set(joined.map(record => record.askId)).size).toBe(2);
    expect(joined.every(record => record.kind === "delegationResult" && record.state === "inContext")).toBe(true);
  });

  it.each(["codex", "claude"])("%s: owner turn-start evidence allows null binding until a captured echo supplies one", runtime => {
    const entries = read(`s01-${runtime}.jsonl`);
    const records = capturedOperations(entries).flatMap(recordsOf).filter(record => record.kind === "owner" && record.inputId === "s01-m1");
    const started = records.find(record => record.state === "inContext" && record.timelineItemId === null)!;
    expect(started).toBeDefined();
    expect(started.evidence).toBe("turnStartInput");
    const session = replayCapturedTrace(entries).sessions.get(started.cutexSessionId)!;
    const final = session.records.get(started.inputId)!;
    expect(final.state).toBe("inContext");
    expect(final.surface).toBe("timeline");
    if (runtime === "codex") {
      const echoed = records.find(record => record.timelineItemId !== null)!;
      expect(echoed).toBeDefined();
      expect(echoed.rev).toBeGreaterThan(started.rev);
      expect(final.timelineItemId).toBe(echoed.timelineItemId);
    } else {
      expect(final.timelineItemId).toBeNull();
    }
    // Native rows may omit item ids and bodies. These checks preserve ledger evidence;
    // they do not infer full native-body delivery or independent real-provider behavior.
  });
});
