import { describe, expect, it } from "vitest";
import { directorRotationBody, nextSuccessorName, rotationCancellable, rotationProgress, rotationWaiting } from "../src/shared/directorRotation";
import type { DirectorRotationState } from "../src/shared/ipc";

const base = { requestId: "desktop-1", projectId: "demo", expectedDirectorCutexSessionId: "cutex.eva", expectedAuthorityEpoch: 3, predecessor: "member" };

describe("nextSuccessorName (cutex next_successor_name)", () => {
  it("counts -rN up and appends -r2 otherwise", () => {
    expect(nextSuccessorName("Eva")).toBe("Eva-r2");
    expect(nextSuccessorName("demo-director-r2")).toBe("demo-director-r3");
    expect(nextSuccessorName("eva-r9")).toBe("eva-r10");
    expect(nextSuccessorName("-r3")).toBe("-r3-r2");
    expect(nextSuccessorName("eva-r1234567")).toBe("eva-r1234567-r2");
  });
});

describe("directorRotationBody", () => {
  it("keeps a well-formed request and drops empty successor fields", () => {
    const body = directorRotationBody({ ...base, handoffTimeoutSecs: 600, successor: { name: " Eva-r2 ", profile: "", model: "  ", cwd: "D:\\work" } });
    expect(body).toEqual({ ...base, handoffTimeoutSecs: 600, successor: { name: "Eva-r2", cwd: "D:\\work" } });
    expect(directorRotationBody({ ...base, predecessor: "archive" }).successor).toEqual({});
  });

  it("refuses malformed input", () => {
    expect(() => directorRotationBody({ ...base, requestId: "" })).toThrow("bad rotation request");
    expect(() => directorRotationBody({ ...base, expectedAuthorityEpoch: 0 })).toThrow("bad authority epoch");
    expect(() => directorRotationBody({ ...base, predecessor: "delete" })).toThrow("bad predecessor disposition");
    expect(() => directorRotationBody({ ...base, handoffTimeoutSecs: 30 })).toThrow("bad handoff timeout");
    expect(() => directorRotationBody({ ...base, handoffTimeoutSecs: 86_401 })).toThrow("bad handoff timeout");
    expect(() => directorRotationBody(null)).toThrow();
    // control characters never reach cutex
    expect(directorRotationBody({ ...base, successor: { name: "Eva\nr2" } }).successor).toEqual({});
  });
});

const rotation = (state: DirectorRotationState, history: DirectorRotationState[] = [], skipped = false) => ({ state, history: history.map((s) => ({ state: s })), handoff: { skipped }, successorCreateStartedAt: null });

describe("rotationProgress", () => {
  it("walks the steps in order", () => {
    expect(rotationProgress(rotation("handoff_requested"))).toEqual({ handoff: "current", successor: "pending", rebind: "pending", dispose: "pending", start: "pending" });
    expect(rotationProgress(rotation("handoff_written"))).toMatchObject({ handoff: "done", successor: "current" });
    expect(rotationProgress(rotation("authority_rebound"))).toMatchObject({ rebind: "done", dispose: "current", start: "pending" });
    expect(Object.values(rotationProgress(rotation("done")))).toEqual(["done", "done", "done", "done", "done"]);
  });

  it("waits for the owner after a timeout and moves on once skipped", () => {
    expect(rotationProgress(rotation("timeout"))).toMatchObject({ handoff: "waiting", successor: "pending" });
    expect(rotationProgress(rotation("timeout", [], true))).toMatchObject({ handoff: "done", successor: "current" });
  });

  it("marks where a failure stopped; a cancel leaves the rest pending", () => {
    const failed = rotationProgress(rotation("failed", ["requested", "handoff_requested", "handoff_written", "successor_created", "failed"]));
    expect(failed).toEqual({ handoff: "done", successor: "done", rebind: "failed", dispose: "pending", start: "pending" });
    const cancelled = rotationProgress(rotation("cancelled", ["requested", "handoff_requested", "cancelled"]));
    expect(Object.values(cancelled)).toEqual(["pending", "pending", "pending", "pending", "pending"]);
  });

  it("cancel and continue follow cutex", () => {
    expect(rotationCancellable(rotation("timeout"))).toBe(true);
    expect(rotationCancellable({ state: "timeout", successorCreateStartedAt: "2026-10-10T00:00:00Z" })).toBe(false);
    expect(rotationCancellable(rotation("successor_created"))).toBe(false);
    expect(rotationWaiting(rotation("handoff_requested"))).toBe(true);
    expect(rotationWaiting(rotation("handoff_written"))).toBe(false);
  });
});
