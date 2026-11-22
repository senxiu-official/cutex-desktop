import { describe, expect, it } from "vitest";
import type { EventEnvelope } from "@cutex-desktop/protocol";
import { applyEvent, timelineFromThreadRead } from "../src/renderer/src/lib/timeline";
import { nextPreview, type ActivityPreview } from "../src/renderer/src/lib/activity";
import { retryCountdown, retryNoticeOf, retryNoticeText } from "../src/renderer/src/lib/retryNotice";

function native(method: string, params: unknown): EventEnvelope {
  return {
    contractVersion: 2, eventId: "e", cursor: "c", streamId: "s", sequence: 1, receivedAt: "2026-10-16T00:00:00Z",
    cutexSessionId: "me", hostId: "h", source: "app_server", sensitivity: "owner", correlation: {},
    native: { kind: "notification", message: { method, params } },
  };
}

const DETAILS = "unexpected status 524 <none>: error code: 524, url: https://relay.example.invalid/v1/responses?key=sk-secret-123, cf-ray: 8f00aa11bb22cc33-SYD";
const retryError = (n: number, details: string | null = DETAILS) => ({ message: `Reconnecting... ${n}/5`, codexErrorInfo: null, additionalDetails: details, misalignment: null });
const retry = (n: number, turnId = "t1") => native("error", { threadId: "th", turnId, willRetry: true, error: retryError(n) });

function running() {
  const state = timelineFromThreadRead({ thread: { id: "th", turns: [] } });
  applyEvent(state, native("turn/started", { turn: { id: "t1", status: "inProgress", startedAt: 1 } }));
  return state;
}

describe("retry notice", () => {
  it("keeps only the counter, HTTP status and host: never the URL path / query or cf-ray", () => {
    const notice = retryNoticeOf(retryError(3));
    expect(notice).toEqual({ attempt: 3, max: 5, waitingForNetwork: false, status: 524, host: "relay.example.invalid" });
    const text = retryNoticeText(notice!, (key, vars) => `${key}:${vars?.n ?? ""}/${vars?.max ?? ""}`);
    expect(text).toBe("turn.retry.attempt:3/5 · HTTP 524 · relay.example.invalid");
    expect(text).not.toMatch(/sk-secret|cf-ray|8f00aa|v1\/responses/);
  });

  it("prefers codexErrorInfo's status, handles waiting for network and missing details", () => {
    expect(retryNoticeOf({ message: "Reconnecting... waiting for network", codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: 502 } }, additionalDetails: null })).toEqual({ attempt: null, max: null, waitingForNetwork: true, status: 502, host: null });
    expect(retryNoticeOf({ message: "Reconnecting... 1/5", additionalDetails: "url: https://user:pw@relay.example.invalid:8443/x" })?.host).toBe("relay.example.invalid");
    expect(retryNoticeOf({ message: "x", additionalDetails: `url: https://${"a".repeat(80)}.example.invalid/` })!.host!.length).toBe(48);
    expect(retryNoticeOf(null)).toBeNull();
  });

  it("shows on the running turn, updates per attempt, clears on the next output", () => {
    const state = running();
    expect(applyEvent(state, retry(1))).toBe(true);
    expect(applyEvent(state, retry(3))).toBe(true);
    expect(state.turns[0]!.retry).toMatchObject({ attempt: 3, max: 5, status: 524 });
    expect(state.turns[0]!.error ?? null).toBeNull();
    expect(applyEvent(state, native("item/agentMessage/delta", { turnId: "t1", itemId: "a1", delta: "hi" }))).toBe(true);
    expect(state.turns[0]!.retry).toBeNull();
  });

  it("clears on an item or an otherwise ignored item delta", () => {
    const state = running();
    applyEvent(state, retry(2));
    applyEvent(state, native("item/started", { turnId: "t1", item: { type: "reasoning", id: "r1", summary: [], content: [] } }));
    expect(state.turns[0]!.retry).toBeNull();
    applyEvent(state, retry(3));
    expect(applyEvent(state, native("item/fileChange/outputDelta", { turnId: "t1", itemId: "p1", delta: "x" }))).toBe(true);
    expect(state.turns[0]!.retry).toBeNull();
    expect(applyEvent(state, native("item/fileChange/outputDelta", { turnId: "t1", itemId: "p1", delta: "x" }))).toBe(false);
  });

  it("clears on turn/completed; the final error shows as the failed turn's error", () => {
    const state = running();
    applyEvent(state, retry(5));
    const final = { message: "exceeded retry limit, last status: 524", codexErrorInfo: { responseTooManyFailedAttempts: { httpStatusCode: 524 } }, additionalDetails: null };
    expect(applyEvent(state, native("error", { threadId: "th", turnId: "t1", willRetry: false, error: final }))).toBe(true);
    expect(state.turns[0]!.retry).toBeNull();
    expect(state.turns[0]!.error).toBe(final.message);
    applyEvent(state, native("turn/completed", { turn: { id: "t1", status: "failed", error: final, completedAt: 9 } }));
    expect(state.turns[0]).toMatchObject({ status: "failed", error: final.message, retry: null });
    expect(state.activeTurnId).toBeNull();
  });

  it("a failed turn/completed without an error keeps the final error event's text", () => {
    const state = running();
    applyEvent(state, native("error", { turnId: "t1", willRetry: false, error: { message: "stream closed" } }));
    applyEvent(state, native("turn/completed", { turn: { id: "t1", status: "failed", error: null, completedAt: 9 } }));
    expect(state.turns[0]!.error).toBe("stream closed");
  });

  it("sidebar preview: retry line over the last activity, back when the turn ends without output", () => {
    const before: ActivityPreview = { kind: "tool", text: "$ pnpm test", at: 1 };
    let p = nextPreview(before, retry(2))!;
    expect(p.kind).toBe("retry");
    expect(p.text).toContain("2/5");
    expect(p.text).toContain("HTTP 524 · relay.example.invalid");
    p = nextPreview(p, retry(3))!;
    expect(p.text).toContain("3/5");
    expect(p.previous).toEqual(before);
    expect(nextPreview(p, native("turn/completed", { turn: { id: "t1", status: "failed" } }))).toEqual(before);
    expect(nextPreview(p, native("item/agentMessage/delta", { itemId: "m", delta: "ok" }))).toMatchObject({ kind: "output", text: "ok" });
    expect(nextPreview(before, native("turn/completed", { turn: { id: "t1", status: "completed" } }))).toBeUndefined();
    expect(nextPreview(before, native("error", { willRetry: false, error: { message: "x" } }))).toBeUndefined();
  });
});

describe("retained input retry (nextRetryAt / retryableInput)", () => {
  const err = { message: "Connection interrupted; waiting for network", codexErrorInfo: "other", additionalDetails: null };
  it("keeps a valid epoch-ms next time and the retryable flag from the outer params", () => {
    const n = retryNoticeOf(err, { nextRetryAt: 2_000_000_000_000, retryableInput: true, message: err.message });
    expect(n).toMatchObject({ waitingForNetwork: true, nextAt: 2_000_000_000_000, retryableInput: true, attempt: null, status: null });
    expect(retryCountdown(n!, 2_000_000_000_000 - 61_500)).toBe("1:02");
    expect(retryCountdown(n!, 2_000_000_000_000 + 5_000)).toBe("0:00");
  });
  it("drops invalid next times and non-true flags", () => {
    for (const nextRetryAt of ["2000000000000", 2_000_000_000.5, 1_700_000_000, Number.NaN, Infinity, -1, null])
      expect(retryNoticeOf(err, { nextRetryAt })?.nextAt).toBeUndefined();
    expect(retryNoticeOf(err, { retryableInput: "true" })?.retryableInput).toBeUndefined();
    expect(retryCountdown(retryNoticeOf(err)!, 0)).toBeNull();
  });
  it("the timeline keeps them on the running turn", () => {
    const state = running();
    applyEvent(state, native("error", { threadId: "th", turnId: "t1", willRetry: true, nextRetryAt: 2_000_000_000_000, retryableInput: true, error: err }));
    expect(state.turns[0]!.retry).toMatchObject({ nextAt: 2_000_000_000_000, retryableInput: true });
    expect(state.turns[0]!.error ?? null).toBeNull();
  });
});

describe("retained input head", () => {
  const err = { message: "Connection interrupted; waiting for network", codexErrorInfo: "other", additionalDetails: null };
  const t = (key: string, vars?: Record<string, string | number>) => (vars ? `${key}:${vars.n}/${vars.max}` : key);
  it("says turn.retry.retained for an input the runtime keeps, whatever the message says", () => {
    expect(retryNoticeText(retryNoticeOf(err, { retryableInput: true, nextRetryAt: 2_000_000_000_000 })!, t)).toBe("turn.retry.retained");
    expect(retryNoticeText(retryNoticeOf({ ...err, message: "Reconnecting... 2/5" }, { retryableInput: true })!, t)).toBe("turn.retry.retained");
  });
  it("keeps the other heads unchanged without the flag", () => {
    expect(retryNoticeText(retryNoticeOf(err)!, t)).toBe("turn.retry.network");
    expect(retryNoticeText(retryNoticeOf({ ...err, message: "Reconnecting... 2/5" }, { retryableInput: false })!, t)).toBe("turn.retry.attempt:2/5");
    expect(retryNoticeText(retryNoticeOf({ ...err, message: "x" }, { retryableInput: "true" })!, t)).toBe("turn.retry.generic");
  });
});

describe("bootstrap claudeRetry (thread/read of a retained turn)", () => {
  const err = { message: "Connection interrupted; waiting for network", codexErrorInfo: "other", additionalDetails: null };
  const wire = { threadId: "th", turnId: "t1", willRetry: true, nextRetryAt: 2_000_000_000_000, retryableInput: true, error: err };
  const read = (turn: Record<string, unknown>) => timelineFromThreadRead({ thread: { id: "th", turns: [{ id: "t1", items: [], ...turn }] } });

  it("a retained in-progress turn shows the retry notice, not its transient error", () => {
    const state = read({ status: "inProgress", error: err, claudeRetry: wire });
    expect(state.activeTurnId).toBe("t1");
    expect(state.turns[0]).toMatchObject({ status: "inProgress", error: null, errorCode: null });
    expect(state.turns[0]!.retry).toMatchObject({ waitingForNetwork: true, nextAt: 2_000_000_000_000, retryableInput: true });
    expect(retryNoticeText(state.turns[0]!.retry!, (k) => k)).toBe("turn.retry.retained");
  });

  it("a failed turn with a stray claudeRetry keeps its failure", () => {
    const state = read({ status: "failed", error: { message: "boom" }, claudeRetry: wire });
    expect(state.turns[0]).toMatchObject({ status: "failed", error: "boom" });
    expect(state.turns[0]!.retry ?? null).toBeNull();
  });

  it("a plain in-progress turn and malformed extensions change nothing", () => {
    const plain = read({ status: "inProgress", error: { message: "boom" } });
    expect(plain.turns[0]!.error).toBe("boom");
    expect(plain.turns[0]!.retry ?? null).toBeNull();
    for (const claudeRetry of [null, "x", [wire], { ...wire, willRetry: "true" }, { ...wire, willRetry: false }, { ...wire, error: null }, { ...wire, turnId: "other" }]) {
      const state = read({ status: "inProgress", error: { message: "boom" }, claudeRetry });
      expect(state.turns[0]!.error).toBe("boom");
      expect(state.turns[0]!.retry ?? null).toBeNull();
    }
  });
});
