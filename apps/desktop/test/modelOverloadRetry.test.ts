import { describe, expect, it, vi } from "vitest";
import type { AutoRetryWait } from "@cutex-desktop/protocol";
import { MODEL_OVERLOAD_RETRY_VISIBLE_FEATURE, formatAutoRetryWait, modelOverloadRetryOf, validatedAutoRetryWait } from "../src/renderer/src/lib/modelOverloadRetry";

const wait: AutoRetryWait = { attempt: 1, maxAttempts: 3, scheduledAt: "2026-10-29T01:00:00Z", turnId: "turn", planId: "plan", phase: "pending", holdsAdmission: true };
const features = new Set([MODEL_OVERLOAD_RETRY_VISIBLE_FEATURE]);
const runtime = { status: "online", runtimeGeneration: 4 };

describe("server overload retry presence", () => {
  it("keeps r266 unchanged even when a wait-like field is present", () => {
    expect(modelOverloadRetryOf({ features: new Set(), resource: { runtime, autoRetry: wait } })).toBeNull();
    expect(modelOverloadRetryOf({ features, resource: { runtime } })).toBeNull();
  });
  it("retains explicit waits past their scheduled time, without synthesizing a deadline", () => {
    expect(modelOverloadRetryOf({ features, resource: { runtime, autoRetry: wait } })).toBe(wait);
    for (const phase of ["pending", "firing", "binding", "uncertain"] as const)
      expect(validatedAutoRetryWait({ ...wait, phase, holdsAdmission: false })?.phase).toBe(phase);
  });
  it.each([
    { attempt: 0 }, { attempt: 1.5 }, { maxAttempts: 0 }, { maxAttempts: Infinity },
    { scheduledAt: "tomorrow" }, { planId: "" }, { turnId: " " }, { phase: "done" },
    { holdsAdmission: undefined }, { holdsAdmission: "true" }, { runtimeGeneration: -1 }, { threadId: "" },
  ])("ignores malformed data: %j", (patch) => {
    expect(validatedAutoRetryWait({ ...wait, ...patch })).toBeNull();
  });
  it("prefers the current queue's explicit presence, including clearing", () => {
    const newer = { ...wait, attempt: 2 };
    const resource = { runtime, autoRetry: wait };
    expect(modelOverloadRetryOf({ features, resource, view: { runtimeGeneration: 4, admission: { autoRetry: newer } } })).toBe(newer);
    expect(modelOverloadRetryOf({ features, resource, view: { runtimeGeneration: 4, admission: { autoRetry: null } } })).toBeNull();
    expect(modelOverloadRetryOf({ features, resource, view: { runtimeGeneration: 4, admission: {} } })).toBe(wait);
  });
  it("keeps non-holding resource status when the queue has no matching lease", () => {
    const nonHolding = { ...wait, holdsAdmission: false };
    expect(modelOverloadRetryOf({ features, resource: { runtime, autoRetry: nonHolding }, view: { runtimeGeneration: 4, admission: { autoRetry: null } } })).toBe(nonHolding);
  });
  it("does not reuse queue state across runtime replacement or stale resources", () => {
    const resource = { runtime, autoRetry: null };
    expect(modelOverloadRetryOf({ features, resource, view: { runtimeGeneration: 3, admission: { autoRetry: wait } } })).toBeNull();
    expect(modelOverloadRetryOf({ features, resource: { runtime, autoRetry: wait }, view: { runtimeGeneration: 5 } })).toBeNull();
    expect(modelOverloadRetryOf({ features, resource: { runtime, autoRetry: { ...wait, runtimeGeneration: 3 } } })).toBeNull();
    expect(modelOverloadRetryOf({ features, resource: { runtime, autoRetry: { ...wait, threadId: "old" } }, view: { runtimeGeneration: 4, timeline: { threadId: "new" } } })).toBeNull();
  });
  it("suppresses disconnected/offline presence", () => {
    for (const rt of [{ ...runtime, status: "offline" }, { ...runtime, appServerConnected: false }])
      expect(modelOverloadRetryOf({ features, resource: { runtime: rt, autoRetry: wait } })).toBeNull();
  });
  it("formats translated labels with the server attempt counts", () => {
    const t = vi.fn(() => "waiting");
    expect(formatAutoRetryWait(t, wait)).toBe("waiting");
    expect(t).toHaveBeenCalledWith("agentStatus.autoRetryWaiting", { attempt: 1, maxAttempts: 3 });
    formatAutoRetryWait(t, wait, "queue.autoRetryOwnerOrder");
    expect(t).toHaveBeenLastCalledWith("queue.autoRetryOwnerOrder", { attempt: 1, maxAttempts: 3 });
  });
});
