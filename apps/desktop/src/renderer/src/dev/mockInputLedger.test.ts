import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import type { InputRecord } from "@cutex-desktop/protocol";
import immutableManifest from "./inputLedgerFixtures/r4-final-8be40c64/MANIFEST.txt?raw";
import { CAPTURED_LEDGER_TRACES, DEFAULT_LEDGER_TRACES, R4_CAPTURE_SET, INPUT_LEDGER_FIXTURE_NOTICE, LEDGER_CAPTURE_DIAGNOSTICS, capturedPreview, createMockInputLedger, inputLedgerMockEnabled, LEDGER_SCENES } from "./mockInputLedger";
import { mockScenarioFeatures } from "./mockFeatures";
import { capturedOperations, parseCapturedTrace, replayCapturedTrace } from "../lib/inputLedger/capturedTraces";
import { emptyInputLedgerSession } from "../lib/inputLedger/alignment";
const T0 = Date.parse("2026-11-02T12:00:00Z");

const currentBoundTraces = CAPTURED_LEDGER_TRACES.filter(trace => trace.startsWith(`${R4_CAPTURE_SET.directory}/`))
  .map(trace => ({ trace, bound: parseCapturedTrace(capturedPreview(trace).raw).filter(entry => entry.source === "session"
    && entry.kind === "stateChanged" && !!(entry.payload.record as InputRecord)?.timelineItemId) }))
  .filter(({ bound }) => bound.length > 0);

// Select the actual current queue snapshot, independent of historical archive availability.
function currentMergeFixture(clock = Date.now) {
  const trace = `${R4_CAPTURE_SET.directory}/s22-codex.jsonl`;
  const checkpoint = parseCapturedTrace(capturedPreview(trace).raw).find(entry => entry.source === "snapshot" && entry.kind === "queueList" && (entry.payload.items as unknown[])?.length >= 3);
  if (!checkpoint) throw new Error("missing current merge queue snapshot");
  return createMockInputLedger("turn", undefined, clock, { trace, line: checkpoint.line });
}

describe("Current R4 preview; explicit synthetic interactive mutations/absent-delivery overlay", () => {
  it("binds immutable-set provenance to the approved manifest bytes and exact 58-file inventory", () => {
    expect(createHash("sha256").update(immutableManifest).digest("hex")).toBe(R4_CAPTURE_SET.manifestSha256);
    expect(CAPTURED_LEDGER_TRACES.filter(trace => trace.startsWith(`${R4_CAPTURE_SET.directory}/`))).toHaveLength(58);
  });
  it.each(["switch-off", "off-s10j-claude", "off-s24-claude", "off-s24-sender-claude"])("%s preserves raw switch-off history with no fabricated ledger or delivery", name => {
    const trace = `${R4_CAPTURE_SET.directory}/${name}.jsonl`, raw = capturedPreview(trace).raw, entries = parseCapturedTrace(raw);
    for (const entry of entries) {
      const selected = entries.filter(candidate => candidate.line <= entry.line), replay = replayCapturedTrace(selected), preview = capturedPreview(trace, entry.line);
      expect(replay.sessions.size).toBe(0);
      expect(preview.records).toEqual([]); expect(preview.delivery).toBeNull();
      expect(preview.epoch).toBe(""); expect(preview.revision).toBe(0); expect(preview.raw).toBe(raw);
    }
  });
  it("defaults exclusively to immutable R4 green aliases; S17/S18/S18b/S19 are passed with no stale absent classification", () => {
    expect(Object.values(DEFAULT_LEDGER_TRACES).every(trace => trace.startsWith(`${R4_CAPTURE_SET.directory}/`) && CAPTURED_LEDGER_TRACES.includes(trace))).toBe(true);
    expect(LEDGER_CAPTURE_DIAGNOSTICS.ignoredAbsent).toEqual([]);
    expect(CAPTURED_LEDGER_TRACES).toEqual(expect.arrayContaining([`${R4_CAPTURE_SET.directory}/s17-codex.jsonl`, `${R4_CAPTURE_SET.directory}/s19-codex.jsonl`, ...["s18", "s18b"].flatMap(name => ["codex", "claude"].map(runtime => `${R4_CAPTURE_SET.directory}/${name}-${runtime}.jsonl`))]));
    const captureClass = INPUT_LEDGER_FIXTURE_NOTICE.startsWith("Public anonymized derivative")
      ? "Public anonymized derivative of R4 backend E2E controlled-native capture"
      : "Immutable passed R4 backend E2E controlled-native capture";
    expect(createMockInputLedger("turn", undefined, Date.now, { trace: `${R4_CAPTURE_SET.directory}/s19-codex.jsonl` }).provenance("eva")).toMatchObject({ captureClass, captureSet: R4_CAPTURE_SET });
    const m = createMockInputLedger(), provenance = m.provenance("eva") as { trace: string; deliverySource: string };
    expect(provenance.trace).toBe(`${R4_CAPTURE_SET.directory}/s26-codex.jsonl`);
    expect(provenance.deliverySource).toContain("ACTUAL");
    const bound = parseCapturedTrace(capturedPreview(provenance.trace).raw).find(entry => entry.source === "session"
      && entry.kind === "stateChanged" && (entry.payload.record as InputRecord)?.inputId === "s26-m1" && !!(entry.payload.record as InputRecord).timelineItemId)!;
    expect(m.snapshot("eva").inputs).toContainEqual({ ...(bound.payload.record as InputRecord), cutexSessionId: "eva" });
    expect(m.snapshot("eva").inputs).toContainEqual(expect.objectContaining({ inputId: "s26-m1", state: "inContext", timelineItemId: expect.any(String), actions: [] }));
    expect(m.snapshot("eva").delivery.state).toBe("turn");
  });
  it("has actual binding metadata in exactly 42 current capture files", () => {
    expect(currentBoundTraces).toHaveLength(42);
  });
  it.each(currentBoundTraces)("$trace preserves actual bound records through D1 and preview session remapping", ({ trace, bound }) => {
    for (const entry of bound) {
      const original = entry.payload.record as InputRecord;
      const preview = capturedPreview(trace, entry.line, original.cutexSessionId);
      const entries = parseCapturedTrace(preview.raw);
      const first = capturedOperations(entries).find(op => op.type === "event" && op.sessionId === original.cutexSessionId && typeof op.params.ledgerEpoch === "string")!;
      if (first.type !== "event") throw Error("expected captured epoch");
      const expected = replayCapturedTrace(entries.filter(candidate => candidate.line <= entry.line), {
        initialSessions: new Map([[first.sessionId, { ...emptyInputLedgerSession(), epoch: first.params.ledgerEpoch as string }]]),
      }).sessions.get(first.sessionId)!;
      expect(preview.records).toEqual([...expected.records.values()]);
      const projected = preview.records.find(record => record.inputId === original.inputId)!;
      if (preview.epoch === entry.payload.ledgerEpoch) expect(projected).toEqual(original);
      else {
        // S21 lacks request-start generation evidence: D1 rejects the cross-epoch
        // update. Preserve that limitation rather than inventing a fresh snapshot.
        expect(trace).toBe(`${R4_CAPTURE_SET.directory}/s21-codex.jsonl`);
        expect(projected).toMatchObject({ state: "waiting", timelineItemId: null });
        expect(preview.fetches.length).toBeGreaterThan(0);
      }
      const mock = createMockInputLedger("turn", undefined, () => T0, { trace, line: entry.line, sourceSessionId: original.cutexSessionId });
      expect(mock.snapshot("preview").inputs.find(record => record.inputId === original.inputId)).toEqual({ ...projected, cutexSessionId: "preview" });
      expect(mock.snapshot("preview").delivery).toEqual(preview.delivery);
    }
  });
  it.each(["s26-codex", "s26-claude", "s13-codex", "s07-codex", "s12-codex", "s16-codex", "s23-codex", "s17-codex", "s19-codex", "s21-codex", "s21-claude", "s18-codex", "s18-claude", "s18b-codex", "s18b-claude"])("R4 %s checkpoints preserve D1 epoch/revision/actions/surfaces AND actual delivery", name => {
    const trace = `${R4_CAPTURE_SET.directory}/${name}.jsonl`, entries = parseCapturedTrace(capturedPreview(trace).raw);
    const target = (entries.find(entry => entry.kind === "stateChanged")!.payload.record as { cutexSessionId: string }).cutexSessionId;
    const first = capturedOperations(entries).find(op => op.type === "event" && op.sessionId === target && typeof op.params.ledgerEpoch === "string")!;
    if (first.type !== "event") throw Error("expected captured epoch");
    const initialSessions = new Map([[first.sessionId, { ...emptyInputLedgerSession(), epoch: first.params.ledgerEpoch as string }]]);
    for (const entry of entries.filter(entry => entry.line >= first.entry.line && (entry.source === "session" && ["stateChanged", "deliveryChanged"].includes(entry.kind) || entry.source === "snapshot" || entry.kind === "interruptSend"))) {
      const selected = entries.filter(candidate => candidate.line <= entry.line);
      const expected = replayCapturedTrace(selected, { initialSessions }).sessions.get(first.sessionId)!;
      const preview = capturedPreview(trace, entry.line);
      expect(preview.records).toEqual([...expected.records.values()]);
      expect(preview.delivery).toEqual(expected.delivery);
      expect(preview.epoch).toBe(expected.epoch); expect(preview.revision).toBe(expected.rev);
      const m = createMockInputLedger("turn", undefined, () => T0, { trace, line: entry.line });
      expect(m.snapshot("eva").inputs).toEqual(preview.records.map(record => ({ ...record, cutexSessionId: "eva" })));
      if (expected.delivery) expect(m.snapshot("eva").delivery).toEqual(expected.delivery);
    }
  });


  it.each(["s18-codex", "s18-claude", "s18b-codex", "s18b-claude"])("%s explicitly selects parent/result-recipient checkpoints with actual D1 delivery", name => {
    const trace = `${R4_CAPTURE_SET.directory}/${name}.jsonl`, entries = parseCapturedTrace(capturedPreview(trace).raw);
    const result = entries.find(entry => entry.kind === "stateChanged" && (entry.payload.record as { kind: string }).kind === "delegationResult")!;
    const parent = (result.payload.record as { cutexSessionId: string }).cutexSessionId;
    expect(capturedPreview(trace).sourceSessionId).not.toBe(parent);
    const first = capturedOperations(entries).find(op => op.type === "event" && op.sessionId === parent && typeof op.params.ledgerEpoch === "string")!;
    if (first.type !== "event") throw Error("expected parent captured epoch");
    const initialSessions = new Map([[parent, { ...emptyInputLedgerSession(), epoch: first.params.ledgerEpoch as string }]]);
    const checkpoints = entries.filter(entry => entry.line >= first.entry.line && entry.source === "session" && entry.cutexSessionId === parent && ["stateChanged", "deliveryChanged"].includes(entry.kind));
    for (const entry of checkpoints) {
      const expected = replayCapturedTrace(entries.filter(candidate => candidate.line <= entry.line), { initialSessions }).sessions.get(parent)!;
      const projected = capturedPreview(trace, entry.line, parent);
      expect(projected.sourceSessionId).toBe(parent);
      expect(projected.records).toEqual([...expected.records.values()]); expect(projected.delivery).toEqual(expected.delivery);
      expect(projected.epoch).toBe(expected.epoch); expect(projected.revision).toBe(expected.rev);
      const m = createMockInputLedger("turn", undefined, () => T0, { trace, line: entry.line, sourceSessionId: parent });
      expect(m.snapshot("eva").delivery).toEqual(expected.delivery);
      expect(m.snapshot("eva").inputs).toEqual(projected.records.map(record => ({ ...record, cutexSessionId: "eva" })));
      expect(m.replay("eva", trace, entry.line, parent)).toMatchObject({ sourceSessionId: parent, deliverySource: expect.stringContaining("ACTUAL") });
    }
    const deliveries = checkpoints.filter(entry => entry.kind === "deliveryChanged");
    expect(deliveries.some(entry => !!(entry.payload.delivery as { lease: unknown }).lease)).toBe(true);
    if (name.startsWith("s18b")) {
      const active = deliveries.find(entry => (entry.payload.delivery as { lease?: { reconcile?: { lastResult: string } } }).lease?.reconcile?.lastResult === "turnActive")!;
      const cleared = deliveries.find(entry => entry.line > active.line && !(entry.payload.delivery as { lease: unknown }).lease)!;
      expect(capturedPreview(trace, active.line, parent).delivery?.lease).not.toBeNull();
      expect(capturedPreview(trace, cleared.line, parent).delivery).toMatchObject({ state: "idle", lease: null });
    } else {
      const stale = deliveries.find(entry => (entry.payload.delivery as { lease?: { reconcile?: { state: string } } }).lease?.reconcile?.state === "stale")!;
      const released = deliveries.find(entry => entry.line > stale.line && !(entry.payload.delivery as { lease: unknown }).lease)!;
      expect(capturedPreview(trace, stale.line, parent).delivery?.lease?.reconcile).toMatchObject({ state: "stale", lastResult: "turnUnreadable" });
      expect(capturedPreview(trace, released.line, parent).delivery).toMatchObject({ state: "turn", lease: null });
    }
  });
  it("rejects unknown source-session selection without fabricating or changing preview state", () => {
    const trace = `${R4_CAPTURE_SET.directory}/s18b-codex.jsonl`, m = createMockInputLedger();
    const before = m.snapshot("eva"), provenance = m.provenance("eva");
    expect(() => capturedPreview(trace, undefined, "not-a-captured-session")).toThrow("unknown captured ledger session");
    expect(() => m.replay("eva", trace, undefined, "not-a-captured-session")).toThrow("unknown captured ledger session");
    expect(m.snapshot("eva")).toEqual(before); expect(m.provenance("eva")).toEqual(provenance);
    const invalid = createMockInputLedger("turn", undefined, Date.now, { trace, sourceSessionId: "not-a-captured-session" });
    expect(() => invalid.snapshot("eva")).toThrow("unknown captured ledger session");
    expect(() => invalid.snapshot("eva")).toThrow("unknown captured ledger session");
  });
  it.each(["codex", "claude"])("S26 %s direct result replays same inputId after the actual control, with captured delivery", runtime => {
    const trace = `${R4_CAPTURE_SET.directory}/s26-${runtime}.jsonl`, entries = parseCapturedTrace(capturedPreview(trace).raw);
    const offered = entries.find(entry => entry.source === "session" && entry.kind === "stateChanged" && (entry.payload.record as { actions: string[] }).actions.includes("interruptSend"))!;
    const marker = entries.find(entry => entry.kind === "interruptSend")!;
    const before = capturedPreview(trace, offered.line), after = capturedPreview(trace, marker.line);
    const initial = before.records.find(record => record.inputId === "s26-m1")!, final = after.records.find(record => record.inputId === initial.inputId)!;
    expect(initial).toMatchObject({ state: "accepted", actions: ["interruptSend"] });
    expect(final).toMatchObject({ state: "inContext", surface: "timeline", actions: [] });
    expect(final.turnId).not.toBe(initial.turnId);
    expect(after.records.filter(record => record.kind === "owner").map(record => record.inputId)).toEqual([initial.inputId]);
    expect(after.delivery).toBeTruthy();
    expect(after.raw).toBe(before.raw);
  });
  it("keeps simulated interrupt responses separate from real replay, checking delivery CAS and preserving identity", async () => {
    const trace = DEFAULT_LEDGER_TRACES.turn;
    const entries = parseCapturedTrace(capturedPreview(trace).raw);
    const offered = entries.find(entry => entry.source === "session" && entry.kind === "stateChanged" && (entry.payload.record as InputRecord)?.actions?.includes("interruptSend"))!;
    const checkpoint = entries.find(entry => entry.line > offered.line && entry.source === "session" && entry.kind === "deliveryChanged" && (entry.payload.delivery as { state: string }).state === "turn")!;
    const m = createMockInputLedger("turn", undefined, () => T0, { trace, line: checkpoint.line }), before = m.snapshot("eva"), original = before.inputs.find(record => record.actions?.includes("interruptSend"))!;
    const params = { inputId: original.inputId, expectedRev: original.rev, expectedTurnId: before.delivery.turn!.turnId, expectedRuntimeGeneration: before.delivery.runtimeGeneration! };
    await expect(m.api.inputInterruptSend("eva", { ...params, expectedRuntimeGeneration: -1 })).rejects.toThrow("revision_conflict");
    expect(m.snapshot("eva")).toEqual(before);
    const response = await m.api.inputInterruptSend("eva", params);
    expect(response.record).toMatchObject({ inputId: original.inputId, state: "sending", reason: "interruptSend", details: { simulation: "SYNTHETIC interactive interruptSend" } });
    expect(m.snapshot("eva").delivery).toEqual(before.delivery);
  });
  it("is opt-in and legacy wins", () => {
    for (const q of ["", "?legacy", "?legacy&inputLedger"]) {
      expect(inputLedgerMockEnabled(q)).toBe(false);
      expect(mockScenarioFeatures(q)).not.toContain("input-ledger-v1");
    }
    expect(mockScenarioFeatures("?inputLedger")).toContain("input-ledger-v1");
  });
  it.each(LEDGER_SCENES)("%s remaps only session id and isolates cloned read results", async scene => {
    const m = createMockInputLedger(scene, undefined, () => T0);
    const provenance = m.provenance("eva") as { trace: string; line: number; deliverySource: string };
    const captured = capturedPreview(provenance.trace, provenance.line);
    expect(provenance.deliverySource).toContain("ACTUAL");
    expect(m.snapshot("eva").delivery).toEqual(captured.delivery);
    expect(m.snapshot("eva").inputs).toEqual(captured.records.map(record => ({ ...record, cutexSessionId: "eva" })));
    const snap = m.snapshot("eva"), list = await m.api.inputList("eva");
    expect(list.records).toEqual(snap.inputs);
    snap.inputs.forEach(record => record.state = "discarded");
    snap.delivery.state = "disconnected";
    expect(await m.api.inputList("eva")).toEqual(list);
    expect(m.snapshot("other").inputs.every(record => record.cutexSessionId === "other")).toBe(true);
  });



  it("projects actual passive pendingNotes and nativeConflict uncertainty", () => {
    expect(createMockInputLedger("bus").snapshot("eva").inputs).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "agentMessage", state: "waiting", reason: "passive", surface: "pendingNotes" })]));
    expect(createMockInputLedger("uncertain").snapshot("eva").inputs).toEqual(expect.arrayContaining([expect.objectContaining({ state: "uncertain", reason: "nativeConflict", surface: "nextUp" })]));
  });


  it("synthetic dismiss returns authoritative batch shape; stale CAS changes nothing", async () => {
    const m = createMockInputLedger("uncertain", undefined, () => T0);
    const record = m.snapshot("eva").inputs.find(record => record.state === "uncertain")!;
    await expect(m.api.inputDismiss("eva", record.inputId, record.rev + 1)).rejects.toThrow("conflict");
    const result = await m.api.inputDismiss("eva", record.inputId, record.rev);
    expect(result).toMatchObject({ ledgerEpoch: m.snapshot("eva").ledgerEpoch, failed: [], records: [expect.objectContaining({ inputId: record.inputId, state: "discarded", surface: "none", rev: record.rev + 1 })] });
  });
  it.each(["offline", "starting"] as const)("synthetic %s owner auto-start remains nextUp until explicit record moves it", scene => {
    const m = createMockInputLedger(scene, undefined, () => T0);
    expect(m.submit("eva", "offline", "auto", "o0").input).toMatchObject({ state: "waiting", reason: "agentOffline", surface: "nextUp" });
    expect(m.snapshot("eva").delivery.state).toBe("starting");
    m.setDelivery("eva", "idle");
    expect(m.snapshot("eva").inputs.find(record => record.inputId === "o0")?.surface).toBe("nextUp");
    expect(m.advance("eva", "o0", "inContext").surface).toBe("timeline");
  });

  it("labels current captured delivery and explicit interactive overlays without historical files", () => {
    const real = createMockInputLedger();
    expect(real.provenance("eva")).toMatchObject({ deliverySource: expect.stringContaining("ACTUAL") });
    real.setDelivery("eva", "offline");
    expect(real.provenance("eva")).toMatchObject({ deliverySource: "SYNTHETIC explicit interactive delivery overlay", delivery: { state: "offline" } });
  });

  it("atomically merges actual queued items, preserves carrier ID, supersedes tails and promotes correct revision", async () => {
    const m = currentMergeFixture(() => T0);
    const before = m.queueSnapshot("eva"), selected = before.items.slice(0, 3);
    expect(selected).toHaveLength(3);
    const result = await m.api.queueMerge("eva", { items: selected.map(item => ({ queueId: item.queueId, expectedRevision: item.revision })) });
    expect(result.revision).toBe(before.revision + 1);
    expect(result.item).toMatchObject({ queueId: selected[0]!.queueId, clientUserMessageId: selected[0]!.clientUserMessageId, revision: result.revision });
    expect(result.inputs.map(record => record.stateRevision)).toEqual([before.stateRevision + 1, before.stateRevision + 2, before.stateRevision + 3]);
    expect(result.inputs.slice(1)).toEqual(selected.slice(1).map(item => expect.objectContaining({ inputId: item.clientUserMessageId, state: "superseded", reason: "mergedInsert", surface: "none", supersededBy: selected[0]!.clientUserMessageId })));
    expect(m.queueSnapshot("eva").items).toHaveLength(before.items.length - 2);
    expect(() => m.promote("eva", result.item.queueId, selected[0]!.revision)).toThrow("changed");
    expect(m.promote("eva", result.item.queueId, result.item.revision).result.input).toMatchObject({ inputId: selected[0]!.clientUserMessageId, surface: "timeline", state: "accepted" });
    expect(m.snapshot("eva").inputs.filter(record => record.inputId === selected[0]!.clientUserMessageId)).toHaveLength(1);
  });
  it("rejects stale/duplicate/oversized atomic selections before mutating anything", async () => {
    const m = currentMergeFixture();
    const before = m.queueSnapshot("eva"), selected = before.items.slice(0, 2).map(item => ({ queueId: item.queueId, expectedRevision: item.revision }));
    await expect(m.api.queueMerge("eva", { items: [selected[0]!, { ...selected[1]!, expectedRevision: -1 }] })).rejects.toThrow("changed");
    await expect(m.api.queueMerge("eva", { items: [selected[0]!, selected[0]!] })).rejects.toThrow("changed");
    await expect(m.api.queueMerge("eva", { items: Array.from({ length: 21 }, () => selected[0]!) })).rejects.toThrow("changed");
    expect(m.queueSnapshot("eva")).toEqual(before);
  });
  it("supports request-order/missing/delta reads and explicit synthetic stale-lease release", async () => {
    const m = createMockInputLedger("lease", undefined, () => T0);
    const capturedLease = m.snapshot("eva").delivery.lease!;
    // Explicit synthetic stale-lease authority over a CURRENT captured lease; raw bytes unchanged.
    m.setDelivery("eva", "held", { lease: { ...capturedLease, reconcile: { ...capturedLease.reconcile, state: "stale" } } });
    m.submit("eva", "a", "auto", "a");
    const before = m.snapshot("eva");
    m.submit("eva", "b", "queue", "b");
    expect((await m.api.inputGet("eva", ["b", "missing", "a"])).records.map(record => record.inputId)).toEqual(["b", "a"]);
    expect((await m.api.inputGet("eva", ["missing"])).missing).toEqual(["missing"]);
    expect((await m.api.inputList("eva", { sinceRevision: before.stateRevision })).records.map(record => record.inputId)).toEqual(["b"]);
    const lease = before.delivery.lease!;
    await expect(m.api.inputLeaseRelease("eva", { ...lease, runtimeGeneration: 2 })).rejects.toThrow("conflict");
    await m.api.inputLeaseRelease("eva", lease);
    expect(m.snapshot("eva").delivery).toMatchObject({ state: "idle", lease: null });
  });
});
