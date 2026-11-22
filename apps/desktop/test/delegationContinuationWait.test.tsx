// @vitest-environment jsdom
// r290 P14 yielded wait (cutex fix/r290-p14-yielded-deliver, contract docs/r290-p14-yielded-deliver.md): the handler
// ended its turn and continues the delegation later. Owner 2026-11-18: such a delegation read 运行中. It reads
// 等待中 · 约{时间}继续 (Director-approved), never a run time; hosts without `continuationWait` keep today's words.
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AskSummary, ContinuationWait } from "../src/shared/ipc";

vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string, vars?: Record<string, unknown>) => vars ? `${key}(${Object.values(vars).join(",")})` : key }) }));
vi.mock("../src/renderer/src/lib/delegationsView", () => ({ useStatusWord: () => (s: { key: string }) => `status:${s.key}` }));

const { agentDelegations, applyAskEvent, awaitingDelegation, continuationWaitOf, delegationBucket, delegationStatus, isDelegationRunning, isUnfinished, openContinuationWait, summaryFromRecord } = await import("../src/renderer/src/lib/delegations");
const { continuationTrailing } = await import("../src/renderer/src/lib/continuationWait");
const { DelegationStatusMark } = await import("../src/renderer/src/components/DelegationParts");
const { DelegationAwaitLine } = await import("../src/renderer/src/components/DelegationComposer");
const zh = (await import("../src/renderer/src/lib/continuationWaitMessages")).zhCN;
const en = (await import("../src/renderer/src/lib/continuationWaitMessages")).en;

const NOW = Date.parse("2026-11-18T05:00:00.000Z");
const wait = (over: Partial<ContinuationWait> = {}): ContinuationWait => ({ state: "waiting", kind: "after", since: "2026-11-18T04:50:00.000Z", nextWakeAt: new Date(NOW + 25 * 60_000).toISOString(), ...over });
const row = (over: Partial<AskSummary> = {}): AskSummary => ({
  askId: "ask-675f7c", title: "Nightly then review", requester: { kind: "agent", cutexSessionId: "cutex.lead", name: "Lead" }, target: "cutex.helper", targetName: "Helper",
  execution: "running", hold: null, review: null, closed: null, queuePosition: null, attempts: 3, answerId: null, openQuestions: 0, ownerQuestions: 0,
  createdAt: "2026-11-18T04:00:00.000Z", updatedAt: "2026-11-18T04:50:00.000Z", revision: 12,
  attempt: { n: 3, state: "yielded", turnId: "t3", startedAt: "2026-11-18T04:45:00.000Z", endedAt: "2026-11-18T04:50:00.000Z" },
  continuationWait: wait(),
  ...over,
});

describe("yielded wait: 等待中, never 运行中", () => {
  it("a timed wait is 等待中 with when it continues, online or offline, in the waiting bucket", () => {
    for (const ctx of [{}, { targetOffline: true }, { targetOffline: false }]) {
      const s = delegationStatus(row(), ctx);
      expect(s).toMatchObject({ key: "continuationWait", tone: "muted", glyph: "hollow" });
      expect(s.cont).toEqual(wait());
      expect(isDelegationRunning(row(), ctx)).toBe(false);
      expect(delegationBucket(row(), ctx)).toBe("waiting");
    }
    expect(isUnfinished(row())).toBe(true);
  });

  it("ready and limited have their own words; limited warns; every kind waits", () => {
    expect(delegationStatus(row({ continuationWait: wait({ state: "ready", nextWakeAt: null }) }))).toMatchObject({ key: "continuationReady", tone: "muted" });
    expect(delegationStatus(row({ continuationWait: wait({ state: "limited", nextWakeAt: null }) }))).toMatchObject({ key: "continuationLimited", tone: "warn" });
    for (const kind of ["children", "jobs"]) expect(delegationStatus(row({ continuationWait: wait({ kind, nextWakeAt: null }) })).key).toBe("continuationWait");
    // An unknown future state still reads as a wait, not 运行中.
    expect(delegationStatus(row({ continuationWait: wait({ state: "parked" }) })).key).toBe("continuationWait");
  });

  it("also for a record queued / admitted while it waits", () => {
    for (const execution of ["queued", "admitted"] as const) expect(delegationStatus(row({ execution, attempt: null })).key).toBe("continuationWait");
  });

  it("older hosts (no field) and null keep today's status", () => {
    // Without the field a yielded attempt reads state surfaces' plain 等待中 (W6c), a live turn 运行中.
    const { continuationWait: _, ...old } = row();
    expect(delegationStatus(old as AskSummary).key).toBe("waiting");
    const live = { ...old, attempt: { ...old.attempt!, state: "running", endedAt: null } } as AskSummary;
    expect(delegationStatus(live).key).toBe("running");
    expect(isDelegationRunning(live)).toBe(true);
    expect(delegationStatus(row({ continuationWait: null })).key).toBe("waiting");
    expect(delegationStatus({ ...live, continuationWait: null }).key).toBe("running");
    expect(delegationStatus(row({ continuationWait: null }), { targetOffline: true }).key).toBe("offline");
    expect(delegationStatus(row({ continuationWait: null, hold: { reason: "waitingForEvent" } })).key).toBe("waitingForEvent");
  });

  // Merge with state surfaces (W6a): a queued / admitted hold that reads 需要你处理 is not hidden behind 等待继续.
  it("a hold that needs the owner wins over the wait; a hold that clears by itself does not", () => {
    for (const hold of [{ reason: "blocked", by: "login" }, { reason: "waitingForApproval" }, { reason: "runtimeUnsupported" }, { reason: "somethingNew" }] as AskSummary["hold"][]) {
      const d = row({ execution: "queued", attempt: null, hold, continuationWait: wait({ state: "ready", nextWakeAt: null }) });
      expect(delegationStatus(d).key).toBe("needsAction");
      expect(delegationBucket(d)).toBe("needsYou");
    }
    const busy = row({ execution: "queued", attempt: null, hold: { reason: "targetBusy" }, continuationWait: wait({ state: "ready", nextWakeAt: null }) });
    expect(delegationStatus(busy).key).toBe("continuationReady");
    expect(delegationBucket(busy)).toBe("waiting");
  });

  // Re-review of a5c80f36a (gate-owner-pause-review, P2): cutex keeps a resume-pending continuation `running` (yielded
  // attempt) while its admission is blocked; the hold must win there too, on every surface.
  it("REVIEW: a running yielded continuation blocked for login needs the owner on every surface", () => {
    for (const hold of [{ reason: "blocked", by: "login" }, { reason: "blocked", by: "budget" }, { reason: "waitingForApproval" }] as AskSummary["hold"][]) {
      const d = row({ execution: "running", hold, continuationWait: wait({ state: "ready", nextWakeAt: null }) });
      const actual = { status: delegationStatus(d).key, bucket: delegationBucket(d), wait: !!openContinuationWait(d), composer: !!awaitingDelegation({ [d.askId]: d }, d.target) };
      expect(actual).toEqual({ status: "needsAction", bucket: "needsYou", wait: false, composer: false });
    }
    // A hold that clears by itself, a job await, and the same record without the field keep their behaviour.
    const busy = row({ execution: "running", hold: { reason: "targetBusy" }, continuationWait: wait({ state: "ready", nextWakeAt: null }) });
    expect(delegationStatus(busy).key).toBe("continuationReady");
    expect(awaitingDelegation({ [busy.askId]: busy }, busy.target)).not.toBeNull();
    expect(delegationStatus(row({ execution: "running", hold: { reason: "waitingForEvent" }, continuationWait: wait({ kind: "jobs", nextWakeAt: null }) })).key).toBe("continuationWait");
    expect(delegationStatus(row({ execution: "running", hold: { reason: "blocked", by: "login" }, continuationWait: null })).key).toBe("waiting");
  });

  it("a question, a stop, a close and a finished execution win over a stale wait", () => {
    expect(delegationStatus(row({ hold: { reason: "waitingForInput" } })).key).toBe("question");
    expect(delegationStatus(row({ attempt: { ...row().attempt!, stopRequested: true } })).key).toBe("stopping");
    expect(delegationStatus(row({ closed: "completed" })).key).toBe("ended");
    expect(delegationStatus(row({ execution: "answered" })).key).toBe("answered");
    expect(delegationStatus(row({ execution: "failed" })).key).toBe("failed");
  });

  it("requester and handler both list it; neither counts it as running", () => {
    const d = row();
    for (const viewer of ["cutex.lead", "cutex.helper"]) {
      const r = agentDelegations({ [d.askId]: d }, viewer, 10, () => ({}));
      expect([...r.mine, ...r.toMe].map(x => x.askId)).toEqual([d.askId]);
      expect([...r.mine, ...r.toMe].filter(x => isDelegationRunning(x))).toHaveLength(0);
    }
  });

  it("the handler's composer finds it (not the requester's, not a closed one)", () => {
    const d = row();
    expect(awaitingDelegation({ [d.askId]: d }, "cutex.helper")?.askId).toBe(d.askId);
    expect(awaitingDelegation({ [d.askId]: d }, "cutex.lead")).toBeNull();
    expect(awaitingDelegation({ x: row({ askId: "x", closed: "completed" }) }, "cutex.helper")).toBeNull();
    expect(awaitingDelegation({ x: row({ askId: "x", continuationWait: null }) }, "cutex.helper")).toBeNull();
  });
});

describe("the words after 等待中", () => {
  it("within the hour: 约 N 分钟后继续; later: the local clock; due: 即将继续", () => {
    expect(continuationTrailing(wait(), NOW)).toEqual({ key: "delegation.cont.inMinutes", n: 25 });
    expect(continuationTrailing(wait({ nextWakeAt: new Date(NOW + 30_000).toISOString() }), NOW)).toEqual({ key: "delegation.cont.inMinutes", n: 1 });
    const later = NOW + 3 * 3600_000;
    const d = new Date(later), pad = (n: number) => String(n).padStart(2, "0");
    const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const r = continuationTrailing(wait({ nextWakeAt: new Date(later).toISOString() }), NOW);
    expect(r?.key).toBe("delegation.cont.at");
    expect((r as { time: string }).time.endsWith(clock)).toBe(true);
    expect(continuationTrailing(wait({ nextWakeAt: new Date(NOW - 5000).toISOString() }), NOW)).toEqual({ key: "delegation.cont.soon" });
  });

  it("children / jobs say what it waits for; no time, ready and limited add nothing", () => {
    expect(continuationTrailing(wait({ kind: "children", nextWakeAt: null }), NOW)).toEqual({ key: "delegation.cont.children" });
    expect(continuationTrailing(wait({ kind: "jobs", nextWakeAt: null }), NOW)).toEqual({ key: "delegation.cont.jobs" });
    expect(continuationTrailing(wait({ nextWakeAt: null }), NOW)).toBeNull();
    expect(continuationTrailing(wait({ state: "ready" }), NOW)).toBeNull();
    expect(continuationTrailing(wait({ state: "limited" }), NOW)).toBeNull();
  });

  it("the approved label reads 等待中 · 约{时间}继续", () => {
    expect(zh["delegation.status.continuationWait"]).toBe("等待中");
    expect(zh["delegation.cont.at"]).toBe("约 {time} 继续");
    expect(zh["delegation.cont.inMinutes"]).toBe("约 {n} 分钟后继续");
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
  });

  it("the status mark shows the wait in place of the ended attempt's time, the reason and exact time on hover", () => {
    const s = delegationStatus(row({ continuationWait: wait({ nextWakeAt: new Date(Date.now() + 10 * 60_000 + 5000).toISOString() }) }));
    const html = renderToStaticMarkup(h(DelegationStatusMark, { status: s, name: "Helper", trailing: "5m" }));
    expect(html).toContain("status:continuationWait");
    expect(html).toMatch(/delegation\.cont\.inMinutes\((10|11)\)/);
    expect(html).toContain("delegation.cont.hintAfter");
    expect(html).toMatch(/delegation\.cont\.wakeAt\(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\)/);
    expect(html).not.toContain("5m");
    const kids = renderToStaticMarkup(h(DelegationStatusMark, { status: delegationStatus(row({ continuationWait: wait({ kind: "children", nextWakeAt: null }) })), name: "Helper", trailing: "5m" }));
    expect(kids).toContain("delegation.cont.children");
    expect(kids).toContain("delegation.cont.hintChildren");
    const limited = renderToStaticMarkup(h(DelegationStatusMark, { status: delegationStatus(row({ continuationWait: wait({ state: "limited", nextWakeAt: null }) })), name: "Helper", trailing: "5m" }));
    expect(limited).toContain("status:continuationLimited");
    expect(limited).toContain("delegation.cont.hintLimited");
    expect(limited).not.toContain("5m");
  });
});

describe("wire", () => {
  it("parses the list / detail field; absent stays absent (older hosts), junk is null", () => {
    const base = { askId: "ask-1", execution: "running", revision: 3 };
    expect(summaryFromRecord({ ...base, continuationWait: { state: "waiting", kind: "after", since: "2026-11-18T04:50:00Z", nextWakeAt: "2026-11-18T05:25:00Z" } })?.continuationWait)
      .toEqual({ state: "waiting", kind: "after", since: "2026-11-18T04:50:00Z", nextWakeAt: "2026-11-18T05:25:00Z" });
    expect(summaryFromRecord(base)).not.toHaveProperty("continuationWait");
    expect(summaryFromRecord({ ...base, continuationWait: null })?.continuationWait).toBeNull();
    expect(continuationWaitOf({ kind: "after" })).toBeNull();
    expect(continuationWaitOf("waiting")).toBeNull();
    expect(continuationWaitOf({ state: "ready", kind: "jobs" })).toEqual({ state: "ready", kind: "jobs", since: null, nextWakeAt: null });
  });

  it("stateChanged carries the wait; without the field the row keeps it", () => {
    const records = { byId: { "ask-675f7c": row() }, progress: {}, questions: {} };
    const cleared = applyAskEvent(records, "cutex/ask/stateChanged", { askId: "ask-675f7c", execution: "running", hold: null, review: null, revision: 13, continuationWait: null });
    expect(cleared?.byId?.["ask-675f7c"]?.continuationWait).toBeNull();
    const kept = applyAskEvent(records, "cutex/ask/stateChanged", { askId: "ask-675f7c", execution: "running", hold: null, review: null, revision: 13 });
    expect(kept?.byId?.["ask-675f7c"]?.continuationWait).toEqual(wait());
  });
});

// Review of 78589a918 (gate-owner-pause-review, two P2s).
describe("REVIEW: legacy job-await facts and stop precedence", () => {
  const LIMIT = new Date(Date.now() + 5 * 60_000).toISOString();
  const jobAwait = (over: Partial<AskSummary> = {}) => row({
    hold: { reason: "waitingForEvent", jobs: ["job1"] }, await: { attempt: 3, jobs: ["job1"], until: "all", resume: "all", since: "2026-11-18T04:50:00.000Z", timeoutAt: LIMIT, note: "legacy timeout note" },
    continuationWait: wait({ kind: "jobs", nextWakeAt: null }), ...over,
  });

  it("P2-1: a P14 jobs wait keeps the job await's 最晚 HH:MM, its note and exact time (status mark)", () => {
    const status = delegationStatus(jobAwait());
    expect(status.key).toBe("continuationWait");
    const html = renderToStaticMarkup(h(DelegationStatusMark, { status, name: "Helper" }));
    expect(html).toContain("delegation.cont.jobs");
    expect(html).toMatch(/delegation\.wait\.until\((\d\d-\d\d )?\d\d:\d\d\)/);
    expect(html).toContain("legacy timeout note");
    expect(html).toMatch(/delegation\.wait\.until\(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\)/);
  });

  it("P2-1: the handler's composer line keeps them too", () => {
    const html = renderToStaticMarkup(h(DelegationAwaitLine, { d: jobAwait(), draft: false }));
    expect(html).toContain("delegation.status.continuationWait");
    expect(html).toContain("delegation.cont.jobs");
    expect(html).toMatch(/delegation\.wait\.until\((\d\d-\d\d )?\d\d:\d\d\)/);
    expect(html).toContain("legacy timeout note");
  });

  it("P2-2: a pending stop or abandon wins on every path: status, bucket, composer selector", async () => {
    const { openContinuationWait } = await import("../src/renderer/src/lib/delegations");
    const stopping = row({ attempt: { ...row().attempt!, stopRequested: true } });
    expect(delegationStatus(stopping).key).toBe("stopping");
    expect(openContinuationWait(stopping)).toBeNull();
    expect(awaitingDelegation({ [stopping.askId]: stopping }, stopping.target)).toBeNull();
    // Also through the delegation_await fallback.
    const stoppingAwait = jobAwait({ attempt: { ...row().attempt!, stopRequested: true } });
    expect(awaitingDelegation({ [stoppingAwait.askId]: stoppingAwait }, stoppingAwait.target)).toBeNull();
    const abandoning = row({ review: "abandoned" });
    expect(openContinuationWait(abandoning)).toBeNull();
    expect(awaitingDelegation({ [abandoning.askId]: abandoning }, abandoning.target)).toBeNull();
    // A plain job await (no stop) is still found.
    expect(awaitingDelegation({ [jobAwait().askId]: jobAwait() }, "cutex.helper")?.askId).toBe("ask-675f7c");
  });
});
