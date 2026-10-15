import { describe, expect, it } from "vitest";
import type { JobRow } from "../src/shared/ipc";
import { agentJobs, jobOperations, jobSeconds, jobStatus, jobsWorthShowing, jobTitle, mergeJobs, shortJobId, sortJobs } from "../src/renderer/src/lib/jobs";
import { agentDelegations } from "../src/renderer/src/lib/delegations";

const row = (jobId: string, state: string, createdAt: number, extra: Partial<JobRow> = {}): JobRow => ({ jobId, actionId: `a-${jobId}`, sessionId: "eva", state, createdAt, updatedAt: createdAt, revision: 1, ...extra });

describe("jobs", () => {
  it("maps Job Service states through one table; unknown states stay in progress with their raw name", () => {
    expect(jobStatus({ state: "launch_pending" })).toMatchObject({ group: "active", key: "starting" });
    expect(jobStatus({ state: "running" })).toMatchObject({ group: "active", key: "running" });
    expect(jobStatus({ state: "exited", exitCode: 0 })).toMatchObject({ group: "done", key: "succeeded" });
    expect(jobStatus({ state: "exited", exitCode: 2 })).toMatchObject({ group: "done", key: "exitCode", exitCode: 2, tone: "danger" });
    expect(jobStatus({ state: "interrupted" })).toMatchObject({ group: "done", key: "interrupted" });
    expect(jobStatus({ state: "launch_unknown" })).toMatchObject({ group: "done", key: "unknown" });
    expect(jobStatus({ state: "waiting_for_resources" })).toMatchObject({ group: "queued" });
    expect(jobStatus({ state: "teleporting" })).toMatchObject({ group: "active", key: "other", raw: "teleporting" });
  });

  it("titles, ids and times", () => {
    expect(jobTitle({ jobId: "job_1", actionId: "build", command: "cargo build" })).toBe("cargo build");
    expect(jobTitle({ jobId: "job_1", actionId: "build", command: null })).toBe("build");
    expect(jobTitle({ jobId: "job_1", actionId: "" })).toBe("job_1");
    expect(shortJobId("job_1deb0000a7c94e2b")).toBe("job_1deb…");
    expect(jobSeconds(row("j", "running", 100), 160)).toBe(60);
    expect(jobSeconds(row("j", "exited", 100, { updatedAt: 130, exitCode: 0 }), 999)).toBe(30);
  });

  it("splits an agent's jobs: unfinished newest first, finished capped by end time", () => {
    const byId = Object.fromEntries(
      [
        row("r1", "running", 10),
        row("r2", "launch_pending", 20),
        row("d1", "exited", 1, { updatedAt: 50, exitCode: 0 }),
        row("d2", "failed", 2, { updatedAt: 40 }),
        row("d3", "cancelled", 3, { updatedAt: 60 }),
        row("x", "running", 5, { sessionId: "other" }),
      ].map((j) => [j.jobId, j]),
    );
    const a = agentJobs(byId, "eva", 2);
    expect(a.open.map((j) => j.jobId)).toEqual(["r2", "r1"]);
    expect(a.finished.map((j) => j.jobId)).toEqual(["d3", "d1"]);
    expect(a.finishedTotal).toBe(3);
    expect(jobsWorthShowing(a, 70)).toBe(true);
    expect(jobsWorthShowing({ open: [], finished: a.finished, finishedTotal: 3 }, 60 + 3600)).toBe(false);
    expect(sortJobs(Object.values(byId))[0]?.jobId).toBe("d3");
  });

  it("merges by revision and reads the Job Service's human operations", () => {
    const old = { j: row("j", "running", 1, { revision: 3 }) };
    expect(mergeJobs(old, [row("j", "running", 1, { revision: 2 })]).j?.revision).toBe(3);
    expect(mergeJobs(old, [row("j", "cancelled", 1, { revision: 4 })]).j?.state).toBe("cancelled");
    expect(jobOperations(null)).toEqual({ cancel: false, output: false, markExternal: false });
    expect(jobOperations({ humanOperations: ["list", "cancel", "readOutput"] })).toEqual({ cancel: true, output: true, markExternal: false });
  });
});

describe("agentDelegations", () => {
  it("returns the recent finished ones newest first", () => {
    const base = { requester: { kind: "agent", cutexSessionId: "lead" }, target: "helper", title: "t", revision: 1 };
    const byId = {
      a: { ...base, askId: "a", execution: "answered", closed: "accepted", closedAt: "2026-10-08T01:00:00Z", createdAt: "2026-10-08T00:00:00Z" },
      b: { ...base, askId: "b", execution: "answered", closed: "accepted", closedAt: "2026-10-08T03:00:00Z", createdAt: "2026-10-08T00:00:00Z" },
      c: { ...base, askId: "c", execution: "running", createdAt: "2026-10-08T00:00:00Z" },
    } as never;
    const r = agentDelegations(byId, "lead");
    expect(r.mine.map((d) => d.askId)).toEqual(["c"]);
    expect(r.done.map((d) => d.askId)).toEqual(["b", "a"]);
    expect(r.finished).toBe(2);
  });
});
