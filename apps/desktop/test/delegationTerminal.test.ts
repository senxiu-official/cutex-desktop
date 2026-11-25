// cutex r295 terminal notices (docs/r295-terminal-notices.md): parsing, one chronological sequence (hf@n then
// terminal@rev), the ending a status line names, a retry that has not started, reasons, and the transcript / status
// rules that keep a closed delegation with no answer from reading 已完成.
import { describe, expect, it } from "vitest";
import type { AskDetail } from "../src/shared/ipc";
import { currentEnding, hasTerminalFacts, noticeRefOfPreview, noticeWordKey, parseTerminalActor, parseTerminalNotice, pendingRetryAfter, reasonOf, selfCaused, terminalNoticesOf, terminalSequence, type TerminalNotice } from "../src/renderer/src/lib/delegationTerminal";
import { delegationResultItems, inferDelegations } from "../src/renderer/src/lib/delegations";
import type { ExternalMessage, TimelineEntry } from "../src/renderer/src/lib/timeline";

const wire = (refId: string, at: string, over: Record<string, unknown> = {}) => ({ refId, at, revision: 1, attempt: 1, execution: "failed", closed: null, reason: "", actor: { kind: "unknown" }, ...over });
const n = (refId: string, at: string, over: Record<string, unknown> = {}) => parseTerminalNotice(wire(refId, at, over))!;
const detail = (over: Partial<AskDetail> & Record<string, unknown>): AskDetail => ({ askId: "ask-1", title: "T", requester: { kind: "agent", cutexSessionId: "lead" }, targetCutexSessionId: "helper", execution: "interrupted", createdAt: "", updatedAt: "", revision: 9, ...over } as AskDetail);

const HF = wire("handlerTurnFailed@2", "2026-11-25T05:00:00Z", { attempt: 2, execution: "interrupted", actor: { kind: "system", component: "handlerRuntime" }, reason: "misalignmentPolicyViolation", revision: 8 });
const STOP = wire("terminal@9", "2026-11-25T05:02:00Z", { attempt: 2, execution: "interrupted", closed: "stopped", actor: { kind: "owner" }, reason: "ownerStopped", revision: 9 });

describe("parsing", () => {
  it("reads every actor form; a missing or newer one is unknown, never the owner", () => {
    expect(parseTerminalActor({ kind: "owner" })).toEqual({ kind: "owner" });
    expect(parseTerminalActor({ kind: "agent", sessionId: "lead" })).toEqual({ kind: "agent", sessionId: "lead" });
    expect(parseTerminalActor({ kind: "system", component: "scheduler" })).toEqual({ kind: "system", component: "scheduler" });
    expect(parseTerminalActor({ kind: "unknown" })).toEqual({ kind: "unknown" });
    expect(parseTerminalActor(undefined)).toEqual({ kind: "unknown" });
    expect(parseTerminalActor({ kind: "agent" })).toEqual({ kind: "unknown" });
    expect(parseTerminalActor({ kind: "peerOwner", host: "x" })).toEqual({ kind: "unknown" });
  });
  it("a notice needs its ref and time", () => {
    expect(parseTerminalNotice({ at: "2026-11-25T05:00:00Z" })).toBeNull();
    expect(parseTerminalNotice(null)).toBeNull();
    expect(parseTerminalNotice(HF)).toMatchObject({ ref: "handlerTurnFailed@2", attempt: 2, execution: "interrupted", closed: null });
  });
  it("feature detection: an older host's detail has neither field", () => {
    expect(hasTerminalFacts(detail({}))).toBe(false);
    expect(hasTerminalFacts(detail({ terminalNotices: [] }))).toBe(true);
    expect(hasTerminalFacts(null)).toBe(false);
    expect(currentEnding(detail({ closed: "stopped" }))).toBeNull();
  });
});

describe("one sequence", () => {
  it("hf@n then terminal@rev in time order; the same ref once; a later closure naming the same attempt stays", () => {
    const later = n("terminal@11", "2026-11-25T05:09:00Z", { attempt: 2, closed: "abandoned", revision: 11 });
    const seq = terminalSequence([parseTerminalNotice(STOP)!, later], [parseTerminalNotice(HF)!, parseTerminalNotice(STOP)!]);
    expect(seq.map((x) => x.ref)).toEqual(["handlerTurnFailed@2", "terminal@9", "terminal@11"]);
  });
  it("same time: by revision, then the failure before the closure", () => {
    const at = "2026-11-25T05:00:00Z";
    expect(terminalSequence([n("terminal@3", at, { revision: 3 }), n("handlerTurnFailed@1", at, { revision: 3 })]).map((x) => x.ref)).toEqual(["handlerTurnFailed@1", "terminal@3"]);
  });
});

describe("the ending a status line names", () => {
  it("a closed delegation: the closure matching its outcome", () => {
    const d = detail({ closed: "stopped", terminalNotices: [STOP, HF] });
    expect(terminalNoticesOf(d).map((x) => x.ref)).toEqual(["handlerTurnFailed@2", "terminal@9"]);
    expect(currentEnding(d)?.ref).toBe("terminal@9");
  });
  it("a normal answer's closure is never an ending", () => {
    const d = detail({ execution: "answered", closed: "completed", terminalNotices: [wire("terminal@4", "2026-11-25T05:00:00Z", { execution: "answered", closed: "completed", reason: "answered", actor: { kind: "system", component: "cutex" } })] });
    expect(currentEnding(d)).toBeNull();
  });
  it("open: the current attempt's failure, not an earlier one's", () => {
    const hf1 = wire("handlerTurnFailed@1", "2026-11-25T04:00:00Z", { attempt: 1 });
    expect(currentEnding(detail({ closed: null, execution: "failed", attempts: [{ n: 1 } as never], terminalNotices: [hf1] }))?.ref).toBe("handlerTurnFailed@1");
    expect(currentEnding(detail({ closed: null, execution: "queued", attempts: [{ n: 1 } as never, { n: 2 } as never], terminalNotices: [hf1] }))).toBeNull();
  });
  it("a retry that has not started is said apart from the earlier failure", () => {
    const hf1 = wire("handlerTurnFailed@1", "2026-11-25T04:00:00Z", { attempt: 1 });
    const d = detail({ closed: null, execution: "queued", attempts: [{ n: 1, startedAt: "x" } as never, { n: 2 } as never], terminalNotices: [hf1] });
    expect(pendingRetryAfter(d, terminalNoticesOf(d))).toBe(2);
    const started = detail({ closed: null, execution: "running", attempts: [{ n: 1 } as never, { n: 2, startedAt: "y" } as never], terminalNotices: [hf1] });
    expect(pendingRetryAfter(started, terminalNoticesOf(started))).toBeNull();
    expect(pendingRetryAfter(detail({ closed: "stopped", attempts: [{ n: 2 } as never], terminalNotices: [hf1] }), [parseTerminalNotice(hf1)!])).toBeNull();
  });
  it("self-caused: the requester's own session", () => {
    const own = n("terminal@7", "2026-11-25T05:00:00Z", { actor: { kind: "agent", sessionId: "lead" } });
    expect(selfCaused(own, "lead")).toBe(true);
    expect(selfCaused(own, "other")).toBe(false);
    expect(selfCaused(parseTerminalNotice(STOP)!, "lead")).toBe(false);
  });
});

describe("words", () => {
  it("reasons that only restate the status or actor are not repeated; known codes have words; text stays text", () => {
    const r = (reason: string) => reasonOf({ reason } as TerminalNotice);
    expect(r("ownerStopped")).toBeNull();
    expect(r("stopped")).toBeNull();
    expect(r("")).toBeNull();
    expect(r("ownerDiscarded")).toEqual({ code: "ownerDiscarded" });
    expect(r("misalignmentPolicyViolation")).toEqual({ code: "misalignmentPolicyViolation" });
    expect(r("Mika was archived")).toEqual({ text: "Mika was archived" });
  });
  it("status words: a failed attempt says its attempt; a closure says how; completed by its execution", () => {
    expect(noticeWordKey(n("handlerTurnFailed@2", "x", { execution: "interrupted" }))).toBe("delegation.ending.attemptInterrupted");
    expect(noticeWordKey(n("handlerTurnFailed@2", "x", { execution: "failed" }))).toBe("delegation.ending.attemptFailed");
    expect(noticeWordKey(n("terminal@9", "x", { closed: "stopped" }))).toBe("delegation.status.stopped");
    expect(noticeWordKey(n("terminal@9", "x", { closed: "completed", execution: "failed" }))).toBe("delegation.status.failed");
    expect(noticeWordKey(n("terminal@9", "x", { closed: "completed", execution: "interrupted" }))).toBe("delegation.ending.interrupted");
    expect(noticeWordKey(n("terminal@9", "x", { closed: "superseded", execution: "answered" }))).toBe("delegation.ending.superseded");
  });
});

describe("a closed delegation with no answer never reads 已完成", () => {
  const tool = (id: string, tool: string, structured: Record<string, unknown>, args: Record<string, unknown> = {}): TimelineEntry => ({ kind: "tool", id, turnId: "t1", item: { type: "mcpToolCall", id, server: "cutex", tool, status: "completed", arguments: args, result: { content: [], structuredContent: structured } } } as unknown as TimelineEntry);
  it("delegation_read's state record and an answer read's delegation_state set the closure", () => {
    const read = inferDelegations([tool("r1", "delegation_read", { ok: true, ask_id: "ask-1", kind: "state", execution: "interrupted", closed: "stopped", terminal: true, reason: "ownerStopped", actor: { kind: "owner" } }, { delegation: "ask-1" })]);
    expect(read.get("ask-1")).toMatchObject({ execution: "interrupted", closed: "stopped" });
    const answer = inferDelegations([tool("r2", "delegation_read", { ok: true, ask_id: "ask-2", answer_id: "a", revision: 1, status: "completed", delegation_state: { kind: "state", execution: "answered", closed: "accepted" } }, { delegation: "ask-2" })]);
    expect(answer.get("ask-2")).toMatchObject({ closed: "accepted" });
  });
  it("a delivered State item with its notice sets the closure (not an answer)", () => {
    const wait = inferDelegations([tool("w1", "delegation_wait", { ok: true, results: [{ kind: "state", ask_id: "ask-3", state: "stopped", notice: STOP }] })]);
    expect(wait.get("ask-3")).toMatchObject({ execution: "interrupted", closed: "stopped" });
    expect(wait.get("ask-3")?.answerPreview).toBeUndefined();
  });
  it("a State item for a normal (accepted) answer is not an ending; one (askId, ref) per batch, failure and closure both kept", () => {
    const accepted = wire("terminal@5", "2026-11-25T05:00:00Z", { execution: "answered", closed: "accepted" });
    const item = (askId: string, notice: unknown) => ({ kind: "state", askId, title: "T", target: { id: "helper", name: "Helper" }, notice });
    const message = { schema: "cutex.delegation-results.v1", data: { items: [item("ask-1", accepted), item("ask-2", HF), item("ask-2", STOP), item("ask-2", STOP), item("ask-3", STOP)] } } as unknown as ExternalMessage;
    const items = delegationResultItems(message);
    expect(items.map((i) => [i.askId, i.notice?.ref ?? null])).toEqual([["ask-1", null], ["ask-2", "handlerTurnFailed@2"], ["ask-2", "terminal@9"], ["ask-3", "terminal@9"]]);
  });
  it("the ref first in a status record's preview", () => {
    expect(noticeRefOfPreview("terminal@9: 跑一遍")).toBe("terminal@9");
    expect(noticeRefOfPreview("handlerTurnFailed@2: x")).toBe("handlerTurnFailed@2");
    expect(noticeRefOfPreview("跑一遍")).toBeNull();
    expect(noticeRefOfPreview(null)).toBeNull();
  });
  it("cutex.delegation-results.v1 State items carry their own notice; other items none", () => {
    const message = { schema: "cutex.delegation-results.v1", data: { items: [{ kind: "state", askId: "ask-1", title: "T", target: { id: "helper", name: "Helper" }, state: "stopped", notice: STOP }, { kind: "answer", askId: "ask-2", notice: STOP }, { kind: "state", askId: "ask-4" }] } } as unknown as ExternalMessage;
    const items = delegationResultItems(message);
    expect(items[0]!.notice).toMatchObject({ ref: "terminal@9", actor: { kind: "owner" } });
    expect(items[1]!.notice).toBeNull();
    expect(items[2]!.notice).toBeNull();
  });
});
