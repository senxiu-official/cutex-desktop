import { describe, expect, it } from "vitest";
import type { EventEnvelope } from "@cutex-desktop/protocol";
import { applyEvent, timelineFromThreadRead } from "../src/renderer/src/lib/timeline";
import { nextPreview, type ActivityPreview } from "../src/renderer/src/lib/activity";
import { retryNoticeOf, retryNoticeText } from "../src/renderer/src/lib/retryNotice";

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
