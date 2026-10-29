// 0.2.0 beta perf audit follow-up (2026-10-24): a status tick re-rendered, in every changed row, its badge and its
// 「在旁边打开」 button (new props each time), and the offline section re-rendered for any agent's activity. Over 400
// status events with ~100 agents (scripts/qa-perf-baseline.mjs m, dev build): 16 287 → 13 345 component renders;
// AgentBadge 488 → 0, BesideButton 472 → 0, OfflineSection 492 → 0.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { activityTimesFor } from "../src/renderer/src/lib/sessionsMeta";

const SRC = join(__dirname, "../src/renderer/src");

describe("activityTimesFor (lib/sessionsMeta)", () => {
  it("is the same object while the listed rows' times are unchanged, whatever the other agents do", () => {
    const ids = ["a", "b"];
    const first = activityTimesFor({ a: 1, b: 2, c: 3 }, ids);
    expect(first).toEqual({ a: 1, b: 2 });
    // Another agent (c) became active, a new one (d) appeared: same object, the section does not re-render.
    expect(activityTimesFor({ a: 1, b: 2, c: 9, d: 4 }, ids)).toBe(first);
    // One of its own rows changed: a new object.
    const next = activityTimesFor({ a: 5, b: 2, c: 9 }, ids);
    expect(next).not.toBe(first);
    expect(next).toEqual({ a: 5, b: 2 });
    // A row without activity stays out (as before: lastSeen falls back to the row's own time).
    expect(activityTimesFor({ a: 5 }, ["a", "z"])).toEqual({ a: 5 });
  });
});

describe("row parts that do not follow a status tick (source)", () => {
  const rows = readFileSync(join(SRC, "components/AgentRows.tsx"), "utf8");
  const badge = readFileSync(join(SRC, "components/AgentBadge.tsx"), "utf8");
  const sidebar = readFileSync(join(SRC, "components/Sidebar.tsx"), "utf8");
  it("AgentBadge and BesideButton are memo components; BesideButton takes only primitives", () => {
    expect(badge).toMatch(/export const AgentBadge = memo\(function AgentBadge\(/);
    expect(rows).toMatch(/const BesideButton = memo\(function BesideButton\(\{ hostId, id, title, size = 14 \}: \{ hostId: string; id: string; title: string; size\?: number \}\)/);
    for (const use of rows.matchAll(/<BesideButton ([^/]*)\/>/g)) expect(use[1]).not.toMatch(/=\{\(|onOpen|foretell/);
  });
  it("the offline section reads its own rows' activity", () => {
    expect(sidebar).toMatch(/activityTimesFor\(activityTimesOf\(s\.activity\), ids\)/);
  });
});
