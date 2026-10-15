import { describe, expect, it } from "vitest";
import { FIRST_SNAPSHOT_MS, FRESH_MS, freshKeys, freshSince } from "../src/renderer/src/lib/freshAgents";

const T0 = Date.parse("2026-10-15T10:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();

describe("fresh agents", () => {
  const base = { opened: new Set<string>(), firstSeen: new Map<string, number>(), hostSeen: new Map<string, number>([["", T0 - 3_600_000]]) };

  it("is fresh for 30 minutes after createdAt, until opened", () => {
    const rows = [
      { key: "new", createdAt: iso(T0 - 5 * 60_000) },
      { key: "old", createdAt: iso(T0 - FRESH_MS - 1) },
      { key: "seen", createdAt: iso(T0 - 60_000) },
    ];
    const r = freshKeys(rows, { ...base, now: T0, opened: new Set(["seen"]) });
    expect([...r.keys]).toEqual(["new"]);
    expect(r.nextChange).toBe(T0 - 5 * 60_000 + FRESH_MS);
    // Expired at that time.
    expect(freshKeys(rows, { ...base, now: r.nextChange!, opened: new Set(["seen"]) }).keys.size).toBe(0);
  });

  it("without createdAt: first sighting this run, never agents of the host's first snapshot", () => {
    const hostSeen = new Map([["h", T0]]);
    const firstSeen = new Map([
      ["initial", T0 + 200],
      ["later", T0 + FIRST_SNAPSHOT_MS + 5_000],
    ]);
    expect(freshSince({ key: "initial", hostId: "h", createdAt: null }, { firstSeen, hostSeen })).toBeNull();
    expect(freshSince({ key: "later", hostId: "h" }, { firstSeen, hostSeen })).toBe(T0 + FIRST_SNAPSHOT_MS + 5_000);
    expect(freshSince({ key: "unknown", hostId: "h" }, { firstSeen, hostSeen })).toBeNull();
    const r = freshKeys([{ key: "initial", hostId: "h" }, { key: "later", hostId: "h" }], { now: T0 + 60_000, opened: new Set(), firstSeen, hostSeen });
    expect([...r.keys]).toEqual(["later"]);
  });

  it("an unparsable createdAt falls back to the sighting rule", () => {
    expect(freshSince({ key: "x", createdAt: "not a date" }, { firstSeen: new Map(), hostSeen: new Map() })).toBeNull();
  });
});
