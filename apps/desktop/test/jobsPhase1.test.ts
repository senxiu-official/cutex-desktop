// Jobs page phase 1 (cutex r296, docs/development/r296-desktop-jobs-spec.md): r296 parameters only to a Job Service
// listing `activeList`, the active list and host totals, waiting delegations kept and never faked, list extras read
// tolerantly, NCI check words.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { jobActiveGroup, jobListExtras } from "../src/shared/jobList";
import { readComponentMaintenance } from "../src/shared/components";
import { jobOperations, jobStatus, mergeJobs } from "../src/renderer/src/lib/jobs";
import { nciCheckWords } from "../src/renderer/src/modules/jobs/NciCheckLine";
import type { JobRow } from "../src/shared/ipc";

const env = vi.hoisted(() => ({ jobs: vi.fn(), caps: vi.fn() }));
vi.mock("../src/renderer/src/bridge", () => ({
  bridge: { on: () => () => {} },
  api: { jobs: env.jobs, jobServiceCapabilities: env.caps, nciVerification: vi.fn() },
  apiFor: () => ({}),
}));
const { refreshAllJobs, refreshActiveJobs, startJobSync, useJobs } = await import("../src/renderer/src/lib/jobStore");

startJobSync({ getState: () => ({ features: new Set(["job-service"]), selectedId: null }) });
const row = (jobId: string, over: Partial<JobRow> = {}): JobRow => ({ jobId, actionId: "", sessionId: "eva", state: "running", createdAt: 1, updatedAt: 1, revision: 1, ...over });
const page = (data: JobRow[], extra: Record<string, unknown> = {}) => ({ ok: true, value: { data, nextCursor: null, ...extra } });

beforeEach(() => {
  useJobs.getState().reset();
  env.jobs.mockReset();
  env.caps.mockReset();
});

describe("r296 list reads", () => {
  it("a Job Service with activeList: waiters on the page read, then the active list; totals and the old running job are kept", async () => {
    env.caps.mockResolvedValue({ ok: true, value: { humanOperations: ["list", "activeList", "readOutputTail"] } });
    env.jobs.mockImplementation(async (p: { activeOnly?: boolean }) =>
      p.activeOnly
        ? page([row("old", { createdAt: 0, waitingDelegationIds: ["ask-run"] })], { activeCounts: { running: 7, queued: 2 }, waitersAvailable: true, nextCursor: "c2" })
        : page([row("new", { state: "exited", waitingDelegationIds: [] })], { activeCounts: { running: 7, queued: 2 }, waitersAvailable: true }));
    await refreshAllJobs();
    expect(env.jobs.mock.calls.map(([p]) => p)).toEqual([
      { query: "", cursor: null, limit: 50, includeWaiters: true },
      { query: "", cursor: null, limit: 50, activeOnly: true, includeWaiters: true },
    ]);
    const s = useJobs.getState();
    expect(s.activeCounts).toEqual({ running: 7, queued: 2 });
    expect(s.waitersAvailable).toBe(true);
    expect(s.activeIds).toEqual(["old"]);
    expect(s.activeCursor).toBe("c2");
    expect(s.byId.old?.waitingDelegationIds).toEqual(["ask-run"]);
    await refreshActiveJobs(true);
    expect(env.jobs.mock.calls.at(-1)![0]).toMatchObject({ cursor: "c2", activeOnly: true });
  });

  it("an older Job Service gets no r296 parameters and no active read; nothing is faked", async () => {
    env.caps.mockResolvedValue({ ok: true, value: { humanOperations: ["list", "cancel", "readOutput"] } });
    env.jobs.mockResolvedValue(page([row("a")]));
    await refreshAllJobs();
    expect(env.jobs.mock.calls.map(([p]) => p)).toEqual([{ query: "", cursor: null, limit: 50 }]);
    const s = useJobs.getState();
    expect([s.activeCounts, s.waitersAvailable, s.activeIds]).toEqual([null, null, null]);
    expect(s.byId.a?.waitingDelegationIds).toBeUndefined();
  });

  it("an unreadable waiting state is kept as false (never an empty list)", async () => {
    env.caps.mockResolvedValue({ ok: true, value: { humanOperations: ["activeList"] } });
    env.jobs.mockResolvedValue(page([row("a")], { waitersAvailable: false }));
    await refreshAllJobs();
    expect(useJobs.getState().waitersAvailable).toBe(false);
    expect(useJobs.getState().byId.a?.waitingDelegationIds).toBeUndefined();
  });
});

describe("pieces", () => {
  it("operations: activeList and readOutputTail", () => {
    expect(jobOperations({ humanOperations: ["activeList", "readOutputTail"] })).toMatchObject({ activeList: true, outputTail: true });
    expect(jobOperations({ humanOperations: ["list"] })).toMatchObject({ activeList: false, outputTail: false });
    expect(jobOperations(null)).toMatchObject({ activeList: false, outputTail: false });
  });
  it("a read without waiters keeps the last waiters of the same revision; a newer revision does not", () => {
    const base = mergeJobs({}, [row("a", { waitingDelegationIds: ["ask-1"] })]);
    expect(mergeJobs(base, [row("a")]).a?.waitingDelegationIds).toEqual(["ask-1"]);
    expect(mergeJobs(base, [row("a", { revision: 2 })]).a?.waitingDelegationIds).toBeUndefined();
    expect(mergeJobs(base, [row("a", { waitingDelegationIds: [] })]).a?.waitingDelegationIds).toEqual([]);
  });
  it("list extras: only well-formed fields", () => {
    expect(jobListExtras({ activeCounts: { running: 2, queued: 0 }, waitersAvailable: false, retention: { records: 10, limit: 1000 } })).toEqual({ activeCounts: { running: 2, queued: 0 }, waitersAvailable: false, retention: { records: 10, limit: 1000 } });
    expect(jobListExtras({ activeCounts: { running: -1, queued: 0 }, waitersAvailable: "yes", retention: { records: 1 } })).toEqual({});
    expect(jobListExtras(null)).toEqual({});
  });
  it("NCI words: last verified, next check (or none), errors and pending notices; nothing when not configured", () => {
    const now = 1_800_000_000_000;
    const base = { configured: true, enabled: true, host: "gadi.nci.org.au", pollIntervalSeconds: 21600, errorCode: null };
    expect(nciCheckWords({ ...base, configured: false }, now, "zh-CN")).toEqual([]);
    expect(nciCheckWords({ ...base, enabled: false }, now, "zh-CN").map((w) => w.key)).toEqual(["jobs.nci.off"]);
    expect(nciCheckWords({ ...base, lastVerifiedAt: now / 1000 - 600, nextCheckAt: now / 1000 + 1500, pendingDeliveries: 2, deliveryErrorCode: "x" }, now, "zh-CN").map((w) => w.key))
      .toEqual(["jobs.nci.lastVerified", "jobs.nci.nextCheck", "jobs.nci.pending", "jobs.nci.deliveryError"]);
    expect(nciCheckWords({ ...base, nextCheckAt: null, errorCode: "ssh_failed" }, now, "zh-CN").map((w) => w.key)).toEqual(["jobs.nci.neverVerified", "jobs.nci.noNextCheck", "jobs.nci.checkError"]);
    // An older host: no nextCheckAt field → no next-check words (never guessed from nextQueryAllowedAt).
    expect(nciCheckWords({ ...base, lastSuccessAt: now / 1000 - 60, nextQueryAllowedAt: now / 1000 + 60 }, now, "en").map((w) => w.key)).toEqual(["jobs.nci.lastVerified"]);
  });
  it("the backend's grouping: tabs and totals agree", () => {
    expect(["launch_pending", "running"].map((state) => jobActiveGroup({ state }))).toEqual(["running", "running"]);
    expect(["registered", "queued", "stale"].map((state) => jobActiveGroup({ state }))).toEqual(["queued", "queued", "queued"]);
    expect(jobActiveGroup({ state: "registered", launchPending: true })).toBe("running");
    expect(jobActiveGroup({ state: "unconfirmed", processAlive: true })).toBe("running");
    expect(["exited", "waiting_for_resources", "failed"].map((state) => jobActiveGroup({ state }))).toEqual([null, null, null]);
    // jobStatus follows it: a 结束跟进 job whose process is alive is in progress (word and open unchanged).
    const alive = jobStatus({ state: "unconfirmed", exitCode: null, terminalReason: "followUpEnded", processAlive: true });
    expect(alive).toMatchObject({ group: "active", key: "followUpEnded", open: false });
    expect(jobStatus({ state: "stale", exitCode: null }).group).toBe("queued");
    expect(jobStatus({ state: "exited", exitCode: 0 }).group).toBe("done");
  });
  it("component maintenance: read from detail, tolerant", () => {
    expect(readComponentMaintenance({ detail: { maintenance: { state: "handoffRequired", selectedVersion: "0.2.0", runningVersion: "0.1.9" } } })).toEqual({ state: "handoffRequired", selectedVersion: "0.2.0", runningVersion: "0.1.9" });
    expect(readComponentMaintenance({ detail: { maintenance: { state: "" } } })).toBeUndefined();
    expect(readComponentMaintenance({ detail: null })).toBeUndefined();
    expect(readComponentMaintenance({ detail: { maintenance: { state: "waiting", selectedVersion: 3 } } })).toEqual({ state: "waiting", selectedVersion: null, runningVersion: null });
  });
});
