// safety-grant-delivery: how a 批准一次 reaches the agent (the approval notice, read at a tool boundary) and how
// long it stays valid (hard cap before the read, read + 30 min after) — the pure part.
import { describe, expect, it } from "vitest";
import type { InputRecord, OwnerNotification, SafetyBlock } from "@cutex-desktop/protocol";
import { blockOfNotice, grantNoticeOf, grantNoticeRowOf } from "../src/renderer/src/lib/safetyGrantNotice";
import { asSafetyBlock } from "../src/shared/ownerNotify";
import { en } from "../src/renderer/src/i18n/en";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";

const HARD = "2026-11-10T09:00:00.000Z";
const READ_EXPIRES = "2026-11-10T07:40:00.000Z";
const granted = (over: Partial<SafetyBlock> = {}) => ({ state: "granted" as const, expiresAt: HARD, noticeInputId: "alarm-approval-1", noticeReadAt: null, hardExpiresAt: HARD, ...over });
const ledger = (state: InputRecord["state"], over: Partial<InputRecord> = {}) => ({ state, evidence: null, ...over }) as Pick<InputRecord, "state" | "evidence">;

describe("grant notice status", () => {
  it("an older cutex (no noticeInputId) keeps the old wording", () => {
    expect(grantNoticeOf({ state: "granted", expiresAt: HARD })).toBeNull();
    expect(grantNoticeOf(granted({ noticeInputId: null }))).toBeNull();
    expect(grantNoticeRowOf(null, ledger("waiting"))).toBeNull();
  });

  it("before the read: waiting, valid until the hard cap", () => {
    expect(grantNoticeOf(granted())).toEqual({ kind: "waiting", until: HARD });
    // Registered / offered at a tool gap: still waiting (offers never start the window).
    for (const stage of ["registered", "offered"] as const) expect(grantNoticeOf(granted(), ledger("accepted", { stage } as Partial<InputRecord>))).toEqual({ kind: "waiting", until: HARD });
    // In context but without evidence is not a read.
    expect(grantNoticeOf(granted(), ledger("inContext"))).toEqual({ kind: "waiting", until: HARD });
    // No hard cap sent: expiresAt (which is the cap before the read).
    expect(grantNoticeOf(granted({ hardExpiresAt: null }))).toEqual({ kind: "waiting", until: HARD });
  });

  it("once read (noticeReadAt, or the ledger record in context with evidence): delivered, until expiresAt", () => {
    expect(grantNoticeOf(granted({ noticeReadAt: "2026-11-10T07:10:00.000Z", expiresAt: READ_EXPIRES }))).toEqual({ kind: "read", until: READ_EXPIRES });
    expect(grantNoticeOf(granted({ expiresAt: READ_EXPIRES }), ledger("inContext", { evidence: "externalInputPersisted" }))).toEqual({ kind: "read", until: READ_EXPIRES });
  });

  it("other block states keep their own lines", () => {
    for (const state of ["blocked", "used", "expired", "dismissed"] as const) expect(grantNoticeOf(granted({ state }))).toBeNull();
  });

  it("the 接下来 row keeps its own status when the notice did not get through", () => {
    for (const state of ["received", "waiting", "sending", "accepted"] as const) expect(grantNoticeRowOf(granted(), ledger(state))?.kind).toBe("waiting");
    for (const state of ["failed", "uncertain", "rejected", "discarded", "superseded", "held"] as const) expect(grantNoticeRowOf(granted(), ledger(state))).toBeNull();
    expect(grantNoticeRowOf(granted(), ledger("inContext", { evidence: "contextPersisted" }))?.kind).toBe("read");
  });

  it("finds the block of a notice record by noticeInputId and agent", () => {
    const note = (id: string, agentId: string, noticeInputId?: string) => ({ notificationId: id, agentId, safetyBlock: { blockId: id, noticeInputId } }) as unknown as OwnerNotification;
    const byId = { a: note("a", "eva", "alarm-approval-1"), b: note("b", "mika", "alarm-approval-2"), c: note("c", "eva") };
    expect(blockOfNotice(byId, "eva", "alarm-approval-1")?.blockId).toBe("a");
    expect(blockOfNotice(byId, "eva", "alarm-approval-2")).toBeNull();
    expect(blockOfNotice(byId, "mika", "alarm-approval-2")?.blockId).toBe("b");
  });
});

describe("the notice fields from cutex", () => {
  const raw = { blockId: "sb", threadId: "t", command: "rm -rf x", toolName: "Bash", state: "granted", expiresAt: HARD };
  it("pass through when cutex sends them, and stay absent on an older cutex", () => {
    expect(asSafetyBlock({ ...raw, noticeInputId: "alarm-approval-1", noticeReadAt: null, hardExpiresAt: HARD })).toMatchObject({ noticeInputId: "alarm-approval-1", noticeReadAt: null, hardExpiresAt: HARD });
    const old = asSafetyBlock(raw)!;
    expect("noticeInputId" in old || "hardExpiresAt" in old || "noticeReadAt" in old).toBe(false);
  });

  it("ships the words in both locales", () => {
    for (const c of [zhCN, en] as Record<string, string>[]) {
      expect(c["safetyBlock.notice.waiting"]).toBeTruthy();
      expect(c["safetyBlock.notice.cap"]).toContain("{time}");
      expect(c["safetyBlock.notice.read"]).toContain("{time}");
      expect(c["safetyBlock.notice.waitingHint"]).toContain("{minutes}");
      expect(c["safetyBlock.notice.readHint"]).toContain("{time}");
    }
    expect(zhCN["safetyBlock.notice.waiting"]).toBe("已批准一次，等待当前工具返回后送达");
    expect(zhCN["safetyBlock.notice.cap"]).toBe("最晚 {time} 前有效");
    expect(zhCN["safetyBlock.notice.read"]).toBe("已送达 · 有效至 {time}");
  });
});
