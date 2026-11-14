import { describe, expect, it } from "vitest";
import type { InputLease } from "@cutex-desktop/protocol";
import { CutexClient } from "../src/index";

interface Call {
  url: string;
  method: string;
  body: unknown;
}

function mockClient(reply: (call: Call) => [number, unknown] = () => [200, { cutex: { result: {} } }]) {
  const calls: Call[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const call: Call = { url: String(input), method: init?.method ?? "GET", body: init?.body };
    calls.push(call);
    const [status, body] = reply(call);
    return new Response(JSON.stringify(body), { status });
  }) as typeof globalThis.fetch;
  const client = new CutexClient({ baseUrl: "http://h:1", token: "tok" }, { fetch, clientId: "c" });
  return { client, calls };
}

const bodyOf = (call: Call) => JSON.parse(String(call.body)) as { requestId: string; method: string; params: Record<string, unknown> };

describe("input ledger methods (input-ledger-v1)", () => {
  it("inputGet posts cutex/input/get on the session with the ids and returns the result", async () => {
    const result = { ledgerEpoch: "e1", stateRevision: 7, records: [], missing: ["x"] };
    const { client, calls } = mockClient(() => [200, { cutex: { result } }]);
    expect(await client.inputGet("cutex.s 1", ["a", "x"])).toEqual(result);
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url).toBe("http://h:1/v2/sessions/cutex.s%201/cutex/requests");
    const body = bodyOf(calls[0]!);
    expect(body).toMatchObject({ method: "cutex/input/get", params: { inputIds: ["a", "x"] } });
    expect(Object.keys(body.params)).toEqual(["inputIds"]);
    expect(body.requestId).toMatch(/[0-9a-f-]{36}/);
  });

  it("inputGet refuses 0 or more than 100 ids without a request", async () => {
    const { client, calls } = mockClient();
    await expect(client.inputGet("s", [])).rejects.toBeInstanceOf(RangeError);
    await expect(client.inputGet("s", Array.from({ length: 101 }, (_, i) => `i${i}`))).rejects.toBeInstanceOf(RangeError);
    await client.inputGet("s", Array.from({ length: 100 }, (_, i) => `i${i}`));
    expect(calls).toHaveLength(1);
  });

  it("inputList sends only the given query fields", async () => {
    const { client, calls } = mockClient(() => [200, { cutex: { result: { ledgerEpoch: "e", stateRevision: 3, records: [], complete: true } } }]);
    await client.inputList("s");
    await client.inputList("s", { sinceRevision: 0 });
    await client.inputList("s", { includeSettledSecs: 900 });
    await client.inputList("s", { sinceRevision: 12, includeSettledSecs: 60 });
    expect(calls.map(call => bodyOf(call))).toEqual([
      expect.objectContaining({ method: "cutex/input/list", params: {} }),
      expect.objectContaining({ method: "cutex/input/list", params: { sinceRevision: 0 } }),
      expect.objectContaining({ method: "cutex/input/list", params: { includeSettledSecs: 900 } }),
      expect.objectContaining({ method: "cutex/input/list", params: { sinceRevision: 12, includeSettledSecs: 60 } }),
    ]);
  });

  it("inputList surfaces resyncRequired as returned", async () => {
    const { client } = mockClient(() => [200, { cutex: { result: { ledgerEpoch: "e", stateRevision: 9, records: [], complete: false, resyncRequired: true } } }]);
    expect(await client.inputList("s", { sinceRevision: 1 })).toMatchObject({ complete: false, resyncRequired: true });
  });

  it("retry / dismiss / lease release post the schema params (methods not served yet)", async () => {
    const { client, calls } = mockClient();
    const lease: InputLease = { holder: "event", turnId: null, since: "2026-11-01T00:00:00Z", runtimeGeneration: 7, inputIds: ["dlv-1"], reconcile: { state: "stale" } };
    await client.inputRetry("s", "cm-1", 4);
    await client.inputDismiss("s", "msg-1", 2);
    await client.inputDispose("s", "ask-1::input-1");
    await client.inputLeaseRelease("s", lease);
    expect(calls.map(call => bodyOf(call))).toEqual([
      expect.objectContaining({ method: "cutex/input/retry", params: { inputId: "cm-1", expectedRev: 4 } }),
      expect.objectContaining({ method: "cutex/input/dismiss", params: { inputId: "msg-1", expectedRev: 2 } }),
      // input-disposal-v1: params are exactly the input id.
      expect.objectContaining({ method: "cutex/input/dispose", params: { inputId: "ask-1::input-1" } }),
      expect.objectContaining({ method: "cutex/input/lease/release", params: { expectedLease: lease } }),
    ]);
  });

  it("atomic merge sends one CAS request and preserves the server records", async () => {
    const result = { revision: 8, affectedQueueIds: ["a", "b"], item: { queueId: "a", revision: 8 }, inputs: [{ inputId: "b", state: "superseded", supersededBy: "owner-a" }] };
    const { client, calls } = mockClient(() => [200, { cutex: { result } }]);
    const params = { items: [{ queueId: "a", expectedRevision: 2 }, { queueId: "b", expectedRevision: 4 }] };
    expect(await client.queueMerge("s", params)).toEqual(result);
    expect(calls.map(bodyOf)).toEqual([expect.objectContaining({ method: "cutex/userInput/queue/merge", params })]);
    await expect(client.queueMerge("s", { items: [] })).rejects.toBeInstanceOf(RangeError);
    await expect(client.queueMerge("s", { items: Array.from({ length: 21 }, () => params.items[0]!) })).rejects.toBeInstanceOf(RangeError);
    expect(calls).toHaveLength(1);
  });

  it("interruptSend names the existing input, record rev, turn and runtime generation in one request", async () => {
    const result = { ledgerEpoch: "e", stateRevision: 9, outcome: "interrupted", interruptedTurnId: "turn-1", record: { inputId: "existing", state: "sending", reason: "interruptSend", surface: "timeline" } };
    const { client, calls } = mockClient(() => [200, { cutex: { result } }]);
    const params = { inputId: "existing", expectedRev: 8, expectedTurnId: "turn-1", expectedRuntimeGeneration: 7 };
    expect(await client.inputInterruptSend("cutex.s 1", params)).toEqual(result);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("http://h:1/v2/sessions/cutex.s%201/cutex/requests");
    expect(bodyOf(calls[0]!)).toMatchObject({ method: "cutex/input/interruptSend", params });
    expect(bodyOf(calls[0]!).params).not.toHaveProperty("input");
  });

  it("an older cutex refusing the method rejects with its API error", async () => {
    const refusal = { contractVersion: 2, error: { source: "cutex", code: "method_not_found", message: "unknown method", retryable: false } };
    const { client } = mockClient(() => [400, refusal]);
    await expect(client.inputList("s")).rejects.toMatchObject({ code: "method_not_found" });
  });
});

it.each([true, false])("inputHold forwards CAS with held=%s", async held => {
  const result = { ledgerEpoch: "e", stateRevision: 11, record: { inputId: "notice", rev: 4, details: { ownerHold: held } } };
  const { client, calls } = mockClient(() => [200, { cutex: { result } }]);
  const params = { inputId: "notice", expectedRev: 3, held };
  expect(await client.inputHold("cutex.s 1", params)).toEqual(result);
  expect(calls).toHaveLength(1);
  expect(calls[0]!.url).toContain("cutex.s%201/cutex/requests");
  expect(bodyOf(calls[0]!)).toMatchObject({ method: "cutex/input/hold", params });
});
