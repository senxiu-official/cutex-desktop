import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AGENT_TOAST_RELEASE_MS, dismissAgentToast, holdAgentToast, pushAgentToast, releaseAgentToast, useAgentToasts } from "../src/renderer/src/lib/agentToasts";

const base = { owner: "artifacts", hostId: "h", sessionId: "s", icon: "artifact" as const, text: "x" };
const ids = () => useAgentToasts.getState().toasts.map((t) => t.id);

describe("agent toasts", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    for (const id of ids()) dismissAgentToast(id);
    vi.useRealTimers();
  });

  it("goes after its time", () => {
    const id = pushAgentToast(base, 10_000);
    vi.advanceTimersByTime(9_999);
    expect(ids()).toContain(id);
    vi.advanceTimersByTime(1);
    expect(ids()).not.toContain(id);
  });

  it("a held card stays; on release it gets what was left", () => {
    const id = pushAgentToast(base, 10_000);
    vi.advanceTimersByTime(2_000);
    holdAgentToast(id);
    vi.advanceTimersByTime(60_000);
    expect(ids()).toContain(id);
    releaseAgentToast(id);
    vi.advanceTimersByTime(7_999);
    expect(ids()).toContain(id);
    vi.advanceTimersByTime(1);
    expect(ids()).not.toContain(id);
  });

  it("a card released near its end still gets a few seconds", () => {
    const id = pushAgentToast(base, 10_000);
    vi.advanceTimersByTime(9_900);
    holdAgentToast(id);
    releaseAgentToast(id);
    vi.advanceTimersByTime(AGENT_TOAST_RELEASE_MS - 1);
    expect(ids()).toContain(id);
    vi.advanceTimersByTime(1);
    expect(ids()).not.toContain(id);
  });

  it("an untimed card is not given a timer by hover", () => {
    const id = pushAgentToast(base, 0);
    holdAgentToast(id);
    releaseAgentToast(id);
    vi.advanceTimersByTime(600_000);
    expect(ids()).toContain(id);
  });
});
