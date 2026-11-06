// @vitest-environment jsdom
// A delegation whose handler ended its turn with delegation_await (Remote #37, 2026-11-06, cutex 4eddce22): execution
// running, hold waitingForEvent, no lease, no turn. It waits; it does not run, online or offline, requester or handler
// side. Shapes as GET /v2/asks returned them (src/asks/view.rs summary: `hold` as serialized, `await`, `jobs`).
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AskSummary } from "../src/shared/ipc";

vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string, vars?: Record<string, unknown>) => vars ? `${key}(${Object.values(vars).join(",")})` : key }) }));
vi.mock("../src/renderer/src/lib/delegationsView", () => ({ useStatusWord: () => (s: { key: string }) => `status:${s.key}` }));

const { agentDelegations, delegationBucket, delegationStatus, delegationWait, isDelegationRunning, isUnfinished } = await import("../src/renderer/src/lib/delegations");
const { DelegationStatusMark } = await import("../src/renderer/src/components/DelegationParts");

const JOB = "job_ce374c4941e4484dadb99b57ab9bbbcb";
const TIMEOUT = "2026-11-05T19:11:10.750Z";
const NOTE = "Do not resume or restart based on a timeout, failed-control-job event, or estimated scPolyA ETA. Await explicit chief-velocity release.";
const waiting = (over: Partial<AskSummary> = {}): AskSummary => ({
  askId: "ask-3129ba2605e34da1902c30f03f18a568", title: "Phase 2 on real phase-1 data (scVelo + BAMs ready)",
  requester: { kind: "agent", cutexSessionId: "cutex.velocity", name: "chief-velocity" }, target: "cutex.jasmine", targetName: "dev-jasmine",
  execution: "running", hold: { reason: "waitingForEvent", jobs: [JOB], until: "all", since: "2026-11-05T07:11:15.908Z", timeout_at: TIMEOUT },
  holdSince: "2026-11-05T07:11:15.908Z", review: null, closed: null, queuePosition: null, attempts: 7, answerId: null, openQuestions: 0, ownerQuestions: 0,
  createdAt: "2026-11-05T01:00:00.000Z", updatedAt: "2026-11-05T07:11:15.908Z", revision: 357,
  attempt: { n: 7, state: "yielded", turnId: "62e7108e-be8c-592b-a2bf-b1ee37a12e6e", startedAt: "2026-11-05T07:09:49.992Z", endedAt: "2026-11-05T07:11:15.908Z" },
  await: { attempt: 7, jobs: [JOB], until: "all", resume: "all", since: "2026-11-05T07:11:15.908Z", timeoutAt: TIMEOUT, note: NOTE },
  jobs: [{ jobId: JOB, source: "terminal", status: "running", exitCode: null, ok: null }],
  ...over,
});

describe("delegation_await: waiting, never running", () => {
  it("is 等待事件 with what it waits for, online and offline (the target coming online changes nothing)", () => {
    for (const ctx of [{ targetOffline: true }, { targetOffline: false }, {}]) {
      const status = delegationStatus(waiting(), ctx);
      expect(status).toMatchObject({ key: "waitingForEvent", tone: "muted", glyph: "hollow" });
      expect(status.wait).toEqual({ jobs: 1, timeoutAt: TIMEOUT, note: NOTE });
      expect(isDelegationRunning(waiting(), ctx)).toBe(false);
      expect(delegationBucket(waiting(), ctx)).toBe("waiting");
    }
    expect(isUnfinished(waiting())).toBe(true);
  });

  it("requester and handler side both list it, neither counts it as running", () => {
    const d = waiting();
    for (const viewer of ["cutex.velocity", "cutex.jasmine"]) {
      const r = agentDelegations({ [d.askId]: d }, viewer, 10, () => ({}));
      expect([...r.mine, ...r.toMe].map(x => x.askId)).toEqual([d.askId]);
      expect([...r.mine, ...r.toMe].filter(x => isDelegationRunning(x))).toHaveLength(0);
    }
  });

  it("the wait comes from `await`, else from the hold as cutex serializes it; finished jobs are not counted", () => {
    expect(delegationWait(waiting({ await: null, jobs: null }))).toEqual({ jobs: 1, timeoutAt: TIMEOUT, note: null });
    expect(delegationWait(waiting({ jobs: [{ jobId: JOB, status: "completed", ok: true }] })).jobs).toBe(0);
    expect(delegationWait(waiting({ await: { ...waiting().await!, timeoutAt: null }, hold: { reason: "waitingForEvent", jobs: [JOB] } })).timeoutAt).toBeNull();
    expect(delegationWait(waiting({ await: { ...waiting().await!, jobs: [] }, hold: { reason: "waitingForEvent" } })).jobs).toBeNull();
  });

  it("a running attempt without the hold is still 运行中; a question still wins", () => {
    expect(delegationStatus(waiting({ hold: null, await: null })).key).toBe("running");
    expect(delegationStatus(waiting({ hold: { reason: "waitingForInput" } })).key).toBe("question");
  });

  it("the handler's composer finds the ask it awaits on; not the requester's, not a running or closed one", async () => {
    const { awaitingDelegation } = await import("../src/renderer/src/lib/delegations");
    const older = waiting({ askId: "ask-older", updatedAt: "2026-11-05T06:00:00.000Z" });
    const byId = { [older.askId]: older, [waiting().askId]: waiting(), run: waiting({ askId: "run", hold: null, updatedAt: "2026-11-05T09:00:00.000Z" }), shut: waiting({ askId: "shut", closed: "completed", updatedAt: "2026-11-05T09:00:00.000Z" }) };
    expect(awaitingDelegation(byId, "cutex.jasmine")?.askId).toBe(waiting().askId);
    expect(awaitingDelegation(byId, "cutex.velocity")).toBeNull();
    expect(awaitingDelegation({ run: byId.run }, "cutex.jasmine")).toBeNull();
  });

  it("the status mark shows the wait instead of the old attempt's run time, the note on hover", () => {
    const status = delegationStatus(waiting(), {});
    // Callers that still pass a time (the attempt's 86 s) are overridden.
    const html = renderToStaticMarkup(h(DelegationStatusMark, { status, name: "dev-jasmine", trailing: "1m" }));
    expect(html).toContain("status:waitingForEvent");
    expect(html).toContain("delegation.wait.job");
    expect(html).toMatch(/delegation\.wait\.until\(\d\d-\d\d \d\d:\d\d\)|delegation\.wait\.until\(\d\d:\d\d\)/);
    expect(html).not.toContain("1m");
    expect(html).toContain("delegation.wait.hint");
    expect(html).toContain("Await explicit chief-velocity release.");
    const none = renderToStaticMarkup(h(DelegationStatusMark, { status: { ...status, wait: { jobs: null, timeoutAt: null, note: null } }, name: "x", trailing: "1m" }));
    expect(none).not.toContain("1m");
    expect(none).not.toContain("·");
  });
});
