// Registry 2.1 (docs/design/next-up-registry.md §三之二; Cutex maintainers 2026-11-18): a delegation row in 接下来
// shows only the registered yielded-wait words. Every combination the backend can send (state × kind × time) must
// land on a registered form; 续接已达上限 stays off 接下来 (shown there as 等待中) and on cards / lists.
import { describe, expect, it } from "vitest";
import type { AskSummary, ContinuationWait } from "../src/shared/ipc";
import { delegationStatus } from "../src/renderer/src/lib/delegations";
import { NEXT_UP_DELEGATION_WAITS, NEXT_UP_DELEGATION_WAITS_APPROVAL } from "../src/renderer/src/lib/inputLedger/nextUpRegistry";
import { delegationWaitForm, nextUpDelegationStatus, registeredWaitForm } from "../src/renderer/src/lib/nextUpDelegation";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";
import { en } from "../src/renderer/src/i18n/en";

const NOW = Date.parse("2026-11-18T05:00:00.000Z");
const at = (min: number | null) => (min === null ? null : new Date(NOW + min * 60_000).toISOString());
const row = (continuationWait: ContinuationWait | null, over: Partial<AskSummary> = {}): AskSummary => ({
  askId: "ask-1", title: "t", requester: { kind: "owner" }, target: "cutex.h", execution: "running", hold: null, review: null, closed: null, queuePosition: null,
  attempts: 1, answerId: null, openQuestions: 0, ownerQuestions: 0, createdAt: "2026-11-18T04:00:00.000Z", updatedAt: "2026-11-18T04:00:00.000Z", revision: 3, attempt: null,
  continuationWait, ...over,
});
const nextUpForm = (w: ContinuationWait | null, over: Partial<AskSummary> = {}) => {
  const s = nextUpDelegationStatus(delegationStatus(row(w, over)));
  return delegationWaitForm(s, NOW);
};

describe("接下来 delegation rows: registered wait words only", () => {
  it("every state × kind × time lands on a registered form", () => {
    const seen = new Set<string>();
    for (const state of ["waiting", "ready", "limited", "somethingNew"])
      for (const kind of ["after", "children", "jobs", "somethingNew"])
        for (const wake of [null, -1, 25, 180, 60 * 30])
          for (const execution of ["running", "admitted", "queued"] as const) {
            const form = nextUpForm({ state, kind, since: at(-10), nextWakeAt: at(wake) }, { execution });
            expect(form, `${state}/${kind}/${wake}/${execution}`).not.toBeNull();
            const id = registeredWaitForm(form!);
            expect(id, `${state}/${kind}/${wake}/${execution} → ${JSON.stringify(form)}`).not.toBeNull();
            seen.add(id!);
          }
    // Every registered form is reachable.
    expect([...seen].sort()).toEqual(Object.keys(NEXT_UP_DELEGATION_WAITS).sort());
  });

  it("续接已达上限 is not a 接下来 form: there it reads 等待中, elsewhere it keeps its own word", () => {
    const limited: ContinuationWait = { state: "limited", kind: "after", since: at(-10), nextWakeAt: null };
    expect(delegationStatus(row(limited)).key).toBe("continuationLimited");
    expect(registeredWaitForm({ status: "delegation.status.continuationLimited", trailing: null })).toBeNull();
    expect(registeredWaitForm(nextUpForm(limited)!)).toBe("plain");
    // Its hover still explains the limit (the wait keeps its own state).
    expect(nextUpDelegationStatus(delegationStatus(row(limited))).cont?.state).toBe("limited");
  });

  it("a pending question, a stop, a close and a finished delegation still win over a stale wait", () => {
    const w: ContinuationWait = { state: "waiting", kind: "after", since: at(-10), nextWakeAt: at(25) };
    expect(nextUpForm(w, { hold: { reason: "waitingForInput" } })).toBeNull();
    expect(nextUpForm(w, { attempt: { n: 1, state: "running", stopRequested: true } })).toBeNull();
    expect(nextUpForm(w, { closed: "completed" })).toBeNull();
    expect(nextUpForm(w, { execution: "answered" })).toBeNull();
  });

  it("the registered texts are what the catalogs say", () => {
    for (const [id, def] of Object.entries(NEXT_UP_DELEGATION_WAITS)) {
      const word = { zh: zhCN[def.status as keyof typeof zhCN], en: en[def.status as keyof typeof en] };
      if (def.trailing === null) {
        expect([word.zh, word.en], id).toEqual([def.text.zh, def.text.en]);
        continue;
      }
      for (const key of def.trailing) {
        const tail = { zh: zhCN[key as keyof typeof zhCN], en: en[key as keyof typeof en] };
        if (id === "timed") {
          // 约{时间}继续: 「约 N 分钟后继续」 within the hour, 「约 14:15 继续」 later.
          expect(word.zh).toBe("等待中");
          expect(tail.zh).toMatch(/^约 .+继续$/);
          expect(tail.en).toMatch(/^continues /);
        } else {
          expect(`${word.zh} · ${tail.zh}`, id).toBe(def.text.zh);
          expect(`${word.en} · ${tail.en}`, id).toBe(def.text.en);
        }
      }
    }
  });

  it("carries its approval record", () => {
    expect(NEXT_UP_DELEGATION_WAITS_APPROVAL).toEqual({ by: "Cutex maintainers", date: "2026-11-18", why: expect.stringContaining("运行中") });
  });
});
