// @vitest-environment jsdom
// Design 052 §8 Q2: the 快用完 alert is on by default (owner, 2026-11-17); an owner who turned it off keeps it off.
import { afterEach, describe, expect, it, vi } from "vitest";

const load = async (stored: Record<string, unknown> | null) => {
  localStorage.clear();
  if (stored) localStorage.setItem("cutex-desktop.ui", JSON.stringify(stored));
  vi.resetModules();
  return (await import("../src/renderer/src/lib/prefs")).getUiPrefs();
};

afterEach(() => localStorage.clear());

// The first import of lib/prefs (and its graph) can take seconds on a busy run.
describe("quotaRunOutAlert default", { timeout: 30_000 }, () => {
  it("is on for a fresh install and for saved prefs without the key", async () => {
    expect((await load(null)).quotaRunOutAlert).toBe(true);
    expect((await load({ quotaMerge: false })).quotaRunOutAlert).toBe(true);
  });

  it("an explicit off is kept; an explicit on stays on", async () => {
    expect((await load({ quotaRunOutAlert: false })).quotaRunOutAlert).toBe(false);
    expect((await load({ quotaRunOutAlert: true })).quotaRunOutAlert).toBe(true);
  });
});
