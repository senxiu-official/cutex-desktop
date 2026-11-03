// Pending inserts kept across restarts (lib/pendingSteerStore): per (host, agent) in localStorage,
// a re-check in flight is redone (checking → waiting), expired / malformed lists dropped, inline
// images left out when the record grows too large, and missing storage tolerated.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PendingSteer } from "../src/renderer/src/lib/legacyDelivery/pendingSteers";
import { loadPendingSteers, PENDING_STEERS_KEY, savePendingSteers } from "../src/renderer/src/lib/legacyDelivery/pendingSteerStore";

let storage: Map<string, string>;
const steer = (id: string, state: PendingSteer["state"] = "waiting", extra?: unknown[]): PendingSteer => ({ id, text: `text ${id}`, imageCount: 0, turnId: "t1", baseline: 0, state, ...(extra ? { extra } : {}) });

beforeEach(() => {
  storage = new Map();
  vi.stubGlobal("localStorage", { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v), removeItem: (k: string) => void storage.delete(k) });
});
afterEach(() => vi.unstubAllGlobals());

describe("pendingSteerStore", () => {
  it("round-trips per agent, marks them restored, redoes a running re-check, drops empty lists", () => {
    savePendingSteers({ "local\u0000a": [steer("1"), steer("2", "checking"), steer("3", "undelivered")], "h\u0000b": [] }, 1000);
    const back = loadPendingSteers();
    expect(Object.keys(back)).toEqual(["local\u0000a"]);
    expect(back["local\u0000a"]!.map((p) => [p.id, p.state, p.restored])).toEqual([["1", "waiting", true], ["2", "waiting", true], ["3", "undelivered", true]]);
    savePendingSteers({}, 3000);
    expect(storage.has(PENDING_STEERS_KEY)).toBe(false);
  });

  it("an unchanged list keeps its time; nothing is dropped for its age (owner 2026-10-23: no timed deletion)", () => {
    const list = [steer("1")];
    const year = 365 * 24 * 60 * 60 * 1000;
    savePendingSteers({ a: list }, 1000);
    savePendingSteers({ a: list, b: [steer("2")] }, 1000 + year);
    expect(JSON.parse(storage.get(PENDING_STEERS_KEY)!).a.at).toBe(1000);
    const back = loadPendingSteers();
    expect(Object.keys(back).sort()).toEqual(["a", "b"]);
  });

  it("malformed records are ignored", () => {
    storage.set(PENDING_STEERS_KEY, JSON.stringify({ a: { at: Date.now(), steers: [{ id: 3 }, null, { id: "ok", text: "t" }] }, b: "x", c: { steers: [] } }));
    expect(loadPendingSteers()).toEqual({ a: [{ id: "ok", text: "t", imageCount: 0, turnId: null, baseline: 0, state: "waiting", restored: true }] });
    storage.set(PENDING_STEERS_KEY, "{not json");
    expect(loadPendingSteers()).toEqual({});
  });

  it("a too large record leaves inline images out (text and local paths stay)", () => {
    const big = { type: "image", url: `data:image/png;base64,${"A".repeat(1_100_000)}` };
    const local = { type: "localImage", path: "/p.png" };
    savePendingSteers({ a: [steer("1", "waiting", [big, local])] });
    const back = loadPendingSteers();
    expect(back.a![0]!.text).toBe("text 1");
    expect(back.a![0]!.extra).toEqual([local]);
  });

  it("without storage nothing is restored and saving does not throw", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(() => savePendingSteers({ a: [steer("1")] })).not.toThrow();
    expect(loadPendingSteers()).toEqual({});
  });
});
