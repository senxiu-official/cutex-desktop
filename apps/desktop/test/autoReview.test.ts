import { describe, expect, it } from "vitest";
import type { EventEnvelope } from "@cutex-desktop/protocol";
import { applyEvent, autoReviewOf, emptyTimeline, orderedEntries, type RawItem } from "../src/renderer/src/lib/timeline";
import { isFailed, segmentEntries } from "../src/renderer/src/lib/workGroups";

function native(method: string, params: unknown): EventEnvelope {
  return {
    contractVersion: 2,
    eventId: "e",
    cursor: "c",
    streamId: "s",
    sequence: 1,
    receivedAt: "",
    cutexSessionId: "me",
    hostId: "h",
    source: "app_server",
    sensitivity: "owner",
    correlation: {},
    native: { kind: "notification", message: { method, params } },
  };
}

const action = { type: "command", source: "unifiedExec", command: "/bin/bash -lc 'echo x > /outside/x.txt'", cwd: "/work" };
const started = (reviewId: string, targetItemId: string | null, extra: Record<string, unknown> = {}) =>
  native("item/autoApprovalReview/started", { threadId: "th", turnId: "t1", reviewId, targetItemId, startedAtMs: 1, action, review: { status: "inProgress", riskLevel: null, userAuthorization: null, rationale: null }, ...extra });
const completed = (reviewId: string, targetItemId: string | null, review: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  native("item/autoApprovalReview/completed", { threadId: "th", turnId: "t1", reviewId, targetItemId, startedAtMs: 1, completedAtMs: 2, decisionSource: "agent", action, review, ...extra });
const command = (status: string): RawItem => ({ type: "commandExecution", id: "call-1", command: "echo x > /outside/x.txt", status, aggregatedOutput: null, exitCode: null });

// Order as the native sends it (mock-relay e2e, native r52h2): review started, guardianWarning,
// review completed, then the (declined) command item.
describe("automatic reviewer decisions", () => {
  it("puts a denial and its reason on the declined command row", () => {
    const tl = emptyTimeline();
    applyEvent(tl, native("turn/started", { turn: { id: "t1", status: "inProgress" } }));
    expect(applyEvent(tl, started("rv1", "call-1"))).toBe(true);
    // The warning repeats what the review shows: not a row of its own while the review runs.
    expect(applyEvent(tl, native("guardianWarning", { threadId: "th", message: "Automatic approval review denied (risk: high, authorization: low): MOCK-DENY" }))).toBe(false);
    applyEvent(tl, completed("rv1", "call-1", { status: "denied", riskLevel: "high", userAuthorization: "low", rationale: "  MOCK-DENY: not requested.  " }));
    applyEvent(tl, native("item/completed", { turnId: "t1", item: command("declined") }));
    const entries = orderedEntries(tl);
    expect(entries.map((e) => e.kind)).toEqual(["tool"]);
    const tool = entries[0]!;
    if (tool.kind !== "tool") throw new Error("tool row");
    expect(autoReviewOf(tool.item)).toMatchObject({ reviewId: "rv1", status: "denied", riskLevel: "high", rationale: "MOCK-DENY: not requested." });
    expect(isFailed(tool.item)).toBe(true);
  });

  it("updates a row already shown and keeps the review when the item is replaced", () => {
    const tl = emptyTimeline();
    applyEvent(tl, native("turn/started", { turn: { id: "t1", status: "inProgress" } }));
    applyEvent(tl, native("item/started", { turnId: "t1", item: command("inProgress") }));
    applyEvent(tl, started("rv1", "call-1"));
    let tool = tl.entries.get("call-1");
    expect(tool?.kind === "tool" && autoReviewOf(tool.item)?.status).toBe("inProgress");
    applyEvent(tl, completed("rv1", "call-1", { status: "approved", riskLevel: "low", userAuthorization: "unknown", rationale: "Low-risk allow." }));
    applyEvent(tl, native("item/completed", { turnId: "t1", item: { ...command("completed"), exitCode: 0 } }));
    tool = tl.entries.get("call-1");
    expect(tool?.kind === "tool" && autoReviewOf(tool.item)).toMatchObject({ status: "approved", riskLevel: "low" });
    expect(tool?.kind === "tool" && isFailed(tool.item)).toBe(false);
  });

  it("shows a review without a tool item (network) as a notice and keeps unexplained warnings", () => {
    const tl = emptyTimeline();
    applyEvent(tl, native("turn/started", { turn: { id: "t1", status: "inProgress" } }));
    const network = { type: "networkAccess", target: "https://example.invalid", host: "example.invalid", protocol: "https", port: 443 };
    applyEvent(tl, started("rv2", null, { action: network }));
    applyEvent(tl, completed("rv2", null, { status: "denied", riskLevel: "medium", userAuthorization: null, rationale: "Not needed." }, { action: network }));
    // No review running: a warning is a row of its own (once).
    expect(applyEvent(tl, native("guardianWarning", { threadId: "th", message: "Strict review required" }))).toBe(true);
    expect(applyEvent(tl, native("guardianWarning", { threadId: "th", message: "Strict review required" }))).toBe(false);
    const entries = orderedEntries(tl);
    expect(entries.map((e) => e.kind)).toEqual(["notice", "notice"]);
    expect(entries[0]).toMatchObject({ id: "autoReview:rv2", review: { status: "denied", action: { type: "networkAccess" } } });
    expect(entries[1]).toMatchObject({ text: "Strict review required" });
    // Notices sit between work groups like other standalone rows.
    expect(segmentEntries(entries).map((s) => s.kind)).toEqual(["entry", "entry"]);
  });

  it("ignores payloads without a review id or status", () => {
    const tl = emptyTimeline();
    applyEvent(tl, native("turn/started", { turn: { id: "t1", status: "inProgress" } }));
    expect(applyEvent(tl, native("item/autoApprovalReview/completed", { turnId: "t1", targetItemId: "x" }))).toBe(false);
    expect(applyEvent(tl, native("guardianWarning", { threadId: "th", message: " " }))).toBe(false);
    expect(orderedEntries(tl)).toEqual([]);
  });
});
