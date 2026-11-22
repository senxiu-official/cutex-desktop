// @vitest-environment jsdom
// State surfaces WP-D5 (fix plan S9, L2, L3, W9; wording N6–N9): the cleanup page's 结束跟进 on stuck messages, the
// live-only withdraw words, persisted closed failed rows, and the legacy "delivered" label.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StuckBusMessage } from "../src/shared/ipc";
import { discardOutcome, discardWords, KNOWN_ERRORS, stuckHints } from "../src/renderer/src/modules/agent-bus/stuck";
import { endedOn, endFollowUpKey, endFollowUpOutcome, endFollowUpRequest, endMessageFollowUp, MESSAGE_END_FOLLOW_UP_FEATURE, MESSAGE_FOLLOW_UP_REASON, useEndFollowUps } from "../src/renderer/src/modules/agent-bus/endFollowUp";
import { zhCN as busZh } from "../src/renderer/src/modules/agent-bus/i18n";
import { en as busEn } from "../src/renderer/src/modules/agent-bus/i18n.en";
import { zhCN as followZh } from "../src/renderer/src/lib/followUpMessages";
import { loadDismissed, MAX_DISMISSED, useAgentMessages, withDismissed } from "../src/renderer/src/lib/agentMessageStore";
import { setKeyFocus } from "../src/renderer/src/lib/hostKeys";
import { applyMessageEvent } from "../src/renderer/src/lib/legacyDelivery/agentMessages";

const msg = (over: Partial<StuckBusMessage> = {}): StuckBusMessage =>
  ({
    messageId: "m1", state: "pending", durable: true, to: { id: "cutex.bob", name: "Bob" }, from: { id: "cutex.alice", name: "Alice" }, ageSecs: 7300, createdAtEpochSecs: 1000,
    senderKind: "cutex", protectedControl: false, nativeSubmissionPresent: false, semanticSha256: "ab".repeat(32), errorCode: null, errorMessage: null, reasons: [], contentPreview: "hello", ...over,
  }) as StuckBusMessage;

beforeEach(() => {
  useEndFollowUps.setState({ entries: {} });
  localStorage.clear();
});

describe("结束跟进 on a stuck message (S9, N8)", () => {
  it("sends the message id, a fresh action id, the reason and the digest; ends as 已结束跟进", async () => {
    const api = { messageEndFollowUp: vi.fn().mockResolvedValue({ ok: true, result: { messageId: "m1", changed: true, settlement: {} } }) };
    expect(await endMessageFollowUp(api, "local", msg(), () => "act-1")).toEqual({ kind: "ended" });
    expect(api.messageEndFollowUp).toHaveBeenCalledWith({ messageId: "m1", actionId: "act-1", reason: MESSAGE_FOLLOW_UP_REASON, expectedSemanticSha256: "ab".repeat(32) });
    expect(useEndFollowUps.getState().entries[endFollowUpKey("local", "m1")]).toMatchObject({ phase: "ended", preview: "hello" });
    expect(endedOn(useEndFollowUps.getState().entries, "local")).toEqual([{ messageId: "m1", preview: "hello" }]);
    expect(endedOn(useEndFollowUps.getState().entries, "remote")).toEqual([]);
    // Ended: not sent again.
    expect(await endMessageFollowUp(api, "local", msg(), () => "act-2")).toBeNull();
    expect(api.messageEndFollowUp).toHaveBeenCalledOnce();
  });

  it("an uncertain answer keeps its action id: clicking again replays the same request", async () => {
    const api = { messageEndFollowUp: vi.fn().mockRejectedValueOnce(new Error("socket closed")).mockResolvedValue({ ok: true, result: { messageId: "m1", changed: false, settlement: {} } }) };
    expect(await endMessageFollowUp(api, "local", msg(), () => "act-1")).toBeNull();
    expect(useEndFollowUps.getState().entries[endFollowUpKey("local", "m1")]).toMatchObject({ phase: "uncertain", actionId: "act-1" });
    await endMessageFollowUp(api, "local", msg(), () => "act-2");
    expect(api.messageEndFollowUp.mock.calls.map((c) => c[0].actionId)).toEqual(["act-1", "act-1"]);
  });

  it("maps refusals: action conflict, older host, gone, other", () => {
    const refuse = (code: string) => endFollowUpOutcome({ ok: false, error: { code, message: code } } as never);
    expect(refuse("action_id_conflict")).toEqual({ kind: "conflict" });
    expect(refuse("idempotency_conflict")).toEqual({ kind: "conflict" });
    expect(refuse("owner_disposition_unsupported")).toEqual({ kind: "unsupported" });
    expect(refuse("message_not_found")).toEqual({ kind: "gone" });
    expect(refuse("device_scope_denied")).toEqual({ kind: "failed", message: "device_scope_denied" });
    expect(endFollowUpRequest(msg({ semanticSha256: null }), "a")).not.toHaveProperty("expectedSemanticSha256");
    expect(MESSAGE_END_FOLLOW_UP_FEATURE).toBe("agent-bus-owner-end-followup-v1");
  });

  it("uses the approved words for the two buttons and the refusals (N6–N8)", () => {
    expect(busZh["agent-bus.settlement.closeConfirmed"]).toBe("确认已结束并关闭");
    // Next Up rows keep their own words (frozen registry).
    expect(busZh["agent-bus.settlement.close"]).toBe("关闭卡住消息");
    expect(busEn["agent-bus.settlement.closeConfirmed"]).toBe("Close (confirmed ended)");
    expect(followZh["followUp.end"]).toBe("结束跟进");
    expect(followZh["followUp.endedMessage"]).toBe("已结束跟进 · 送达未确认");
    expect(busZh["agent-bus.settlement.runtimeGone"]).toBe("{{agent}}已不在（已归档或删除），无法核对。可以结束跟进。");
    expect(busEn["agent-bus.settlement.runtimeGone"]).toBe("The {{agent}} is gone (archived or deleted), so this can't be checked. You can end follow-up.");
    expect(busZh["agent-bus.stuck.error.live_discard_capacity"]).toBe("没有撤下：主机记不下更多已撤下的消息，这条仍在队列里。");
    expect(busEn["agent-bus.stuck.error.live_discard_capacity"]).toBe("Not withdrawn: the host can't record any more withdrawn messages, so this one is still queued.");
  });
});

describe("live-only withdraw (L2, N7, N9)", () => {
  it("a live-only message says 从队列撤下, with （可能被再次排入） on a host without tombstones; a durable one keeps 丢弃", () => {
    expect(discardWords(msg({ durable: false }), true)).toMatchObject({ label: "agent-bus.stuck.withdraw", tip: "agent-bus.stuck.withdrawTip" });
    expect(discardWords(msg({ durable: false }), false)).toMatchObject({ label: "agent-bus.stuck.withdrawMayRequeue", tip: "agent-bus.stuck.withdrawMayRequeueTip" });
    expect(discardWords(msg(), true)).toEqual({ label: "agent-bus.stuck.discard", armed: "agent-bus.stuck.discardArmed" });
    expect(discardWords(msg({ protectedControl: true }), false).armed).toBe("agent-bus.cleanup.discardProtectedArmed");
    expect(busZh["agent-bus.stuck.withdraw"]).toBe("从队列撤下");
    expect(busZh["agent-bus.stuck.withdrawMayRequeue"]).toBe("从队列撤下（可能被再次排入）");
    expect(busEn["agent-bus.stuck.withdraw"]).toBe("Withdraw from queue");
    expect(busEn["agent-bus.stuck.withdrawMayRequeue"]).toBe("Withdraw from queue (may be queued again)");
  });
  it("the memory-only hint follows the host; live_discard_capacity is a worded refusal", () => {
    expect(stuckHints(msg({ durable: false }), true)).toEqual([{ key: "memoryOnlyTombstone" }]);
    expect(stuckHints(msg({ durable: false }))).toEqual([{ key: "memoryOnly" }]);
    expect(KNOWN_ERRORS).toContain("live_discard_capacity");
    expect(discardOutcome({ ok: false, error: { code: "live_discard_capacity", message: "full" } } as never)).toEqual({ kind: "failed", code: "live_discard_capacity", message: "full" });
  });
});

describe("closed failed rows persist per host (L3)", () => {
  it("survive a reset (restart) and stay per host, bounded", () => {
    setKeyFocus("local");
    useAgentMessages.getState().reset();
    useAgentMessages.getState().dismiss("m-fail");
    useAgentMessages.getState().reset();
    expect(useAgentMessages.getState().dismissed.has("m-fail")).toBe(true);
    setKeyFocus("remote");
    expect(useAgentMessages.getState().dismissed.has("m-fail")).toBe(false);
    useAgentMessages.getState().dismiss("m-r");
    expect([...loadDismissed("remote")]).toEqual(["m-r"]);
    setKeyFocus("local");
    expect([...useAgentMessages.getState().dismissed]).toEqual(["m-fail"]);
    let all: Record<string, string[]> = {};
    for (let i = 0; i < MAX_DISMISSED + 3; i++) all = withDismissed(all, "h", `m${i}`);
    expect(all.h).toHaveLength(MAX_DISMISSED);
    expect(all.h![0]).toBe("m3");
  });
});

describe("legacy delivered means read (W9)", () => {
  it("a legacy delivered message is 已读入 / Read, never Next Up's 已送达", async () => {
    const map = applyMessageEvent({}, "cutex/agentBus/messageDelivered", { messageId: "m1", fromCutexSessionId: "a", toCutexSessionId: "b", turnId: "t" }, 1);
    expect(map.m1!.state).toBe("delivered");
    const zh = (await import("../src/renderer/src/i18n/zh-CN")).zhCN as Record<string, string>;
    const en = (await import("../src/renderer/src/i18n/en")).en as Record<string, string>;
    expect(zh["agentMsg.state.delivered"]).toBe("已读入");
    expect(en["agentMsg.state.delivered"]).toBe("Read");
    expect(zh["agentMsg.state.delivered"]).not.toContain("已送达");
    expect(zh["agentMsg.state.delivered"]).not.toBe(zh["nextUp.state.awaitingRead"]);
  });
});
