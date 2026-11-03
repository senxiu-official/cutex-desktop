import { describe, expect, it } from "vitest";
import { capturedOperations, capturedSurfaceTrace, parseCapturedTrace, replayCapturedTrace } from "./capturedTraces";
import { checkSurfaceTrace } from "./surfaceTrace";
import { record } from "./testkit";

// Pure parser/transport cases: no private or historical fixture import is needed.
const input = record("parser-input", { cutexSessionId: "cutex.parser", state: "waiting", reason: "explicitQueue", surface: "nextUp" });
const parse = (source: string, kind: string, payload: Record<string, unknown>) => parseCapturedTrace(JSON.stringify({ atMs: 1, source, kind, cutexSessionId: input.cutexSessionId, payload }))[0]!;
const snapshot = () => parse("snapshot", "inputList", { ledgerEpoch: "parser-epoch", stateRevision: 1, records: [input], complete: true });
const reply = () => parse("marker", "queueMerge", { result: { Ok: { inputs: [input] } } });

describe("capture parser boundaries without historical raw data", () => {
  it("reports original physical line numbers instead of silently dropping bad input", () => {
    expect(() => parseCapturedTrace("\n{broken}")).toThrow("line 2: invalid JSON");
    expect(() => parseCapturedTrace('{"atMs":1,"source":"session","kind":"stateChanged"}')).toThrow("line 1");
    expect(() => capturedOperations(parseCapturedTrace('{"atMs":1,"source":"session","kind":"stateChanged","payload":{}}'))).toThrow("no session id");
  });
  it("preserves unknown marker payloads and does not silently claim unsupported data was replayed", () => {
    const entry = parseCapturedTrace('{"atMs":1,"source":"newRecorder","kind":"future","payload":{"keep":123},"extra":true}')[0]!;
    expect(entry.raw.extra).toBe(true);
    expect(capturedOperations([entry])).toEqual([{ type: "ignored", entry, reason: "non-ledger capture marker" }]);
  });
  it("does not prune held records for an incomplete list", () => {
    const entry = snapshot(), incomplete = { ...entry, payload: { ...entry.payload, complete: false } };
    const operation = capturedOperations([incomplete])[0]!;
    expect(operation.type === "snapshot" && operation.snapshot.coverage.kind).toBe("partial");
  });
  it("replies without a known request epoch remain explicitly unresolved", () => {
    expect(replayCapturedTrace([reply()]).unresolvedResponses).toHaveLength(1);
    expect(replayCapturedTrace([snapshot(), reply()], { responseEpoch: () => undefined }).unresolvedResponses.length).toBeGreaterThan(0);
  });
  it("does not hide a contradictory host/session projection as a transport duplicate", () => {
    const full = parse("session", "stateChanged", { cutexSessionId: input.cutexSessionId, ledgerEpoch: "parser-epoch", stateRevision: input.stateRevision, record: input });
    const host = { ...full, source: "host", payload: { ...full.payload, record: { ...input, surface: "timeline" } } };
    const trace = capturedSurfaceTrace([host, full], { snapshots: false });
    expect(trace).toHaveLength(2);
    expect(checkSurfaceTrace(trace).length).toBeGreaterThan(0);
  });
});
