// State surfaces D1 (owner-approved wording 2026-11-17, .claude/agent-artifacts/state-surfaces-wording-proposal.md):
// delegation statuses without 受阻 (waiting vs needsAction), stop settlement (ask-stop-settlement-v1), 结束跟进, the
// per-run words, and N10 (Next Up registry v2.0): a delegation result a stop does not hold.
import { describe, expect, it } from "vitest";
import type { AskSummary } from "../src/shared/ipc";
import { attemptStateKey, delegationActions, delegationBucket, delegationStatus, followUpActionId, peerStateKey } from "../src/renderer/src/lib/delegations";
import { answerStartsAfterStop, heldKeys, perItemAdmission } from "../src/renderer/src/lib/stopHold";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";
import { en } from "../src/renderer/src/i18n/en";

const ask = (over: Partial<AskSummary> = {}): AskSummary =>
  ({ askId: "ask-1", title: "t", target: "cutex.t", requester: { kind: "owner" }, execution: "running", revision: 1, attempts: 1, createdAt: "2026-11-17T00:00:00Z", updatedAt: "2026-11-17T00:00:00Z", attempt: { n: 1, state: "running", startedAt: "2026-11-17T00:00:00Z" }, ...over }) as AskSummary;

describe("W6a: no 受阻 — will it clear by itself?", () => {
  it("holds that clear by themselves read 等待继续, with the reason as the hover", () => {
    for (const hold of [{ reason: "profileSwitchPending" }, { reason: "heldByRuntime", native: "busy" }] as const) {
      const s = delegationStatus(ask({ execution: "queued", hold: hold as never }));
      expect(s.key).toBe("waiting");
      expect(s.hint?.key).toMatch(/^delegation\.statusHint\./);
    }
  });
  it("holds that need the owner read 需要你处理 and count in 需要你", () => {
    for (const hold of [{ reason: "runtimeUnsupported" }, { reason: "waitingForApproval" }, { reason: "blocked", by: "login" }, { reason: "blocked", by: "budget" }, { reason: "heldByRuntime", native: "unsupported" }, { reason: "somethingNew" }] as const) {
      const d = ask({ execution: "queued", hold: hold as never });
      expect(delegationStatus(d).key).toBe("needsAction");
      expect(delegationBucket(d)).toBe("needsYou");
    }
    expect(delegationStatus(ask({ execution: "queued", hold: { reason: "blocked", by: "quota" } })).key).toBe("quota");
    expect(delegationStatus(ask({ execution: "queued", hold: { reason: "blocked", by: "runtimeDown" } })).key).toBe("offline");
  });
  it("peer wire words map onto the new keys; 受阻 is gone from the catalogs", () => {
    expect(peerStateKey("heldByRuntime")).toBe("waiting");
    expect(peerStateKey("runtimeUnsupported")).toBe("needsAction");
    expect(peerStateKey("blocked")).toBe("needsAction");
    expect("delegation.status.blocked" in zhCN).toBe(false);
    expect(zhCN["delegation.status.waiting"]).toBe("等待继续");
    expect(zhCN["delegation.status.needsAction"]).toBe("需要你处理");
    expect(en["delegation.status.needsAction"]).toBe("Needs your action");
    // 受阻 is retired for delegations (the goal feature keeps its own state word).
    expect(Object.entries(zhCN).filter(([k, v]) => k.startsWith("delegation.") && v.includes("受阻"))).toEqual([]);
  });
  it("W6b/W6c: admitted reads 已接收 (owner 2026-11-25); a yielded attempt waits, with its stage note as the condition", () => {
    expect(zhCN["delegation.status.starting"]).toBe("已接收");
    const yielded = delegationStatus(ask({ attempt: { n: 2, state: "yielded", stageNote: "等 CI 跑完" } as never }));
    expect(yielded).toMatchObject({ key: "waiting", hint: { key: "delegation.statusHint.yieldedNote", vars: { condition: "等 CI 跑完" } } });
    expect(delegationStatus(ask()).key).toBe("running");
  });
});

describe("stop settlement (W8, N4, N5) and 结束跟进 (N1–N3)", () => {
  const stopping = (attempt: Record<string, unknown> = {}) => ask({ attempt: { n: 3, state: "running", stopRequested: true, ...attempt } as never });
  it("a stop request reads 已请求停止 with its deadline on hover; past the deadline 停止未确认", () => {
    expect(delegationStatus(stopping({ stopDeadline: "2026-11-17T00:10:00Z" }))).toMatchObject({ key: "stopping", hint: { key: "delegation.statusHint.stopping", at: { time: "2026-11-17T00:10:00Z" } } });
    expect(delegationStatus(stopping({ stopDeadline: "2026-11-17T00:10:00Z", stopUnconfirmed: true }))).toMatchObject({ key: "stopUnconfirmed", tone: "warn", hint: { key: "delegation.statusHint.stopUnconfirmed" } });
    expect(zhCN["delegation.status.stopping"]).toBe("已请求停止");
    expect(zhCN["delegation.status.stopUnconfirmed"]).toBe("停止未确认");
    expect(en["delegation.status.stopping"]).toBe("Stop requested");
  });
  it("结束跟进 is offered where nothing else ends the wait: stop requested / unconfirmed, accepted not started, unknown", () => {
    expect(delegationActions(stopping()).endFollowUp).toBe(true);
    expect(delegationActions(stopping({ stopUnconfirmed: true })).endFollowUp).toBe(true);
    expect(delegationActions(ask({ execution: "admitted", attempt: null })).endFollowUp).toBe(true);
    expect(delegationActions(ask({ execution: "somethingNew" as never })).endFollowUp).toBe(true);
    expect(delegationActions(ask()).endFollowUp).toBe(false);
    expect(delegationActions(ask({ execution: "queued" })).endFollowUp).toBe(false);
    expect(delegationActions(ask({ closed: "stopped", execution: "interrupted" })).endFollowUp).toBe(false);
    // A cross-host mirror: its handler is on the other host.
    expect(delegationActions({ ...stopping(), remote: { peerId: "p", label: "remote" } as never }).endFollowUp).toBe(false);
  });
  it("after 结束跟进: 已结束跟进 · 结果未确认, finished", () => {
    const ended = ask({ execution: "interrupted", closed: "stopped", followUpEnded: true });
    expect(delegationStatus(ended).key).toBe("followUpEnded");
    expect(delegationBucket(ended)).toBe("done");
    expect(zhCN["delegation.status.followUpEnded"]).toBe("已结束跟进 · 结果未确认");
    expect(zhCN["followUp.end"]).toBe("结束跟进");
    expect(zhCN["followUp.confirm"]).toBe("不再等待这件事的结果。不会停止或撤回已经发送的操作；结果记为「未确认」，以后迟到的结果也不会让它重新出现。");
  });
  it("one action id per delegation attempt (a repeated click replays, never a second disposal)", () => {
    expect(followUpActionId({ askId: "ask-9", attempts: 4, attempt: { n: 3 } })).toBe("followup-ask-9-3");
    expect(followUpActionId({ askId: "ask-9", attempts: 4, attempt: null })).toBe("followup-ask-9-4");
  });
  it("W7: who stopped it and why are separate", () => {
    // The record does not say who stopped it (cross-review P2-6): never the requester's name, never 你.
    expect(delegationStatus(ask({ execution: "interrupted", attempt: { n: 1, state: "interrupted", interruptReason: "stopped" } as never }))).toMatchObject({ key: "stopped" });
    const byAria = delegationStatus(ask({ execution: "interrupted", requester: { kind: "agent", cutexSessionId: "cutex.a", name: "Aria" }, attempt: { n: 1, state: "interrupted", interruptReason: "stopped" } as never }));
    expect(byAria.key).toBe("stopped");
    expect(JSON.stringify(byAria)).not.toContain("Aria");
    // ownerStopped: 已停止, with its known cause as the hover line.
    expect(delegationStatus(ask({ execution: "interrupted", attempt: { n: 1, state: "interrupted", interruptReason: "ownerStopped" } as never }))).toMatchObject({ key: "stopped", hint: { key: "delegation.statusHint.ownerStopped" } });
    expect("delegation.status.stoppedByYou" in zhCN).toBe(false);
    expect(zhCN["delegation.status.runtimeRestart"]).toBe("已中断 · 主机重启");
  });
  it("an unknown execution reads 状态无法识别 and keeps the raw value", () => {
    expect(delegationStatus(ask({ execution: "somethingNew" as never }))).toMatchObject({ key: "unknown", hint: { vars: { raw: "somethingNew" } } });
  });
});

describe("per-run words (4.2, W10)", () => {
  it("answered is 已有结果 in the run table; unknown states keep their raw value", () => {
    expect(attemptStateKey("answered")).toBe("answered");
    expect(attemptStateKey("yielded")).toBe("yielded");
    expect(attemptStateKey("brandNew")).toBe("unknown");
    // Closed (stopped / 结束跟进) while the record still says the run is going: unconfirmed, never 运行中.
    expect(attemptStateKey("running", true)).toBe("unconfirmed");
    expect(attemptStateKey("answered", true)).toBe("answered");
    expect(zhCN["delegation.attempt.unconfirmed"]).toBe("结果未确认");
    expect(zhCN["delegation.attempt.answered"]).toBe("已有结果");
    expect(zhCN["delegation.attempt.yielded"]).toBe("本回合已结束，等待继续");
    expect(zhCN["delegation.status.answered"]).toBe("已完成");
  });
});

describe("W1: quota words promise nothing without a schedule", () => {
  it("no schedule: 额度用完; a schedule: 预计 … 尝试继续; an estimate: 重置时间未知，预计 … 检查", () => {
    expect(zhCN["delegation.status.quota"]).toBe("额度用完");
    expect(zhCN["delegation.status.quotaAt"]).toBe("额度用完 · 预计 {at} 尝试继续");
    expect(zhCN["delegation.status.quotaEstimated"]).toBe("额度用完 · 重置时间未知，预计 {at} 检查");
  });
});

describe("N10 (Next Up registry v2.0): a delegation result is not held by a stop", () => {
  const answer = { id: "a", deliveryKind: "answer", enqueuedAt: "", eligible: true, held: null } as const;
  it("an eligible answer under a stop says it starts a new turn; questions keep their hold", () => {
    expect(answerStartsAfterStop(answer, { ridealongsHeld: "ownerStop" })).toBe(true);
    expect(answerStartsAfterStop(answer, { ridealongsHeld: null })).toBe(false);
    expect(answerStartsAfterStop({ ...answer, deliveryKind: "question", eligible: false, held: "ownerStop" }, { ridealongsHeld: "ownerStop" })).toBe(false);
    expect(answerStartsAfterStop({ id: "b", deliveryKind: "answer", enqueuedAt: "" } as never, { ridealongsHeld: "ownerStop" })).toBe(false);
  });
  it("the stop-held group's hover follows the host: per-item hosts explain that results are not held", () => {
    expect(perItemAdmission([answer])).toBe(true);
    expect(perItemAdmission([{}])).toBe(false);
    expect(heldKeys("ownerStop", true).hint).toBe("queue.turn.afterStopHint");
    expect(heldKeys("ownerStop").hint).toBe("queue.turn.heldStopHint");
    expect(zhCN["queue.turn.afterStop"]).toBe("中断后，收到委托结果会开始新回合");
    expect(zhCN["agentPause.resumeButton"]).toBe("继续这个{{agent}}");
    expect(zhCN["asksPause.resumeShort"]).toBe("放行新委托");
  });
});
