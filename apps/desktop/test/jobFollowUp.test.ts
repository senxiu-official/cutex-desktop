// @vitest-environment jsdom
// State surfaces WP-D4 (fix plan S7): 结束跟进 on jobs — table 4.6 states, the Job Service call's outcomes, and the
// local durable mark on an older Job Service.
import { beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({ jobCloseFollowUp: vi.fn() }));
vi.mock("../src/renderer/src/bridge", () => ({ api: bridge, apiFor: () => bridge, bridge: { on: () => () => {} } }));
vi.mock("../src/renderer/src/lib/jobStore", () => ({ refreshAgentJobs: vi.fn(), refreshAllJobs: vi.fn(), refreshHostJobs: vi.fn(), useJobs: { getState: () => ({ allIds: null }) } }));

import { canEndJobFollowUp, isJobFinished, jobStatus, jobStatusTipKey } from "../src/renderer/src/lib/jobs";
import { isJobLocallyEnded, MAX_LOCAL_MARKS, reloadLocalJobMarks, setLocalJobMarks, withMark } from "../src/renderer/src/lib/jobLocalMarks";
import { endJobFollowUp, JOB_FOLLOW_UP_REASON, jobFollowUpOutcome } from "../src/renderer/src/lib/jobFollowUp";

beforeEach(() => {
  setLocalJobMarks({});
  bridge.jobCloseFollowUp.mockReset();
});

describe("job states (table 4.6)", () => {
  it("offers 结束跟进 on every non-terminal state and an unrecognized one, never on a final one", () => {
    for (const state of ["launch_pending", "running", "queued", "waiting_for_resources", "registered"]) expect(canEndJobFollowUp({ state, exitCode: null })).toBe(true);
    expect(canEndJobFollowUp({ state: "running", exitCode: null, observedProcessState: { state: "exited", observedAtEpochMillis: 1 } })).toBe(true);
    expect(canEndJobFollowUp({ state: "frozen_by_admin", exitCode: null })).toBe(true);
    for (const state of ["exited", "failed", "cancelled", "interrupted", "launch_unknown", "unconfirmed"]) expect(canEndJobFollowUp({ state, exitCode: 0 })).toBe(false);
  });

  it("an unrecognized wire state reads 结果未确认 and is not counted in progress", () => {
    const s = jobStatus({ state: "frozen_by_admin", exitCode: null });
    expect(s).toMatchObject({ key: "unconfirmed", group: "done", unrecognized: true, raw: "frozen_by_admin" });
    expect(jobStatusTipKey(s)).toBe("jobs.status.unrecognized.tip");
  });

  it("the Job Service's followUpEnded reads 已结束跟进; a plain unconfirmed reads 结果未确认", () => {
    expect(jobStatus({ state: "unconfirmed", exitCode: null, terminalReason: "followUpEnded" })).toMatchObject({ key: "followUpEnded", group: "done", open: false });
    expect(jobStatus({ state: "unconfirmed", exitCode: null, followUpEnded: true })).toMatchObject({ key: "followUpEnded" });
    expect(jobStatus({ state: "unconfirmed", exitCode: null })).toMatchObject({ key: "unconfirmed", group: "done" });
    expect(jobStatusTipKey(jobStatus({ state: "unconfirmed", exitCode: null, terminalReason: "followUpEnded" }))).toBe("jobs.status.followUpEnded.tip");
    expect(jobStatusTipKey(jobStatus({ state: "running", exitCode: null }))).toBeNull();
  });
});

describe("local mark (older Job Service)", () => {
  it("moves the job out of in progress as 结果未确认 (this device only), survives a restart, and a real final state wins", async () => {
    const job = { jobId: "job_a", revision: 3, sessionId: "eva", state: "running", exitCode: null };
    expect(await endJobFollowUp(job, false)).toEqual({ kind: "local" });
    expect(bridge.jobCloseFollowUp).not.toHaveBeenCalled();
    expect(jobStatus(job)).toMatchObject({ key: "localEnded", group: "done", open: false });
    expect(isJobFinished(job)).toBe(true);
    expect(jobStatusTipKey(jobStatus(job))).toBe("jobs.status.localEnded.tip");
    reloadLocalJobMarks();
    expect(isJobLocallyEnded("job_a")).toBe(true);
    expect(jobStatus({ ...job, state: "exited", exitCode: 0 })).toMatchObject({ key: "succeeded" });
  });

  it("is bounded: the oldest marks go first", () => {
    let marks = {};
    for (let i = 0; i < MAX_LOCAL_MARKS + 5; i++) marks = withMark(marks, `job_${i}`, i);
    expect(Object.keys(marks)).toHaveLength(MAX_LOCAL_MARKS);
    expect("job_0" in marks).toBe(false);
    expect(`job_${MAX_LOCAL_MARKS + 4}` in marks).toBe(true);
  });
});

describe("Job Service call", () => {
  it("sends the job's revision and a reason; maps refusals", async () => {
    bridge.jobCloseFollowUp.mockResolvedValue({ ok: true, value: {} });
    expect(await endJobFollowUp({ jobId: "job_b", revision: 7, sessionId: "eva" }, true)).toEqual({ kind: "ended" });
    expect(bridge.jobCloseFollowUp).toHaveBeenCalledWith("job_b", 7, JOB_FOLLOW_UP_REASON);
    expect(isJobLocallyEnded("job_b")).toBe(false);
    expect(jobFollowUpOutcome({ ok: false, code: "idempotency_conflict", message: "" })).toEqual({ kind: "conflict" });
    expect(jobFollowUpOutcome({ ok: false, code: "action_id_conflict", message: "" })).toEqual({ kind: "conflict" });
    expect(jobFollowUpOutcome({ ok: false, code: "job_conflict", message: "revision" })).toEqual({ kind: "changed", message: "revision" });
    expect(jobFollowUpOutcome({ ok: false, code: "job_service_unavailable", message: "down" })).toEqual({ kind: "failed", message: "down" });
    bridge.jobCloseFollowUp.mockRejectedValue(new Error("socket closed"));
    expect(await endJobFollowUp({ jobId: "job_c", revision: 1, sessionId: "eva" }, true)).toEqual({ kind: "failed", message: "socket closed" });
  });
});
