// Stuck Agent Bus messages: the wire adapter + request validation (shared/agentBusStuck.ts) and the
// pure parts of the settings section (modules/agent-bus/stuck.ts): labels, hints, what a discard's
// answer means, and 全部丢弃 one by one.
import { describe, expect, it } from "vitest";
import { asStuckDiscarded, asStuckMessage, asStuckView, cleanMinAge, DEFAULT_MIN_AGE_SECS, MAX_MIN_AGE_SECS, STUCK_DISCARD_REASON, stuckDiscardRequest } from "../src/shared/agentBusStuck";
import type { StuckBusDiscardRequest, StuckBusDiscardResult, StuckBusMessage } from "../src/shared/ipc";
import { ageParts, bulkTargets, discardAll, discardOutcome, discardRequest, isMinAgeChoice, knownKind, MIN_AGE_CHOICES, minAgeKey, partyName, protectedCount, reasonsTooltip, refusalText, senderLabel, stuckHints } from "../src/renderer/src/modules/agent-bus/stuck";

const SHA = "ab".repeat(32);

/** A durable row as cutex sends it (`StuckAgentBusMessage` + `durable_row`). */
const wireRow = (over: Record<string, unknown> = {}) => ({
  messageId: "msg-1",
  state: "pending",
  durable: true,
  to: { id: "cutex.bob", name: "Bob" },
  from: { id: "cutex.alice", name: "Alice" },
  toCutexSessionId: "cutex.bob",
  fromCutexSessionId: "cutex.alice",
  semanticSha256: SHA,
  createdAtEpochSecs: 1_000,
  ageSecs: 7_300,
  senderKind: "cutex",
  controlType: null,
  nativeSubmissionPresent: false,
  protectedControl: false,
  error: null,
  reasons: ["not in any live runtime queue"],
  contentPreview: "hello",
  liveQueues: [],
  ...over,
});

const msg = (over: Partial<StuckBusMessage> = {}): StuckBusMessage => ({
  messageId: "m1",
  state: "pending",
  durable: true,
  to: { id: "cutex.bob", name: "Bob" },
  from: { id: "cutex.alice", name: "Alice" },
  ageSecs: 7300,
  createdAtEpochSecs: 1000,
  senderKind: "cutex",
  protectedControl: false,
  nativeSubmissionPresent: false,
  semanticSha256: SHA,
  errorCode: null,
  errorMessage: null,
  reasons: [],
  contentPreview: "hello",
  ...over,
});

describe("asStuckView", () => {
  it("reads cutex's list", () => {
    const view = asStuckView({ messages: [wireRow()], total: 1, liveQueue: { available: true }, minAgeSecs: 3600, generatedAt: "2026-10-10T00:00:00Z" });
    expect(view).toEqual({
      messages: [
        {
          messageId: "msg-1",
          state: "pending",
          durable: true,
          to: { id: "cutex.bob", name: "Bob" },
          from: { id: "cutex.alice", name: "Alice" },
          ageSecs: 7300,
          createdAtEpochSecs: 1000,
          senderKind: "cutex",
          protectedControl: false,
          nativeSubmissionPresent: false,
          semanticSha256: SHA,
          errorCode: null,
          errorMessage: null,
          reasons: ["not in any live runtime queue"],
          contentPreview: "hello",
        },
      ],
      total: 1,
      liveQueueAvailable: true,
      liveQueueError: null,
      minAgeSecs: 3600,
    });
  });

  it("an in-memory-only row has no digest and may have no sender or age", () => {
    const m = asStuckMessage({ messageId: "x", state: "live_only", durable: false, to: { id: "cutex.bob", name: null }, from: { id: "cutex-alarm", name: null }, ageSecs: null, senderKind: "alarm_service", semanticSha256: null, contentPreview: "ring" });
    expect(m).toMatchObject({ state: "live_only", durable: false, ageSecs: null, semanticSha256: null, from: { id: "cutex-alarm", name: null }, senderKind: "alarm_service", protectedControl: false });
    expect(asStuckMessage({ messageId: "y", to: { id: "t", name: null }, from: null })!.from).toBeNull();
  });

  it("keeps the last error's code and text, and drops a malformed digest", () => {
    const m = asStuckMessage(wireRow({ error: { source: "cutex", code: "native_ingress_timeout", message: "no receipt" }, semanticSha256: "nope" }))!;
    expect(m).toMatchObject({ errorCode: "native_ingress_timeout", errorMessage: "no receipt", semanticSha256: null });
  });

  it("skips rows without an id, reports an unreadable live queue, and total is never below what is listed", () => {
    const view = asStuckView({ messages: [wireRow(), { state: "pending" }, null, "x"], total: 0, liveQueue: { available: false, error: "connection refused" }, minAgeSecs: 60 });
    expect(view.messages.map((m) => m.messageId)).toEqual(["msg-1"]);
    expect(view).toMatchObject({ total: 1, liveQueueAvailable: false, liveQueueError: "connection refused", minAgeSecs: 60 });
    expect(asStuckView({ messages: [wireRow()], total: 450 }).total).toBe(450);
  });

  it("an odd reply is an empty list with the requested age", () => {
    expect(asStuckView(null, 600)).toEqual({ messages: [], total: 0, liveQueueAvailable: true, liveQueueError: null, minAgeSecs: 600 });
    expect(asStuckView({ messages: "x" }, 60).messages).toEqual([]);
  });
});

describe("asStuckDiscarded / cleanMinAge", () => {
  it("reads changed and a live withdrawal error", () => {
    expect(asStuckDiscarded({ messageId: "m", discarded: true, changed: true, durable: { changed: true }, liveWithdrawn: [] }, "m")).toEqual({ messageId: "m", changed: true, liveWithdrawError: null });
    expect(asStuckDiscarded({ messageId: "m", discarded: true, changed: false, liveWithdrawError: "bus down" }, "m")).toEqual({ messageId: "m", changed: false, liveWithdrawError: "bus down" });
    expect(asStuckDiscarded(undefined, "fallback")).toEqual({ messageId: "fallback", changed: false, liveWithdrawError: null });
  });

  it("clamps the age filter to whole seconds in 0..31 days", () => {
    expect([cleanMinAge(3600), cleanMinAge(0), cleanMinAge(-1), cleanMinAge(90.9), cleanMinAge(1e12)]).toEqual([3600, 0, 0, 90, MAX_MIN_AGE_SECS]);
    expect([cleanMinAge("1h"), cleanMinAge(NaN), cleanMinAge(undefined)]).toEqual([DEFAULT_MIN_AGE_SECS, DEFAULT_MIN_AGE_SECS, DEFAULT_MIN_AGE_SECS]);
  });
});

describe("stuckDiscardRequest", () => {
  it("fixes the reason in main and passes the digest and allowProtected only when given", () => {
    expect(stuckDiscardRequest({ messageId: "m1" })).toEqual({ messageId: "m1", reason: STUCK_DISCARD_REASON });
    expect(stuckDiscardRequest({ messageId: "m1", expectedSemanticSha256: SHA, allowProtected: true })).toEqual({ messageId: "m1", reason: STUCK_DISCARD_REASON, expectedSemanticSha256: SHA, allowProtected: true });
    expect(stuckDiscardRequest({ messageId: "m1", expectedSemanticSha256: null, allowProtected: false })).toEqual({ messageId: "m1", reason: STUCK_DISCARD_REASON });
  });

  it("rejects a malformed request; extra fields (a reason from the renderer) are not forwarded", () => {
    expect(() => stuckDiscardRequest({ messageId: "" })).toThrow("bad message id");
    expect(() => stuckDiscardRequest({ messageId: "x".repeat(513) })).toThrow("bad message id");
    expect(() => stuckDiscardRequest({ messageId: "m", expectedSemanticSha256: "abc" })).toThrow("bad semantic digest");
    expect(() => stuckDiscardRequest(null as unknown as StuckBusDiscardRequest)).toThrow("bad discard request");
    const forged = { messageId: "m1", reason: "something else", allowProtected: "yes" } as unknown as StuckBusDiscardRequest;
    expect(stuckDiscardRequest(forged)).toEqual({ messageId: "m1", reason: STUCK_DISCARD_REASON });
  });
});

describe("labels", () => {
  it("ages are one rounded-down unit", () => {
    expect([null, -1, 5, 60, 3599, 3600, 7300, 172_799, 172_800, 400_000].map((s) => ageParts(s))).toEqual([
      null,
      null,
      { unit: "lt1m", n: 0 },
      { unit: "min", n: 1 },
      { unit: "min", n: 59 },
      { unit: "hour", n: 1 },
      { unit: "hour", n: 2 },
      { unit: "hour", n: 47 },
      { unit: "day", n: 2 },
      { unit: "day", n: 4 },
    ]);
  });

  it("every age filter choice has a label key, and 0 means all", () => {
    expect(MIN_AGE_CHOICES.map(minAgeKey)).toEqual(["m5", "h1", "h6", "d1", "all"]);
    expect(isMinAgeChoice(3600) && isMinAgeChoice(0) && !isMinAgeChoice(7) && !isMinAgeChoice("3600")).toBe(true);
  });

  it("a party shows its name, else a shortened id; sender kinds are the ones cutex reports", () => {
    expect(partyName({ id: "cutex.bob", name: "Bob" })).toBe("Bob");
    expect(partyName({ id: "cutex.bob", name: null })).toBe("cutex.bob");
    expect(partyName({ id: "cutex.0123456789abcdef0123", name: null })).toBe("cutex.0123456789…");
    expect(partyName(null)).toBeNull();
    expect(knownKind("job_service")).toBe("job_service");
    expect(knownKind("cutex")).toBe("cutex");
    expect(knownKind("something_new")).toBeNull();
    expect(knownKind(null)).toBeNull();
  });
});

describe("senderLabel", () => {
  it("a named session shows its name; the owner and the services show their kind, not an id", () => {
    expect(senderLabel(msg())).toEqual({ name: "Alice" });
    expect(senderLabel(msg({ from: { id: "owner", name: null }, senderKind: "owner" }))).toEqual({ kind: "owner" });
    expect(senderLabel(msg({ from: null, senderKind: "job_service" }))).toEqual({ kind: "job_service" });
    expect(senderLabel(msg({ from: { id: "cutex-alarm", name: null }, senderKind: "alarm_service" }))).toEqual({ kind: "alarm_service" });
  });

  it("an unnamed session shows its shortened id; nothing known is null", () => {
    expect(senderLabel(msg({ from: { id: "cutex.0123456789abcdef0123", name: null }, senderKind: "cutex" }))).toEqual({ name: "cutex.0123456789…" });
    expect(senderLabel(msg({ from: null, senderKind: "unknown" }))).toBeNull();
    expect(senderLabel(msg({ from: null, senderKind: null }))).toBeNull();
  });
});

describe("stuckHints", () => {
  it("memory-only, held, frozen / quarantine, error and protected, at most three", () => {
    expect(stuckHints(msg({ durable: false, state: "live_only" }))).toEqual([{ key: "memoryOnly" }]);
    expect(stuckHints(msg({ state: "stale_held" }))).toEqual([{ key: "held" }]);
    expect(stuckHints(msg({ nativeSubmissionPresent: true, errorCode: "native_ingress_timeout" }))).toEqual([{ key: "frozen" }, { key: "error", params: { code: "native_ingress_timeout" } }, { key: "quarantine" }]);
    expect(stuckHints(msg({ protectedControl: true, nativeSubmissionPresent: true, errorCode: "x" }))).toEqual([{ key: "frozen" }, { key: "error", params: { code: "x" } }, { key: "protected" }]);
    expect(stuckHints(msg())).toEqual([]);
  });

  it("cutex's own reasons go to the tooltip", () => {
    expect(reasonsTooltip(msg({ reasons: ["a", "b"] }))).toBe("a\nb");
    expect(reasonsTooltip(msg())).toBeUndefined();
  });
});

describe("discard requests and outcomes", () => {
  it("a row is pinned by its digest; only a protected row asks for allowProtected", () => {
    expect(discardRequest(msg())).toEqual({ messageId: "m1", expectedSemanticSha256: SHA });
    expect(discardRequest(msg({ protectedControl: true, semanticSha256: null }))).toEqual({ messageId: "m1", expectedSemanticSha256: null, allowProtected: true });
  });

  it("全部丢弃 leaves Task / Job / control messages to their own rows", () => {
    const rows = [msg({ messageId: "a" }), msg({ messageId: "b", protectedControl: true }), msg({ messageId: "c" })];
    expect(bulkTargets(rows).map((m) => m.messageId)).toEqual(["a", "c"]);
    expect(protectedCount(rows)).toBe(1);
  });

  it("not found / not discardable only mean the message is gone; other refusals fail", () => {
    const refusal = (code: string): StuckBusDiscardResult => ({ ok: false, error: { code, message: `${code} text` } });
    expect(discardOutcome({ ok: true, discarded: { messageId: "m", changed: true, liveWithdrawError: null } })).toEqual({ kind: "discarded", liveWithdrawError: null });
    expect(discardOutcome({ ok: true, discarded: { messageId: "m", changed: false, liveWithdrawError: "down" } })).toEqual({ kind: "discarded", liveWithdrawError: "down" });
    expect(discardOutcome(refusal("message_not_found"))).toEqual({ kind: "gone" });
    expect(discardOutcome(refusal("message_not_discardable"))).toEqual({ kind: "gone" });
    expect(discardOutcome(refusal("message_digest_mismatch"))).toEqual({ kind: "failed", code: "message_digest_mismatch", message: "message_digest_mismatch text" });
  });

  it("a refusal shows the page's own wording when it has one, else the code and cutex's text", () => {
    const known = (code: string) => (code === "message_protected" ? "protected!" : null);
    expect(refusalText({ code: "message_protected", message: "m" }, known)).toBe("protected!");
    expect(refusalText({ code: "odd", message: "text" }, known)).toBe("odd: text");
  });
});

describe("discardAll", () => {
  const ok: StuckBusDiscardResult = { ok: true, discarded: { messageId: "x", changed: true, liveWithdrawError: null } };
  const rows = ["a", "b", "c", "d"].map((messageId) => msg({ messageId }));

  it("discards one by one, in order, and reports progress", async () => {
    const seen: string[] = [];
    const progress: [number, number][] = [];
    const summary = await discardAll(
      rows,
      async (request) => {
        seen.push(request.messageId);
        return ok;
      },
      (done, total) => progress.push([done, total]),
    );
    expect(seen).toEqual(["a", "b", "c", "d"]);
    expect(progress).toEqual([[1, 4], [2, 4], [3, 4], [4, 4]]);
    expect(summary).toEqual({ discarded: 4, gone: 0, liveWarnings: 0, failed: [], notAttempted: 0 });
  });

  it("counts gone messages, live warnings and refusals, and carries on after a refusal", async () => {
    const answers: Record<string, StuckBusDiscardResult> = {
      a: ok,
      b: { ok: false, error: { code: "message_not_found", message: "gone" } },
      c: { ok: false, error: { code: "message_digest_mismatch", message: "changed" } },
      d: { ok: true, discarded: { messageId: "d", changed: true, liveWithdrawError: "bus down" } },
    };
    const summary = await discardAll(rows, async (request) => answers[request.messageId]!);
    expect(summary).toEqual({ discarded: 2, gone: 1, liveWarnings: 1, failed: [{ messageId: "c", code: "message_digest_mismatch", message: "changed" }], notAttempted: 0 });
  });

  it("a lost connection stops the run and says how many were left", async () => {
    let calls = 0;
    const summary = await discardAll(rows, async () => {
      calls += 1;
      if (calls === 2) throw new Error("fetch failed");
      return ok;
    });
    expect(calls).toBe(2);
    expect(summary).toEqual({ discarded: 1, gone: 0, liveWarnings: 0, failed: [{ messageId: "b", code: "error", message: "fetch failed" }], notAttempted: 2 });
  });

  it("sends each message's digest and allows only a protected one", async () => {
    const sent: unknown[] = [];
    await discardAll([msg({ messageId: "a" }), msg({ messageId: "p", protectedControl: true })], async (request) => (sent.push(request), ok));
    expect(sent).toEqual([
      { messageId: "a", expectedSemanticSha256: SHA },
      { messageId: "p", expectedSemanticSha256: SHA, allowProtected: true },
    ]);
  });

  it("nothing to discard is an empty summary", async () => {
    expect(await discardAll([], async () => ok)).toEqual({ discarded: 0, gone: 0, liveWarnings: 0, failed: [], notAttempted: 0 });
  });
});
