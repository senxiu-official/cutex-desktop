// 工作流 review fixes (2026-10-15): auto-expand once per waiting run, a 404 stops a run's polling while
// a transient error keeps its detail, the badge loads the focus host's list.
import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ workflowRun: vi.fn() }));
vi.mock("../src/renderer/src/bridge", () => ({ bridge: undefined, api: {} }));
vi.mock("../src/renderer/src/modules/app", () => ({ services: { daemonFor: () => ({ workflowRun: env.workflowRun }) } }));
vi.mock("../src/renderer/src/store", () => ({ useApp: Object.assign(vi.fn(), { getState: () => ({}) }), featuresOf: () => new Set() }));
const { autoExpandWaiting } = await import("../src/renderer/src/modules/workflows/model");
const { detailKey, isRunGone, loadRun, useWorkflowCache } = await import("../src/renderer/src/modules/workflows/store");

beforeEach(() => {
  useWorkflowCache.setState({ lists: {}, details: {}, gone: {} });
  env.workflowRun.mockReset();
});

describe("workflows page", () => {
  it("opens each waiting run once; a collapsed one stays collapsed on later polls", () => {
    const first = autoExpandWaiting(["a", "b"], new Set());
    expect(first.open).toEqual(["a", "b"]);
    const again = autoExpandWaiting(["a", "b"], first.seen);
    expect(again.open).toEqual([]);
    expect(autoExpandWaiting(["a", "c"], first.seen).open).toEqual(["c"]);
  });
});

describe("workflow run detail cache", () => {
  it("recognises cutex's 404 run_not_found (also through IPC) but not other errors", () => {
    expect(isRunGone(new Error("run_not_found: no workflow run wf-1"))).toBe(true);
    expect(isRunGone(new Error("Error invoking remote method 'workflowRun': Error: run_not_found: no workflow run"))).toBe(true);
    expect(isRunGone({ code: "workflow_run_not_found" })).toBe(true);
    expect(isRunGone(new Error("cutex management API unreachable at http://127.0.0.1:24270"))).toBe(false);
  });

  it("keeps the detail on a transient error, drops it and marks it gone on 404", async () => {
    const key = detailKey("h", "wf-1");
    env.workflowRun.mockResolvedValueOnce({ runId: "wf-1", state: "running" });
    await loadRun("h", "wf-1");
    expect(useWorkflowCache.getState().details[key]).toBeTruthy();
    env.workflowRun.mockRejectedValueOnce(new Error("timeout"));
    await loadRun("h", "wf-1");
    expect(useWorkflowCache.getState().details[key]).toBeTruthy();
    expect(useWorkflowCache.getState().gone[key]).toBeUndefined();
    env.workflowRun.mockRejectedValueOnce(new Error("run_not_found: no workflow run wf-1"));
    await loadRun("h", "wf-1");
    expect(useWorkflowCache.getState().details[key]).toBeUndefined();
    expect(useWorkflowCache.getState().gone[key]).toBe(true);
  });
});
