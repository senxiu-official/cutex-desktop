import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACTIVITY_PREFS_KEY, parseActivityPrefs, reloadActivityPrefs, setIncludeOwnerTurns, useActivityPrefs } from "../src/renderer/src/modules/project-view/activityPrefs";

let stored: Map<string, string>;
beforeEach(() => {
  stored = new Map();
  vi.stubGlobal("localStorage", { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) });
  reloadActivityPrefs();
});
afterEach(() => { vi.unstubAllGlobals(); useActivityPrefs.setState({ includeOwnerTurns: false }); });

describe("project activity preference", () => {
  it("defaults off and restores a real boolean only", () => {
    for (const raw of [null, [], "true", {}, { includeOwnerTurns: "true" }, { includeOwnerTurns: 1 }]) expect(parseActivityPrefs(raw)).toEqual({ includeOwnerTurns: false });
    expect(useActivityPrefs.getState().includeOwnerTurns).toBe(false);
    expect(parseActivityPrefs({ includeOwnerTurns: true })).toEqual({ includeOwnerTurns: true });
  });
  it("persists on and off and restores them in a fresh view", () => {
    setIncludeOwnerTurns(true);
    expect(JSON.parse(stored.get(ACTIVITY_PREFS_KEY)!)).toEqual({ includeOwnerTurns: true });
    useActivityPrefs.setState({ includeOwnerTurns: false });
    reloadActivityPrefs();
    expect(useActivityPrefs.getState().includeOwnerTurns).toBe(true);
    setIncludeOwnerTurns(false);
    useActivityPrefs.setState({ includeOwnerTurns: true });
    reloadActivityPrefs();
    expect(useActivityPrefs.getState().includeOwnerTurns).toBe(false);
  });
  it("tolerates broken or unavailable storage without breaking the filter", () => {
    stored.set(ACTIVITY_PREFS_KEY, "{broken"); reloadActivityPrefs();
    expect(useActivityPrefs.getState().includeOwnerTurns).toBe(false);
    vi.stubGlobal("localStorage", { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("full"); } });
    expect(() => setIncludeOwnerTurns(true)).not.toThrow();
    expect(useActivityPrefs.getState().includeOwnerTurns).toBe(true);
    expect(() => reloadActivityPrefs()).not.toThrow();
  });
});
