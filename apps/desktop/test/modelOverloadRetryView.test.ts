import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionResource } from "@cutex-desktop/protocol";
import { MODEL_OVERLOAD_RETRY_VISIBLE_FEATURE } from "../src/renderer/src/lib/modelOverloadRetry";

const state = vi.hoisted(() => ({
  features: new Set<string>(),
  snapshot: { active: [] as SessionResource[] },
  featuresOf: vi.fn(), sidebarOf: vi.fn(), viewOf: vi.fn(),
}));
vi.mock("../src/renderer/src/store", () => ({
  useApp: (select: (s: unknown) => unknown) => select({ hosts: { active: "focus" } }),
  featuresOf: (...args: unknown[]) => { state.featuresOf(...args); return state.features; },
  sidebarOf: (...args: unknown[]) => { state.sidebarOf(...args); return state.snapshot; },
  viewOf: (...args: unknown[]) => { state.viewOf(...args); return undefined; },
}));
import { useModelOverloadRetry } from "../src/renderer/src/lib/modelOverloadRetryView";

const wait = { attempt: 2, maxAttempts: 3, scheduledAt: "2026-10-29T00:00:00Z", turnId: "turn", planId: "plan", phase: "pending", holdsAdmission: true } as const;
const resource = { cutexSessionId: "retry-preview", runtime: { status: "online", runtimeGeneration: 4 }, autoRetry: wait } as SessionResource;
beforeEach(() => {
  vi.clearAllMocks();
  state.features = new Set([MODEL_OVERLOAD_RETRY_VISIBLE_FEATURE]);
  state.snapshot = { active: [resource] };
});

describe("retry wait store selection", () => {
  it("gates before scanning resources or reading a view on capability-off hosts", () => {
    state.features.clear();
    expect(useModelOverloadRetry("retry-preview", "remote")).toBeNull();
    expect(state.sidebarOf).not.toHaveBeenCalled();
    expect(state.viewOf).not.toHaveBeenCalled();
  });
  it("indexes once per immutable snapshot and immediately reads replacement resources", () => {
    const iteration = vi.spyOn(state.snapshot.active, Symbol.iterator);
    expect(useModelOverloadRetry("retry-preview", "remote")).toBe(wait);
    expect(useModelOverloadRetry("retry-preview", "remote")).toBe(wait);
    expect(useModelOverloadRetry("other", "remote")).toBeNull();
    expect(iteration).toHaveBeenCalledOnce();
    const updatedWait = { ...wait, attempt: 3 };
    state.snapshot = { active: [{ ...resource, autoRetry: updatedWait }] };
    expect(useModelOverloadRetry("retry-preview", "remote")).toBe(updatedWait);
    expect(state.featuresOf).toHaveBeenCalledWith(expect.anything(), "remote");
    expect(state.viewOf).toHaveBeenCalledWith(expect.anything(), "remote", "retry-preview");
  });
  it("still looks up the conversation's resource when none is supplied", () => {
    expect(useModelOverloadRetry("retry-preview", "remote")).toBe(wait);
    expect(state.sidebarOf).toHaveBeenCalledWith(expect.anything(), "remote");
  });
  it("does not reuse a resource for a different session", () => {
    expect(useModelOverloadRetry("other", "remote")).toBeNull();
    expect(state.sidebarOf).toHaveBeenCalledOnce();
  });
});
